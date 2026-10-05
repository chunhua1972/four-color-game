import type { RuleConfig, SeatCount } from '../contracts/types.ts';
export function makeRuleConfig(n: SeatCount): RuleConfig {
  if (![2, 3, 4, 5, 6].includes(n)) throw new Error('UNSUPPORTED_RULES');
  return {
    presetId: n <= 4 ? 'tw10-product-v1' : 'tw10-extended-v1',
    version: 1,
    seatCount: n,
    baseHandSize: n <= 4 ? 20 : n === 5 ? 16 : 14,
    minBaseHu: 10,
    allowSoldierPair: false,
    allowGeneralTriple: false,
    allowPassHu: true,
    mandatoryKong: false,
    generalDiscardable: false,
    incomingGroupExposure: 'exposed',
    multiWin: false,
    flowerEnabled: true,
    flowerCountScope: 'winner_all_owned_cards',
    stakeUnit: 1,
    responseTimeoutMs: 12000,
    discardTimeoutMs: 30000,
    drawTimeoutMs: 8000,
    reconnectGraceMs: 90000,
    shuffleEveryRound: true,
  };
}
export function validateRuleConfig(rules: RuleConfig): void {
  const expected = makeRuleConfig(rules.seatCount);
  for (const key of Object.keys(expected) as (keyof RuleConfig)[]) {
    if (key === 'flowerEnabled') {
      if (typeof rules[key] !== 'boolean') throw new Error('UNSUPPORTED_RULES');
    } else if (rules[key] !== expected[key]) throw new Error('UNSUPPORTED_RULES');
  }
  if (Object.keys(rules).length !== Object.keys(expected).length)
    throw new Error('UNSUPPORTED_RULES');
}
