import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const text = readFileSync('.env.local', 'utf8');
for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
  const value = text
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error(`Missing ${name}`);
  if (name.endsWith('KEY') && !value.startsWith('sb_publishable_')) {
    const claims = JSON.parse(Buffer.from(value.split('.')[1] ?? '', 'base64url'));
    if (claims.role !== 'anon') throw new Error('Refusing a non-public key');
  }
  const result = spawnSync(
    'gh',
    ['variable', 'set', name, '--repo', 'chunhua1972/four-color-game'],
    { input: value, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`Unable to set ${name}`);
  console.log(`${name}: GitHub Actions public build variable set.`);
}
