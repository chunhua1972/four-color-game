import {
  applyGameCommand,
  assertStateInvariants,
  buildPlayerSnapshot,
  chooseAiCommand,
  createDeck,
  createInitialState,
  ENGINE_VERSION,
  makeRuleConfig,
  resolveReactionWindow,
  shuffleDeck,
} from '@four-colors/game-core';
import type {
  AuthoritativeState,
  CommandReceipt,
  CommandRequest,
  Controller,
  PlayerSnapshot,
  TransitionResult,
} from '@four-colors/game-core';
import type { PracticeConfig } from '../gateway.ts';
import { z } from 'zod';
const DB_NAME = 'four-colors-practice-v1';
const configSchema = z
  .object({
    seats: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    difficulty: z.enum(['easy', 'normal']),
  })
  .strict();
const intentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pass') }).strict(),
  z.object({ kind: z.literal('hu') }).strict(),
  z
    .object({
      kind: z.literal('claim'),
      action: z.enum(['eat', 'pong', 'kong']),
      meldKind: z.enum([
        'general_single',
        'pair',
        'court',
        'army',
        'soldier_three',
        'soldier_four',
        'triple',
        'quad',
        'general_quad',
      ]),
      handTileIds: z.array(z.number().int().min(0).max(111)).max(3),
    })
    .strict(),
]);
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('discard'),
      tileId: z.number().int().min(0).max(111),
    })
    .strict(),
  z.object({ type: z.literal('open_draw') }).strict(),
  z.object({ type: z.literal('declare_opening_hu') }).strict(),
  z
    .object({
      type: z.literal('respond'),
      windowId: z.string(),
      intent: intentSchema,
      responseRevision: z.number().int().min(0),
    })
    .strict(),
]);
const requestSchema = z
  .object({
    gameId: z.string(),
    expectedBoardVersion: z.number().int().min(0),
    idempotencyKey: z.string().min(1).max(100),
    command: commandSchema,
  })
  .strict();
let state: AuthoritativeState | null = null;
let nextStepAt = 0;
let db: IDBDatabase | null = null;
const receipts = new Map<string, { hash: string; receipt: CommandReceipt }>();
const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};
function randomInt(n: number): number {
  const range = 4294967296 - (4294967296 % n);
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= range);
  return buf[0] % n;
}
async function openDB(): Promise<IDBDatabase> {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('saves');
      req.result.createObjectStore('history', { keyPath: 'gameId' });
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}
async function readSave(): Promise<
  | {
      state: AuthoritativeState;
      receipts: [string, { hash: string; receipt: CommandReceipt }][];
    }
  | undefined
> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = database.transaction('saves').objectStore('saves').get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function save(): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['saves', 'history'], 'readwrite');
    tx.objectStore('saves').put({ state, receipts: [...receipts] }, 'current');
    if (state?.result) {
      const snapshot = buildPlayerSnapshot(state, 0, Date.now());
      tx.objectStore('history').put({
        gameId: state.gameId,
        at: Date.now(),
        snapshot,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function snapshot(): PlayerSnapshot {
  if (!state) throw new Error('沒有暫存牌局');
  return buildPlayerSnapshot(state, 0, Date.now());
}
function publish(): void {
  if (state) scope.postMessage({ snapshot: snapshot() });
}
async function transition(result: TransitionResult): Promise<void> {
  if (!result.ok) throw new Error(result.error.reason + '（' + result.error.code + '）');
  state = result.state;
  await save();
  publish();
}
let queue = Promise.resolve();
function enqueue(work: () => Promise<void>) {
  queue = queue.then(work).catch((error) =>
    scope.postMessage({
      error: error instanceof Error ? error.message : '引擎錯誤',
    }),
  );
}
scope.onmessage = (event: MessageEvent<{ id: string; type: string; payload: unknown }>) =>
  enqueue(async () => {
    const { id, type, payload } = event.data;
    try {
      let data: unknown;
      if (type === 'initialize' || type === 'replay') {
        const desired =
          type === 'replay' && state
            ? {
                seats: state.rules.seatCount,
                difficulty: state.controllers.find((c) => c.kind === 'ai')?.difficulty ?? 'normal',
              }
            : payload;
        if (desired) {
          if (type === 'replay' && !state?.result) throw new Error('本局尚未結束');
          const config: PracticeConfig = configSchema.parse(desired);
          receipts.clear();
          const controllers: Controller[] = Array.from({ length: config.seats }, (_, seat) =>
            seat === 0
              ? { kind: 'human', userId: 'local' }
              : { kind: 'ai', difficulty: config.difficulty },
          );
          const dealer =
            state?.result && state.rules.seatCount === config.seats
              ? (state.result.winnerSeat ?? (state.dealerSeat + 1) % config.seats)
              : randomInt(config.seats);
          state = createInitialState(
            shuffleDeck(createDeck(), randomInt),
            dealer,
            makeRuleConfig(config.seats),
            controllers,
            crypto.randomUUID(),
            { nowMs: Date.now(), id: crypto.randomUUID() },
          );
          await save();
        } else {
          const saved = await readSave();
          if (saved?.state) {
            if (saved.state.engineVersion !== ENGINE_VERSION || saved.state.schemaVersion !== 1)
              throw new Error('暫局版本不相容，請建立新局');
            assertStateInvariants(saved.state);
            state = saved.state;
            for (const [key, value] of saved.receipts ?? []) receipts.set(key, value);
          }
        }
        nextStepAt = Date.now() + 700;
        data = state ? snapshot() : null;
        publish();
      } else if (type === 'command') {
        const req: CommandRequest = requestSchema.parse(payload);
        if (!state || req.gameId !== state.gameId) throw new Error('牌局已變更');
        const hash = JSON.stringify(req);
        const previous = receipts.get(req.idempotencyKey);
        if (previous) {
          if (previous.hash !== hash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          data = previous.receipt;
        } else {
          if (req.expectedBoardVersion !== state.boardVersion)
            throw new Error('牌局已更新，請重新選牌（STALE_VERSION）');
          const result = applyGameCommand(state, 0, req.command, {
            nowMs: Date.now(),
            id: crypto.randomUUID(),
          });
          if (!result.ok) throw new Error(result.error.reason + '（' + result.error.code + '）');
          state = result.state;
          const receipt: CommandReceipt = {
            idempotencyKey: req.idempotencyKey,
            accepted: true,
            boardVersion: state.boardVersion,
            snapshot: snapshot(),
          };
          receipts.set(req.idempotencyKey, { hash, receipt });
          if (receipts.size > 128) receipts.delete(receipts.keys().next().value!);
          await save();
          publish();
          data = receipt;
          nextStepAt = Date.now() + 600;
        }
      } else if (type === 'snapshot') {
        data = snapshot();
        publish();
      } else if (type === 'clear') {
        state = null;
        receipts.clear();
        await save();
        data = null;
      } else throw new Error('UNKNOWN_REQUEST');
      scope.postMessage({ id, data });
    } catch (error) {
      scope.postMessage({
        id,
        error: error instanceof Error ? error.message : '本地牌局錯誤',
      });
    }
  });
setInterval(
  () =>
    enqueue(async () => {
      if (!state || state.result || Date.now() < nextStepAt) return;
      const now = Date.now();
      const ctx = { nowMs: now, id: crypto.randomUUID() };
      if (state.window) {
        for (const seat of state.window.participantSeats) {
          const controller = state.controllers[seat];
          if (state.responses[seat] || controller.kind !== 'ai' || now >= state.window.deadlineAtMs)
            continue;
          const snap = buildPlayerSnapshot(state, seat, now);
          const command = chooseAiCommand(
            {
              seat,
              ownHand: snap.hand,
              public: snap.public,
              legalOptions: snap.legalOptions,
            },
            controller.difficulty,
            randomInt,
          );
          await transition(applyGameCommand(state, seat, command, ctx));
        }
        if (
          state.window &&
          (now >= state.window.deadlineAtMs ||
            state.window.participantSeats.every((seat) => state!.responses[seat]))
        )
          await transition(resolveReactionWindow(state, state.window.id, ctx));
      } else if (state.activeSeat !== null) {
        const seat = state.activeSeat;
        const controller = state.controllers[seat];
        if (
          controller.kind === 'ai' ||
          (state.turnDeadlineAtMs !== null && now >= state.turnDeadlineAtMs)
        ) {
          const snap = buildPlayerSnapshot(state, seat, now);
          const command = chooseAiCommand(
            {
              seat,
              ownHand: snap.hand,
              public: snap.public,
              legalOptions: snap.legalOptions,
            },
            controller.kind === 'ai' ? controller.difficulty : 'normal',
            randomInt,
          );
          await transition(applyGameCommand(state, seat, command, ctx));
        }
      }
      nextStepAt = Date.now() + 650;
    }),
  200,
);
