import type { AuthoritativeState } from '../contracts/types.ts';
import { classifyMeld, getMeldHu } from '../rules/patterns.ts';
import { validateRuleConfig } from '../rules/presets.ts';
import { decodeTile, toCounts } from '../tiles/catalog.ts';
export function assertStateInvariants(s: AuthoritativeState): void {
  validateRuleConfig(s.rules);
  const all = [
    ...s.wall,
    ...s.hands.flat(),
    ...s.melds.flatMap((m) => m.tileIds),
    ...s.discards,
    ...(s.offer ? [s.offer.tileId] : []),
    ...(s.flowerTileId === null ? [] : [s.flowerTileId]),
  ];
  const counts = toCounts(all);
  if (all.length !== 112 || counts.some((n) => n !== 4)) throw new Error('TILE_CONSERVATION');
  const n = s.rules.seatCount;
  if (
    s.hands.length !== n ||
    s.controllers.length !== n ||
    s.dealerSeat < 0 ||
    s.dealerSeat >= n ||
    (s.activeSeat !== null &&
      (!Number.isInteger(s.activeSeat) || s.activeSeat < 0 || s.activeSeat >= n))
  )
    throw new Error('INVALID_SEATS');
  if ((s.phase === 'response_window') !== (s.offer !== null && s.window !== null))
    throw new Error('INVALID_WINDOW');
  if (s.phase !== 'response_window' && (s.offer || s.window || Object.keys(s.responses).length))
    throw new Error('STALE_WINDOW');
  if (
    s.phase === 'await_discard' &&
    (s.activeSeat === null ||
      !s.hands[s.activeSeat].some((id) => decodeTile(id).role !== 'general'))
  )
    throw new Error('STUCK_DISCARD');
  if ((s.phase === 'finished' || s.phase === 'drawn_game') !== (s.result !== null))
    throw new Error('INVALID_RESULT');
  if (s.result && s.result.scores.reduce((n, d) => n + d.delta, 0) !== 0)
    throw new Error('NON_ZERO_SUM');
  for (const m of s.melds)
    if (
      m.ownerSeat < 0 ||
      m.ownerSeat >= n ||
      classifyMeld(m.tileIds.map((id) => decodeTile(id).typeId)) !== m.kind ||
      m.hu !== getMeldHu(m.kind, 'exposed')
    )
      throw new Error('INVALID_MELD');
  if (
    s.window &&
    (s.window.offerId !== s.offer?.id ||
      Object.keys(s.responses).some((seat) => !s.window?.participantSeats.includes(Number(seat))))
  )
    throw new Error('INVALID_RESPONSE');
}
