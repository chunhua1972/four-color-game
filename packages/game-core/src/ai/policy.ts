import type { AiObservation, Difficulty, PlayerCommand } from '../contracts/types.ts';
import { decodeTile, toCounts } from '../tiles/catalog.ts';
import { getMeldHu, PATTERNS } from '../rules/patterns.ts';
// This estimate is only an AI heuristic, never the authority's win test.
export function scoreHandPotential(hand: readonly number[]): number {
  const c = toCounts(hand);
  let score = 0;
  for (let t = 0; t < 28; t++) {
    const count = c[t];
    if (!count) continue;
    const role = t % 7;
    if (role === 0) score += count * 3 + (count === 4 ? 7 : 0);
    else if (count === 4) score += 22;
    else if (count === 3) score += 13;
    else if (count === 2) score += role === 6 ? 0 : 4;
    else score -= 2;
  }
  for (const p of PATTERNS.filter((p) =>
    ['court', 'army', 'soldier_three', 'soldier_four'].includes(p.kind),
  )) {
    const present = p.types.filter((t) => c[t] > 0).length;
    if (present === p.types.length) score += 5 + getMeldHu(p.kind, 'concealed') * 2;
    else if (present === p.types.length - 1) score += 2;
  }
  return score;
}
export function chooseAiCommand(
  obs: AiObservation,
  difficulty: Difficulty,
  randomIndex: (n: number) => number,
): PlayerCommand {
  const opts = obs.legalOptions;
  if (!opts.length) throw new Error('NO_LEGAL_ACTION');
  const win = opts.find(
    (o) =>
      o.command.type === 'declare_opening_hu' ||
      (o.command.type === 'respond' && o.command.intent.kind === 'hu') ||
      o.terminalConsequence === 'win',
  );
  if (win) return win.command;
  const discard = opts.filter((o) => o.command.type === 'discard');
  if (discard.length) {
    const distinct = discard.filter(
      (o, i) =>
        discard.findIndex(
          (p) => decodeTile(p.previewTileIds[0]).typeId === decodeTile(o.previewTileIds[0]).typeId,
        ) === i,
    );
    if (difficulty === 'easy') return distinct[randomIndex(distinct.length)].command;
    return distinct.sort(
      (a, b) =>
        scoreHandPotential(obs.ownHand.filter((id) => id !== b.previewTileIds[0])) -
          scoreHandPotential(obs.ownHand.filter((id) => id !== a.previewTileIds[0])) ||
        a.id.localeCompare(b.id),
    )[0].command;
  }
  const safe = opts.filter((o) => o.terminalConsequence !== 'xiang_gong');
  const candidates = safe.length ? safe : opts;
  if (difficulty === 'easy') return candidates[randomIndex(candidates.length)].command;
  const baseline = scoreHandPotential(obs.ownHand) + obs.public.seats[obs.seat].publicHu * 3;
  const ranked = candidates.map((o) => {
    const command = o.command;
    if (command.type !== 'respond' || command.intent.kind !== 'claim')
      return { command, score: baseline };
    const intent = command.intent;
    const rest = obs.ownHand.filter((id) => !intent.handTileIds.includes(id));
    const discards = rest.filter((id) => decodeTile(id).role !== 'general');
    const potential = discards.length
      ? Math.max(...discards.map((id) => scoreHandPotential(rest.filter((t) => t !== id))))
      : scoreHandPotential(rest);
    return {
      command,
      score:
        potential +
        (obs.public.seats[obs.seat].publicHu + getMeldHu(intent.meldKind, 'exposed')) * 3 +
        2,
    };
  });
  return ranked.sort((a, b) => b.score - a.score)[0].command;
}
