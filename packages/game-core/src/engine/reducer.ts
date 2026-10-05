import { ENGINE_VERSION } from '../contracts/types.ts';
import type {
  AuthoritativeState,
  ClaimIntent,
  Controller,
  EngineContext,
  HuEvaluation,
  PlayerCommand,
  RuleConfig,
  TransitionResult,
} from '../contracts/types.ts';
import { decodeTile, toCounts } from '../tiles/catalog.ts';
import { validateRuleConfig } from '../rules/presets.ts';
import {
  enumerateLegalClaims,
  getClaimPriority,
  getReactionParticipants,
  isLegalClaimIntent,
  seatDistance,
} from '../rules/claims.ts';
import { getMeldHu } from '../rules/patterns.ts';
import { evaluateHu } from '../solver/exactCover.ts';
import { calculateFlowerHu, calculateScore } from '../rules/score.ts';
import { assertStateInvariants } from './invariants.ts';
import { buildPublicSnapshot } from './snapshot.ts';
export function dealRound(
  deck: readonly number[],
  dealer: number,
  rules: RuleConfig,
): { hands: number[][]; wall: number[] } {
  validateRuleConfig(rules);
  toCounts(deck);
  if (deck.length !== 112 || !Number.isInteger(dealer) || dealer < 0 || dealer >= rules.seatCount)
    throw new Error('INVALID_DEAL');
  const hands = Array.from({ length: rules.seatCount }, () => [] as number[]);
  let cursor = 0;
  for (let round = 0; round < rules.baseHandSize; round++)
    for (let offset = 0; offset < rules.seatCount; offset++)
      hands[(dealer + offset) % rules.seatCount].push(deck[cursor++]);
  hands[dealer].push(deck[cursor++]);
  return { hands, wall: deck.slice(cursor) };
}
export function createInitialState(
  deck: readonly number[],
  dealer: number,
  rules: RuleConfig,
  controllers: Controller[],
  gameId: string,
  ctx: EngineContext,
): AuthoritativeState {
  const s: AuthoritativeState = {
    schemaVersion: 1,
    gameId,
    boardVersion: 0,
    engineVersion: ENGINE_VERSION,
    rules: { ...rules },
    phase: 'dealer_opening',
    dealerSeat: dealer,
    activeSeat: dealer,
    turnDeadlineAtMs: ctx.nowMs + rules.discardTimeoutMs,
    controllers: structuredClone(controllers),
    ...dealRound(deck, dealer, rules),
    melds: [],
    discards: [],
    offer: null,
    window: null,
    responses: {},
    firstDiscardTypeId: null,
    flowerTileId: null,
    result: null,
  };
  assertStateInvariants(s);
  return s;
}
function reject(code: string, reason: string): TransitionResult {
  return { ok: false, error: { code, reason } };
}
function clearWindow(s: AuthoritativeState): void {
  s.offer = null;
  s.window = null;
  s.responses = {};
}
function finishWin(
  s: AuthoritativeState,
  seat: number,
  hu: Extract<HuEvaluation, { baseHu: number }>,
): void {
  const owned = [
    ...s.hands[seat],
    ...s.melds.filter((m) => m.ownerSeat === seat).flatMap((m) => m.tileIds),
  ];
  let flowerType: number | null = null;
  if (s.rules.flowerEnabled) {
    if (s.wall.length) {
      s.flowerTileId = s.wall.shift() ?? null;
      flowerType = s.flowerTileId === null ? null : decodeTile(s.flowerTileId).typeId;
    } else flowerType = s.firstDiscardTypeId;
  }
  const flowerHu = calculateFlowerHu(owned, flowerType);
  const totalHu = hu.baseHu + flowerHu;
  s.result = {
    reason: 'win',
    winnerSeat: seat,
    penaltySeat: null,
    baseHu: hu.baseHu,
    flowerHu,
    totalHu,
    groups: hu.groups,
    scores: calculateScore(s.rules.seatCount, 'win', seat, totalHu),
  };
  s.phase = 'finished';
  s.activeSeat = null;
  s.turnDeadlineAtMs = null;
  clearWindow(s);
}
function finishNonWin(s: AuthoritativeState, penaltySeat: number | null): void {
  const reason = penaltySeat === null ? 'draw' : 'xiang_gong';
  s.result = {
    reason,
    winnerSeat: null,
    penaltySeat,
    baseHu: 0,
    flowerHu: 0,
    totalHu: 0,
    groups: [],
    scores: calculateScore(s.rules.seatCount, reason, penaltySeat),
  };
  s.phase = penaltySeat === null ? 'drawn_game' : 'finished';
  s.activeSeat = null;
  s.turnDeadlineAtMs = null;
  clearWindow(s);
}
function openWindow(
  s: AuthoritativeState,
  tileId: number,
  source: 'discard' | 'open_draw',
  seat: number,
  ctx: EngineContext,
): void {
  s.phase = 'response_window';
  s.activeSeat = null;
  s.turnDeadlineAtMs = null;
  s.offer = {
    id: `${ctx.id}:offer`,
    tileId,
    source,
    originSeat: seat,
    createdAtMs: ctx.nowMs,
  };
  s.window = {
    id: `${ctx.id}:window`,
    offerId: s.offer.id,
    participantSeats: getReactionParticipants(s.offer, s.rules.seatCount),
    startedAtMs: ctx.nowMs,
    deadlineAtMs: ctx.nowMs + s.rules.responseTimeoutMs,
  };
  s.responses = {};
  const pub = buildPublicSnapshot(s);
  for (const participant of s.window.participantSeats) {
    const opts = enumerateLegalClaims({
      seat: participant,
      ownHand: s.hands[participant],
      public: pub,
    });
    if (
      opts.length === 1 &&
      opts[0].command.type === 'respond' &&
      opts[0].command.intent.kind === 'pass'
    )
      s.responses[participant] = {
        windowId: s.window.id,
        intent: { kind: 'pass' },
        acceptedAtMs: ctx.nowMs,
        responseRevision: 1,
        locked: true,
      };
  }
}
function accept(s: AuthoritativeState): TransitionResult {
  assertStateInvariants(s);
  return { ok: true, state: s };
}
export function applyGameCommand(
  state: AuthoritativeState,
  seat: number,
  command: PlayerCommand,
  ctx: EngineContext,
): TransitionResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.rules.seatCount)
    return reject('NOT_MEMBER', '你不是本桌成員');
  if (state.result) return reject('GAME_FINISHED', '本局已結束');
  const s = structuredClone(state);
  try {
    if (command.type === 'respond') {
      if (
        s.phase !== 'response_window' ||
        !s.window ||
        command.windowId !== s.window.id ||
        ctx.nowMs >= s.window.deadlineAtMs
      )
        return reject('WINDOW_CLOSED', '進牌時間已結束');
      if (!s.window.participantSeats.includes(seat))
        return reject('NOT_YOUR_PHASE', '不能回應自己的打牌');
      if (s.responses[seat]) return reject('RESPONSE_ALREADY_LOCKED', '已送出的意向不能變更');
      if (command.responseRevision !== 0) return reject('STALE_RESPONSE', '回應版本已過期');
      const options = enumerateLegalClaims({
        seat,
        ownHand: s.hands[seat],
        public: buildPublicSnapshot(s),
      });
      if (!isLegalClaimIntent(command.intent, options, s.hands[seat]))
        return reject(
          command.intent.kind === 'pass' ? 'PASS_FORBIDDEN' : 'INVALID_CLAIM',
          '此進牌方式不符合房規',
        );
      s.responses[seat] = {
        windowId: s.window.id,
        acceptedAtMs: ctx.nowMs,
        intent: structuredClone(command.intent),
        responseRevision: 1,
        locked: true,
      };
      return accept(s); // Response revision changes; boardVersion does not.
    }
    if (s.activeSeat !== seat) return reject('NOT_YOUR_TURN', '還沒輪到你');
    if (command.type === 'discard') {
      if (s.phase !== 'dealer_opening' && s.phase !== 'await_discard')
        return reject('NOT_YOUR_PHASE', '目前不能打牌');
      if (!s.hands[seat].includes(command.tileId))
        return reject('CARD_NOT_OWNED', '這張牌不在你的手中');
      if (decodeTile(command.tileId).role === 'general')
        return reject('GENERAL_NOT_DISCARDABLE', '將不能打出');
      s.hands[seat] = s.hands[seat].filter((id) => id !== command.tileId);
      if (s.firstDiscardTypeId === null) s.firstDiscardTypeId = decodeTile(command.tileId).typeId;
      openWindow(s, command.tileId, 'discard', seat, ctx);
    } else if (command.type === 'open_draw') {
      if (s.phase !== 'await_draw') return reject('NOT_YOUR_PHASE', '目前不能翻牌');
      if (!s.wall.length) finishNonWin(s, null);
      else openWindow(s, s.wall.shift()!, 'open_draw', seat, ctx);
    } else if (command.type === 'declare_opening_hu') {
      if (s.phase !== 'dealer_opening') return reject('NOT_YOUR_PHASE', '只有莊家開局可天胡');
      const hu = evaluateHu(s.hands[seat], null, [], s.rules);
      if (hu.status === 'deferred') return reject('RESOLUTION_DEFERRED', '正在計算完整拆組');
      if (hu.status !== 'eligible')
        return reject('HAND_NOT_COMPLETE', '需要完整拆組且基礎至少 10 胡');
      finishWin(s, seat, hu);
    }
    s.boardVersion++;
    return accept(s);
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'INVALID_COMMAND', '無法處理這個動作');
  }
}
export function resolveReactionWindow(
  state: AuthoritativeState,
  windowId: string,
  ctx: EngineContext,
): TransitionResult {
  if (
    state.phase !== 'response_window' ||
    !state.window ||
    !state.offer ||
    state.window.id !== windowId
  )
    return reject('WINDOW_CLOSED', '此反應窗已關閉');
  if (
    ctx.nowMs < state.window.deadlineAtMs &&
    !state.window.participantSeats.every((seat) => state.responses[seat])
  )
    return reject('WINDOW_PENDING', '仍在等待其他席的意向');
  const s = structuredClone(state);
  const offer = s.offer!;
  const window = s.window!;
  try {
    const candidates: { seat: number; intent: ClaimIntent }[] = [];
    for (const seat of window.participantSeats) {
      let intent = s.responses[seat]?.intent;
      if (!intent) {
        const opts = enumerateLegalClaims({
          seat,
          ownHand: s.hands[seat],
          public: buildPublicSnapshot(s),
        });
        const fallback =
          opts.find((o) => o.id === 'pass') ??
          opts.find(
            (o) =>
              o.command.type === 'respond' &&
              o.command.intent.kind === 'claim' &&
              o.command.intent.meldKind === 'general_single',
          );
        if (!fallback || fallback.command.type !== 'respond')
          throw new Error('RESOLUTION_DEFERRED');
        intent = fallback.command.intent;
      }
      if (
        !isLegalClaimIntent(
          intent,
          enumerateLegalClaims({
            seat,
            ownHand: s.hands[seat],
            public: buildPublicSnapshot(s),
          }),
          s.hands[seat],
        )
      )
        throw new Error('INVALID_CLAIM');
      if (intent.kind !== 'pass') candidates.push({ seat, intent });
    }
    candidates.sort(
      (a, b) =>
        getClaimPriority(b.intent) - getClaimPriority(a.intent) ||
        seatDistance(offer.originSeat, a.seat, offer.source, s.rules.seatCount) -
          seatDistance(offer.originSeat, b.seat, offer.source, s.rules.seatCount),
    );
    const winner = candidates[0];
    if (winner?.intent.kind === 'hu') {
      const hu = evaluateHu(
        s.hands[winner.seat],
        offer.tileId,
        s.melds.filter((m) => m.ownerSeat === winner.seat),
        s.rules,
      );
      if (hu.status !== 'eligible')
        throw new Error(hu.status === 'deferred' ? 'RESOLUTION_DEFERRED' : 'INVALID_HU');
      s.hands[winner.seat].push(offer.tileId);
      clearWindow(s);
      finishWin(s, winner.seat, hu);
    } else if (winner?.intent.kind === 'claim') {
      const intent = winner.intent;
      s.hands[winner.seat] = s.hands[winner.seat].filter((id) => !intent.handTileIds.includes(id));
      s.melds.push({
        id: `${ctx.id}:meld`,
        ownerSeat: winner.seat,
        kind: intent.meldKind,
        tileIds: [...intent.handTileIds, offer.tileId],
        exposure: 'exposed',
        claimedOfferId: offer.id,
        sourceSeat: offer.originSeat,
        hu: getMeldHu(intent.meldKind, 'exposed'),
      });
      clearWindow(s);
      s.activeSeat = winner.seat;
      if (!s.hands[winner.seat].some((id) => decodeTile(id).role !== 'general')) {
        const hu = evaluateHu(
          s.hands[winner.seat],
          null,
          s.melds.filter((m) => m.ownerSeat === winner.seat),
          s.rules,
        );
        if (hu.status === 'deferred') throw new Error('RESOLUTION_DEFERRED');
        if (hu.status === 'eligible') finishWin(s, winner.seat, hu);
        else finishNonWin(s, winner.seat);
      } else {
        s.phase = 'await_discard';
        s.turnDeadlineAtMs = ctx.nowMs + s.rules.discardTimeoutMs;
      }
    } else {
      s.discards.push(offer.tileId);
      clearWindow(s);
      if (!s.wall.length) finishNonWin(s, null);
      else {
        s.phase = 'await_draw';
        s.activeSeat = (offer.originSeat + 1) % s.rules.seatCount;
        s.turnDeadlineAtMs = ctx.nowMs + s.rules.drawTimeoutMs;
      }
    }
    s.boardVersion++;
    return accept(s);
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'RESOLUTION_ERROR', '裁決尚未完成');
  }
}
