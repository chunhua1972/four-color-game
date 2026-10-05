import type { Exposure, MeldKind, Pattern } from '../contracts/types.ts';
const HU: Record<MeldKind, [number, number]> = {
  general_single: [1, 1],
  pair: [0, 0],
  court: [2, 2],
  army: [1, 1],
  soldier_three: [3, 3],
  soldier_four: [5, 5],
  triple: [3, 1],
  quad: [8, 6],
  general_quad: [6, 8],
};
export const MELD_NAMES: Record<MeldKind, string> = {
  general_single: '單將',
  pair: '對',
  court: '將士象',
  army: '車馬炮',
  soldier_three: '三色兵',
  soldier_four: '四色兵',
  triple: '碰',
  quad: '槓',
  general_quad: '將槓',
};
export function getMeldHu(kind: MeldKind, exposure: Exposure): number {
  return HU[kind][exposure === 'concealed' ? 0 : 1];
}
export function generateGroupPatterns(): Pattern[] {
  const result: Pattern[] = [];
  const add = (kind: MeldKind, types: number[]) =>
    result.push({ key: `${kind}:${types.join(',')}`, kind, types });
  for (let type = 0; type < 28; type++) {
    const role = type % 7;
    if (role === 0) {
      add('general_single', [type]);
      add('general_quad', Array<number>(4).fill(type));
    } else {
      if (role !== 6) add('pair', [type, type]);
      add('triple', [type, type, type]);
      add('quad', [type, type, type, type]);
    }
  }
  for (let c = 0; c < 4; c++) {
    add('court', [c * 7, c * 7 + 1, c * 7 + 2]);
    add('army', [c * 7 + 3, c * 7 + 4, c * 7 + 5]);
  }
  const soldiers = [6, 13, 20, 27];
  for (let i = 0; i < 4; i++)
    add(
      'soldier_three',
      soldiers.filter((_, j) => i !== j),
    );
  add('soldier_four', soldiers);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
export const PATTERNS = generateGroupPatterns();
export function classifyMeld(types: readonly number[]): MeldKind | null {
  if (types.some((t) => !Number.isInteger(t) || t < 0 || t > 27)) return null;
  const key = [...types].sort((a, b) => a - b).join(',');
  return PATTERNS.find((p) => p.types.join(',') === key)?.kind ?? null;
}
export function containsPattern(counts: readonly number[], pattern: Pattern): boolean {
  const required = new Map<number, number>();
  for (const t of pattern.types) required.set(t, (required.get(t) ?? 0) + 1);
  return [...required].every(([t, n]) => counts[t] >= n);
}
