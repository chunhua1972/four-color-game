import { supabase } from './supabase.ts';
import type { RuleConfig, SeatCount } from '@four-colors/game-core';
export interface CloudRoom {
  id: string;
  hostUserId: string;
  seatCount: SeatCount;
  status: 'waiting' | 'playing' | 'closed';
  revision: number;
  rules: RuleConfig;
  gameId: string | null;
  members: { userId: string; seat: number; name: string; ready: boolean }[];
  aiSeats: { seat: number; difficulty: 'easy' | 'normal' }[];
}
const messages: Record<string, string> = {
  UNAUTHORIZED: '登入已過期，請重新連線。',
  NOT_GAME_MEMBER: '你沒有加入這局。',
  NOT_ROOM_MEMBER: '你沒有加入這個房間。',
  STALE_VERSION: '局面已更新，請依最新牌局操作。',
  STALE_ROOM: '房間已更新，請再操作一次。',
  WINDOW_EXPIRED: '喊牌時間已結束。',
  WINDOW_FROZEN: '伺服器正在裁決，請稍候。',
  RESPONSE_LOCKED: '意向已鎖定。',
  INVALID_INVITE: '邀請碼不存在或已過期。',
  ROOM_FULL: '房間已滿。',
  ROOM_NOT_WAITING: '牌局進行中，請等待下一局。',
  HOST_ONLY: '這個動作需要房主操作。',
  NOT_ALL_READY: '請填滿座位，並讓所有真人按下準備。',
  AI_TAKEOVER: '離線超過 90 秒，這局已由電腦代打。可觀戰並在下一局重新加入。',
  CONCURRENT_RETRY: '目前操作較多，請依最新局面再試。',
  REQUEST_FAILED: '操作未完成，請確認設定與連線後再試。',
};
export async function ensureGuest() {
  if (!supabase) throw new Error('尚未設定雲端連線');
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  if (session) return session.user.id;
  const result = await supabase.auth.signInAnonymously();
  if (result.error) throw result.error;
  return result.data.user!.id;
}
export async function cloudCall<T>(
  operation: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase) throw new Error('尚未設定雲端連線');
  await ensureGuest();
  const { data, error } = await supabase.functions.invoke('game-api', {
    body: { operation, ...payload },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    let code: string | undefined;
    try {
      code = (await response?.json())?.error;
    } catch {
      /* network failure has no response */
    }
    throw new Error(
      code ? (messages[code] ?? `操作未完成（${code}）`) : '連線中斷，請恢復網路後再試。',
    );
  }
  return data.data as T;
}
export const roomCall = <T>(operation: string, data: Record<string, unknown> = {}) =>
  cloudCall<T>(`room.${operation}`, { data });
