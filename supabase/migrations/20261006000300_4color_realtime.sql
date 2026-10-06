-- Private broadcasts reveal only identifiers. Every snapshot still checks membership.
create policy "4color_game_broadcast_members" on realtime.messages for select to authenticated
using (extension='broadcast' and exists(select 1 from public."4color_game_members" gm
  where gm.user_id=(select auth.uid()) and gm.membership_status='active' and realtime.topic()='4color_game:'||gm.game_id::text));
create policy "4color_room_broadcast_members" on realtime.messages for select to authenticated
using (extension='broadcast' and exists(select 1 from public."4color_room_members" rm
  where rm.user_id=(select auth.uid()) and realtime.topic()='4color_room:'||rm.room_id::text));

create function "4color_private"."4color_broadcast_room"() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if tg_table_name='4color_rooms' then rid:=coalesce(new.id,old.id); else rid:=coalesce(new.room_id,old.room_id); end if;
 perform realtime.send(jsonb_build_object('roomId',rid),'changed','4color_room:'||rid::text,true);
 return null;
end $$;
create trigger "4color_room_notice" after update on public."4color_rooms" for each row execute function "4color_private"."4color_broadcast_room"();

create function "4color_private"."4color_dispatch_outbox"() returns integer language plpgsql security definer set search_path='' as $$
declare o "4color_private"."4color_outbox"; n integer:=0;
begin
 for o in select * from "4color_private"."4color_outbox" where sent_at is null order by public_seq for update skip locked limit 100 loop
   perform realtime.send(jsonb_build_object('gameId',o.game_id,'boardVersion',o.board_version,'publicSeq',o.public_seq),'changed','4color_game:'||o.game_id::text,true);
   update "4color_private"."4color_outbox" set sent_at=clock_timestamp() where id=o.id; n:=n+1;
 end loop;
 return n;
end $$;
revoke execute on function "4color_private"."4color_broadcast_room"(),"4color_private"."4color_dispatch_outbox"() from public,anon,authenticated;
grant execute on function "4color_private"."4color_dispatch_outbox"() to service_role;
