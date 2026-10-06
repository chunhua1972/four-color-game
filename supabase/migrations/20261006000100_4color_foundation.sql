-- Foundation only. Game writes and room joins have NO client mutation RPC yet.
-- The shared TypeScript engine will be used by server-only adapters in M5/M6.
create schema if not exists "4color_private";
revoke all on schema "4color_private" from public, anon, authenticated;
alter default privileges in schema "4color_private" revoke all on tables from public, anon, authenticated;
alter default privileges in schema "4color_private" revoke execute on functions from public, anon, authenticated;

create table public."4color_profiles" (
  user_id uuid primary key references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 20),
  avatar_seed text not null default 'four-colors'
);
create table public."4color_rooms" (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id),
  seat_count smallint not null check (seat_count between 2 and 6),
  status text not null default 'waiting' check (status in ('waiting','playing','closed')),
  rules jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);
create table public."4color_room_members" (
  room_id uuid not null references public."4color_rooms"(id),
  user_id uuid not null references auth.users(id),
  seat smallint not null check (seat between 0 and 5),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id), unique(room_id,seat)
);
create table public."4color_room_ai_seats" (
  room_id uuid not null references public."4color_rooms"(id),
  seat smallint not null check (seat between 0 and 5),
  difficulty text not null check (difficulty in ('easy','normal')),
  primary key(room_id,seat)
);
create table public."4color_games" (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public."4color_rooms"(id),
  round_no integer not null check (round_no > 0),
  board_version bigint not null default 0 check (board_version >= 0),
  phase text not null check (phase in ('dealer_opening','await_draw','await_discard','response_window','finished','drawn_game')),
  public_snapshot jsonb not null,
  rules_hash text not null,
  engine_version text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique(room_id,round_no)
);
create table public."4color_game_members" (
  game_id uuid not null references public."4color_games"(id),
  user_id uuid not null references auth.users(id),
  seat smallint not null check (seat between 0 and 5),
  membership_status text not null default 'active' check (membership_status in ('active','removed')),
  primary key(game_id,user_id), unique(game_id,seat)
);
create table public."4color_game_events" (
  game_id uuid not null references public."4color_games"(id),
  public_seq bigint not null check(public_seq > 0),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(game_id,public_seq)
);
create table public."4color_game_results" (
  game_id uuid not null references public."4color_games"(id),
  seat smallint not null check(seat between 0 and 5),
  reason text not null check(reason in ('win','draw','xiang_gong','administrative_abort')),
  base_hu integer not null check(base_hu >= 0),
  flower_hu integer not null check(flower_hu >= 0),
  score_delta integer not null,
  primary key(game_id,seat)
);
create table "4color_private"."4color_game_authority" (
  game_id uuid primary key references public."4color_games"(id),
  board_version bigint not null check(board_version >= 0),
  state_json jsonb not null,
  state_hash text not null,
  resolution_token uuid
);
create table "4color_private"."4color_tile_locations" (
  game_id uuid not null references public."4color_games"(id),
  tile_id smallint not null check(tile_id between 0 and 111),
  zone text not null check(zone in ('WALL','HAND','MELD','DISCARD','OFFER','FLOWER')),
  seat smallint check(seat between 0 and 5),
  meld_id uuid,
  wall_order integer,
  primary key(game_id,tile_id)
);
create table "4color_private"."4color_game_responses" (
  game_id uuid not null references public."4color_games"(id),
  window_id text not null,
  seat smallint not null check(seat between 0 and 5),
  intent jsonb not null,
  response_revision integer not null default 1 check(response_revision > 0),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(game_id,window_id,seat)
);
create table "4color_private"."4color_command_receipts" (
  scope_id uuid not null,
  actor_key text not null,
  key text not null check(char_length(key) between 1 and 100),
  request_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(scope_id,actor_key,key)
);
create table "4color_private"."4color_room_invites" (
  code_hash text primary key,
  room_id uuid not null references public."4color_rooms"(id),
  expires_at timestamptz not null
);
create table "4color_private"."4color_internal_events" (
  game_id uuid not null references public."4color_games"(id),
  seq bigint not null,
  command jsonb not null,
  context jsonb not null,
  result_hash text not null,
  primary key(game_id,seq)
);
create table "4color_private"."4color_jobs" (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public."4color_games"(id),
  kind text not null check(kind in ('ai','deadline','reconnect','resolve')),
  token text not null,
  due_at timestamptz not null,
  lease_until timestamptz,
  attempt integer not null default 0 check(attempt >= 0),
  status text not null default 'pending' check(status in ('pending','running','done','obsolete','failed')),
  unique(game_id,kind,token)
);
create table "4color_private"."4color_outbox" (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public."4color_games"(id),
  board_version bigint not null,
  public_seq bigint not null,
  sent_at timestamptz,
  unique(game_id,board_version)
);
create index "4color_room_members_user" on public."4color_room_members"(user_id,room_id);
create index "4color_game_members_user" on public."4color_game_members"(user_id,game_id);
create index "4color_jobs_due" on "4color_private"."4color_jobs"(due_at) where status in ('pending','running');

-- Serialize cross-table seat occupancy under the same room row lock.
create function "4color_private"."4color_guard_room_seat"() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer; room_status text;
begin
  select seat_count,status into n,room_status from public."4color_rooms" where id=new.room_id for update;
  if n is null or new.seat >= n or room_status <> 'waiting' then raise exception 'INVALID_ROOM_SEAT'; end if;
  if tg_table_name='4color_room_members' and exists(select 1 from public."4color_room_ai_seats" where room_id=new.room_id and seat=new.seat) then raise exception 'SEAT_OCCUPIED'; end if;
  if tg_table_name='4color_room_ai_seats' and exists(select 1 from public."4color_room_members" where room_id=new.room_id and seat=new.seat) then raise exception 'SEAT_OCCUPIED'; end if;
  return new;
end $$;
create trigger "4color_guard_human_seat" before insert or update of room_id,seat on public."4color_room_members" for each row execute function "4color_private"."4color_guard_room_seat"();
create trigger "4color_guard_ai_seat" before insert or update of room_id,seat on public."4color_room_ai_seats" for each row execute function "4color_private"."4color_guard_room_seat"();

create function public."4color_is_my_room"(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public."4color_room_members" where room_id=p_room_id and user_id=(select auth.uid()));
$$;
create function public."4color_is_my_game"(p_game_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public."4color_game_members" where game_id=p_game_id and user_id=(select auth.uid()) and membership_status='active');
$$;
revoke all on function public."4color_is_my_room"(uuid),public."4color_is_my_game"(uuid) from public,anon;
grant execute on function public."4color_is_my_room"(uuid),public."4color_is_my_game"(uuid) to authenticated;

alter table public."4color_profiles" enable row level security;
alter table public."4color_rooms" enable row level security;
alter table public."4color_room_members" enable row level security;
alter table public."4color_room_ai_seats" enable row level security;
alter table public."4color_games" enable row level security;
alter table public."4color_game_members" enable row level security;
alter table public."4color_game_events" enable row level security;
alter table public."4color_game_results" enable row level security;
create policy "4color_own_profile" on public."4color_profiles" for select to authenticated using(user_id=(select auth.uid()));
create policy "4color_own_rooms" on public."4color_rooms" for select to authenticated using(public."4color_is_my_room"(id));
create policy "4color_room_members_read" on public."4color_room_members" for select to authenticated using(public."4color_is_my_room"(room_id));
create policy "4color_room_ai_read" on public."4color_room_ai_seats" for select to authenticated using(public."4color_is_my_room"(room_id));
create policy "4color_member_games" on public."4color_games" for select to authenticated using(public."4color_is_my_game"(id));
create policy "4color_member_seats" on public."4color_game_members" for select to authenticated using(public."4color_is_my_game"(game_id));
create policy "4color_member_events" on public."4color_game_events" for select to authenticated using(public."4color_is_my_game"(game_id));
create policy "4color_member_results" on public."4color_game_results" for select to authenticated using(public."4color_is_my_game"(game_id));
revoke all on public."4color_profiles",public."4color_rooms",public."4color_room_members",public."4color_room_ai_seats",public."4color_games",public."4color_game_members",public."4color_game_events",public."4color_game_results" from anon,authenticated;
grant select on public."4color_profiles",public."4color_rooms",public."4color_room_members",public."4color_room_ai_seats",public."4color_games",public."4color_game_members",public."4color_game_events",public."4color_game_results" to authenticated;
grant all on public."4color_profiles",public."4color_rooms",public."4color_room_members",public."4color_room_ai_seats",public."4color_games",public."4color_game_members",public."4color_game_events",public."4color_game_results" to service_role;
grant usage on schema "4color_private" to service_role;
grant all on all tables in schema "4color_private" to service_role;
revoke all on all tables in schema "4color_private" from public,anon,authenticated;
revoke execute on function "4color_private"."4color_guard_room_seat"() from public,anon,authenticated;

-- One statement/MVCC snapshot: public board + own hand + own receipt only.
-- SQL does not compute legal options. The future Edge adapter adds them with core.
create function public."4color_get_my_game_bundle"(p_game_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'public',g.public_snapshot,
    'viewerSeat',gm.seat,
    'hand',a.state_json->'hands'->gm.seat::integer,
    'myResponse',case when r.seat is null then null else jsonb_build_object(
      'windowId',r.window_id,'intent',r.intent,'responseRevision',r.response_revision,
      'acceptedAtMs',floor(extract(epoch from r.accepted_at)*1000),'locked',true) end,
    'myResponseRevision',coalesce(r.response_revision,0),
    'serverNowMs',floor(extract(epoch from statement_timestamp())*1000)
  )
  from public."4color_game_members" gm
  join public."4color_games" g on g.id=gm.game_id
  join "4color_private"."4color_game_authority" a on a.game_id=g.id and a.board_version=g.board_version
  left join "4color_private"."4color_game_responses" r on r.game_id=g.id and r.seat=gm.seat and r.window_id=a.state_json->'window'->>'id'
  where gm.game_id=p_game_id and gm.user_id=(select auth.uid()) and gm.membership_status='active';
$$;
revoke all on function public."4color_get_my_game_bundle"(uuid) from public,anon;
grant execute on function public."4color_get_my_game_bundle"(uuid) to authenticated;
comment on function public."4color_get_my_game_bundle"(uuid) is 'Read bundle only. Returns NULL for a nonmember. Legal actions must be computed by the shared-core read adapter.';
