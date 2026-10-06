// Only remove UUIDs recorded by this deployment's own QA scripts.
import { readFileSync, writeFileSync } from 'node:fs';
const ids = JSON.parse(readFileSync('.deploy/test-ids.json', 'utf8'));
for (const list of Object.values(ids))
  for (const id of list) if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid cleanup id');
const rooms = ids.rooms.map((id) => `'${id}'::uuid`).join(',');
if (!rooms) throw new Error('No test rooms');
const sql = `begin;
create temporary table qa_games as select id from public."4color_games" where room_id in (${rooms});
create temporary table qa_users as select distinct user_id from public."4color_room_members" where room_id in (${rooms});
delete from "4color_private"."4color_command_receipts" where scope_id in(select id from qa_games);
${['outbox', 'jobs', 'internal_events', 'game_responses', 'tile_locations', 'game_authority'].map((t) => `delete from "4color_private"."4color_${t}" where game_id in(select id from qa_games);`).join('\n')}
${['game_results', 'game_events', 'game_members'].map((t) => `delete from public."4color_${t}" where game_id in(select id from qa_games);`).join('\n')}
delete from public."4color_games" where id in(select id from qa_games);
delete from "4color_private"."4color_room_invites" where room_id in (${rooms});
delete from public."4color_room_members" where room_id in (${rooms});
delete from public."4color_room_ai_seats" where room_id in (${rooms});
delete from public."4color_rooms" where id in (${rooms});
delete from public."4color_profiles" where user_id in(select user_id from qa_users) and display_name in('Deployment QA A','Deployment QA B','Browser QA A','Browser QA B')
and not exists(select 1 from public."4color_room_members" where public."4color_room_members".user_id=public."4color_profiles".user_id);
commit; select 'Only deployment QA rooms and games removed' as status;`;
writeFileSync('.deploy/cleanup.sql', sql);
console.log('Cleanup prepared for recorded QA room UUIDs only.');
