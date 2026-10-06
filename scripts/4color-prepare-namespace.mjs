// Generate the Games namespace from the preserved original Fourcolor migrations.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
const root = resolve('.');
const migrationRoot = 'supabase/migrations';
const archiveRoot = 'supabase/archive/fourcolor-migrations';
const originals = [
  '20261005000100_foundation.sql',
  '20261005000200_cloud_game.sql',
  '20261005000300_realtime.sql',
  '20261005000400_scheduler.sql',
  '20261005000500_scheduler_idle.sql',
];
export function namespaceSql(sql) {
  return sql
    .replace(
      /\b(public|private)\.([a-z_]\w*)/g,
      (_, schema, name) =>
        `${schema === 'private' ? '"4color_private"' : 'public'}."4color_${name}"`,
    )
    .replace(/\bschema (if not exists )?private\b/g, 'schema $1"4color_private"')
    .replace(
      /\b(create (?:unique )?index|create policy|create trigger) ([a-z_]\w*)/gi,
      '$1 "4color_$2"',
    )
    .replace(
      /drop constraint outbox_game_id_board_version_key/g,
      'drop constraint "4color_outbox_game_id_board_version_key"',
    )
    .replace(/tg_table_name='(rooms|room_members|room_ai_seats)'/g, "tg_table_name='4color_$1'")
    .replaceAll("'game:'", "'4color_game:'")
    .replaceAll("'room:'", "'4color_room:'")
    .replaceAll('four_colors_job_secret', '4color_job_secret')
    .replaceAll('four_colors_job_url', '4color_job_url')
    .replaceAll('four-colors-jobs', '4color_jobs')
    .replaceAll('four-colors-outbox', '4color_outbox');
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/4color-prepare-namespace.mjs')
) {
  mkdirSync(archiveRoot, { recursive: true });
  for (const name of originals) {
    const from = resolve(migrationRoot, name),
      to = resolve(archiveRoot, name);
    if (!from.startsWith(root + sep) || !to.startsWith(root + sep))
      throw new Error('Outside workspace');
    if (existsSync(from)) renameSync(from, to);
  }
  for (let i = 0; i < 3; i++) {
    const suffix = ['foundation', 'cloud_game', 'realtime'][i];
    writeFileSync(
      `${migrationRoot}/20261006000${i + 1}00_4color_${suffix}.sql`,
      namespaceSql(readFileSync(`${archiveRoot}/${originals[i]}`, 'utf8')),
    );
  }
  const scheduler = `${readFileSync(`${archiveRoot}/${originals[3]}`, 'utf8')}\n${readFileSync(`${archiveRoot}/${originals[4]}`, 'utf8')}`;
  // Jobs become active only after the data import and final verification.
  writeFileSync(
    `${migrationRoot}/20261006000400_4color_scheduler.sql`,
    namespaceSql(scheduler).replace(/select cron.schedule\([^;]+;/g, ''),
  );
  console.log('Four Games migrations prepared; original migration history archived.');
}
