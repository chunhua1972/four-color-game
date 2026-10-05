import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
await db.exec(
  readFileSync(
    new URL('../supabase/migrations/20261005000100_foundation.sql', import.meta.url),
    'utf8',
  ),
);
const A = '00000000-0000-4000-8000-000000000001',
  B = '00000000-0000-4000-8000-000000000002',
  C = '00000000-0000-4000-8000-000000000003',
  room = '00000000-0000-4000-8000-000000000004',
  game = '00000000-0000-4000-8000-000000000005';
await db.exec(
  `insert into auth.users values('${A}'),('${B}'),('${C}'); insert into public.rooms(id,host_user_id,seat_count,rules) values('${room}','${A}',2,'{}'); insert into public.room_members(room_id,user_id,seat) values('${room}','${A}',0),('${room}','${B}',1); insert into public.games(id,room_id,round_no,phase,public_snapshot,rules_hash,engine_version) values('${game}','${room}',1,'dealer_opening','{"boardVersion":0,"wallCount":71}','test','0.1.0'); insert into public.game_members(game_id,user_id,seat) values('${game}','${A}',0),('${game}','${B}',1); insert into private.game_authority(game_id,board_version,state_json,state_hash) values('${game}',0,'{"hands":[[12,13],[40,41]],"wall":[0,1],"window":null}','test');`,
);
async function actor(uid, role = 'authenticated') {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${uid}',false); set role ${role};`,
  );
}
await actor(A);
let result = await db.query(`select public.get_my_game_bundle('${game}') as bundle`);
assert.deepEqual(result.rows[0].bundle.hand, [12, 13]);
assert.equal(result.rows[0].bundle.wall, undefined);
assert.equal(result.rows[0].bundle.hands, undefined);
await assert.rejects(() => db.query('select * from private.game_authority'), /permission denied/);
await assert.rejects(
  () => db.query(`update public.games set board_version=99 where id='${game}'`),
  /permission denied/,
);
await actor(B);
result = await db.query(`select public.get_my_game_bundle('${game}') as bundle`);
assert.deepEqual(result.rows[0].bundle.hand, [40, 41]);
await actor(C);
result = await db.query(`select public.get_my_game_bundle('${game}') as bundle`);
assert.equal(result.rows[0].bundle, null);
assert.equal((await db.query('select * from public.games')).rows.length, 0);
assert.equal((await db.query('select * from public.rooms')).rows.length, 0);
await actor('', 'anon');
await assert.rejects(
  () => db.query(`select public.get_my_game_bundle('${game}')`),
  /permission denied/,
);
await assert.rejects(() => db.query('select * from public.games'), /permission denied/);
await db.exec('reset role');
await assert.rejects(
  () => db.query(`insert into public.room_ai_seats values('${room}',0,'normal')`),
  /SEAT_OCCUPIED/,
);
await assert.rejects(
  () => db.query(`insert into public.room_ai_seats values('${room}',2,'normal')`),
  /INVALID_ROOM_SEAT/,
);
await db.close();
console.log(
  'PostgreSQL foundation passed: A/B own hand, C no membership, anon denied, client writes denied, private schema denied, seat occupancy constraints. Realtime/CAS/jobs require Supabase integration tests in M5/M6.',
);
