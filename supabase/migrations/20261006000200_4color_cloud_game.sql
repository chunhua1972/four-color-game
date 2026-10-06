-- Trusted adapters are the only writers. All RPCs below are service-role only.
alter table "4color_private"."4color_tile_locations" alter column meld_id type text using meld_id::text;
alter table public."4color_game_members" add column last_seen_at timestamptz not null default now();
alter table "4color_private"."4color_outbox" drop constraint "4color_outbox_game_id_board_version_key";
alter table "4color_private"."4color_outbox" add unique(game_id,public_seq);
create index "4color_outbox_pending" on "4color_private"."4color_outbox"(game_id) where sent_at is null;

create function "4color_private"."4color_room_bundle"(p_room uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'hostUserId',r.host_user_id,'seatCount',r.seat_count,
 'status',r.status,'revision',r.revision,'rules',r.rules,
 'gameId',(select g.id from public."4color_games" g where g.room_id=r.id order by round_no desc limit 1),
 'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'seat',m.seat,'ready',m.ready,'name',p.display_name) order by m.seat)
 from public."4color_room_members" m left join public."4color_profiles" p on p.user_id=m.user_id where m.room_id=r.id),'[]'),
 'aiSeats',coalesce((select jsonb_agg(jsonb_build_object('seat',seat,'difficulty',difficulty) order by seat) from public."4color_room_ai_seats" where room_id=r.id),'[]'))
 from public."4color_rooms" r where r.id=p_room;
$$;

create function public."4color_server_room_action"(p_actor uuid,p_operation text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid; r public."4color_rooms"; s integer; invite text; nm text; actor_seat integer;
begin
 if not exists(select 1 from auth.users where id=p_actor) then raise exception 'UNAUTHORIZED'; end if;
 if p_operation='list' then
   return coalesce((select jsonb_agg("4color_private"."4color_room_bundle"(id) order by created_at desc) from public."4color_rooms"
     where status<>'closed' and public."4color_rooms".id in(select room_id from public."4color_room_members" where user_id=p_actor)),'[]');
 end if;
 if p_operation='create' then
   rid:=(p_data->>'id')::uuid; nm:=trim(p_data->>'name');
   if length(nm) not between 1 and 20 then raise exception 'INVALID_NAME'; end if;
   insert into public."4color_profiles"(user_id,display_name) values(p_actor,nm) on conflict(user_id) do update set display_name=excluded.display_name;
   insert into public."4color_rooms"(id,host_user_id,seat_count,rules) values(rid,p_actor,(p_data->>'seatCount')::integer,p_data->'rules');
   insert into public."4color_room_members"(room_id,user_id,seat) values(rid,p_actor,0);
   insert into "4color_private"."4color_room_invites"(code_hash,room_id,expires_at) values(p_data->>'codeHash',rid,now()+interval '24 hours');
   return "4color_private"."4color_room_bundle"(rid);
 end if;
 if p_operation='join' then
   select room_id into rid from "4color_private"."4color_room_invites" where code_hash=p_data->>'codeHash' and expires_at>clock_timestamp();
   if rid is null then raise exception 'INVALID_INVITE'; end if;
 else rid:=(p_data->>'roomId')::uuid; end if;
 select * into r from public."4color_rooms" where id=rid for update;
 if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
 select seat into actor_seat from public."4color_room_members" where room_id=rid and user_id=p_actor;
 if p_operation='join' and actor_seat is null then
   if r.status<>'waiting' then raise exception 'ROOM_NOT_WAITING'; end if;
   select x into s from generate_series(0,r.seat_count-1) x where not exists(select 1 from public."4color_room_members" where room_id=rid and seat=x)
     and not exists(select 1 from public."4color_room_ai_seats" where room_id=rid and seat=x) order by x limit 1;
   if s is null then raise exception 'ROOM_FULL'; end if;
   nm:=trim(p_data->>'name'); if length(nm) not between 1 and 20 then raise exception 'INVALID_NAME'; end if;
   insert into public."4color_profiles"(user_id,display_name) values(p_actor,nm) on conflict(user_id) do update set display_name=excluded.display_name;
   insert into public."4color_room_members"(room_id,user_id,seat) values(rid,p_actor,s);
   update public."4color_rooms" set revision=revision+1 where id=rid;
   return "4color_private"."4color_room_bundle"(rid);
 end if;
 if actor_seat is null then raise exception 'NOT_ROOM_MEMBER'; end if;
 if p_operation in ('get','join') then return "4color_private"."4color_room_bundle"(rid); end if;
 if p_operation='invite' then
   if r.host_user_id<>p_actor then raise exception 'HOST_ONLY'; end if;
   delete from "4color_private"."4color_room_invites" where room_id=rid;
   insert into "4color_private"."4color_room_invites" values(p_data->>'codeHash',rid,now()+interval '24 hours');
   return "4color_private"."4color_room_bundle"(rid);
 end if;
 if r.status<>'waiting' then raise exception 'ROOM_NOT_WAITING'; end if;
 if r.revision<>(p_data->>'revision')::bigint then raise exception 'STALE_ROOM'; end if;
 if p_operation='ready' then
   update public."4color_room_members" set ready=(p_data->>'ready')::boolean where room_id=rid and user_id=p_actor;
 elsif p_operation='ai' then
   if r.host_user_id<>p_actor then raise exception 'HOST_ONLY'; end if;
   s:=(p_data->>'seat')::integer;
   if p_data->>'difficulty' is null then delete from public."4color_room_ai_seats" where room_id=rid and seat=s;
   else insert into public."4color_room_ai_seats" values(rid,s,p_data->>'difficulty') on conflict(room_id,seat) do update set difficulty=excluded.difficulty; end if;
 elsif p_operation='leave' then
   delete from public."4color_room_members" where room_id=rid and user_id=p_actor;
   if r.host_user_id=p_actor then
     select user_id into r.host_user_id from public."4color_room_members" where room_id=rid order by seat limit 1;
     if r.host_user_id is null then update public."4color_rooms" set status='closed' where id=rid;
     else update public."4color_rooms" set host_user_id=r.host_user_id where id=rid; end if;
   end if;
 else raise exception 'INVALID_OPERATION'; end if;
 update public."4color_rooms" set revision=revision+1 where id=rid;
 return "4color_private"."4color_room_bundle"(rid);
end $$;

create function "4color_private"."4color_replace_tiles"(p_game uuid,p_state jsonb) returns void language plpgsql set search_path='' as $$
begin
 delete from "4color_private"."4color_tile_locations" where game_id=p_game;
 insert into "4color_private"."4color_tile_locations"(game_id,tile_id,zone,seat,meld_id,wall_order)
 select p_game,t::smallint,'WALL',null,null,(n-1)::integer from jsonb_array_elements_text(p_state->'wall') with ordinality w(t,n)
 union all select p_game,t::smallint,'HAND',(n-1)::smallint,null,null from jsonb_array_elements(p_state->'hands') with ordinality h(hand,n) cross join lateral jsonb_array_elements_text(hand) t
 union all select p_game,t::smallint,'MELD',(m->>'ownerSeat')::smallint,m->>'id',null from jsonb_array_elements(p_state->'melds') m cross join lateral jsonb_array_elements_text(m->'tileIds') t
 union all select p_game,t::smallint,'DISCARD',null,null,null from jsonb_array_elements_text(p_state->'discards') t
 union all select p_game,(p_state->'offer'->>'tileId')::smallint,'OFFER',null,null,null where p_state->'offer' <> 'null'::jsonb
 union all select p_game,(p_state->>'flowerTileId')::smallint,'FLOWER',null,null,null where p_state->>'flowerTileId' is not null;
 if (select count(*) from "4color_private"."4color_tile_locations" where game_id=p_game)<>112 then raise exception 'TILE_CONSERVATION'; end if;
end $$;

create function "4color_private"."4color_schedule_game"(p_game uuid,p_state jsonb) returns void language plpgsql set search_path='' as $$
declare job_token text; due timestamptz; c jsonb; n integer:=0;
begin
 update "4color_private"."4color_jobs" set status='obsolete' where game_id=p_game and status='pending';
 if p_state->>'phase' in ('finished','drawn_game') then return; end if;
 job_token:=coalesce(p_state->'window'->>'id',p_state->>'boardVersion');
 due:=to_timestamp(coalesce((p_state->'window'->>'deadlineAtMs')::double precision,(p_state->>'turnDeadlineAtMs')::double precision)/1000);
 insert into "4color_private"."4color_jobs"(game_id,kind,token,due_at) values(p_game,'deadline',job_token,due)
 on conflict(game_id,kind,token) do update set due_at=excluded.due_at,status=case when "4color_private"."4color_jobs".status='running' then 'running' else 'pending' end;
 for c in select value from jsonb_array_elements(p_state->'controllers') loop
   if c->>'kind'='ai' and ((p_state->>'activeSeat')::integer=n or
      (p_state->>'phase'='response_window' and p_state->'window'->'participantSeats' @> to_jsonb(array[n]) and not (p_state->'responses' ? n::text))) then
     insert into "4color_private"."4color_jobs"(game_id,kind,token,due_at) values(p_game,'ai',job_token||':'||n,clock_timestamp()+interval '650 milliseconds')
       on conflict(game_id,kind,token) do update set status=case when "4color_private"."4color_jobs".status='running' then 'running' else 'pending' end;
   end if;
   n:=n+1;
 end loop;
 if p_state->>'phase'='response_window' and not exists(select 1 from jsonb_array_elements_text(p_state->'window'->'participantSeats') t where not(p_state->'responses' ? t)) then
   insert into "4color_private"."4color_jobs"(game_id,kind,token,due_at) values(p_game,'resolve',job_token,clock_timestamp())
   on conflict(game_id,kind,token) do update set status=case when "4color_private"."4color_jobs".status='running' then 'running' else 'pending' end;
 end if;
 insert into "4color_private"."4color_jobs"(game_id,kind,token,due_at)
 select p_game,'reconnect',gm.seat::text,gm.last_seen_at+interval '90 seconds' from public."4color_game_members" gm
 where gm.game_id=p_game and p_state->'controllers'->gm.seat::integer->>'kind'='human'
 on conflict(game_id,kind,token) do update set due_at=excluded.due_at,status=case when "4color_private"."4color_jobs".status='running' then 'running' else 'pending' end;
end $$;

create function public."4color_server_start_game"(p_actor uuid,p_room uuid,p_revision bigint,p_state jsonb,p_public jsonb,p_rules_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public."4color_rooms"; gid uuid; round_number integer;
begin
 select * into r from public."4color_rooms" where id=p_room for update;
 if r.host_user_id is distinct from p_actor then raise exception 'HOST_ONLY'; end if;
 if r.status='playing' then return jsonb_build_object('gameId',(select id from public."4color_games" where room_id=p_room order by round_no desc limit 1)); end if;
 if r.status<>'waiting' or r.revision<>p_revision then raise exception 'STALE_ROOM'; end if;
 if (select count(*) from public."4color_room_members" where room_id=p_room)+(select count(*) from public."4color_room_ai_seats" where room_id=p_room)<>r.seat_count
   or exists(select 1 from public."4color_room_members" where room_id=p_room and not ready) then raise exception 'NOT_ALL_READY'; end if;
 if p_state->'rules'<>r.rules then raise exception 'RULES_MISMATCH'; end if;
 if exists(select 1 from public."4color_room_members" m where room_id=p_room and p_state->'controllers'->m.seat::integer <> jsonb_build_object('kind','human','userId',m.user_id))
   or exists(select 1 from public."4color_room_ai_seats" a where room_id=p_room and p_state->'controllers'->a.seat::integer <> jsonb_build_object('kind','ai','difficulty',a.difficulty)) then raise exception 'CONTROLLERS_MISMATCH'; end if;
 gid:=(p_state->>'gameId')::uuid;
 select coalesce(max(round_no),0)+1 into round_number from public."4color_games" where room_id=p_room;
 insert into public."4color_games"(id,room_id,round_no,phase,public_snapshot,rules_hash,engine_version) values(gid,p_room,round_number,p_state->>'phase',p_public,p_rules_hash,p_state->>'engineVersion');
 insert into public."4color_game_members"(game_id,user_id,seat) select gid,user_id,seat from public."4color_room_members" where room_id=p_room;
 insert into "4color_private"."4color_game_authority"(game_id,board_version,state_json,state_hash) values(gid,0,p_state,md5(p_state::text));
 perform "4color_private"."4color_replace_tiles"(gid,p_state); perform "4color_private"."4color_schedule_game"(gid,p_state);
 update public."4color_rooms" set status='playing',revision=revision+1 where id=p_room;
 return jsonb_build_object('gameId',gid);
end $$;

create function public."4color_server_game_context"(p_game uuid,p_actor uuid default null,p_key text default null,p_request_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s integer; rec "4color_private"."4color_command_receipts"; a "4color_private"."4color_game_authority"; seen timestamptz;
begin
 if p_actor is not null then
   select seat into s from public."4color_game_members" where game_id=p_game and user_id=p_actor and membership_status='active';
   if s is null then raise exception 'NOT_GAME_MEMBER'; end if;
   update public."4color_game_members" set last_seen_at=clock_timestamp() where game_id=p_game and user_id=p_actor;
   update "4color_private"."4color_jobs" set due_at=clock_timestamp()+interval '90 seconds' where game_id=p_game and kind='reconnect' and token=s::text and status='pending';
   if p_key is not null then
     select * into rec from "4color_private"."4color_command_receipts" where scope_id=p_game and actor_key=p_actor::text and key=p_key;
     if rec.key is not null then
       if rec.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
       return jsonb_build_object('receipt',rec.response_json);
     end if;
   end if;
 end if;
 select * into a from "4color_private"."4color_game_authority" where game_id=p_game;
 if a.game_id is null then raise exception 'GAME_NOT_FOUND'; end if;
 select min(last_seen_at) into seen from public."4color_game_members" where game_id=p_game;
 return jsonb_build_object('state',a.state_json,'stateHash',a.state_hash,'resolutionToken',a.resolution_token,'seat',s,
   'serverNowMs',floor(extract(epoch from clock_timestamp())*1000),'public',(select public_snapshot from public."4color_games" where id=p_game),
   'presence',coalesce((select jsonb_object_agg(seat::text,floor(extract(epoch from last_seen_at)*1000)) from public."4color_game_members" where game_id=p_game),'{}'));
end $$;

create function public."4color_server_freeze_window"(p_game uuid,p_window text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a "4color_private"."4color_game_authority";
begin
 select * into a from "4color_private"."4color_game_authority" where game_id=p_game for update;
 if a.state_json->'window'->>'id' is distinct from p_window then return null; end if;
 if clock_timestamp()<to_timestamp((a.state_json->'window'->>'deadlineAtMs')::double precision/1000) and
 exists(select 1 from jsonb_array_elements_text(a.state_json->'window'->'participantSeats') t where not(a.state_json->'responses' ? t)) then return null; end if;
 update "4color_private"."4color_game_authority" set resolution_token=coalesce(resolution_token,gen_random_uuid()) where game_id=p_game;
 return public."4color_server_game_context"(p_game);
end $$;

create function public."4color_server_commit_game"(p_game uuid,p_expected_hash text,p_state jsonb,p_public jsonb,p_actor uuid default null,
 p_key text default null,p_request_hash text default null,p_receipt jsonb default null,p_resolution uuid default null,p_job uuid default null,p_command jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a "4color_private"."4color_game_authority"; rec "4color_private"."4color_command_receipts"; s integer; seq_no bigint; rr jsonb; rid uuid;
begin
 select room_id into rid from public."4color_games" where id=p_game;
 perform 1 from public."4color_rooms" where id=rid for update;
 select * into a from "4color_private"."4color_game_authority" where game_id=p_game for update;
 if p_actor is not null then
   select seat into s from public."4color_game_members" where game_id=p_game and user_id=p_actor and membership_status='active';
   if s is null then raise exception 'NOT_GAME_MEMBER'; end if;
   select * into rec from "4color_private"."4color_command_receipts" where scope_id=p_game and actor_key=p_actor::text and key=p_key;
   if rec.key is not null then
     if rec.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
     return jsonb_build_object('receipt',rec.response_json);
   end if;
   if a.state_json->'controllers'->s->>'kind'<>'human' then raise exception 'AI_TAKEOVER'; end if;
 end if;
 if a.state_hash is distinct from p_expected_hash then return jsonb_build_object('conflict',true); end if;
 if a.resolution_token is distinct from p_resolution then raise exception 'WINDOW_FROZEN'; end if;
 if p_command->>'type'='respond' then
   if a.state_json->'window'->>'id' is distinct from p_command->>'windowId' or
    clock_timestamp()>=to_timestamp((a.state_json->'window'->>'deadlineAtMs')::double precision/1000) then raise exception 'WINDOW_EXPIRED'; end if;
 elsif p_actor is not null and clock_timestamp()>=to_timestamp((a.state_json->>'turnDeadlineAtMs')::double precision/1000) then
   raise exception 'TURN_EXPIRED';
 end if;
 if (p_state->>'boardVersion')::bigint not between a.board_version and a.board_version+1 then raise exception 'INVALID_VERSION'; end if;
 perform "4color_private"."4color_replace_tiles"(p_game,p_state);
 update "4color_private"."4color_game_authority" set board_version=(p_state->>'boardVersion')::bigint,state_json=p_state,state_hash=md5(p_state::text),resolution_token=null where game_id=p_game;
 update public."4color_games" set board_version=(p_state->>'boardVersion')::bigint,phase=p_state->>'phase',public_snapshot=p_public,
   ended_at=case when p_state->>'phase' in ('finished','drawn_game') then clock_timestamp() else null end where id=p_game;
 insert into "4color_private"."4color_game_responses"(game_id,window_id,seat,intent,response_revision,accepted_at)
 select p_game,x.value->>'windowId',x.key::smallint,x.value->'intent',(x.value->>'responseRevision')::integer,to_timestamp((x.value->>'acceptedAtMs')::double precision/1000)
 from jsonb_each(p_state->'responses') x on conflict do nothing;
 select coalesce(max(seq),0)+1 into seq_no from "4color_private"."4color_internal_events" where game_id=p_game;
 insert into "4color_private"."4color_internal_events" values(p_game,seq_no,p_command,jsonb_build_object('serverNowMs',floor(extract(epoch from clock_timestamp())*1000)),md5(p_state::text));
 -- Notices carry identifiers only, never pending intentions or card locations.
 insert into public."4color_game_events"(game_id,public_seq,event_type,payload) values(p_game,seq_no,'changed',jsonb_build_object('gameId',p_game,'boardVersion',p_state->'boardVersion','publicSeq',seq_no));
 insert into "4color_private"."4color_outbox"(game_id,board_version,public_seq) values(p_game,(p_state->>'boardVersion')::bigint,seq_no);
 if p_state->>'phase' in ('finished','drawn_game') then
   rr:=p_state->'result';
   insert into public."4color_game_results" select p_game,(x->>'seat')::smallint,rr->>'reason',(rr->>'baseHu')::integer,(rr->>'flowerHu')::integer,(x->>'delta')::integer from jsonb_array_elements(rr->'scores') x on conflict do nothing;
   update public."4color_rooms" set status='waiting',revision=revision+1 where id=rid;
   update public."4color_room_members" set ready=false where room_id=rid;
 end if;
 perform "4color_private"."4color_schedule_game"(p_game,p_state);
 if p_actor is not null then insert into "4color_private"."4color_command_receipts"(scope_id,actor_key,key,request_hash,response_json) values(p_game,p_actor::text,p_key,p_request_hash,p_receipt); end if;
 if p_job is not null then update "4color_private"."4color_jobs" set status='done',lease_until=null where id=p_job; end if;
 return jsonb_build_object('receipt',p_receipt,'committed',true);
end $$;

create function public."4color_server_claim_jobs"(p_limit integer default 12) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 with due as (select id from "4color_private"."4color_jobs" where (status='pending' or (status='running' and lease_until<clock_timestamp()))
   and due_at<=clock_timestamp() order by due_at for update skip locked limit least(p_limit,24)),
 claimed as (update "4color_private"."4color_jobs" j set status='running',lease_until=clock_timestamp()+interval '20 seconds',attempt=attempt+1 from due where j.id=due.id returning j.*)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into v from claimed;
 return v;
end $$;
create function public."4color_server_finish_job"(p_id uuid,p_retry boolean default false) returns void language sql security definer set search_path='' as $$
 update "4color_private"."4color_jobs" set status=case when p_retry then 'pending' else 'obsolete' end,lease_until=null,
 due_at=case when p_retry then clock_timestamp()+interval '2 seconds' else due_at end where id=p_id and status='running';
$$;
create function public."4color_server_health"() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('pendingJobs',(select count(*) from "4color_private"."4color_jobs" where status in ('pending','running')),
 'overdueJobs',(select count(*) from "4color_private"."4color_jobs" where status='pending' and due_at<clock_timestamp()-interval '15 seconds'),
 'outboxPending',(select count(*) from "4color_private"."4color_outbox" where sent_at is null));
$$;

-- PostgREST exposes the function names, but only the backend credential can call them.
revoke execute on all functions in schema "4color_private" from public,anon,authenticated;
revoke execute on function public."4color_server_room_action"(uuid,text,jsonb),public."4color_server_start_game"(uuid,uuid,bigint,jsonb,jsonb,text),
public."4color_server_game_context"(uuid,uuid,text,text),public."4color_server_freeze_window"(uuid,text),
public."4color_server_commit_game"(uuid,text,jsonb,jsonb,uuid,text,text,jsonb,uuid,uuid,jsonb),public."4color_server_claim_jobs"(integer),
public."4color_server_finish_job"(uuid,boolean),public."4color_server_health"() from public,anon,authenticated;
grant execute on function public."4color_server_room_action"(uuid,text,jsonb),public."4color_server_start_game"(uuid,uuid,bigint,jsonb,jsonb,text),
public."4color_server_game_context"(uuid,uuid,text,text),public."4color_server_freeze_window"(uuid,text),
public."4color_server_commit_game"(uuid,text,jsonb,jsonb,uuid,text,text,jsonb,uuid,uuid,jsonb),public."4color_server_claim_jobs"(integer),
public."4color_server_finish_job"(uuid,boolean),public."4color_server_health"() to service_role;
