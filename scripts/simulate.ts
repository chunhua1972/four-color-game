import {
  applyGameCommand,
  assertStateInvariants,
  buildPlayerSnapshot,
  chooseAiCommand,
  createDeck,
  createInitialState,
  makeRuleConfig,
  resolveReactionWindow,
  shuffleDeck,
} from '../packages/game-core/src/index.ts';
import type { Controller, SeatCount } from '../packages/game-core/src/index.ts';
import { seededRandom } from './random.ts';
import { writeFileSync } from 'node:fs';
const rounds = Number(process.argv[2] ?? 1000);
const difficulty = process.argv[3] === 'easy' ? 'easy' : 'normal';
const report = [];
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('invalid rounds');
for (const n of [2, 3, 4, 5, 6] as SeatCount[]) {
  const summary = {
    seats: n,
    rounds,
    wins: 0,
    draws: 0,
    penalties: 0,
    maxActions: 0,
    totalActions: 0,
    illegal: 0,
  };
  const start = performance.now();
  for (let round = 0; round < rounds; round++) {
    const seed = n * 100000 + round;
    const rng = seededRandom(seed);
    let step = 0;
    let now = 0;
    const controllers: Controller[] = Array.from({ length: n }, () => ({
      kind: 'ai',
      difficulty,
    }));
    let s = createInitialState(
      shuffleDeck(createDeck(), rng),
      rng(n),
      makeRuleConfig(n),
      controllers,
      `sim:${seed}`,
      { nowMs: now, id: 'init' },
    );
    while (!s.result && step < 2000) {
      step++;
      now += 10;
      const ctx = { nowMs: now, id: `${seed}:${step}` };
      if (s.window) {
        for (const seat of s.window.participantSeats) {
          if (s.responses[seat]) continue;
          const snap = buildPlayerSnapshot(s, seat, now);
          const command = chooseAiCommand(
            {
              seat,
              ownHand: snap.hand,
              public: snap.public,
              legalOptions: snap.legalOptions,
            },
            difficulty,
            rng,
          );
          const result = applyGameCommand(s, seat, command, ctx);
          if (!result.ok)
            throw new Error(`seed ${seed} step ${step}: ${JSON.stringify(result.error)}`);
          s = result.state;
        }
        const result = resolveReactionWindow(s, s.window!.id, ctx);
        if (!result.ok) throw new Error(`seed ${seed}: ${result.error.code}`);
        s = result.state;
      } else {
        const seat = s.activeSeat!;
        const snap = buildPlayerSnapshot(s, seat, now);
        const command = chooseAiCommand(
          {
            seat,
            ownHand: snap.hand,
            public: snap.public,
            legalOptions: snap.legalOptions,
          },
          difficulty,
          rng,
        );
        const result = applyGameCommand(s, seat, command, ctx);
        if (!result.ok) throw new Error(`seed ${seed}: ${result.error.code}`);
        s = result.state;
      }
      assertStateInvariants(s);
    }
    if (!s.result) throw new Error(`stuck seed ${seed}`);
    if (s.result.reason === 'win') summary.wins++;
    else if (s.result.reason === 'draw') summary.draws++;
    else summary.penalties++;
    summary.maxActions = Math.max(summary.maxActions, step);
    summary.totalActions += step;
  }
  const result = {
    ...summary,
    elapsedMs: Math.round(performance.now() - start),
  };
  report.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync(
  difficulty === 'normal' ? 'docs/simulation.json' : 'docs/simulation-easy.json',
  JSON.stringify(
    {
      engine: '0.1.0',
      policy: `${difficulty}-v1`,
      seedRange: 'N*100000+[0,rounds)',
      results: report,
    },
    null,
    2,
  ),
);
