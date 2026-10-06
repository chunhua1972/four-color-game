// Import proof only: this is not a deployed game API.
import {
  createDeck,
  dealRound,
  ENGINE_VERSION,
  makeRuleConfig,
} from '../../../packages/game-core/src/index.ts';
export function coreProof() {
  return [2, 3, 4, 5, 6].map((n) => {
    const rules = makeRuleConfig(n as 2 | 3 | 4 | 5 | 6);
    const deal = dealRound(createDeck(), 0, rules);
    return {
      engineVersion: ENGINE_VERSION,
      seats: n,
      dealt: deal.hands.flat().length,
      remaining: deal.wall.length,
    };
  });
}
