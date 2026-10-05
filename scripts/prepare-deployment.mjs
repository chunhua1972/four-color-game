// Generate transient scheduler credentials only in an ignored directory.
// No secret is ever printed or passed as a command-line argument.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ];
    }),
);
const url = new URL(env.VITE_SUPABASE_URL);
if (url.hostname !== 'pojhgousjmrlussvslwu.supabase.co')
  throw new Error('Unexpected deployment target');
if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  const claims = JSON.parse(
    Buffer.from(env.VITE_SUPABASE_PUBLISHABLE_KEY?.split('.')[1] ?? '', 'base64url'),
  );
  if (claims.role !== 'anon') throw new Error('Only public frontend keys are allowed');
}
mkdirSync('.deploy', { recursive: true });
mkdirSync('.deploy/supabase', { recursive: true });
writeFileSync(
  '.deploy/supabase/config.toml',
  `project_id = "007-deployment"
[auth]
enable_anonymous_sign_ins = true
site_url = "https://chunhua1972.github.io/four-color-game/"
additional_redirect_urls = ["https://chunhua1972.github.io/four-color-game/", "http://localhost:5173", "http://localhost:4173"]
`,
);
const secret = randomBytes(32).toString('hex');
writeFileSync(
  '.deploy/job.env',
  `JOB_DISPATCH_SECRET=${secret}\nPUBLIC_ORIGINS=https://chunhua1972.github.io,http://localhost:5173,http://localhost:4173\n`,
);
const endpoint = `${url.origin}/functions/v1/job-dispatch`;
writeFileSync(
  '.deploy/cron.sql',
  `do $$ declare sid uuid; begin
select id into sid from vault.secrets where name='four_colors_job_secret';
if sid is null then perform vault.create_secret('${secret}','four_colors_job_secret'); else perform vault.update_secret(sid,'${secret}'); end if;
select id into sid from vault.secrets where name='four_colors_job_url';
if sid is null then perform vault.create_secret('${endpoint}','four_colors_job_url'); else perform vault.update_secret(sid,'${endpoint}'); end if;
end $$; select 'Scheduler configured without exposing credentials' as status;`,
);
console.log('Deployment files prepared in ignored .deploy/; scheduler credential remains private.');
