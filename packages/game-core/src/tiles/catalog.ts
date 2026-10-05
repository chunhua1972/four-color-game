import type { Color, Role, Tile, TileId } from '../contracts/types.ts';
export const COLORS: Color[] = ['red', 'yellow', 'green', 'white'];
export const ROLES: Role[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];
export const COLOR_NAMES: Record<Color, string> = {
  red: '紅',
  yellow: '黃',
  green: '綠',
  white: '白',
};
export const ROLE_NAMES: Record<Role, string> = {
  general: '將',
  advisor: '士',
  elephant: '象',
  chariot: '車',
  horse: '馬',
  cannon: '炮',
  soldier: '兵',
};
export function decodeTile(id: TileId): Tile {
  if (!Number.isInteger(id) || id < 0 || id > 111) throw new Error('INVALID_TILE_ID');
  const typeId = Math.floor(id / 4);
  return {
    id,
    typeId,
    color: COLORS[Math.floor(typeId / 7)],
    role: ROLES[typeId % 7],
  };
}
export function tileLabel(id: TileId): string {
  const t = decodeTile(id);
  return COLOR_NAMES[t.color] + ROLE_NAMES[t.role];
}
export function createDeck(): TileId[] {
  return Array.from({ length: 112 }, (_, i) => i);
}
export function toCounts(ids: readonly TileId[]): number[] {
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_TILE_ID');
  const counts = Array<number>(28).fill(0);
  for (const id of ids) counts[decodeTile(id).typeId]++;
  return counts;
}
export function validateCounts(counts: readonly number[]): void {
  if (counts.length !== 28 || counts.some((n) => !Number.isInteger(n) || n < 0 || n > 4))
    throw new Error('INVALID_COUNTS');
}
export function sortHand(ids: readonly TileId[], mode: 'color' | 'role' = 'color'): TileId[] {
  return [...ids].sort((a, b) =>
    mode === 'color' ? a - b : (Math.floor(a / 4) % 7) - (Math.floor(b / 4) % 7) || a - b,
  );
}
export function shuffleDeck(
  deck: readonly TileId[],
  uniformInt: (maxExclusive: number) => number,
): TileId[] {
  toCounts(deck);
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = uniformInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('INVALID_RANDOM');
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
