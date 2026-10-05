import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CommandReceipt, CommandRequest, PlayerSnapshot } from '@four-colors/game-core';
import type { GameGateway } from './gateway.ts';
import { supabase } from '../../lib/supabase.ts';
import { cloudCall, ensureGuest } from '../../lib/cloud.ts';
export class CloudGateway implements GameGateway {
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  private channel: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshot: PlayerSnapshot | null = null;
  private closed = false;
  private refreshing: Promise<PlayerSnapshot> | null = null;
  private pending: CommandRequest | null = null;
  onError: ((message: string) => void) | null = null;
  onConnection: ((connected: boolean) => void) | null = null;
  constructor(private gameId: string) {}
  async initialize() {
    await ensureGuest();
    await this.getSnapshot();
    if (this.closed) return;
    this.channel = supabase!
      .channel(`game:${this.gameId}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => {
        void this.getSnapshot().catch(() => {});
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void this.getSnapshot().catch(() => {});
      });
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.getSnapshot().catch(() => {});
    }, 10000);
    window.addEventListener('online', this.refresh);
    window.addEventListener('offline', this.offline);
  }
  private refresh = () => {
    void this.getSnapshot().catch(() => {});
  };
  private offline = () => {
    this.onConnection?.(false);
  };
  private publish(s: PlayerSnapshot) {
    if (this.closed) return;
    if (
      this.snapshot &&
      (s.public.boardVersion < this.snapshot.public.boardVersion ||
        (s.public.boardVersion === this.snapshot.public.boardVersion &&
          s.myResponseRevision < this.snapshot.myResponseRevision))
    )
      return;
    this.snapshot = s;
    for (const listener of this.listeners) listener(s);
  }
  getSnapshot(): Promise<PlayerSnapshot> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = cloudCall<PlayerSnapshot>('snapshot', { gameId: this.gameId })
      .then((s) => {
        this.publish(s);
        this.onConnection?.(true);
        return s;
      })
      .catch((e) => {
        this.onConnection?.(false);
        this.onError?.(e.message);
        throw e;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  async submitCommand(req: CommandRequest): Promise<CommandReceipt> {
    const pending = this.pending;
    if (pending && JSON.stringify(pending.command) !== JSON.stringify(req.command)) {
      await this.submitCommand(pending);
      await this.getSnapshot();
      throw new Error('已確認前一次動作，請依最新局面操作。');
    }
    const request = pending ?? req;
    this.pending = request;
    try {
      const receipt = await cloudCall<CommandReceipt>('command', { request });
      this.pending = null;
      this.publish(receipt.snapshot);
      await this.getSnapshot();
      return receipt;
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('連線中斷')) this.pending = null;
      await this.getSnapshot().catch(() => {});
      throw e;
    }
  }
  subscribe(listener: (s: PlayerSnapshot) => void) {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.channel) void supabase!.removeChannel(this.channel);
    window.removeEventListener('online', this.refresh);
    window.removeEventListener('offline', this.offline);
    this.listeners.clear();
  }
}
