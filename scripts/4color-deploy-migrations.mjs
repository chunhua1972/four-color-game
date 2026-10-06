// Games has migration history for multiple applications. Apply only this game's files.
import { readdirSync, readFileSync } from 'node:fs';
import { query, target, literal } from './4color-migrate.mjs';
const applied = new Set(
  query(target, 'select version from supabase_migrations.schema_migrations;').map(
    (row) => row.version,
  ),
);
const files = readdirSync('supabase/migrations')
  .filter((name) => /^\d+_4color_.*\.sql$/.test(name))
  .sort();
let count = 0;
for (const file of files) {
  const version = file.split('_')[0];
  if (applied.has(version)) continue;
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
  query(
    target,
    `begin; ${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(version)},${literal(name)},array[${literal(sql)}]); notify pgrst,'reload schema'; commit; select 'Applied migration' as status;`,
  );
  count++;
  console.log(`Applied ${file}`);
}
console.log(
  `Games: applied ${count} pending 4color migrations; other application history preserved.`,
);
