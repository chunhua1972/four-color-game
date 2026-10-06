import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  createDeck,
  createInitialState,
  makeRuleConfig,
  buildPublicSnapshot,
  applyGameCommand,
} from '../packages/game-core/src/index.ts';
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
);
for (const file of ['20261006000100_4color_foundation.sql', '20261006000200_4color_cloud_game.sql'])
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
const a = crypto.randomUUID(),
  b = crypto.randomUUID(),
  c = crypto.randomUUID(),
  rid = crypto.randomUUID();
await db.query('insert into auth.users values($1),($2),($3)', [a, b, c]);
async function room(actor, op, data) {
  return (
    await db.query('select public."4color_server_room_action"($1,$2,$3) as v', [
      actor,
      op,
      JSON.stringify(data),
    ])
  ).rows[0].v;
}
let r = await room(a, 'create', {
  id: rid,
  name: 'A',
  seatCount: 2,
  rules: makeRuleConfig(2),
  codeHash: 'test-code',
});
assert.equal(r.members.length, 1);
r = await room(b, 'join', { name: 'B', codeHash: 'test-code' });
await assert.rejects(() => room(c, 'join', { name: 'C', codeHash: 'test-code' }), /ROOM_FULL/);
await assert.rejects(
  () => room(b, 'ai', { roomId: rid, revision: r.revision, seat: 1, difficulty: 'normal' }),
  /HOST_ONLY/,
);
r = await room(a, 'ready', { roomId: rid, revision: r.revision, ready: true });
await assert.rejects(
  () => room(b, 'ready', { roomId: rid, revision: r.revision - 1, ready: true }),
  /STALE_ROOM/,
);
r = await room(b, 'ready', { roomId: rid, revision: r.revision, ready: true });
const game = crypto.randomUUID(),
  now = Date.now();
const state = createInitialState(
  createDeck(),
  0,
  makeRuleConfig(2),
  [
    { kind: 'human', userId: a },
    { kind: 'human', userId: b },
  ],
  game,
  { nowMs: now, id: crypto.randomUUID() },
);
await db.query('select public."4color_server_start_game"($1,$2,$3,$4,$5,$6)', [
  a,
  rid,
  r.revision,
  JSON.stringify(state),
  JSON.stringify(buildPublicSnapshot(state)),
  'hash',
]);
assert.equal(
  (await db.query('select count(*)::int as n from "4color_private"."4color_tile_locations"')).rows[0].n,
  112,
);
assert.ok((await db.query('select count(*)::int as n from "4color_private"."4color_jobs"')).rows[0].n >= 3);
async function ctx() {
  return (await db.query('select public."4color_server_game_context"($1,$2) as v', [game, a])).rows[0].v;
}
const context = await ctx();
const action = {
  type: 'discard',
  tileId: state.hands[0].find((id) => Math.floor(id / 4) % 7 !== 0),
};
const transition = applyGameCommand(state, 0, action, { nowMs: now + 1, id: crypto.randomUUID() });
assert.ok(transition.ok);
const next = transition.state,
  key = crypto.randomUUID(),
  receipt = { accepted: true, test: true };
const args = [
  game,
  context.stateHash,
  JSON.stringify(next),
  JSON.stringify(buildPublicSnapshot(next)),
  a,
  key,
  'request-hash',
  JSON.stringify(receipt),
];
async function commit(values) {
  return (await db.query('select public."4color_server_commit_game"($1,$2,$3,$4,$5,$6,$7,$8) as v', values))
    .rows[0].v;
}
const first = await commit(args);
assert.ok(first.committed);
assert.deepEqual((await commit(args)).receipt, receipt);
await assert.rejects(
  () => commit([...args.slice(0, 6), 'different', args[7]]),
  /IDEMPOTENCY_MISMATCH/,
);
const conflict = await commit([...args.slice(0, 5), crypto.randomUUID(), ...args.slice(6)]);
assert.equal(conflict.conflict, true);
const before = (await ctx()).stateHash;
const invalid = structuredClone(next);
invalid.wall.pop();
await assert.rejects(
  () =>
    commit([
      game,
      before,
      JSON.stringify(invalid),
      JSON.stringify(buildPublicSnapshot(invalid)),
      a,
      crypto.randomUUID(),
      'x',
      '{}',
    ]),
  /TILE_CONSERVATION/,
);
assert.equal((await ctx()).stateHash, before);
await db.exec(`set role authenticated`);
await assert.rejects(
  () => db.query('select public."4color_server_game_context"($1)', [game]),
  /permission denied/,
);
await assert.rejects(() => db.query('select public."4color_server_claim_jobs"()'), /permission denied/);
await db.exec('reset role');
const jobs = (await db.query('select public."4color_server_claim_jobs"(12) as v')).rows[0].v;
assert.ok(Array.isArray(jobs));
const again = (await db.query('select public."4color_server_claim_jobs"(12) as v')).rows[0].v;
assert.equal(again.length, 0);
await db.close();
console.log(
  'Cloud transactions passed: room permission/occupancy/revision, atomic 112-tile commit, exact idempotency receipt, CAS conflict, rollback, backend-only RPCs, job leases.',
);
