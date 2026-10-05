import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const base = 'https://chunhua1972.github.io/four-color-game/';
const browser = await chromium.launch();
const contexts = [];
const report = { at: new Date().toISOString(), url: base, checks: [] };
mkdirSync('.deploy', { recursive: true });
try {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(mobile);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(desktop);
  const a = await mobile.newPage(),
    b = await desktop.newPage();
  const response = await a.goto(base);
  console.log('Pages: HTTP loaded.');
  assert.equal(response.status(), 200);
  await a.getByRole('heading', { name: '邀朋友同桌', exact: true }).waitFor();
  const manifest = await a.request.get(`${base}manifest.webmanifest`);
  const m = await manifest.json();
  assert.equal(m.scope, '/four-color-game/');
  await a.getByRole('button', { name: '開始練習', exact: true }).click();
  await a.locator('.game-page').waitFor();
  const localId = await a.locator('.game-page').getAttribute('data-game-id');
  await a.reload();
  await a.locator('.game-page').waitFor();
  assert.equal(await a.locator('.game-page').getAttribute('data-game-id'), localId);
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  report.checks.push('pages-http', 'subpath-manifest', 'hash-router-reload', 'mobile-local-game');
  console.log('Pages: mobile practice and subpath reload passed.');
  await a.goto(`${base}#/lobby`);
  await a.getByLabel('你的暱稱').fill('Browser QA A');
  await a.getByLabel('總座位數').selectOption('2');
  await a.getByRole('button', { name: '建立房間', exact: true }).click();
  await a.locator('.invite-box strong').waitFor();
  console.log('Pages: cloud room created.');
  const code = await a.locator('.invite-box strong').innerText();
  const rid = new URL(a.url()).hash.split('/').at(-1);
  const ids = JSON.parse(readFileSync('.deploy/test-ids.json', 'utf8'));
  ids.rooms.push(rid);
  writeFileSync('.deploy/test-ids.json', JSON.stringify(ids));
  await b.goto(`${base}#/lobby`);
  await b.getByLabel('你的暱稱').fill('Browser QA B');
  await b.getByLabel('邀請碼', { exact: true }).fill(code);
  await b.getByRole('button', { name: '加入房間', exact: true }).click();
  await b.locator('.room-seats').waitFor();
  console.log('Pages: independent guest joined.');
  await a.locator('.room-seat').filter({ hasText: 'Browser QA B' }).waitFor();
  await a.getByRole('button', { name: '我準備好了', exact: true }).click();
  await a.getByRole('button', { name: '取消準備', exact: true }).waitFor();
  await b
    .locator('.room-seat')
    .filter({ hasText: 'Browser QA A' })
    .getByText('已準備', { exact: true })
    .waitFor();
  await b.getByRole('button', { name: '我準備好了', exact: true }).click();
  await a.getByRole('button', { name: '開始對戰', exact: true }).waitFor();
  await a.getByRole('button', { name: '開始對戰', exact: true }).click({ timeout: 15000 });
  await Promise.all([a.locator('.game-page').waitFor(), b.locator('.game-page').waitFor()]);
  console.log('Pages: both guests entered the same game.');
  const gameId = await a.locator('.game-page').getAttribute('data-game-id');
  assert.equal(await b.locator('.game-page').getAttribute('data-game-id'), gameId);
  ids.games.push(gameId);
  writeFileSync('.deploy/test-ids.json', JSON.stringify(ids));
  const ownA = await a.locator('.hand-rack .tile').count(),
    ownB = await b.locator('.hand-rack .tile').count();
  assert.equal(ownA, 21);
  assert.equal(ownB, 20);
  await a.reload();
  await a.locator('.game-page').waitFor();
  assert.equal(await a.locator('.game-page').getAttribute('data-game-id'), gameId);
  await a.locator('.hand-rack button:not(:disabled)').first().click();
  await a.getByRole('button', { name: /^打出 / }).click();
  await b.locator('.offer-area .tile').waitFor();
  await mobile.setOffline(true);
  await a.getByText('正在恢復連線，暫停送出動作…').waitFor();
  await mobile.setOffline(false);
  await a.locator('.game-page').waitFor();
  report.checks.push(
    'two-independent-browser-guests',
    'create-invite-join-ready-start',
    'same-cloud-game',
    'own-seat-hand-count',
    'cloud-reload',
    'cross-browser-discard',
    'offline-reconnect',
  );
  // Capture only generated QA accounts/game data, never auth headers/storage.
  await a.screenshot({ path: '.deploy/pages-mobile.png', fullPage: true });
  writeFileSync('docs/pages-verification.json', JSON.stringify(report, null, 2));
  console.log(
    `Published Pages verification passed: ${report.checks.length} checks, mobile and desktop cloud play.`,
  );
} catch (e) {
  console.error(`Published Pages verification failed: ${e.message.split('\n')[0]}`);
  console.error(
    e.stack?.split('\n').find((line) => line.includes('test-deployed.mjs')) ?? 'No script location',
  );
  for (let i = 0; i < contexts.length; i++)
    await contexts[i]
      .pages()[0]
      ?.screenshot({ path: `.deploy/pages-failure-${i}.png`, fullPage: true });
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
