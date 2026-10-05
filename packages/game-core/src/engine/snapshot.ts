import type {
  AuthoritativeState,
  PlayerSnapshot,
  PublicSnapshot,
  RoundResult,
} from '../contracts/types.ts';
import { enumerateLegalClaims } from '../rules/claims.ts';
import { evaluateHu } from '../solver/exactCover.ts';
import { decodeTile, sortHand } from '../tiles/catalog.ts';
// Explicit whitelist. Never spread authority into a client DTO.
function publicResult(r: RoundResult | null): RoundResult | null {
  return r === null
    ? null
    : {
        reason: r.reason,
        winnerSeat: r.winnerSeat,
        penaltySeat: r.penaltySeat,
        baseHu: r.baseHu,
        flowerHu: r.flowerHu,
        totalHu: r.totalHu,
        groups: r.groups.map((g) => ({
          kind: g.kind,
          typeCounts: [...g.typeCounts],
          includesIncoming: g.includesIncoming,
          exposure: g.exposure,
          hu: g.hu,
        })),
        scores: r.scores.map((s) => ({ seat: s.seat, delta: s.delta })),
      };
}
export function buildPublicSnapshot(s: AuthoritativeState): PublicSnapshot {
  return {
    gameId: s.gameId,
    boardVersion: s.boardVersion,
    engineVersion: s.engineVersion,
    rules: { ...s.rules },
    phase: s.phase,
    dealerSeat: s.dealerSeat,
    activeSeat: s.activeSeat,
    turnDeadlineAtMs: s.turnDeadlineAtMs,
    wallCount: s.wall.length,
    seats: s.controllers.map((c, seat) => ({
      seat,
      name: c.kind === 'human' ? '你' : `電腦 ${seat + 1}`,
      controllerKind: c.kind,
      handCount: s.hands[seat].length,
      publicHu: s.melds.filter((m) => m.ownerSeat === seat).reduce((n, m) => n + m.hu, 0),
      melds: s.melds
        .filter((m) => m.ownerSeat === seat)
        .map((m) => ({
          id: m.id,
          ownerSeat: m.ownerSeat,
          kind: m.kind,
          tileIds: [...m.tileIds],
          exposure: m.exposure,
          claimedOfferId: m.claimedOfferId,
          sourceSeat: m.sourceSeat,
          hu: m.hu,
        })),
    })),
    offer: s.offer ? { ...s.offer } : null,
    window: s.window ? { ...s.window, participantSeats: [...s.window.participantSeats] } : null,
    discards: [...s.discards],
    flowerTileId: s.flowerTileId,
    firstDiscardTypeId: s.firstDiscardTypeId,
    result: publicResult(s.result),
  };
}
export function buildPlayerSnapshot(
  s: AuthoritativeState,
  seat: number,
  nowMs: number,
): PlayerSnapshot {
  if (!Number.isInteger(seat) || seat < 0 || seat >= s.rules.seatCount)
    throw new Error('NOT_MEMBER');
  const pub = buildPublicSnapshot(s);
  const hand = sortHand(s.hands[seat]);
  const receipt = s.responses[seat] ?? null;
  let legalOptions = receipt ? [] : enumerateLegalClaims({ seat, ownHand: hand, public: pub });
  const hint = evaluateHu(hand, null, pub.seats[seat].melds, s.rules);
  if (s.activeSeat === seat && (s.phase === 'await_discard' || s.phase === 'dealer_opening')) {
    legalOptions = hand
      .filter((id) => decodeTile(id).role !== 'general')
      .map((id) => ({
        id: `discard:${id}`,
        command: { type: 'discard' as const, tileId: id },
        previewTileIds: [id],
      }));
    if (s.phase === 'dealer_opening' && hint.status === 'eligible')
      legalOptions.push({
        id: 'opening_hu',
        command: { type: 'declare_opening_hu' },
        previewTileIds: [],
        huIfWinning: hint.baseHu,
      });
  } else if (s.phase === 'await_draw' && s.activeSeat === seat)
    legalOptions = [{ id: 'draw', command: { type: 'open_draw' }, previewTileIds: [] }];
  return {
    public: pub,
    viewerSeat: seat,
    hand,
    legalOptions,
    myResponse: receipt ? { ...receipt, intent: structuredClone(receipt.intent) } : null,
    myResponseRevision: receipt?.responseRevision ?? 0,
    serverNowMs: nowMs,
    hint,
  };
}
