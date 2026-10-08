-- =============================================================================
-- Odometer photos must prove the reading.
--
-- The Edge Function read-odometer looks at the photo and answers a status
-- (ok, no_odometer, trip_meter_only, blurry, covered_or_dark, not_dashboard,
-- unsure, out_of_range) and, when ok, the number. The app only lets the
-- driver confirm that number; typing is possible after three failed photos,
-- after a warning ("Change"), or with no connection. What the driver did is
-- stored with the log (entry, photo_attempts); what the server read is stored
-- by the server alone (ai_value, ai_status, ai_checked_at, flag): a driver has
-- no privilege on those columns, and the trigger below fills them from the
-- read of the very photo the log points at.
--
-- A log typed with no connection is checked later: every 5 minutes a pg_cron
-- job asks read-odometer (through pg_net) to look at photos that have not
-- been checked. The function's URL and the shared key live in Vault
-- (secrets functions_url and server_key), never in a migration.
-- =============================================================================

-- 1. odometer_reads: the model's verdict is a status; a row may belong to a log (server check).
alter table public.odometer_reads
  drop column rejected,
  add column status text not null default 'unsure',
  add column mode   text not null default 'driver',
  add column log_id uuid references public.odometer_logs (id),
  add constraint odometer_reads_status_check check (
    status in ('ok', 'no_odometer', 'trip_meter_only', 'blurry', 'covered_or_dark', 'not_dashboard', 'unsure', 'out_of_range')),
  add constraint odometer_reads_mode_check check (mode in ('driver', 'server'));

-- 2. odometer_logs: how the reading was entered (the phone) and what the server read (the server).
alter table public.odometer_logs
  add column entry          text not null default 'photo',
  add column photo_attempts smallint not null default 1,
  add column ai_value       integer,
  add column ai_status      text,
  add column ai_checked_at  timestamptz,
  add column ai_attempts    smallint not null default 0,
  add column flag           text,
  add constraint odometer_logs_entry_check check (entry in ('photo', 'photo_changed', 'typed_unreadable', 'typed_offline')),
  add constraint odometer_logs_photo_attempts_check check (photo_attempts >= 0),
  add constraint odometer_logs_ai_status_check check (
    ai_status is null
    or ai_status in ('ok', 'no_odometer', 'trip_meter_only', 'blurry', 'covered_or_dark', 'not_dashboard', 'unsure', 'out_of_range')),
  add constraint odometer_logs_flag_check check (
    flag is null or flag in ('photo_changed', 'typed_unreadable', 'ai_differs', 'ai_failed'));

comment on column public.odometer_logs.entry is
  'photo = the driver confirmed the number the server read; photo_changed = the driver changed it; typed_unreadable = typed after 3 unreadable photos; typed_offline = typed with no connection, checked later';
comment on column public.odometer_logs.flag is
  'Set by the server only. photo_changed, typed_unreadable, ai_differs (typed offline, the photo shows another number), ai_failed (typed offline, the photo could not be read)';

create index odometer_logs_flagged_idx on public.odometer_logs (logged_at desc) where flag is not null;
create index odometer_logs_unchecked_idx on public.odometer_logs (logged_at) where ai_checked_at is null and photo_id is not null;

-- 3. Drivers insert only these columns. The server-side columns are not in the list,
--    so a phone that sends ai_value, ai_status or flag is refused (42501).
revoke insert on public.odometer_logs from authenticated;
grant insert (id, vehicle_id, employee_id, task_id, reading_km, ocr_value, photo_id, kind, logged_at, entry, photo_attempts)
  on public.odometer_logs to authenticated;

-- 4. The flag rules, in one place.
create function public.odometer_log_flag(p_entry text, p_reading integer, p_ai_value integer, p_ai_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entry = 'photo_changed' then 'photo_changed'
    when p_entry = 'typed_unreadable' then 'typed_unreadable'
    when p_ai_status is null then null                                  -- not checked yet
    when p_ai_status <> 'ok' or p_ai_value is null then 'ai_failed'
    when p_ai_value <> p_reading then 'ai_differs'
    else null
  end
$$;

-- 5. On insert the server fills the AI columns from the read of the log's own photo.
--    Whatever a driver's phone sent in those columns is thrown away first.
create function public.odometer_logs_set_ai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_read record;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    new.ai_value := null;
    new.ai_status := null;
    new.ai_checked_at := null;
    new.ai_attempts := 0;
    new.flag := null;
  end if;

  if new.photo_id is not null and new.ai_status is null then
    select r.reading_km, r.status
    into v_read
    from public.odometer_reads r
    join public.photos p on p.storage_path = r.photo_path
    where p.id = new.photo_id and r.ok
    order by r.created_at desc
    limit 1;
    if found then
      new.ai_value := v_read.reading_km;
      new.ai_status := v_read.status;
      new.ai_checked_at := now();
    end if;
  end if;

  new.flag := public.odometer_log_flag(new.entry, new.reading_km, new.ai_value, new.ai_status);
  return new;
end;
$$;

create trigger odometer_logs_set_ai before insert on public.odometer_logs
  for each row execute function public.odometer_logs_set_ai();

-- 6. The server's later check (read-odometer in server mode) writes its result here.
create function public.set_odometer_ai(p_log_id uuid, p_ai_value integer, p_ai_status text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.odometer_logs l
  set ai_value      = p_ai_value,
      ai_status     = p_ai_status,
      ai_checked_at = now(),
      flag          = public.odometer_log_flag(l.entry, l.reading_km, p_ai_value, p_ai_status)
  where l.id = p_log_id;
$$;

-- 7. Every 5 minutes: ask read-odometer to look at logs whose photo has not been checked
--    (typed with no connection, or a check that failed). Up to 5 tries per log; after
--    that the log is marked unsure, which flags a typed reading as ai_failed.
create extension if not exists pg_net with schema extensions;

create function public.queue_odometer_checks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_key   text;
  v_log   record;
  v_count integer := 0;
begin
  update public.odometer_logs l
  set ai_status = 'unsure', ai_checked_at = now(),
      flag = public.odometer_log_flag(l.entry, l.reading_km, null, 'unsure')
  where l.ai_checked_at is null and l.ai_attempts >= 5;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'server_key';
  if v_url is null or v_key is null then
    raise notice 'queue_odometer_checks: Vault secrets functions_url / server_key are not set';
    return 0;
  end if;

  for v_log in
    select l.id
    from public.odometer_logs l
    join public.photos p on p.id = l.photo_id
    where l.ai_checked_at is null
      and l.ai_attempts < 5
      and l.logged_at > now() - interval '30 days'
      and l.logged_at < now() - interval '1 minute'
    order by l.logged_at
    limit 50
  loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/read-odometer',
      body := jsonb_build_object('log_id', v_log.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-server-key', v_key),
      timeout_milliseconds := 30000
    );
    update public.odometer_logs set ai_attempts = ai_attempts + 1 where id = v_log.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.odometer_log_flag(text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.odometer_logs_set_ai()                       from public, anon, authenticated;
revoke all on function public.set_odometer_ai(uuid, integer, text)         from public, anon, authenticated;
revoke all on function public.queue_odometer_checks()                      from public, anon, authenticated;
grant execute on function public.set_odometer_ai(uuid, integer, text) to service_role;

select cron.schedule('check-odometer-photos', '*/5 * * * *', $$select public.queue_odometer_checks()$$);
