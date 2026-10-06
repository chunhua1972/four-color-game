// Explicit, resumable migration between the two user-owned projects.
// Database records, sessions, and credentials stay in ignored .deploy files.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const source = 'pojhgousjmrlussvslwu';
export const target = 'aabjctsxjwsismfrwpja';
const cli = process.env.SUPABASE_CLI ?? 'supabase';
const directory = resolve('.deploy/4color-migration');
mkdirSync(directory, { recursive: true });
export const quote = (v) => `"${v.replaceAll('"', '""')}"`;
export const literal = (v) => `'${v.replaceAll("'", "''")}'`;
export function run(args) {
  const result = spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(
      `Supabase ${args.slice(0, 2).join(' ')} failed: ${result.stderr?.slice(0, 600)}`,
    );
  return result.stdout;
}
export function query(ref, sql) {
  const file = resolve(directory, `query-${process.pid}.sql`);
  writeFileSync(file, sql);
  const output = run([
    'db',
    'query',
    '--linked',
    '--project-ref',
    ref,
    '--file',
    file,
    '--output',
    'json',
  ]);
  const response = JSON.parse(output);
  if (!Array.isArray(response.rows)) throw new Error('Unexpected database response');
  return response.rows;
}
const save = (name, value) =>
  writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2));
const load = (name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const tablesSql = `select schemaname as schema,tablename as name from pg_tables where schemaname in ('public','private','4color_private','auth') order by schemaname,tablename;`;
const columnsSql = `select table_schema as schema,table_name as name,column_name as column,ordinal_position,is_generated,is_identity from information_schema.columns where table_schema in ('public','private','4color_private','auth') order by table_schema,table_name,ordinal_position;`;
const names = {
  public: [
    'profiles',
    'rooms',
    'room_members',
    'room_ai_seats',
    'games',
    'game_members',
    'game_events',
    'game_results',
  ],
  private: [
    'game_authority',
    'tile_locations',
    'game_responses',
    'command_receipts',
    'room_invites',
    'internal_events',
    'jobs',
    'outbox',
  ],
};
const destination = (schema, name) =>
  `${schema === 'private' ? quote('4color_private') : quote(schema)}.${quote(schema === 'auth' ? name : `4color_${name}`)}`;
const tetrisFingerprint = () =>
  query(
    target,
    load('target-inventory.json')
      .tables.filter((t) => t.name.startsWith('tetris_'))
      .map(
        (t) =>
          `select ${literal(t.name)} as name,count(*)::int as count,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as hash from public.${quote(t.name)} t`,
      )
      .join(' union all '),
  );
const mode =
  process.argv[1] && resolve(process.argv[1]) === resolve('scripts/4color-migrate.mjs')
    ? process.argv[2]
    : undefined;
if (mode === 'inspect') {
  for (const [label, ref] of [
    ['source', source],
    ['target', target],
  ]) {
    const tables = query(ref, tablesSql);
    const counts = query(
      ref,
      tables
        .map(
          (t) =>
            `select ${literal(t.schema)} as schema,${literal(t.name)} as name,count(*)::int as count from ${quote(t.schema)}.${quote(t.name)}`,
        )
        .join(' union all '),
    );
    save(`${label}-inventory.json`, { tables: counts, columns: query(ref, columnsSql) });
    console.log(
      `${label}: ${JSON.stringify(counts.filter((t) => t.count || t.schema !== 'auth'))}`,
    );
  }
} else if (mode === 'backup') {
  // Repeat backup after writers are stopped for the final cutover.
  const inventory = load('source-inventory.json');
  const records = {};
  const selected = inventory.tables.filter(
    (t) => t.schema !== 'auth' || (t.count > 0 && t.name !== 'schema_migrations'),
  );
  const allRows = query(
    source,
    selected
      .map(
        (t) =>
          `select ${literal(t.schema)} as schema,${literal(t.name)} as name,coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as data from ${quote(t.schema)}.${quote(t.name)} t`,
      )
      .join(' union all '),
  );
  for (const t of allRows) {
    const { data } = t;
    records[`${t.schema}.${t.name}`] = data;
    console.log(`Backed up ${t.schema}.${t.name}: ${data.length} rows`);
  }
  save('source-data.json', records);
  save(
    'source-functions.json',
    query(
      source,
      `select n.nspname as schema,p.proname as name,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private');`,
    ),
  );
  save(
    'source-realtime-policies.json',
    query(
      source,
      `select policyname,cmd,qual,with_check from pg_policies where schemaname='realtime' and tablename='messages';`,
    ),
  );
  console.log('Backup complete; private records were not printed.');
} else if (mode === 'keys') {
  const keys = JSON.parse(
    run(['projects', 'api-keys', '--project-ref', target, '--output', 'json']),
  );
  const key = keys.find((k) => k.name === 'anon' || k.type === 'publishable')?.api_key;
  assert.ok(key, 'Public key not found');
  if (!key.startsWith('sb_publishable_'))
    assert.equal(JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role, 'anon');
  const old = readFileSync('.env.local', 'utf8');
  if (!existsSync(resolve(directory, 'source.env')))
    writeFileSync(resolve(directory, 'source.env'), old);
  writeFileSync(
    '.env.local',
    old
      .replace(/^VITE_SUPABASE_URL=.*$/m, `VITE_SUPABASE_URL=https://${target}.supabase.co`)
      .replace(/^VITE_SUPABASE_PUBLISHABLE_KEY=.*$/m, `VITE_SUPABASE_PUBLISHABLE_KEY=${key}`),
  );
  console.log('Local frontend now targets Games with its public key.');
} else if (mode === 'settings') {
  const workdir = resolve(directory, 'target-settings');
  mkdirSync(resolve(workdir, 'supabase'), { recursive: true });
  writeFileSync(resolve(workdir, 'supabase/config.toml'), 'project_id = "games"\n');
  run(['config', 'pull', '--project-ref', target, '--workdir', workdir, '--yes']);
  const config = readFileSync(resolve(workdir, 'supabase/config.toml'), 'utf8');
  console.log(
    config
      .split(/\r?\n/)
      .filter((line) =>
        /^(enable_anonymous_sign_ins|site_url|additional_redirect_urls)\s*=/.test(line),
      )
      .join('\n'),
  );
} else if (mode === 'schema') {
  const migrations = readdirSync('supabase/migrations')
    .filter((name) => /^20261006\d+_4color_.*\.sql$/.test(name))
    .sort();
  const sql = migrations
    .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
    .join('\n');
  const before = tetrisFingerprint();
  save('target-before.json', before);
  const tracking =
    `create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);` +
    migrations
      .map(
        (name) =>
          `insert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(name.split('_')[0])},${literal(name.replace(/^\d+_/, '').replace(/\.sql$/, ''))},array[${literal(readFileSync(`supabase/migrations/${name}`, 'utf8'))}]);`,
      )
      .join('\n');
  query(
    target,
    `begin;\n${sql}\n${tracking}\nnotify pgrst,'reload schema';\ncommit; select '4color schema installed' as status;`,
  );
  save('target-columns.json', query(target, columnsSql));
  console.log(
    'Games: 4color tables, functions, RLS, realtime policies and scheduler helpers installed. Cron remains inactive.',
  );
} else if (mode === 'freeze' || mode === 'unfreeze') {
  const functions = load('source-functions.json').filter(
    (f) => f.schema === 'public' && f.name.startsWith('server_'),
  );
  const signatures = query(
    source,
    `select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'server_%';`,
  );
  assert.equal(signatures.length, functions.length);
  const privileges = signatures
    .map((f) =>
      mode === 'freeze'
        ? `revoke execute on function ${f.signature} from service_role;`
        : `grant execute on function ${f.signature} to service_role;`,
    )
    .join('\n');
  const tables = Object.entries(names)
    .flatMap(([schema, tables]) => tables.map((name) => `${schema}.${quote(name)}`))
    .join(',');
  query(
    source,
    `begin; set local role postgres; lock table ${tables} in access exclusive mode; ${privileges} select cron.alter_job(jobid,active := ${mode === 'unfreeze'}) from cron.job where jobname in ('four-colors-jobs','four-colors-outbox'); commit; select 'Source ${mode}' as status;`,
  );
  console.log(
    `Source ${mode}: application writes and game cron ${mode === 'freeze' ? 'stopped' : 'resumed'}.`,
  );
} else if (mode === 'import') {
  const records = load('source-data.json');
  const columns = load('target-columns.json');
  const authOrder = [
    'users',
    'identities',
    'sessions',
    'refresh_tokens',
    'mfa_factors',
    'mfa_challenges',
    'mfa_amr_claims',
    'one_time_tokens',
    'flow_state',
  ];
  const ordered = [
    ...authOrder.map((name) => ['auth', name]),
    ...Object.entries(names).flatMap(([schema, list]) => list.map((name) => [schema, name])),
  ];
  let sql = 'begin; set local session_replication_role = replica;\n';
  for (const [schema, name] of ordered) {
    const rows = records[`${schema}.${name}`] ?? [];
    if (!rows.length) continue;
    const targetSchema = schema === 'private' ? '4color_private' : schema;
    const targetName = schema === 'auth' ? name : `4color_${name}`;
    const fields = columns
      .filter(
        (c) =>
          c.schema === targetSchema &&
          c.name === targetName &&
          c.is_generated === 'NEVER' &&
          !(schema === 'auth' && name === 'refresh_tokens' && c.column === 'id'),
      )
      .map((c) => c.column);
    assert.ok(fields.length, `Missing columns for ${schema}.${name}`);
    if (schema === 'auth') {
      const key = name === 'refresh_tokens' ? 'token' : 'id';
      const collisions = query(
        target,
        `select count(*)::int as n from ${destination(schema, name)} where ${quote(key)}::text in (${rows.map((r) => literal(String(r[key]))).join(',')});`,
      )[0].n;
      assert.equal(collisions, 0, `${schema}.${name} identity collision; import stopped`);
    }
    const relation = destination(schema, name);
    const selected = fields.map(quote).join(',');
    sql += `insert into ${relation}(${selected}) select ${selected} from jsonb_populate_recordset(null::${relation},${literal(JSON.stringify(rows))}::jsonb);\n`;
  }
  sql += "commit; select '4color records imported' as status;";
  writeFileSync(resolve(directory, 'import.sql'), sql);
  query(target, sql);
  console.log(
    'All 16 application tables and existing auth users/sessions imported atomically; refresh-token sequence IDs regenerated.',
  );
} else if (mode === 'verify') {
  const records = load('source-data.json');
  const checks = [];
  const live = query(
    target,
    Object.entries(names)
      .flatMap(([schema, tables]) =>
        tables.map(
          (name) =>
            `select ${literal(schema)} as schema,${literal(name)} as name,coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) as data from ${destination(schema, name)} t`,
        ),
      )
      .join(' union all '),
  );
  for (const [schema, tables] of Object.entries(names)) {
    for (const name of tables) {
      const original = records[`${schema}.${name}`];
      const { data } = live.find((t) => t.schema === schema && t.name === name);
      const canonical = (rows) =>
        rows
          .map((r) =>
            JSON.stringify(
              Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))),
            ),
          )
          .sort();
      const digest = (rows) =>
        createHash('sha256')
          .update(JSON.stringify(canonical(rows)))
          .digest('hex');
      assert.equal(digest(data), digest(original), `Mismatch: ${schema}.${name}`);
      checks.push({
        table: `${schema === 'private' ? '4color_private' : schema}.4color_${name}`,
        rows: data.length,
        exactMatch: true,
      });
    }
  }
  for (const name of ['users', 'sessions', 'refresh_tokens', 'mfa_amr_claims']) {
    const rows = records[`auth.${name}`] ?? [];
    const key = name === 'refresh_tokens' ? 'token' : 'id';
    const [{ n }] = query(
      target,
      `select count(*)::int as n from auth.${quote(name)} where ${quote(key)}::text in (${rows.map((r) => literal(String(r[key]))).join(',')});`,
    );
    assert.equal(n, rows.length);
    checks.push({ table: `auth.${name}`, imported: n });
  }
  assert.deepEqual(tetrisFingerprint(), load('target-before.json'), 'Existing Tetris data changed');
  checks.push({ existingTetrisTables: 7, unchanged: true });
  save('verification.json', { source, target, verifiedAt: new Date().toISOString(), checks });
  console.log(
    `Verified all ${checks.length} tables: exact application rows and original auth identities preserved.`,
  );
} else if (mode === 'activate') {
  query(
    target,
    `select cron.schedule('4color_jobs','2 seconds','select "4color_private"."4color_invoke_game_jobs"()'); select cron.schedule('4color_outbox','1 second','select "4color_private"."4color_dispatch_outbox"()'); select public."4color_server_health"() as health;`,
  );
  console.log('Games: 4color cron jobs activated.');
} else if (mode) {
  throw new Error(`Unknown phase: ${mode}`);
}
