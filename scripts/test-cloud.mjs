// Live smoke/race/isolation checks. Tokens and hands never appear in reports.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chooseAiCommand } from '../packages/game-core/src/index.ts';
const { createClient } = createRequire(new URL('../apps/web/package.json', import.meta.url))(
  '@supabase/supabase-js',
);
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ];
    }),
);
const url = env.VITE_SUPABASE_URL,
  key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const clients = Array.from({ length: 3 }, () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
);
const ids = [],
  roomIds = [],
  gameIds = [];
const report = { at: new Date().toISOString(), checks: [], seatCounts: [], completedRound: false };
mkdirSync('.deploy', { recursive: true });
function saveCleanup() {
  writeFileSync(
    '.deploy/test-ids.json',
    JSON.stringify({ users: ids, rooms: roomIds, games: gameIds }),
  );
}
async function call(client, operation, body = {}) {
  const { data, error } = await client.functions.invoke('game-api', {
    body: { operation, ...body },
  });
  if (error) {
    let code = 'NETWORK_OR_FUNCTION_ERROR';
    try {
      code = (await error.context.json()).error;
    } catch {}
    throw new Error(code);
  }
  return data.data;
}
const room = (client, op, data = {}) => call(client, `room.${op}`, { data });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function channel(client, topic, expect = true) {
  const ch = client.channel(topic, { config: { private: true } });
  let count = 0;
  ch.on('broadcast', { event: 'changed' }, () => {
    count++;
  });
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 12000);
    ch.subscribe((s) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(s)) {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  if (expect) assert.equal(status, 'SUBSCRIBED');
  else assert.notEqual(status, 'SUBSCRIBED');
  return { ch, count: () => count };
}
try {
  for (const client of clients) {
    const result = await client.auth.signInAnonymously();
    if (result.error) throw new Error(`AUTH_${result.error.code}`);
    ids.push(result.data.user.id);
    saveCleanup();
  }
  console.log('Live Auth: three independent guests established.');
  report.checks.push('anonymous-auth');
  const [a, b, c] = clients;
  for (const n of [2, 3, 4, 5, 6]) {
    const made = await room(a, 'create', { name: 'Deployment QA A', seatCount: n });
    roomIds.push(made.room.id);
    saveCleanup();
    let r = await room(b, 'join', { name: 'Deployment QA B', code: made.code });
    for (let seat = 2; seat < n; seat++)
      r = await room(a, 'ai', { roomId: r.id, revision: r.revision, seat, difficulty: 'normal' });
    r = await room(a, 'ready', { roomId: r.id, revision: r.revision, ready: true });
    r = await room(b, 'ready', { roomId: r.id, revision: r.revision, ready: true });
    const { gameId } = await room(a, 'start', { roomId: r.id, revision: r.revision });
    gameIds.push(gameId);
    saveCleanup();
    const [sa, sb] = await Promise.all([
      call(a, 'snapshot', { gameId }),
      call(b, 'snapshot', { gameId }),
    ]);
    assert.equal(sa.viewerSeat, 0);
    assert.equal(sb.viewerSeat, 1);
    assert.equal(sa.public.gameId, sb.public.gameId);
    assert.equal(sa.hand.length, (n <= 4 ? 20 : n === 5 ? 16 : 14) + 1);
    assert.equal(sb.hand.length, sa.hand.length - 1);
    assert.equal(sa.hands, undefined);
    assert.equal(sa.wall, undefined);
    assert.equal(sa.public.hands, undefined);
    assert.equal(sa.public.responses, undefined);
    assert.ok(sa.hand.every((tile) => !sb.hand.includes(tile)));
    await assert.rejects(() => call(c, 'snapshot', { gameId }), /NOT_GAME_MEMBER/);
    const privateRead = await c.from('games').select('*').eq('id', gameId);
    assert.equal(privateRead.data.length, 0);
    const privileged = await a.rpc('server_game_context', { p_game: gameId });
    assert.ok(privileged.error);
    const dml = await a.from('games').update({ board_version: 999 }).eq('id', gameId);
    assert.ok(dml.error);
    let rt;
    if (n === 2) {
      rt = await channel(b, `game:${gameId}`);
      const denied = await channel(c, `game:${gameId}`, false);
      await c.removeChannel(denied.ch);
      report.checks.push(
        'private-realtime-membership',
        'rest-rls',
        'backend-rpc-denied',
        'client-writes-denied',
      );
    }
    const options = sa.legalOptions.filter((o) => o.command.type === 'discard');
    const requests = options
      .slice(0, 2)
      .map((o) => ({
        gameId,
        expectedBoardVersion: sa.public.boardVersion,
        idempotencyKey: crypto.randomUUID(),
        command: o.command,
      }));
    const race = await Promise.allSettled(
      requests.map((request) => call(a, 'command', { request })),
    );
    assert.equal(race.filter((v) => v.status === 'fulfilled').length, 1);
    const index = race.findIndex((v) => v.status === 'fulfilled');
    const retry = await call(a, 'command', { request: requests[index] });
    assert.deepEqual(retry, race[index].value);
    report.checks.push(`race-idempotency-${n}`);
    if (rt) {
      for (let i = 0; i < 10 && rt.count() === 0; i++) await pause(1000);
      assert.ok(rt.count() > 0);
      await b.removeChannel(rt.ch);
    }
    report.seatCounts.push(n);
    console.log(
      `Live ${n} seats: mixed room, own-hand isolation, simultaneous commands and exact retry receipt passed.`,
    );
  }
  // Complete one real cloud round using only each player's allowed observation.
  const gameId = gameIds[0];
  for (let step = 0; step < 450; step++) {
    const snaps = await Promise.all([
      call(clients[0], 'snapshot', { gameId }),
      call(clients[1], 'snapshot', { gameId }),
    ]);
    if (snaps[0].public.result) {
      report.completedRound = true;
      report.resultReason = snaps[0].public.result.reason;
      assert.equal(
        snaps[0].public.result.scores.reduce((n, s) => n + s.delta, 0),
        0,
      );
      break;
    }
    await Promise.all(
      snaps.map(async (s, seat) => {
        if (!s.legalOptions.length) return;
        const command = chooseAiCommand(
          { seat, ownHand: s.hand, public: s.public, legalOptions: s.legalOptions },
          'normal',
          (n) => 0 % n,
        );
        await call(clients[seat], 'command', {
          request: {
            gameId,
            expectedBoardVersion: s.public.boardVersion,
            idempotencyKey: crypto.randomUUID(),
            command,
          },
        }).catch((e) => {
          if (!/STALE_VERSION|WINDOW_EXPIRED|WINDOW_FROZEN|TURN_EXPIRED/.test(e.message)) throw e;
        });
      }),
    );
    if (step % 30 === 0)
      console.log(`Live round progressing: step ${step}, board ${snaps[0].public.boardVersion}.`);
    await pause(1200);
  }
  assert.ok(report.completedRound, 'Cloud round did not finish within the test budget');
  console.log(
    `Live round completed (${report.resultReason}); server jobs resolved windows and zero-sum settlement passed.`,
  );
  const r = await room(clients[0], 'get', { roomId: roomIds[0] });
  assert.equal(r.status, 'waiting');
  assert.ok(r.members.every((m) => !m.ready));
  report.checks.push('server-job-resolution', 'zero-sum-settlement', 'next-round-room-reset');
  writeFileSync('docs/cloud-verification.json', JSON.stringify(report, null, 2));
} catch (e) {
  console.error(`Cloud verification failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.removeAllChannels()));
  saveCleanup();
}
