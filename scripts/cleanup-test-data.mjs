// Only remove UUIDs recorded by this deployment's own QA scripts.
import { readFileSync, writeFileSync } from 'node:fs';
const ids = JSON.parse(readFileSync('.deploy/test-ids.json', 'utf8'));
for (const list of Object.values(ids))
  for (const id of list) if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid cleanup id');
const rooms = ids.rooms.map((id) => `'${id}'::uuid`).join(',');
if (!rooms) throw new Error('No test rooms');
const sql = `begin;
create temporary table qa_games as select id from public.games where room_id in (${rooms});
delete from private.command_receipts where scope_id in(select id from qa_games);
${['outbox', 'jobs', 'internal_events', 'game_responses', 'tile_locations', 'game_authority'].map((t) => `delete from private.${t} where game_id in(select id from qa_games);`).join('\n')}
${['game_results', 'game_events', 'game_members'].map((t) => `delete from public.${t} where game_id in(select id from qa_games);`).join('\n')}
delete from public.games where id in(select id from qa_games);
delete from private.room_invites where room_id in (${rooms});
delete from public.room_members where room_id in (${rooms});
delete from public.room_ai_seats where room_id in (${rooms});
delete from public.rooms where id in (${rooms});
commit; select 'Only deployment QA rooms and games removed' as status;`;
writeFileSync('.deploy/cleanup.sql', sql);
console.log('Cleanup prepared for recorded QA room UUIDs only.');
