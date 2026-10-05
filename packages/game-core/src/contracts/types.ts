export type SeatCount = 2 | 3 | 4 | 5 | 6;
export type SeatId = number;
export type TileId = number;
export type TileTypeId = number;
export type Color = 'red' | 'yellow' | 'green' | 'white';
export type Role = 'general' | 'advisor' | 'elephant' | 'chariot' | 'horse' | 'cannon' | 'soldier';
export type Difficulty = 'easy' | 'normal';
export type MeldKind =
  | 'general_single'
  | 'pair'
  | 'court'
  | 'army'
  | 'soldier_three'
  | 'soldier_four'
  | 'triple'
  | 'quad'
  | 'general_quad';
export type Exposure = 'concealed' | 'exposed';
export type Phase =
  'dealer_opening' | 'await_discard' | 'await_draw' | 'response_window' | 'finished' | 'drawn_game';
export interface Tile {
  id: TileId;
  typeId: TileTypeId;
  color: Color;
  role: Role;
}
export interface RuleConfig {
  presetId: 'tw10-product-v1' | 'tw10-extended-v1';
  version: 1;
  seatCount: SeatCount;
  baseHandSize: 20 | 16 | 14;
  minBaseHu: 10;
  allowSoldierPair: false;
  allowGeneralTriple: false;
  allowPassHu: true;
  mandatoryKong: false;
  generalDiscardable: false;
  incomingGroupExposure: 'exposed';
  multiWin: false;
  flowerEnabled: boolean;
  flowerCountScope: 'winner_all_owned_cards';
  stakeUnit: 1;
  responseTimeoutMs: 12000;
  discardTimeoutMs: 30000;
  drawTimeoutMs: 8000;
  reconnectGraceMs: 90000;
  shuffleEveryRound: true;
}
export interface Pattern {
  key: string;
  kind: MeldKind;
  types: number[];
}
export interface PartitionGroup {
  kind: MeldKind;
  typeCounts: number[];
  includesIncoming: boolean;
  exposure: Exposure;
  hu: number;
}
export type WinSolveResult =
  | {
      status: 'complete';
      groups: PartitionGroup[];
      concealedAndIncomingHu: number;
      nodes: number;
    }
  | { status: 'not_complete'; nodes: number }
  | { status: 'deferred'; reason: 'budget_exceeded'; nodes: number };
export type HuEvaluation =
  | {
      status: 'eligible' | 'below_threshold';
      baseHu: number;
      groups: PartitionGroup[];
    }
  | { status: 'not_complete' | 'deferred' };
export interface Meld {
  id: string;
  ownerSeat: SeatId;
  kind: MeldKind;
  tileIds: TileId[];
  exposure: 'exposed';
  claimedOfferId: string;
  sourceSeat: SeatId;
  hu: number;
}
export interface Offer {
  id: string;
  tileId: TileId;
  source: 'discard' | 'open_draw';
  originSeat: SeatId;
  createdAtMs: number;
}
export interface ReactionWindow {
  id: string;
  offerId: string;
  participantSeats: SeatId[];
  startedAtMs: number;
  deadlineAtMs: number;
}
export type ClaimIntent =
  | { kind: 'pass' }
  | { kind: 'hu' }
  | {
      kind: 'claim';
      action: 'eat' | 'pong' | 'kong';
      meldKind: MeldKind;
      handTileIds: TileId[];
    };
export type PlayerCommand =
  | { type: 'discard'; tileId: TileId }
  | { type: 'open_draw' }
  | { type: 'declare_opening_hu' }
  | {
      type: 'respond';
      windowId: string;
      intent: ClaimIntent;
      responseRevision: number;
    };
export interface ResponseReceipt {
  windowId: string;
  acceptedAtMs: number;
  intent: ClaimIntent;
  responseRevision: number;
  locked: true;
}
export interface LegalOption {
  id: string;
  command: PlayerCommand;
  previewTileIds: TileId[];
  huIfWinning?: number;
  terminalConsequence?: 'win' | 'xiang_gong';
}
export interface ScoreDelta {
  seat: SeatId;
  delta: number;
}
export interface RoundResult {
  reason: 'win' | 'draw' | 'xiang_gong' | 'administrative_abort';
  winnerSeat: SeatId | null;
  penaltySeat: SeatId | null;
  baseHu: number;
  flowerHu: number;
  totalHu: number;
  groups: PartitionGroup[];
  scores: ScoreDelta[];
}
export type Controller = { kind: 'human'; userId: string } | { kind: 'ai'; difficulty: Difficulty };
export interface AuthoritativeState {
  schemaVersion: 1;
  gameId: string;
  boardVersion: number;
  engineVersion: string;
  rules: RuleConfig;
  phase: Phase;
  dealerSeat: SeatId;
  activeSeat: SeatId | null;
  turnDeadlineAtMs: number | null;
  controllers: Controller[];
  wall: TileId[];
  hands: TileId[][];
  melds: Meld[];
  discards: TileId[];
  offer: Offer | null;
  window: ReactionWindow | null;
  responses: Record<string, ResponseReceipt>;
  firstDiscardTypeId: TileTypeId | null;
  flowerTileId: TileId | null;
  result: RoundResult | null;
}
export interface PublicSeat {
  seat: SeatId;
  name: string;
  controllerKind: Controller['kind'];
  handCount: number;
  melds: Meld[];
  publicHu: number;
}
export interface PublicSnapshot {
  gameId: string;
  boardVersion: number;
  engineVersion: string;
  rules: RuleConfig;
  phase: Phase;
  dealerSeat: SeatId;
  activeSeat: SeatId | null;
  turnDeadlineAtMs: number | null;
  wallCount: number;
  seats: PublicSeat[];
  offer: Offer | null;
  window: ReactionWindow | null;
  discards: TileId[];
  flowerTileId: TileId | null;
  firstDiscardTypeId: TileTypeId | null;
  result: RoundResult | null;
}
export interface PlayerSnapshot {
  public: PublicSnapshot;
  viewerSeat: SeatId;
  hand: TileId[];
  legalOptions: LegalOption[];
  myResponse: ResponseReceipt | null;
  myResponseRevision: number;
  serverNowMs: number;
  hint: HuEvaluation;
}
export interface PlayerRuleView {
  seat: SeatId;
  ownHand: TileId[];
  public: PublicSnapshot;
}
export interface AiObservation extends PlayerRuleView {
  legalOptions: LegalOption[];
}
export interface EngineContext {
  nowMs: number;
  id: string;
}
export interface RuleError {
  code: string;
  reason: string;
}
export type TransitionResult =
  { ok: true; state: AuthoritativeState } | { ok: false; error: RuleError };
export interface CommandRequest {
  gameId: string;
  expectedBoardVersion: number;
  idempotencyKey: string;
  command: PlayerCommand;
}
export interface CommandReceipt {
  idempotencyKey: string;
  accepted: true;
  boardVersion: number;
  snapshot: PlayerSnapshot;
}
export const ENGINE_VERSION = '0.1.0';
