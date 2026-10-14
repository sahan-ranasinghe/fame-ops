-- Route quality and offline reliability (14 October 2026).
--
-- 1. driver_heartbeats: the phone's heartbeat history (about one row a minute
--    while on duty, uploaded in batches, also after an outage), so the office
--    can tell "no GPS signal" (heartbeats, no fixes) from "app not running"
--    (nothing at all). Drivers insert their own rows; office roles read them.
--    Pruned after 30 days.
-- 2. driver_latest: the newest heartbeat's refused-point count, data
--    availability, app state and GPS age; the heading of the last point (the
--    live marker turns with it).
-- 3. send_heartbeat(): the same, with the new values.
-- 4. location_points: office roles read them through RLS and the table joins
--    the Realtime publication, so the driver page grows a line point by point
--    (a late backlog lands in the right place).
-- 5. route_matched: the snapped-to-road geometry per driving leg (map matching
--    behind the map_matching setting). Service role only.
-- 6. One nightly prune for points (90 days), heartbeats (30) and matches (90).
-- Everything is additive.

-- 1. Heartbeat history -------------------------------------------------------
create table public.driver_heartbeats (
  id                 bigint generated always as identity primary key,
  employee_id        uuid not null references public.employees (id),
  at                 timestamptz not null,
  session_id         uuid,
  sharing            boolean,
  location_on        boolean,
  permission         text,
  battery_pct        smallint,
  app_state          text,
  data_available     boolean,
  fixes_seen         integer,
  fixes_stored       integer,
  dropped_accuracy   integer,
  dropped_jump       integer,
  dropped_jitter     integer,
  dropped_duplicate  integer,
  last_gps_fix_age_s integer,
  queued_points      integer,
  rejected_points    integer,
  app_version        text,
  received_at        timestamptz not null default now(),
  constraint driver_heartbeats_employee_at_key unique (employee_id, at),
  constraint driver_heartbeats_permission_check
    check (permission is null or permission in ('always', 'foreground', 'denied', 'unknown')),
  constraint driver_heartbeats_app_state_check
    check (app_state is null or app_state in ('foreground', 'background'))
);

comment on table public.driver_heartbeats is
  'What the phone said about itself, about once a minute while on duty (uploaded in batches, also after an outage). Pruned after 30 days.';

alter table public.driver_heartbeats enable row level security;

-- received_at stays the server's time. A driver writes only their own rows (the policy); the
-- unique key makes a second upload of the same batch harmless (on conflict do nothing).
grant insert (employee_id, at, session_id, sharing, location_on, permission, battery_pct, app_state, data_available,
              fixes_seen, fixes_stored, dropped_accuracy, dropped_jump, dropped_jitter, dropped_duplicate,
              last_gps_fix_age_s, queued_points, rejected_points, app_version)
  on public.driver_heartbeats to authenticated;
grant select on public.driver_heartbeats to authenticated;

create policy driver_heartbeats_insert_own on public.driver_heartbeats
  for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));

create policy driver_heartbeats_select_office on public.driver_heartbeats
  for select to authenticated
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'viewer'));

-- 2. driver_latest: the newest heartbeat's extra values, the heading --------
alter table public.driver_latest
  add column hb_rejected_points integer,
  add column hb_data_available  boolean,
  add column hb_app_state       text,
  add column hb_fix_age_s       integer,
  add column heading            real,
  add constraint driver_latest_hb_app_state_check
    check (hb_app_state is null or hb_app_state in ('foreground', 'background'));

comment on column public.driver_latest.hb_rejected_points is 'Points the server refused and the phone keeps (the last heartbeat''s count).';
comment on column public.driver_latest.heading is 'Heading of the last point in degrees, when the phone gave one.';

create or replace function public.location_points_set_latest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A phone with a wrong clock must not pin "latest" to a time in the future.
  if new.recorded_at > now() + interval '5 minutes' then
    return null;
  end if;

  insert into public.driver_latest as dl
    (employee_id, session_id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at, heading, sharing)
  values
    (new.employee_id, new.session_id, new.lat, new.lng, new.accuracy_m, new.speed_mps,
     new.battery_pct, new.recorded_at, new.heading,
     exists (select 1 from public.duty_sessions s
             where s.employee_id = new.employee_id and s.ended_at is null))
  on conflict (employee_id) do update
    set session_id  = excluded.session_id,
        lat         = excluded.lat,
        lng         = excluded.lng,
        accuracy_m  = excluded.accuracy_m,
        speed_mps   = excluded.speed_mps,
        battery_pct = excluded.battery_pct,
        recorded_at = excluded.recorded_at,
        heading     = excluded.heading
    where dl.recorded_at is null or excluded.recorded_at > dl.recorded_at;

  return null;
end;
$$;

-- 3. send_heartbeat with the new values ---------------------------------------
-- The function is replaced (not overloaded): an older app that sends only the first
-- seven arguments still matches, the rest default to null.
drop function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer);

create function public.send_heartbeat(
  p_at              timestamptz,
  p_sharing         boolean,
  p_location_on     boolean,
  p_permission      text,
  p_battery_pct     integer default null,
  p_app_version     text    default null,
  p_queued_points   integer default null,
  p_rejected_points integer default null,
  p_data_available  boolean default null,
  p_app_state       text    default null,
  p_fix_age_s       integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := public.current_employee_id();
  v_at  timestamptz := least(coalesce(p_at, now()), now());
  v_ok  boolean := coalesce(p_location_on, false) and coalesce(p_permission, 'unknown') = 'always';
begin
  -- Drivers only: office people have employee rows too, but no phone to report.
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver') then
    raise exception 'Only a signed-in driver can send a heartbeat';
  end if;
  if p_permission is not null and p_permission not in ('always', 'foreground', 'denied', 'unknown') then
    raise exception 'Unknown permission value %', p_permission;
  end if;
  if p_app_state is not null and p_app_state not in ('foreground', 'background') then
    raise exception 'Unknown app state %', p_app_state;
  end if;

  insert into public.driver_latest as dl
    (employee_id, sharing, hb_at, hb_sharing, hb_location_on, hb_permission, hb_battery_pct, hb_app_version, hb_queued_points,
     hb_location_off_since, hb_rejected_points, hb_data_available, hb_app_state, hb_fix_age_s)
  values
    (v_me,
     exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
     v_at, p_sharing, p_location_on, p_permission, p_battery_pct, p_app_version, p_queued_points,
     case when v_ok then null else v_at end,
     p_rejected_points, p_data_available, p_app_state, p_fix_age_s)
  on conflict (employee_id) do update
    set hb_at                 = excluded.hb_at,
        hb_sharing            = excluded.hb_sharing,
        hb_location_on        = excluded.hb_location_on,
        hb_permission         = excluded.hb_permission,
        hb_battery_pct        = excluded.hb_battery_pct,
        hb_app_version        = excluded.hb_app_version,
        hb_queued_points      = excluded.hb_queued_points,
        hb_location_off_since = case when v_ok then null else coalesce(dl.hb_location_off_since, excluded.hb_at) end,
        hb_rejected_points    = excluded.hb_rejected_points,
        hb_data_available     = excluded.hb_data_available,
        hb_app_state          = excluded.hb_app_state,
        hb_fix_age_s          = excluded.hb_fix_age_s
    where dl.hb_at is null or excluded.hb_at > dl.hb_at;
end;
$$;

revoke all on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer)
  from public, anon;
grant execute on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer)
  to authenticated, service_role;

-- 4. location_points: read by the office, in the Realtime publication --------
create policy location_points_select_office on public.location_points
  for select to authenticated
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'viewer'));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.location_points;
  end if;
end;
$$;

-- 5. Snapped routes -------------------------------------------------------------
create table public.route_matched (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id),
  date        date not null,
  provider    text not null check (provider in ('google_roads', 'osrm')),
  leg_from    timestamptz not null,
  leg_to      timestamptz not null,
  -- [[unix_ms, lat, lng], ...] along the road
  geometry    jsonb not null default '[]'::jsonb,
  matched_at  timestamptz not null default now(),
  status      text not null default 'ok' check (status in ('ok', 'failed')),
  error       text,
  constraint route_matched_leg_key unique (employee_id, date, provider, leg_from)
);

comment on table public.route_matched is
  'A driving leg snapped to roads by the map-matching provider; one row per leg start, replaced when the leg grows.';

alter table public.route_matched enable row level security;
revoke all on public.route_matched from public, anon, authenticated;

-- 6. One nightly prune ----------------------------------------------------------
create function public.prune_driver_heartbeats(p_keep_days integer default 30, p_batch integer default 50000)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from public.driver_heartbeats
    where id in (
      select id from public.driver_heartbeats
      where at < now() - make_interval(days => p_keep_days)
      order by id
      limit p_batch
    )
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

create function public.prune_route_matched(p_keep_days integer default 90)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from public.route_matched
    where date < (now() at time zone 'Asia/Colombo')::date - p_keep_days
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

-- Points 90 days, heartbeats 30 days, snapped legs 90 days, in one nightly job.
create function public.prune_location_data()
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'points', public.prune_location_points(),
    'heartbeats', public.prune_driver_heartbeats(),
    'matched', public.prune_route_matched()
  );
end;
$$;

revoke all on function public.prune_driver_heartbeats(integer, integer) from public, anon, authenticated;
revoke all on function public.prune_route_matched(integer) from public, anon, authenticated;
revoke all on function public.prune_location_data() from public, anon, authenticated;

-- cron.schedule with a job name replaces the job: the same nightly slot now prunes all three.
select cron.schedule('prune-location-points', '30 21 * * *', $$select public.prune_location_data()$$);
