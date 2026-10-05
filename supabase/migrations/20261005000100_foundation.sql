-- Foundation only. Game writes and room joins have NO client mutation RPC yet.
-- The shared TypeScript engine will be used by server-only adapters in M5/M6.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 20),
  avatar_seed text not null default 'four-colors'
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id),
  seat_count smallint not null check (seat_count between 2 and 6),
  status text not null default 'waiting' check (status in ('waiting','playing','closed')),
  rules jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid not null references public.rooms(id),
  user_id uuid not null references auth.users(id),
  seat smallint not null check (seat between 0 and 5),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id), unique(room_id,seat)
);
create table public.room_ai_seats (
  room_id uuid not null references public.rooms(id),
  seat smallint not null check (seat between 0 and 5),
  difficulty text not null check (difficulty in ('easy','normal')),
  primary key(room_id,seat)
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
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
create table public.game_members (
  game_id uuid not null references public.games(id),
  user_id uuid not null references auth.users(id),
  seat smallint not null check (seat between 0 and 5),
  membership_status text not null default 'active' check (membership_status in ('active','removed')),
  primary key(game_id,user_id), unique(game_id,seat)
);
create table public.game_events (
  game_id uuid not null references public.games(id),
  public_seq bigint not null check(public_seq > 0),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(game_id,public_seq)
);
create table public.game_results (
  game_id uuid not null references public.games(id),
  seat smallint not null check(seat between 0 and 5),
  reason text not null check(reason in ('win','draw','xiang_gong','administrative_abort')),
  base_hu integer not null check(base_hu >= 0),
  flower_hu integer not null check(flower_hu >= 0),
  score_delta integer not null,
  primary key(game_id,seat)
);
create table private.game_authority (
  game_id uuid primary key references public.games(id),
  board_version bigint not null check(board_version >= 0),
  state_json jsonb not null,
  state_hash text not null,
  resolution_token uuid
);
create table private.tile_locations (
  game_id uuid not null references public.games(id),
  tile_id smallint not null check(tile_id between 0 and 111),
  zone text not null check(zone in ('WALL','HAND','MELD','DISCARD','OFFER','FLOWER')),
  seat smallint check(seat between 0 and 5),
  meld_id uuid,
  wall_order integer,
  primary key(game_id,tile_id)
);
create table private.game_responses (
  game_id uuid not null references public.games(id),
  window_id text not null,
  seat smallint not null check(seat between 0 and 5),
  intent jsonb not null,
  response_revision integer not null default 1 check(response_revision > 0),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(game_id,window_id,seat)
);
create table private.command_receipts (
  scope_id uuid not null,
  actor_key text not null,
  key text not null check(char_length(key) between 1 and 100),
  request_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(scope_id,actor_key,key)
);
create table private.room_invites (
  code_hash text primary key,
  room_id uuid not null references public.rooms(id),
  expires_at timestamptz not null
);
create table private.internal_events (
  game_id uuid not null references public.games(id),
  seq bigint not null,
  command jsonb not null,
  context jsonb not null,
  result_hash text not null,
  primary key(game_id,seq)
);
create table private.jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  kind text not null check(kind in ('ai','deadline','reconnect','resolve')),
  token text not null,
  due_at timestamptz not null,
  lease_until timestamptz,
  attempt integer not null default 0 check(attempt >= 0),
  status text not null default 'pending' check(status in ('pending','running','done','obsolete','failed')),
  unique(game_id,kind,token)
);
create table private.outbox (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  board_version bigint not null,
  public_seq bigint not null,
  sent_at timestamptz,
  unique(game_id,board_version)
);
create index room_members_user on public.room_members(user_id,room_id);
create index game_members_user on public.game_members(user_id,game_id);
create index jobs_due on private.jobs(due_at) where status in ('pending','running');

-- Serialize cross-table seat occupancy under the same room row lock.
create function private.guard_room_seat() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer; room_status text;
begin
  select seat_count,status into n,room_status from public.rooms where id=new.room_id for update;
  if n is null or new.seat >= n or room_status <> 'waiting' then raise exception 'INVALID_ROOM_SEAT'; end if;
  if tg_table_name='room_members' and exists(select 1 from public.room_ai_seats where room_id=new.room_id and seat=new.seat) then raise exception 'SEAT_OCCUPIED'; end if;
  if tg_table_name='room_ai_seats' and exists(select 1 from public.room_members where room_id=new.room_id and seat=new.seat) then raise exception 'SEAT_OCCUPIED'; end if;
  return new;
end $$;
create trigger guard_human_seat before insert or update of room_id,seat on public.room_members for each row execute function private.guard_room_seat();
create trigger guard_ai_seat before insert or update of room_id,seat on public.room_ai_seats for each row execute function private.guard_room_seat();

create function public.is_my_room(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.room_members where room_id=p_room_id and user_id=(select auth.uid()));
$$;
create function public.is_my_game(p_game_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_members where game_id=p_game_id and user_id=(select auth.uid()) and membership_status='active');
$$;
revoke all on function public.is_my_room(uuid),public.is_my_game(uuid) from public,anon;
grant execute on function public.is_my_room(uuid),public.is_my_game(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_ai_seats enable row level security;
alter table public.games enable row level security;
alter table public.game_members enable row level security;
alter table public.game_events enable row level security;
alter table public.game_results enable row level security;
create policy own_profile on public.profiles for select to authenticated using(user_id=(select auth.uid()));
create policy own_rooms on public.rooms for select to authenticated using(public.is_my_room(id));
create policy room_members_read on public.room_members for select to authenticated using(public.is_my_room(room_id));
create policy room_ai_read on public.room_ai_seats for select to authenticated using(public.is_my_room(room_id));
create policy member_games on public.games for select to authenticated using(public.is_my_game(id));
create policy member_seats on public.game_members for select to authenticated using(public.is_my_game(game_id));
create policy member_events on public.game_events for select to authenticated using(public.is_my_game(game_id));
create policy member_results on public.game_results for select to authenticated using(public.is_my_game(game_id));
revoke all on public.profiles,public.rooms,public.room_members,public.room_ai_seats,public.games,public.game_members,public.game_events,public.game_results from anon,authenticated;
grant select on public.profiles,public.rooms,public.room_members,public.room_ai_seats,public.games,public.game_members,public.game_events,public.game_results to authenticated;
grant all on public.profiles,public.rooms,public.room_members,public.room_ai_seats,public.games,public.game_members,public.game_events,public.game_results to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
revoke all on all tables in schema private from public,anon,authenticated;
revoke execute on function private.guard_room_seat() from public,anon,authenticated;

-- One statement/MVCC snapshot: public board + own hand + own receipt only.
-- SQL does not compute legal options. The future Edge adapter adds them with core.
create function public.get_my_game_bundle(p_game_id uuid) returns jsonb
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
  from public.game_members gm
  join public.games g on g.id=gm.game_id
  join private.game_authority a on a.game_id=g.id and a.board_version=g.board_version
  left join private.game_responses r on r.game_id=g.id and r.seat=gm.seat and r.window_id=a.state_json->'window'->>'id'
  where gm.game_id=p_game_id and gm.user_id=(select auth.uid()) and gm.membership_status='active';
$$;
revoke all on function public.get_my_game_bundle(uuid) from public,anon;
grant execute on function public.get_my_game_bundle(uuid) to authenticated;
comment on function public.get_my_game_bundle(uuid) is 'Read bundle only. Returns NULL for a nonmember. Legal actions must be computed by the shared-core read adapter.';
