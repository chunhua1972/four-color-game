import { expect, it } from 'vitest';
import {
  applyGameCommand,
  assertStateInvariants,
  buildPlayerSnapshot,
  createDeck,
  createInitialState,
  makeRuleConfig,
  resolveReactionWindow,
  seatDistance,
} from '../src/index.ts';
import type { AuthoritativeState, ClaimIntent, SeatCount } from '../src/index.ts';
const ctx = { nowMs: 1, id: 'test' };
function setup(hands: number[][]): AuthoritativeState {
  const s = createInitialState(
    createDeck(),
    0,
    makeRuleConfig(hands.length as SeatCount),
    hands.map((_, i) => ({ kind: 'human', userId: String(i) })),
    'test',
    ctx,
  );
  s.hands = hands;
  const owned = new Set(hands.flat());
  s.wall = createDeck().filter((id) => !owned.has(id));
  assertStateInvariants(s);
  return s;
}
function discarded(s: AuthoritativeState, id: number): AuthoritativeState {
  const r = applyGameCommand(s, 0, { type: 'discard', tileId: id }, { nowMs: 2, id: 'discard' });
  if (!r.ok) throw new Error(r.error.code);
  return r.state;
}
function respond(s: AuthoritativeState, seat: number, intent: ClaimIntent): AuthoritativeState {
  const r = applyGameCommand(
    s,
    seat,
    { type: 'respond', windowId: s.window!.id, intent, responseRevision: 0 },
    { nowMs: 3, id: `respond${seat}` },
  );
  if (!r.ok) throw new Error(r.error.code);
  return r.state;
}
function resolve(s: AuthoritativeState): AuthoritativeState {
  const r = resolveReactionWindow(s, s.window!.id, {
    nowMs: 13000,
    id: 'resolve',
  });
  if (!r.ok) throw new Error(r.error.code);
  return r.state;
}
it('forbids discarding generals and other players cards with no state mutation', () => {
  const s = setup([[0, 12], [40]]);
  const before = JSON.stringify(s);
  expect(applyGameCommand(s, 0, { type: 'discard', tileId: 0 }, ctx)).toMatchObject({
    ok: false,
    error: { code: 'GENERAL_NOT_DISCARDABLE' },
  });
  expect(applyGameCommand(s, 0, { type: 'discard', tileId: 40 }, ctx).ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});
it('same window responses do not advance boardVersion and cannot be changed', () => {
  let s = discarded(setup([[12], [13, 14], [16, 20]]), 12);
  const v = s.boardVersion;
  s = respond(s, 1, { kind: 'pass' });
  expect(s.boardVersion).toBe(v);
  expect(
    applyGameCommand(
      s,
      1,
      {
        type: 'respond',
        windowId: s.window!.id,
        intent: { kind: 'hu' },
        responseRevision: 0,
      },
      ctx,
    ),
  ).toMatchObject({ ok: false, error: { code: 'RESPONSE_ALREADY_LOCKED' } });
});
it('pong outranks an earlier eat', () => {
  let s = discarded(setup([[12], [16, 20], [13, 14]]), 12);
  s = respond(s, 1, {
    kind: 'claim',
    action: 'eat',
    meldKind: 'army',
    handTileIds: [16, 20],
  });
  s = respond(s, 2, {
    kind: 'claim',
    action: 'pong',
    meldKind: 'triple',
    handTileIds: [13, 14],
  });
  s = resolve(s);
  expect(s.melds[0].ownerSeat).toBe(2);
  assertStateInvariants(s);
});
it('hu outranks pong and moves the offer exactly once', () => {
  let s = discarded(setup([[12], [13, 14], [40, 41, 42, 43, 84, 85, 86, 87, 15]]), 12);
  s = respond(s, 1, {
    kind: 'claim',
    action: 'pong',
    meldKind: 'triple',
    handTileIds: [13, 14],
  });
  s = respond(s, 2, { kind: 'hu' });
  s = resolve(s);
  expect(s.result?.winnerSeat).toBe(2);
  expect(s.hands[2]).toContain(12);
  expect(s.discards).not.toContain(12);
  assertStateInvariants(s);
});
it('two hu use source seat order even when farther seat responded first', () => {
  let s = setup([
    [57, 16],
    [12, 13, 14, 15, 28],
    [40, 41, 42, 43, 84],
  ]);
  s.phase = 'await_draw';
  s.activeSeat = 0;
  s.wall = s.wall.filter((id) => id !== 58);
  s.wall.unshift(58);
  const r = applyGameCommand(s, 0, { type: 'open_draw' }, { nowMs: 2, id: 'draw' });
  if (!r.ok) throw new Error(r.error.code);
  s = r.state;
  s = respond(s, 2, { kind: 'hu' });
  s = respond(s, 1, { kind: 'hu' });
  s = resolve(s);
  expect(s.result?.winnerSeat).toBe(1);
});
it('a drawn general cannot be passed, but times out to a legal single', () => {
  let s = setup([[12], [40]]);
  s.phase = 'await_draw';
  s.wall = s.wall.filter((id) => id !== 0);
  s.wall.unshift(0);
  const r = applyGameCommand(s, 0, { type: 'open_draw' }, { nowMs: 2, id: 'draw' });
  if (!r.ok) throw new Error(r.error.code);
  s = r.state;
  expect(
    applyGameCommand(
      s,
      0,
      {
        type: 'respond',
        windowId: s.window!.id,
        intent: { kind: 'pass' },
        responseRevision: 0,
      },
      { nowMs: 3, id: 'pass' },
    ),
  ).toMatchObject({ ok: false, error: { code: 'PASS_FORBIDDEN' } });
  s = resolve(s);
  expect(s.melds[0].kind).toBe('general_single');
  expect(s.activeSeat).toBe(0);
  expect(s.wall).toHaveLength(109);
});
it('claiming the final hand below 10 hu ends in a penalty', () => {
  let s = discarded(setup([[12], [13, 14]]), 12);
  s = respond(s, 1, {
    kind: 'claim',
    action: 'pong',
    meldKind: 'triple',
    handTileIds: [13, 14],
  });
  s = resolve(s);
  expect(s.result?.reason).toBe('xiang_gong');
  expect(s.result?.penaltySeat).toBe(1);
});
it('window rejects commands exactly at deadline', () => {
  const s = discarded(setup([[12], [13, 14]]), 12);
  expect(
    applyGameCommand(
      s,
      1,
      {
        type: 'respond',
        windowId: s.window!.id,
        intent: { kind: 'pass' },
        responseRevision: 0,
      },
      { nowMs: s.window!.deadlineAtMs, id: 'late' },
    ),
  ).toMatchObject({ ok: false, error: { code: 'WINDOW_CLOSED' } });
});
it('public projection never includes other concealed cards, wall, or pending intentions', () => {
  const s = setup([
    [12, 0],
    [40, 41],
  ]);
  const snap = buildPlayerSnapshot(s, 0, 1);
  expect(snap.hand).toEqual([0, 12]);
  expect(Object.keys(snap.public)).not.toContain('hands');
  expect(Object.keys(snap.public)).not.toContain('wall');
  expect(Object.keys(snap.public)).not.toContain('responses');
  expect(snap.public.seats[1]).toMatchObject({ handCount: 2 });
});
it.each([2, 3, 4, 5, 6])('seat distance and turn order use N=%i', (n) => {
  expect(seatDistance(n - 1, 0, 'discard', n)).toBe(0);
  expect(seatDistance(n - 1, n - 1, 'open_draw', n)).toBe(0);
  let s = discarded(setup(Array.from({ length: n }, (_, i) => [12 + i * 4])), 12);
  s = resolve(s);
  expect(s.activeSeat).toBe(1);
});
