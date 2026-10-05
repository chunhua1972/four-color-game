import { chromium } from '@playwright/test';
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 1000 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto('http://localhost:5173');
    await page.getByRole('button', { name: '開始練習' }).waitFor();
    await page.screenshot({ path: `docs/screenshots/home-${name}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
