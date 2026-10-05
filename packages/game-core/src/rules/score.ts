import type { RoundResult, ScoreDelta, TileId } from '../contracts/types.ts';
import { decodeTile } from '../tiles/catalog.ts';
export function calculateFlowerHu(owned: readonly TileId[], flowerType: number | null): number {
  return flowerType === null
    ? 0
    : owned.filter((id) => decodeTile(id).typeId === flowerType).length;
}
export function calculateScore(
  n: number,
  reason: RoundResult['reason'],
  seat: number | null,
  totalHu = 0,
): ScoreDelta[] {
  if (
    !Number.isInteger(n) ||
    n < 2 ||
    n > 6 ||
    (seat !== null && (!Number.isInteger(seat) || seat < 0 || seat >= n))
  )
    throw new Error('INVALID_SCORE_CONTEXT');
  if (reason === 'win' && (seat === null || totalHu < 10)) throw new Error('INVALID_SCORE_CONTEXT');
  if (reason === 'xiang_gong' && seat === null) throw new Error('INVALID_SCORE_CONTEXT');
  const unit = reason === 'win' ? 1 + Math.max(0, totalHu - 10) : 11;
  return Array.from({ length: n }, (_, s) => ({
    seat: s,
    delta:
      reason === 'win'
        ? s === seat
          ? unit * (n - 1)
          : -unit
        : reason === 'xiang_gong'
          ? s === seat
            ? -11 * (n - 1)
            : 11
          : 0,
  }));
}
