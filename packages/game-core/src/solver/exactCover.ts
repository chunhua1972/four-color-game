import type {
  HuEvaluation,
  Meld,
  PartitionGroup,
  RuleConfig,
  TileId,
  WinSolveResult,
} from '../contracts/types.ts';
import { decodeTile, toCounts, validateCounts } from '../tiles/catalog.ts';
import { containsPattern, getMeldHu, PATTERNS } from '../rules/patterns.ts';
const BY_ANCHOR = Array.from({ length: 28 }, (_, type) =>
  PATTERNS.filter((p) => p.types.includes(type)),
);
type Solution = { hu: number; groups: PartitionGroup[] };
export function solveCounts(
  input: readonly number[],
  incomingType: number | null = null,
  maxNodes = 150000,
): WinSolveResult {
  validateCounts(input);
  if (
    incomingType !== null &&
    (!Number.isInteger(incomingType) ||
      incomingType < 0 ||
      incomingType > 27 ||
      input[incomingType] < 1)
  )
    throw new Error('INVALID_INCOMING');
  const memo = new Map<string, Solution | null>();
  let nodes = 0;
  let exceeded = false;
  function visit(counts: number[], token: boolean): Solution | null {
    if (++nodes > maxNodes) {
      exceeded = true;
      return null;
    }
    const anchor = counts.findIndex((n) => n > 0);
    if (anchor === -1) return token ? null : { hu: 0, groups: [] };
    const key = counts.join('') + (token ? ':1' : ':0');
    if (memo.has(key)) return memo.get(key) ?? null;
    let best: Solution | null = null;
    for (const pattern of BY_ANCHOR[anchor]) {
      if (!containsPattern(counts, pattern)) continue;
      const rest = [...counts];
      for (const t of pattern.types) rest[t]--;
      const canUse = token && incomingType !== null && pattern.types.includes(incomingType);
      for (const useIncoming of canUse ? [false, true] : [false]) {
        if (token && !useIncoming && incomingType !== null && rest[incomingType] === 0) continue;
        const child = visit(rest, token && !useIncoming);
        if (exceeded) return null;
        if (!child) continue;
        const exposure = useIncoming ? 'exposed' : 'concealed';
        const hu = getMeldHu(pattern.kind, exposure);
        if (!best || child.hu + hu > best.hu) {
          const typeCounts = Array<number>(28).fill(0);
          for (const t of pattern.types) typeCounts[t]++;
          best = {
            hu: child.hu + hu,
            groups: [
              {
                kind: pattern.kind,
                typeCounts,
                includesIncoming: useIncoming,
                exposure,
                hu,
              },
              ...child.groups,
            ],
          };
        }
      }
    }
    memo.set(key, best);
    return best;
  }
  const solution = visit([...input], incomingType !== null);
  if (exceeded) return { status: 'deferred', reason: 'budget_exceeded', nodes };
  return solution
    ? {
        status: 'complete',
        groups: solution.groups,
        concealedAndIncomingHu: solution.hu,
        nodes,
      }
    : { status: 'not_complete', nodes };
}
export function findBestCompletePartition(
  hand: readonly TileId[],
  incoming: TileId | null = null,
  maxNodes?: number,
): WinSolveResult {
  return solveCounts(
    toCounts(incoming === null ? hand : [...hand, incoming]),
    incoming === null ? null : decodeTile(incoming).typeId,
    maxNodes,
  );
}
export function evaluateHu(
  hand: readonly TileId[],
  incoming: TileId | null,
  melds: readonly Meld[],
  rules: RuleConfig,
  maxNodes?: number,
): HuEvaluation {
  toCounts([...hand, ...(incoming === null ? [] : [incoming]), ...melds.flatMap((m) => m.tileIds)]);
  const solved = findBestCompletePartition(hand, incoming, maxNodes);
  if (solved.status !== 'complete') return { status: solved.status };
  const groups: PartitionGroup[] = melds.map((m) => ({
    kind: m.kind,
    typeCounts: toCounts(m.tileIds),
    includesIncoming: false,
    exposure: 'exposed',
    hu: getMeldHu(m.kind, 'exposed'),
  }));
  const baseHu = groups.reduce((n, g) => n + g.hu, 0) + solved.concealedAndIncomingHu;
  return {
    status: baseHu >= rules.minBaseHu ? 'eligible' : 'below_threshold',
    baseHu,
    groups: [...groups, ...solved.groups],
  };
}
export function getWinningTileTypes(
  hand: readonly TileId[],
  melds: readonly Meld[],
  rules: RuleConfig,
): { typeId: number; baseHu: number }[] {
  const owned = new Set([...hand, ...melds.flatMap((m) => m.tileIds)]);
  const result: { typeId: number; baseHu: number }[] = [];
  for (let t = 0; t < 28; t++) {
    const incoming = [t * 4, t * 4 + 1, t * 4 + 2, t * 4 + 3].find((id) => !owned.has(id));
    if (incoming === undefined) continue;
    const hu = evaluateHu(hand, incoming, melds, rules);
    if (hu.status === 'eligible') result.push({ typeId: t, baseHu: hu.baseHu });
    if (hu.status === 'deferred') throw new Error('RESOLUTION_DEFERRED');
  }
  return result;
}
