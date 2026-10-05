import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
let failed = false;
for (const file of files) {
  if (
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
    /(^|\/)(?:\.deploy|\.temp)(?:\/|$)/.test(file)
  ) {
    console.error(`Forbidden tracked file: ${file}`);
    failed = true;
    continue;
  }
  const data = readFileSync(file);
  if (data.includes(0)) continue;
  const text = data.toString('utf8');
  const patterns = [
    /sb_secret_[A-Za-z0-9_-]{10,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  if (patterns.some((p) => p.test(text))) {
    console.error(`Credential-like content: ${file}`);
    failed = true;
  }
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      if (claims.role === 'service_role') {
        console.error(`Server credential: ${file}`);
        failed = true;
      }
    } catch {
      /* not a JWT */
    }
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `Secret check passed: ${files.length} tracked files; no environment files or server credentials.`,
  );
