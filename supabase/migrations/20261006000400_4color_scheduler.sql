create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create function "4color_private"."4color_invoke_game_jobs"() returns bigint language plpgsql security definer set search_path='' as $$
declare secret text; endpoint text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='4color_job_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='4color_job_url' limit 1;
 if secret is null or endpoint is null then return null; end if;
 return net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-job-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;
revoke all on function "4color_private"."4color_invoke_game_jobs"() from public,anon,authenticated;



-- No Edge invocations when there is no due work; Cron itself stays durable.
create or replace function "4color_private"."4color_invoke_game_jobs"() returns bigint language plpgsql security definer set search_path='' as $$
declare secret text; endpoint text;
begin
 if not exists(select 1 from "4color_private"."4color_jobs" where due_at<=clock_timestamp() and
   (status='pending' or (status='running' and lease_until<clock_timestamp()))) then return null; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='4color_job_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='4color_job_url' limit 1;
 if secret is null or endpoint is null then return null; end if;
 return net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-job-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;
