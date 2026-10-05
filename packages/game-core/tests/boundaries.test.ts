import { expect, it } from 'vitest';
import {
  applyGameCommand,
  assertStateInvariants,
  createDeck,
  createInitialState,
  makeRuleConfig,
  resolveReactionWindow,
} from '../src/index.ts';
import type { AuthoritativeState, ClaimIntent } from '../src/index.ts';
function offerFixture(hands: number[][], discard: number): AuthoritativeState {
  const s = createInitialState(
    createDeck(),
    0,
    makeRuleConfig(2),
    [
      { kind: 'human', userId: '0' },
      { kind: 'human', userId: '1' },
    ],
    'boundary',
    { nowMs: 1, id: 'init' },
  );
  s.hands = hands;
  s.wall = createDeck().filter((id) => !hands.flat().includes(id));
  const r = applyGameCommand(
    s,
    0,
    { type: 'discard', tileId: discard },
    { nowMs: 2, id: 'discard' },
  );
  if (!r.ok) throw new Error(r.error.code);
  return r.state;
}
function claim(s: AuthoritativeState, intent: ClaimIntent): AuthoritativeState {
  const r = applyGameCommand(
    s,
    1,
    { type: 'respond', windowId: s.window!.id, responseRevision: 0, intent },
    { nowMs: 3, id: 'respond' },
  );
  if (!r.ok) throw new Error(r.error.code);
  return r.state;
}
function resolve(s: AuthoritativeState): AuthoritativeState {
  const r = resolveReactionWindow(s, s.window!.id, { nowMs: 13000, id: 'resolve' });
  if (!r.ok) throw new Error(r.error.code);
  assertStateInvariants(r.state);
  return r.state;
}
it('any owned physical copies of a legal claim are accepted', () => {
  let s = offerFixture([[12], [15, 14, 13, 16]], 12);
  s = claim(s, { kind: 'claim', action: 'pong', meldKind: 'triple', handTileIds: [15, 13] });
  s = resolve(s);
  expect(s.melds[0].tileIds.sort((a, b) => a - b)).toEqual([12, 13, 15]);
  expect(s.hands[1]).toContain(14);
});
it('a repeated physical ID in a claim is rejected', () => {
  const s = offerFixture([[12], [13, 14, 16]], 12);
  const before = JSON.stringify(s);
  const r = applyGameCommand(
    s,
    1,
    {
      type: 'respond',
      windowId: s.window!.id,
      responseRevision: 0,
      intent: { kind: 'claim', action: 'pong', meldKind: 'triple', handTileIds: [13, 13] },
    },
    { nowMs: 3, id: 'bad' },
  );
  expect(r.ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});
it('non-hu claim completes at 10 and does not misclassify an all-general remainder', () => {
  let s = offerFixture([[12], [13, 14, 0, 1, 2, 28, 29, 56, 57, 84, 85]], 12);
  s = claim(s, { kind: 'claim', action: 'pong', meldKind: 'triple', handTileIds: [13, 14] });
  s = resolve(s);
  expect(s.result).toMatchObject({ reason: 'win', winnerSeat: 1, baseHu: 10 });
});
it('the last offer is settled before declaring a draw', () => {
  let s = offerFixture([[12], [13, 14]], 12);
  s.discards.push(...s.wall);
  s.wall = [];
  s = claim(s, { kind: 'pass' });
  s = resolve(s);
  expect(s.phase).toBe('drawn_game');
  expect(s.result?.scores.map((x) => x.delta)).toEqual([0, 0]);
  expect(s.discards).toContain(12);
});
it('winning on the last offer uses first-discard flower type without moving a card', () => {
  let s = offerFixture([[12], [40, 41, 42, 43, 84, 85, 86, 87, 15]], 12);
  s.discards.push(...s.wall);
  s.wall = [];
  s = claim(s, { kind: 'hu' });
  s = resolve(s);
  expect(s.result).toMatchObject({ reason: 'win', baseHu: 14, flowerHu: 2, totalHu: 16 });
  expect(s.flowerTileId).toBeNull();
});
it('kong does not replenish from the wall', () => {
  let s = offerFixture([[12], [13, 14, 15, 16]], 12);
  const before = s.wall.length;
  s = claim(s, { kind: 'claim', action: 'kong', meldKind: 'quad', handTileIds: [13, 14, 15] });
  s = resolve(s);
  expect(s.wall).toHaveLength(before);
  expect(s.phase).toBe('await_discard');
});
it('a stale window cannot resolve the current board', () => {
  const s = offerFixture([[12], [13, 14]], 12);
  expect(resolveReactionWindow(s, 'old', { nowMs: 13000, id: 'old' })).toMatchObject({
    ok: false,
    error: { code: 'WINDOW_CLOSED' },
  });
});
it('accepted command and injected context replay identically', () => {
  const s = offerFixture([[12], [13, 14]], 12);
  const command = {
    type: 'respond' as const,
    windowId: s.window!.id,
    responseRevision: 0,
    intent: { kind: 'pass' as const },
  };
  const ctx = { nowMs: 3, id: 'replay' };
  expect(applyGameCommand(s, 1, command, ctx)).toEqual(applyGameCommand(s, 1, command, ctx));
});
it('finished games reject a second settlement', () => {
  let s = offerFixture([[12], [13, 14]], 12);
  s = claim(s, { kind: 'claim', action: 'pong', meldKind: 'triple', handTileIds: [13, 14] });
  s = resolve(s);
  expect(
    applyGameCommand(s, 1, { type: 'open_draw' }, { nowMs: 13001, id: 'again' }),
  ).toMatchObject({ ok: false, error: { code: 'GAME_FINISHED' } });
});
