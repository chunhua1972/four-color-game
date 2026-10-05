import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateFlowerHu,
  calculateScore,
  classifyMeld,
  createDeck,
  dealRound,
  evaluateHu,
  findBestCompletePartition,
  getMeldHu,
  makeRuleConfig,
  PATTERNS,
  shuffleDeck,
  solveCounts,
  toCounts,
  validateRuleConfig,
} from '../src/index.ts';
import type { Meld, SeatCount } from '../src/index.ts';
import { seededRandom } from '../../../scripts/random.ts';
const ids = (...types: number[]) => {
  const used = Array<number>(28).fill(0);
  return types.map((t) => t * 4 + used[t]++);
};
describe('catalog and presets', () => {
  it('contains exactly 112 unique cards, four copies each', () => {
    expect(new Set(createDeck()).size).toBe(112);
    expect(toCounts(createDeck())).toEqual(Array(28).fill(4));
  });
  it.each([
    [2, 41, 71],
    [3, 61, 51],
    [4, 81, 31],
    [5, 81, 31],
    [6, 85, 27],
  ])('%i seats deal %i, leave %i', (n, dealt, wall) => {
    const rules = makeRuleConfig(n as SeatCount);
    const d = dealRound(createDeck(), n - 1, rules);
    expect(d.hands.flat()).toHaveLength(dealt);
    expect(d.wall).toHaveLength(wall);
    expect(d.hands[n - 1]).toHaveLength(rules.baseHandSize + 1);
  });
  it('rejects incompatible rule overrides', () => {
    expect(() => validateRuleConfig({ ...makeRuleConfig(6), baseHandSize: 20 })).toThrow();
    expect(() => makeRuleConfig(7 as SeatCount)).toThrow();
  });
  it('rejects repeated physical IDs and bad counts', () => {
    expect(() => toCounts([0, 0])).toThrow('DUPLICATE_TILE_ID');
    expect(() => solveCounts(Array(28).fill(5))).toThrow();
    expect(() => toCounts([112])).toThrow();
  });
  it('shuffle preserves every physical card over arbitrary seeds', () =>
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const deck = shuffleDeck(createDeck(), seededRandom(seed));
        expect([...deck].sort((a, b) => a - b)).toEqual(createDeck());
      }),
      { numRuns: 100 },
    ));
});
describe('golden patterns and exposure matrix', () => {
  it.each(PATTERNS.map((p) => [p.key, p] as const))('%s classification and hu', (_, p) => {
    expect(classifyMeld(p.types)).toBe(p.kind);
  });
  it.each([
    [[0, 1, 2], 'court', 2, 2],
    [[3, 4, 5], 'army', 1, 1],
    [[6, 13, 20], 'soldier_three', 3, 3],
    [[6, 13, 20, 27], 'soldier_four', 5, 5],
    [[3, 3], 'pair', 0, 0],
    [[3, 3, 3], 'triple', 3, 1],
    [[3, 3, 3, 3], 'quad', 8, 6],
    [[0, 0, 0, 0], 'general_quad', 6, 8],
    [[0], 'general_single', 1, 1],
  ] as const)('golden %j', (types, kind, dark, open) => {
    expect(classifyMeld(types)).toBe(kind);
    expect(getMeldHu(kind, 'concealed')).toBe(dark);
    expect(getMeldHu(kind, 'exposed')).toBe(open);
  });
  it.each([[6, 6], [0, 0, 0], [3, 11, 19], [6, 6, 13], [1], [0, 1], [27, 27], [28]])(
    'invalid %j',
    (...types) => expect(classifyMeld(types)).toBeNull(),
  );
});
describe('exact-cover solver', () => {
  it('three generals are three singles, not a triple', () => {
    const r = findBestCompletePartition(ids(0, 0, 0));
    expect(r.status === 'complete' && r.concealedAndIncomingHu).toBe(3);
  });
  it('dark quad plus two generals is 10 hu', () => {
    const r = evaluateHu(ids(3, 3, 3, 3, 7, 14), null, [], makeRuleConfig(4));
    expect(r.status === 'eligible' && r.baseHu).toBe(10);
  });
  it('incoming quad scores exposed 6, dark remainder scores 8', () => {
    const hand = ids(3, 3, 3, 10, 10, 10, 10);
    const r = findBestCompletePartition(hand, 15);
    expect(r.status === 'complete' && r.concealedAndIncomingHu).toBe(14);
    if (r.status === 'complete') expect(r.groups.filter((g) => g.includesIncoming)).toHaveLength(1);
  });
  it('incoming general quad prefers exposed 8 to singles', () => {
    const r = findBestCompletePartition([0, 1, 2], 3);
    expect(r.status === 'complete' && r.concealedAndIncomingHu).toBe(8);
  });
  it('never ignores an unmatched soldier', () =>
    expect(evaluateHu(ids(3, 3, 3, 3, 7, 14, 6), null, [], makeRuleConfig(4)).status).toBe(
      'not_complete',
    ));
  it('fixed exposed quad cannot be rescored as concealed', () => {
    const meld: Meld = {
      id: 'm',
      ownerSeat: 0,
      kind: 'quad',
      tileIds: ids(3, 3, 3, 3),
      exposure: 'exposed',
      hu: 6,
      claimedOfferId: 'o',
      sourceSeat: 1,
    };
    const r = evaluateHu(ids(7, 14), null, [meld], makeRuleConfig(4));
    expect(r.status === 'below_threshold' && r.baseHu).toBe(8);
  });
  it('complete 9 hu cannot qualify with flowers', () => {
    const r = evaluateHu(ids(3, 3, 3, 3, 7), null, [], makeRuleConfig(4));
    expect(r.status).toBe('below_threshold');
  });
  it.each([
    [4, [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 22, 22, 22, 22, 0, 0, 0, 0, 14], 39],
    [5, [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 22, 22, 22, 22, 0], 33],
    [6, [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 21, 21, 21], 27],
  ] as const)('%i-seat opening win exists', (n, types, expected) => {
    const r = evaluateHu(ids(...types), null, [], makeRuleConfig(n));
    expect(r.status === 'eligible' && r.baseHu).toBe(expected);
  });
  it('empty hand is a complete zero-hu base', () => {
    const r = findBestCompletePartition([]);
    expect(r.status === 'complete' && r.concealedAndIncomingHu).toBe(0);
  });
  it('budget exhaustion is deferred', () =>
    expect(findBestCompletePartition(ids(3, 3, 3, 3), null, 1).status).toBe('deferred'));
  it('physical copies and input order do not affect hu', () => {
    expect(findBestCompletePartition([12, 13, 14])).toMatchObject({
      status: 'complete',
      concealedAndIncomingHu: 3,
    });
    expect(findBestCompletePartition([15, 14, 13])).toMatchObject({
      status: 'complete',
      concealedAndIncomingHu: 3,
    });
  });
  it('matches an independent physical-subset brute force oracle on small hands', () => {
    // Independent rule recognition and scoring; does not call patterns or classifyMeld.
    const score = (group: number[], incoming: number | null): number | null => {
      const t = group.map((id) => Math.floor(id / 4));
      const roles = t.map((n) => n % 7);
      const same = t.every((n) => n === t[0]);
      const open = incoming !== null && group.includes(incoming);
      if (group.length === 1) return roles[0] === 0 ? 1 : null;
      if (same) {
        if (group.length === 2 && roles[0] !== 0 && roles[0] !== 6) return 0;
        if (group.length === 3 && roles[0] !== 0) return open ? 1 : 3;
        if (group.length === 4) return roles[0] === 0 ? (open ? 8 : 6) : open ? 6 : 8;
      }
      const sameColor = t.every((n) => Math.floor(n / 7) === Math.floor(t[0] / 7));
      const sorted = [...roles].sort().join('');
      if (group.length === 3 && sameColor && sorted === '012') return 2;
      if (group.length === 3 && sameColor && sorted === '345') return 1;
      if (roles.every((r) => r === 6) && new Set(t).size === t.length)
        return group.length === 3 ? 3 : group.length === 4 ? 5 : null;
      return null;
    };
    const brute = (cards: number[], incoming: number | null): number | null => {
      if (!cards.length) return 0;
      let best: number | null = null;
      for (let mask = 1; mask < 1 << cards.length; mask += 2) {
        const group = cards.filter((_, i) => (mask & (1 << i)) !== 0);
        if (group.length > 4) continue;
        const hu = score(group, incoming);
        if (hu === null) continue;
        const child = brute(
          cards.filter((_, i) => (mask & (1 << i)) === 0),
          incoming,
        );
        if (child !== null) best = Math.max(best ?? -Infinity, hu + child);
      }
      return best;
    };
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 31 }), {
          minLength: 0,
          maxLength: 8,
        }),
        fc.boolean(),
        (hand, hasIncoming) => {
          const incoming = hasIncoming && hand.length ? hand[hand.length - 1] : null;
          const exact = findBestCompletePartition(
            incoming === null ? hand : hand.slice(0, -1),
            incoming,
          );
          const expected = brute(hand, incoming);
          expect(exact.status).toBe(expected === null ? 'not_complete' : 'complete');
          if (exact.status === 'complete') expect(exact.concealedAndIncomingHu).toBe(expected);
        },
      ),
      { numRuns: 200, seed: 10205 },
    );
  });
});
describe('settlement', () => {
  it('four seats 12 hu: +9,-3,-3,-3', () =>
    expect(calculateScore(4, 'win', 0, 12).map((s) => s.delta)).toEqual([9, -3, -3, -3]));
  it('six seats 10 hu: winner +5', () =>
    expect(calculateScore(6, 'win', 2, 10).map((s) => s.delta)).toEqual([-1, -1, 5, -1, -1, -1]));
  it('penalty pays 11 to each other seat', () =>
    expect(calculateScore(3, 'xiang_gong', 1).map((s) => s.delta)).toEqual([11, -22, 11]));
  it('flower checks all owned copies', () =>
    expect(calculateFlowerHu(ids(3, 3, 3, 3, 7), 3)).toBe(4));
  it('scores remain zero-sum', () =>
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 10, max: 100 }), (n, hu) => {
        expect(calculateScore(n, 'win', n - 1, hu).reduce((a, b) => a + b.delta, 0)).toBe(0);
      }),
    ));
});
