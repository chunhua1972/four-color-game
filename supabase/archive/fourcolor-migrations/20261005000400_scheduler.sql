create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create function private.invoke_game_jobs() returns bigint language plpgsql security definer set search_path='' as $$
declare secret text; endpoint text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='four_colors_job_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='four_colors_job_url' limit 1;
 if secret is null or endpoint is null then return null; end if;
 return net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-job-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;
revoke all on function private.invoke_game_jobs() from public,anon,authenticated;
select cron.schedule('four-colors-jobs','2 seconds','select private.invoke_game_jobs()');
select cron.schedule('four-colors-outbox','1 second','select private.dispatch_outbox()');
