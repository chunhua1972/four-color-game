import {
  createDeck,
  findBestCompletePartition,
  shuffleDeck,
} from '../packages/game-core/src/index.ts';
import { seededRandom } from './random.ts';
import { writeFileSync } from 'node:fs';
const cases = 2000;
const samples: number[] = [];
let maxNodes = 0;
let deferred = 0;
for (let i = 0; i < cases; i++) {
  const hand = shuffleDeck(createDeck(), seededRandom(i)).slice(0, 21);
  const start = performance.now();
  const r = findBestCompletePartition(hand);
  samples.push(performance.now() - start);
  maxNodes = Math.max(maxNodes, r.nodes);
  if (r.status === 'deferred') deferred++;
}
samples.sort((a, b) => a - b);
const report = {
  cases,
  handSize: 21,
  p95Ms: samples[Math.floor(cases * 0.95)],
  maxMs: samples[cases - 1],
  maxNodes,
  deferred,
  limitation: 'Desktop random-hand baseline; not a worst-case or mobile guarantee.',
};
writeFileSync('docs/benchmark.json', JSON.stringify(report, null, 2));
console.log(report);
