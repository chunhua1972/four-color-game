import type {
  CommandReceipt,
  CommandRequest,
  Difficulty,
  PlayerSnapshot,
  SeatCount,
} from '@four-colors/game-core';
export interface GameGateway {
  getSnapshot(): Promise<PlayerSnapshot>;
  submitCommand(req: CommandRequest): Promise<CommandReceipt>;
  subscribe(listener: (s: PlayerSnapshot) => void): () => void;
  dispose(): void;
}
export interface PracticeConfig {
  seats: SeatCount;
  difficulty: Difficulty;
}
export class LocalGateway implements GameGateway {
  private worker = new Worker(new URL('./workers/local.worker.ts', import.meta.url), {
    type: 'module',
  });
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private snapshot: PlayerSnapshot | null = null;
  onError: ((message: string) => void) | null = null;
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{
        id?: string;
        data?: unknown;
        snapshot?: PlayerSnapshot;
        error?: string;
      }>,
    ) => {
      const { id, data, snapshot, error } = event.data;
      if (snapshot) {
        this.snapshot = snapshot;
        for (const listener of this.listeners) listener(snapshot);
      }
      if (id) {
        const request = this.pending.get(id);
        if (request) {
          if (error) request.reject(new Error(error));
          else request.resolve(data);
          this.pending.delete(id);
        }
      } else if (error) this.onError?.(error);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '本地引擎無法啟動');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.onError?.(error.message);
    };
  }
  private request<T>(type: string, payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (data) => resolve(data as T), reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
  initialize(config?: PracticeConfig): Promise<PlayerSnapshot | null> {
    return this.request('initialize', config);
  }
  replay(): Promise<PlayerSnapshot> {
    return this.request('replay');
  }
  clear(): Promise<void> {
    return this.request('clear');
  }
  async getSnapshot(): Promise<PlayerSnapshot> {
    return this.request('snapshot');
  }
  submitCommand(req: CommandRequest): Promise<CommandReceipt> {
    return this.request('command', req);
  }
  subscribe(listener: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('已離開牌桌'));
    this.pending.clear();
    this.listeners.clear();
  }
}
