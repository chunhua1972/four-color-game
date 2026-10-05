import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('apps/web/public/icon.svg', 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
    );
    await page.screenshot({ path: `apps/web/public/icon-${size}.png`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('Original SVG exported to PWA/iOS PNG icons.');
