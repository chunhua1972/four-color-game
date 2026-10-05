import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  assertStateInvariants,
  createDeck,
  createInitialState,
  makeRuleConfig,
} from '../../packages/game-core/src/index.ts';
import type { AuthoritativeState, SeatCount } from '../../packages/game-core/src/index.ts';
const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
async function seedPractice(page: Page, s: AuthoritativeState) {
  await page.goto('/');
  await page.evaluate(async (state) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('four-colors-practice-v1', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('saves');
        req.result.createObjectStore('history', { keyPath: 'gameId' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put({ state, receipts: [] }, 'current');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, s);
  await page.goto('/practice');
}
function fixture(n: SeatCount): AuthoritativeState {
  const types =
    n <= 4
      ? [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 22, 22, 22, 22, 0, 0, 0, 0, 14]
      : n === 5
        ? [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 22, 22, 22, 22, 0]
        : [3, 3, 3, 3, 10, 10, 10, 10, 19, 19, 19, 19, 21, 21, 21];
  const counts = Array<number>(28).fill(0);
  const hand = types.map((t) => t * 4 + counts[t]++);
  const s = createInitialState(
    createDeck(),
    0,
    makeRuleConfig(n),
    Array.from({ length: n }, (_, i) =>
      i === 0 ? { kind: 'human', userId: 'local' } : { kind: 'ai', difficulty: 'normal' },
    ),
    `fixture-${n}`,
    { nowMs: Date.now(), id: 'init' },
  );
  s.hands[0] = hand;
  const remaining = createDeck().filter((id) => !hand.includes(id));
  for (let i = 1; i < n; i++) s.hands[i] = remaining.splice(0, s.rules.baseHandSize);
  s.wall = remaining;
  assertStateInvariants(s);
  return s;
}
for (let i = 0; i < 5; i++) {
  const n = (i + 2) as SeatCount;
  const viewport = sizes[i];
  test(`${n} seats fit ${viewport.width}x${viewport.height} and restore`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: `${n}席`, exact: true }).click();
    await page.getByRole('button', { name: '開始練習' }).click();
    await expect(page.getByRole('heading', { name: '四色・十胡仔' })).toBeVisible();
    await expect(page.locator('.seat-panel')).toHaveCount(n - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const firstCount = await page.locator('.hand-rack .tile').count();
    expect(firstCount).toBeGreaterThanOrEqual(n <= 4 ? 19 : n === 5 ? 15 : 13);
    await page.screenshot({
      path: `docs/screenshots/practice-${n}-${viewport.width}.png`,
      fullPage: true,
    });
    const gameId = await page.locator('.game-page').getAttribute('data-game-id');
    await page.reload();
    await expect(page.getByRole('heading', { name: '四色・十胡仔' })).toBeVisible();
    await expect(page.locator('.seat-panel')).toHaveCount(n - 1);
    await expect(page.locator('.game-page')).toHaveAttribute('data-game-id', gameId!);
    await expect(page.locator('.error')).toHaveCount(0);
  });
  test(`${n}-seat golden opening win, settlement and replay`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedPractice(page, fixture(n));
    await page.getByRole('button', { name: '天胡', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: '本局胡牌' })).toBeVisible();
    await expect(page.locator('.score-list>div')).toHaveCount(n);
    await page.getByRole('dialog').getByRole('button', { name: '再玩一局' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.seat-panel')).toHaveCount(n - 1);
  });
}
test('selecting a tile does not submit; keyboard Escape cancels', async ({ page }) => {
  await seedPractice(page, fixture(4));
  const tile = page.locator('.hand-rack button:not([disabled])').first();
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.offer-area .tile')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tile).toHaveAttribute('aria-pressed', 'false');
  await tile.click();
  await page.getByRole('button', { name: /^打出 / }).click();
  await expect(page.locator('.offer-area .tile')).toHaveCount(1);
});
test('production offline shell restores practice without caching APIs', async ({
  page,
  context,
}) => {
  await seedPractice(page, fixture(4));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('.hand-rack')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.hand-rack')).toBeVisible();
  await expect(page.getByText('目前離線，本地練習仍可使用')).toBeVisible();
  const urls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const key of await caches.keys())
      for (const req of await (await caches.open(key)).keys()) result.push(req.url);
    return result;
  });
  expect(urls.some((url) => /\/(auth|rest|functions|api)\//.test(url))).toBe(false);
});
test('rule lab evaluates fixed-meld counterexample', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('button', { name: '載入明槓反例' }).click();
  await page.getByRole('button', { name: '計算最佳完整拆組' }).click();
  await expect(page.getByRole('heading', { name: '完整但未達門檻・8 胡' })).toBeVisible();
});
