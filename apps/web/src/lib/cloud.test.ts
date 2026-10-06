import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock('./supabase.ts', () => ({ supabase: { auth } }));
describe('first guest identity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  it('concurrent first-page requests share one guest, then reuse the saved identity', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signInAnonymously.mockResolvedValue({ data: { user: { id: 'same-guest' } }, error: null });
    const { ensureGuest } = await import('./cloud.ts');
    const ids = await Promise.all(Array.from({ length: 25 }, () => ensureGuest()));
    expect(new Set(ids)).toEqual(new Set(['same-guest']));
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'same-guest' } } },
      error: null,
    });
    expect(await ensureGuest()).toBe('same-guest');
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
  it('a failed initial connection can retry without caching a rejected identity', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signInAnonymously
      .mockResolvedValueOnce({ data: { user: null }, error: new Error('offline') })
      .mockResolvedValueOnce({ data: { user: { id: 'recovered' } }, error: null });
    const { ensureGuest } = await import('./cloud.ts');
    await expect(ensureGuest()).rejects.toThrow('offline');
    expect(await ensureGuest()).toBe('recovered');
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
  it('refreshes a migrated guest against Games without creating a new identity', async () => {
    const claims = btoa(JSON.stringify({ ref: 'pojhgousjmrlussvslwu' }));
    auth.getSession.mockResolvedValue({
      data: {
        session: { access_token: `header.${claims}.signature`, user: { id: 'original-guest' } },
      },
      error: null,
    });
    auth.refreshSession.mockResolvedValue({
      data: { session: { user: { id: 'original-guest' } } },
      error: null,
    });
    const { ensureGuest } = await import('./cloud.ts');
    expect(await ensureGuest()).toBe('original-guest');
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
  it('keeps a migrated identity on refresh failure so reconnect can retry', async () => {
    const claims = btoa(JSON.stringify({ ref: 'pojhgousjmrlussvslwu' }));
    auth.getSession.mockResolvedValue({
      data: {
        session: { access_token: `header.${claims}.signature`, user: { id: 'original-guest' } },
      },
      error: null,
    });
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('offline') });
    const { ensureGuest } = await import('./cloud.ts');
    await expect(ensureGuest()).rejects.toThrow('offline');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
});
