import type { ClaimIntent, LegalOption, Offer, PlayerRuleView } from '../contracts/types.ts';
import { decodeTile, toCounts } from '../tiles/catalog.ts';
import { containsPattern, PATTERNS } from './patterns.ts';
import { evaluateHu } from '../solver/exactCover.ts';
export function getReactionParticipants(offer: Offer, n: number): number[] {
  return Array.from({ length: n }, (_, s) => s).filter(
    (s) => offer.source === 'open_draw' || s !== offer.originSeat,
  );
}
export function seatDistance(
  origin: number,
  candidate: number,
  source: Offer['source'],
  n: number,
): number {
  return (candidate - origin + n - (source === 'discard' ? 1 : 0)) % n;
}
export function getClaimPriority(intent: ClaimIntent): number {
  return intent.kind === 'hu'
    ? 4
    : intent.kind === 'pass'
      ? 0
      : { kong: 3, pong: 2, eat: 1 }[intent.action];
}
export function enumerateLegalClaims(view: PlayerRuleView): LegalOption[] {
  const { public: pub, seat, ownHand: hand } = view;
  const { offer, window, rules } = pub;
  if (
    pub.phase !== 'response_window' ||
    !offer ||
    !window ||
    !window.participantSeats.includes(seat)
  )
    return [];
  const options: LegalOption[] = [];
  const hu = evaluateHu(hand, offer.tileId, pub.seats[seat].melds, rules);
  if (hu.status === 'deferred') throw new Error('RESOLUTION_DEFERRED');
  const option = (id: string, intent: ClaimIntent, ids: number[], baseHu?: number) =>
    options.push({
      id,
      command: {
        type: 'respond',
        windowId: window.id,
        intent,
        responseRevision: 0,
      },
      previewTileIds: ids,
      ...(baseHu === undefined ? {} : { huIfWinning: baseHu }),
    });
  if (hu.status === 'eligible') option('hu', { kind: 'hu' }, [offer.tileId], hu.baseHu);
  const counts = toCounts(hand);
  const incoming = decodeTile(offer.tileId);
  counts[incoming.typeId]++;
  const canEat =
    seat === (offer.originSeat + 1) % rules.seatCount ||
    (offer.source === 'open_draw' && seat === offer.originSeat);
  for (const pattern of PATTERNS) {
    if (!pattern.types.includes(incoming.typeId) || !containsPattern(counts, pattern)) continue;
    const action =
      pattern.kind === 'quad' || pattern.kind === 'general_quad'
        ? 'kong'
        : pattern.kind === 'triple'
          ? 'pong'
          : 'eat';
    if (action === 'eat' && !canEat) continue;
    // A single general can only originate from an open draw.
    if (pattern.kind === 'general_single' && offer.source !== 'open_draw') continue;
    const needed = [...pattern.types];
    needed.splice(needed.indexOf(incoming.typeId), 1);
    const pool = [...hand];
    const ids: number[] = [];
    for (const type of needed) {
      const index = pool.findIndex((id) => decodeTile(id).typeId === type);
      if (index < 0) throw new Error('INVALID_PATTERN');
      ids.push(pool.splice(index, 1)[0]);
    }
    const intent: ClaimIntent = {
      kind: 'claim',
      action,
      meldKind: pattern.kind,
      handTileIds: ids,
    };
    option(`${action}:${pattern.key}`, intent, [offer.tileId, ...ids]);
    const rest = hand.filter((id) => !ids.includes(id));
    if (!rest.some((id) => decodeTile(id).role !== 'general')) {
      const terminalHu = evaluateHu(
        rest,
        null,
        [
          ...pub.seats[seat].melds,
          {
            id: 'preview',
            ownerSeat: seat,
            kind: pattern.kind,
            tileIds: [offer.tileId, ...ids],
            exposure: 'exposed',
            claimedOfferId: offer.id,
            sourceSeat: offer.originSeat,
            hu: 0,
          },
        ],
        rules,
      );
      if (terminalHu.status === 'deferred') throw new Error('RESOLUTION_DEFERRED');
      options[options.length - 1].terminalConsequence =
        terminalHu.status === 'eligible' ? 'win' : 'xiang_gong';
    }
  }
  if (!(offer.source === 'open_draw' && seat === offer.originSeat && incoming.role === 'general'))
    option('pass', { kind: 'pass' }, []);
  return options;
}
export function isLegalClaimIntent(
  intent: ClaimIntent,
  options: LegalOption[],
  hand: readonly number[],
): boolean {
  if (
    intent.kind === 'claim' &&
    (new Set(intent.handTileIds).size !== intent.handTileIds.length ||
      intent.handTileIds.some((id) => !hand.includes(id)))
  )
    return false;
  return options.some((o) => {
    if (o.command.type !== 'respond') return false;
    const candidate = o.command.intent;
    if (intent.kind !== 'claim' || candidate.kind !== 'claim')
      return intentsEqual(intent, candidate);
    return (
      intent.action === candidate.action &&
      intent.meldKind === candidate.meldKind &&
      intent.handTileIds.length === candidate.handTileIds.length &&
      intent.handTileIds
        .map((id) => decodeTile(id).typeId)
        .sort((a, b) => a - b)
        .join(',') ===
        candidate.handTileIds
          .map((id) => decodeTile(id).typeId)
          .sort((a, b) => a - b)
          .join(',')
    );
  });
}
export function intentsEqual(a: ClaimIntent, b: ClaimIntent): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'claim' || b.kind !== 'claim') return true;
  return (
    a.action === b.action &&
    a.meldKind === b.meldKind &&
    new Set(a.handTileIds).size === a.handTileIds.length &&
    a.handTileIds.length === b.handTileIds.length &&
    [...a.handTileIds]
      .sort((x, y) => x - y)
      .every((id, i) => id === [...b.handTileIds].sort((x, y) => x - y)[i])
  );
}
