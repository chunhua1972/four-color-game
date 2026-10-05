import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const base = process.env.VITE_BASE_PATH ?? '/';
const assets = readdirSync(`${dir}/assets`).map((file) => `${base}assets/${file}`);
const index = readFileSync(`${dir}/index.html`, 'utf8');
const swTemplate = readFileSync(new URL('../apps/web/public/sw.js', import.meta.url), 'utf8');
const version = createHash('sha256')
  .update(index)
  .update(swTemplate)
  .update(JSON.stringify(assets))
  .digest('hex')
  .slice(0, 12);
const sw = swTemplate
  .replace(
    /const PRECACHE = \[[\s\S]*?\];/,
    `const PRECACHE = ${JSON.stringify([base, ...['index.html', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'].map((p) => base + p), ...assets])};`,
  )
  .replace("cache.match('/index.html')", `cache.match('${base}index.html')`)
  .replace('four-colors-shell-dev', `four-colors-shell-${version}`);
writeFileSync(`${dir}/sw.js`, sw);
const manifest = JSON.parse(readFileSync(`${dir}/manifest.webmanifest`, 'utf8'));
manifest.id = base;
manifest.start_url = base;
manifest.scope = base;
manifest.description = '四色牌 2–6 席真人與 AI 同桌對戰';
manifest.icons.forEach((icon) => {
  icon.src = base + icon.src.replace(/^\//, '');
});
writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify(manifest, null, 2));
console.log(`Offline shell ${version}: ${assets.length} static assets.`);
