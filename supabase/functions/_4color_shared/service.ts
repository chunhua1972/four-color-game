import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { z } from 'npm:zod@4.6.5';
import {
  applyGameCommand,
  assertStateInvariants,
  buildPlayerSnapshot,
  buildPublicSnapshot,
  chooseAiCommand,
  createDeck,
  createInitialState,
  makeRuleConfig,
  resolveReactionWindow,
  shuffleDeck,
} from '../../../packages/game-core/src/index.ts';
import type {
  AuthoritativeState,
  CommandReceipt,
  CommandRequest,
  Controller,
  PlayerSnapshot,
  PublicSnapshot,
  SeatCount,
} from '../../../packages/game-core/src/index.ts';

export const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(`4color_${name}`, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export function randomInt(n: number) {
  const a = new Uint32Array(1),
    range = 4294967296 - (4294967296 % n);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= range);
  return a[0] % n;
}
export async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function invitation() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
const uuid = z.string().uuid();
const intent = z.discriminatedUnion('kind', [
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
export const commandRequest = z
  .object({
    gameId: uuid,
    expectedBoardVersion: z.number().int().nonnegative(),
    idempotencyKey: uuid,
    command: z.discriminatedUnion('type', [
      z.object({ type: z.literal('discard'), tileId: z.number().int().min(0).max(111) }).strict(),
      z.object({ type: z.literal('open_draw') }).strict(),
      z.object({ type: z.literal('declare_opening_hu') }).strict(),
      z
        .object({
          type: z.literal('respond'),
          windowId: z.string().max(100),
          intent,
          responseRevision: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
  })
  .strict();
interface Context {
  state: AuthoritativeState;
  stateHash: string;
  resolutionToken: string | null;
  seat: number;
  serverNowMs: number;
  public: PublicSnapshot;
  receipt?: CommandReceipt;
  presence: Record<string, number>;
}
export interface Room {
  id: string;
  hostUserId: string;
  seatCount: SeatCount;
  status: string;
  revision: number;
  rules: AuthoritativeState['rules'];
  gameId: string | null;
  members: { userId: string; seat: number; name: string; ready: boolean }[];
  aiSeats: { seat: number; difficulty: 'easy' | 'normal' }[];
}
function projection(state: AuthoritativeState, old?: PublicSnapshot): PublicSnapshot {
  const pub = buildPublicSnapshot(state);
  pub.seats.forEach((seat) => {
    const original = old?.seats[seat.seat];
    seat.name =
      original?.name ??
      (seat.controllerKind === 'human' ? `玩家 ${seat.seat + 1}` : `電腦 ${seat.seat + 1}`);
    if (original?.controllerKind === 'human' && seat.controllerKind === 'ai')
      seat.name += '（代打）';
  });
  return pub;
}
function playerSnapshot(
  state: AuthoritativeState,
  seat: number,
  now: number,
  pub: PublicSnapshot,
): PlayerSnapshot {
  const snap = buildPlayerSnapshot(state, seat, now);
  snap.public = pub;
  // A returning guest whose seat has been taken over remains a read-only participant.
  if (state.controllers[seat].kind !== 'human') snap.legalOptions = [];
  return snap;
}
export async function snapshot(gameId: string, actor: string) {
  uuid.parse(gameId);
  const ctx = await rpc<Context>('server_game_context', { p_game: gameId, p_actor: actor });
  return playerSnapshot(ctx.state, ctx.seat, ctx.serverNowMs, ctx.public);
}
export async function command(actor: string, input: unknown): Promise<CommandReceipt> {
  const request: CommandRequest = commandRequest.parse(input);
  const requestHash = await hash(JSON.stringify(request));
  for (let attempt = 0; attempt < 8; attempt++) {
    const ctx = await rpc<Context>('server_game_context', {
      p_game: request.gameId,
      p_actor: actor,
      p_key: request.idempotencyKey,
      p_request_hash: requestHash,
    });
    if (ctx.receipt) return ctx.receipt;
    if (ctx.state.boardVersion !== request.expectedBoardVersion) throw new Error('STALE_VERSION');
    if (ctx.state.controllers[ctx.seat].kind !== 'human') throw new Error('AI_TAKEOVER');
    if (ctx.resolutionToken) throw new Error('WINDOW_FROZEN');
    const transition = applyGameCommand(ctx.state, ctx.seat, request.command, {
      nowMs: ctx.serverNowMs,
      id: crypto.randomUUID(),
    });
    if (!transition.ok) throw new Error(transition.error.code);
    assertStateInvariants(transition.state);
    const pub = projection(transition.state, ctx.public);
    const receipt: CommandReceipt = {
      accepted: true,
      idempotencyKey: request.idempotencyKey,
      boardVersion: transition.state.boardVersion,
      snapshot: playerSnapshot(transition.state, ctx.seat, ctx.serverNowMs, pub),
    };
    const commit = await rpc<{ conflict?: boolean; receipt: CommandReceipt }>(
      'server_commit_game',
      {
        p_game: request.gameId,
        p_expected_hash: ctx.stateHash,
        p_state: transition.state,
        p_public: pub,
        p_actor: actor,
        p_key: request.idempotencyKey,
        p_request_hash: requestHash,
        p_receipt: receipt,
        p_command: request.command,
      },
    );
    if (!commit.conflict) return commit.receipt;
  }
  throw new Error('CONCURRENT_RETRY');
}
export async function roomAction(actor: string, operation: string, input: unknown) {
  const payload = z.record(z.string(), z.unknown()).parse(input);
  if (operation === 'start') {
    const { roomId, revision } = z
      .object({ roomId: uuid, revision: z.number().int().nonnegative() })
      .strict()
      .parse(payload);
    const room = await rpc<Room>('server_room_action', {
      p_actor: actor,
      p_operation: 'get',
      p_data: { roomId },
    });
    if (room.hostUserId !== actor) throw new Error('HOST_ONLY');
    if (room.status === 'playing') return { gameId: room.gameId };
    const controllers: Controller[] = Array.from({ length: room.seatCount }, (_, seat) => {
      const member = room.members.find((m) => m.seat === seat),
        ai = room.aiSeats.find((a) => a.seat === seat);
      if (member) return { kind: 'human', userId: member.userId };
      if (ai) return { kind: 'ai', difficulty: ai.difficulty };
      throw new Error('NOT_ALL_READY');
    });
    let dealer = 0;
    if (room.gameId) {
      const old = await rpc<Context>('server_game_context', { p_game: room.gameId });
      dealer = old.state.result?.winnerSeat ?? (old.state.dealerSeat + 1) % room.seatCount;
    }
    const state = createInitialState(
      shuffleDeck(createDeck(), randomInt),
      dealer,
      room.rules,
      controllers,
      crypto.randomUUID(),
      { nowMs: Date.now(), id: crypto.randomUUID() },
    );
    const pub = projection(state);
    for (const member of room.members) pub.seats[member.seat].name = member.name;
    return rpc('server_start_game', {
      p_actor: actor,
      p_room: roomId,
      p_revision: revision,
      p_state: state,
      p_public: pub,
      p_rules_hash: await hash(JSON.stringify(state.rules)),
    });
  }
  let code: string | undefined;
  let data: Record<string, unknown>;
  const common = { roomId: uuid, revision: z.number().int().nonnegative() };
  switch (operation) {
    case 'create': {
      const p = z
        .object({
          name: z.string().trim().min(1).max(20),
          seatCount: z.number().int().min(2).max(6),
        })
        .strict()
        .parse(payload);
      code = invitation();
      data = {
        ...p,
        id: crypto.randomUUID(),
        rules: makeRuleConfig(p.seatCount as SeatCount),
        codeHash: await hash(code),
      };
      break;
    }
    case 'join': {
      const p = z
        .object({ name: z.string().trim().min(1).max(20), code: z.string().trim().min(12).max(20) })
        .strict()
        .parse(payload);
      data = { name: p.name, codeHash: await hash(p.code.toUpperCase().replace(/[\s-]/g, '')) };
      break;
    }
    case 'get':
      data = z.object({ roomId: uuid }).strict().parse(payload);
      break;
    case 'list':
      data = z.object({}).strict().parse(payload);
      break;
    case 'ready':
      data = z
        .object({ ...common, ready: z.boolean() })
        .strict()
        .parse(payload);
      break;
    case 'ai':
      data = z
        .object({
          ...common,
          seat: z.number().int().min(0).max(5),
          difficulty: z.enum(['easy', 'normal']).nullable(),
        })
        .strict()
        .parse(payload);
      break;
    case 'leave':
      data = z.object(common).strict().parse(payload);
      break;
    case 'invite': {
      data = z.object({ roomId: uuid }).strict().parse(payload);
      code = invitation();
      data.codeHash = await hash(code);
      break;
    }
    default:
      throw new Error('INVALID_OPERATION');
  }
  const result = await rpc('server_room_action', {
    p_actor: actor,
    p_operation: operation,
    p_data: data,
  });
  return code ? { room: result, code } : result;
}

interface Job {
  id: string;
  game_id: string;
  kind: 'ai' | 'deadline' | 'resolve' | 'reconnect';
  token: string;
}
async function runJob(job: Job) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let ctx = await rpc<Context>('server_game_context', { p_game: job.game_id });
    const state = ctx.state;
    if (state.result) return false;
    const token = state.window?.id ?? String(state.boardVersion);
    let next: AuthoritativeState;
    let cmd: unknown = { type: job.kind, token: job.token };
    if ((job.kind === 'resolve' || job.kind === 'deadline') && state.window) {
      if (job.token !== token) return false;
      const frozen = await rpc<Context | null>('server_freeze_window', {
        p_game: job.game_id,
        p_window: state.window.id,
      });
      if (!frozen) return false;
      ctx = frozen;
      const transition = resolveReactionWindow(ctx.state, state.window.id, {
        nowMs: ctx.serverNowMs,
        id: crypto.randomUUID(),
      });
      if (!transition.ok) throw new Error(transition.error.code);
      next = transition.state;
    } else if (job.kind === 'reconnect') {
      const seat = Number(job.token);
      if (state.controllers[seat]?.kind !== 'human') return false;
      if (ctx.serverNowMs - ctx.presence[String(seat)] < state.rules.reconnectGraceMs) return false;
      next = structuredClone(state);
      next.controllers[seat] = { kind: 'ai', difficulty: 'normal' };
      next.boardVersion++;
    } else {
      const seat =
        job.kind === 'ai'
          ? Number(job.token.slice(job.token.lastIndexOf(':') + 1))
          : state.activeSeat;
      if (seat === null) return false;
      if (
        job.kind === 'ai' &&
        (job.token !== `${token}:${seat}` || state.controllers[seat].kind !== 'ai')
      )
        return false;
      if (
        job.kind === 'deadline' &&
        (job.token !== token || ctx.serverNowMs < (state.turnDeadlineAtMs ?? Infinity))
      )
        return false;
      if (ctx.resolutionToken) return false;
      const own = buildPlayerSnapshot(state, seat, ctx.serverNowMs);
      if (!own.legalOptions.length) return false;
      const controller = state.controllers[seat];
      const action = chooseAiCommand(
        { seat, ownHand: own.hand, public: own.public, legalOptions: own.legalOptions },
        controller.kind === 'ai' ? controller.difficulty : 'normal',
        randomInt,
      );
      cmd = action;
      const transition = applyGameCommand(state, seat, action, {
        nowMs: ctx.serverNowMs,
        id: crypto.randomUUID(),
      });
      if (!transition.ok) throw new Error(transition.error.code);
      next = transition.state;
    }
    assertStateInvariants(next);
    const result = await rpc<{ conflict?: boolean }>('server_commit_game', {
      p_game: job.game_id,
      p_expected_hash: ctx.stateHash,
      p_state: next,
      p_public: projection(next, ctx.public),
      p_resolution: ctx.resolutionToken,
      p_job: job.id,
      p_command: cmd,
    });
    if (!result.conflict) return true;
  }
  throw new Error('JOB_CAS_RETRY');
}
export async function dispatchJobs() {
  const jobs = await rpc<Job[]>('server_claim_jobs', { p_limit: 12 });
  let completed = 0,
    retried = 0;
  await Promise.all(
    jobs.map(async (job) => {
      try {
        if (await runJob(job)) completed++;
        else await rpc('server_finish_job', { p_id: job.id });
      } catch {
        // Do not log authoritative states, tokens or keys. Leases recover worker termination.
        retried++;
        await rpc('server_finish_job', { p_id: job.id, p_retry: true });
      }
    }),
  );
  return { claimed: jobs.length, completed, retried };
}
