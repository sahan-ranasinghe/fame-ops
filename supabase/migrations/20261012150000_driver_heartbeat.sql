-- Driver heartbeats: what the phone reports about itself about once a minute
-- while "Sharing my location" is on, separate from GPS points: sharing on/off,
-- Android Location services on/off, the location permission, battery, app
-- version and how many points are still queued on the phone. The office turns
-- it into one status (live / location off / no signal / not sharing) within
-- a minute of the truth changing, instead of waiting 15 minutes for a point
-- to go stale.
--
-- Stored on driver_latest (one row per driver), so the web app's Realtime
-- channel on that table hears a heartbeat the moment it lands. A driver
-- writes only their own row, through send_heartbeat(); the row itself stays
-- closed to drivers (no policy) and readable by the office roles.

alter table public.driver_latest
  add column hb_at                 timestamptz,
  add column hb_sharing            boolean,
  add column hb_location_on        boolean,
  add column hb_permission         text,
  add column hb_battery_pct        smallint,
  add column hb_app_version        text,
  add column hb_queued_points      integer,
  -- The first heartbeat of the current "location off" spell; null while location is on.
  add column hb_location_off_since timestamptz,
  add constraint driver_latest_hb_permission_check
    check (hb_permission is null or hb_permission in ('always', 'foreground', 'denied', 'unknown'));

comment on column public.driver_latest.hb_at is 'When the phone sent its last heartbeat (phone time, never after the server''s now()).';
comment on column public.driver_latest.hb_location_off_since is 'Since when the phone reports Location services off or the permission missing; null while all is well.';

-- The app calls this about every 60 s while sharing, at once when Location or
-- the permission changes, and once more when sharing stops. A heartbeat that
-- is older than the one already stored (a queued one arriving late) changes
-- nothing. The phone's clock is not trusted into the future.
create function public.send_heartbeat(
  p_at            timestamptz,
  p_sharing       boolean,
  p_location_on   boolean,
  p_permission    text,
  p_battery_pct   integer default null,
  p_app_version   text    default null,
  p_queued_points integer default null
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

  insert into public.driver_latest as dl
    (employee_id, sharing, hb_at, hb_sharing, hb_location_on, hb_permission, hb_battery_pct, hb_app_version, hb_queued_points,
     hb_location_off_since)
  values
    (v_me,
     exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
     v_at, p_sharing, p_location_on, p_permission, p_battery_pct, p_app_version, p_queued_points,
     case when v_ok then null else v_at end)
  on conflict (employee_id) do update
    set hb_at                 = excluded.hb_at,
        hb_sharing            = excluded.hb_sharing,
        hb_location_on        = excluded.hb_location_on,
        hb_permission         = excluded.hb_permission,
        hb_battery_pct        = excluded.hb_battery_pct,
        hb_app_version        = excluded.hb_app_version,
        hb_queued_points      = excluded.hb_queued_points,
        hb_location_off_since = case when v_ok then null else coalesce(dl.hb_location_off_since, excluded.hb_at) end
    where dl.hb_at is null or excluded.hb_at > dl.hb_at;
end;
$$;

revoke all on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer) from public, anon;
grant execute on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer) to authenticated, service_role;
