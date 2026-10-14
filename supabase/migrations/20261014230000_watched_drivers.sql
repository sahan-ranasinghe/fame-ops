-- =============================================================================
-- Watched mode (14 October 2026, docs/phase6-plan.md 7.5): the office is looking
-- at a driver (the driver page, the driver selected on Live locations, or every
-- sharing driver while "today's trails" are on). The web app calls watch_drivers
-- every 30 s, which sets driver_latest.watched_until 90 s ahead (service role
-- only, through the tool). send_heartbeat() now answers {"watched": bool}, so the
-- phone knows within a minute and uploads every 10 s while moving (20 s
-- otherwise). Additive: the column, and the function's answer (void before).
-- =============================================================================

alter table public.driver_latest add column watched_until timestamptz;
comment on column public.driver_latest.watched_until is
  'The office is watching this driver until here (watch_drivers, refreshed every 30 s while a page shows them): the phone uploads every 10 s while moving.';

drop function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer, integer, bigint);
create function public.send_heartbeat(
  p_at                    timestamptz,
  p_sharing               boolean,
  p_location_on           boolean,
  p_permission            text,
  p_battery_pct           integer default null,
  p_app_version           text    default null,
  p_queued_points         integer default null,
  p_rejected_points       integer default null,
  p_data_available        boolean default null,
  p_app_state             text    default null,
  p_fix_age_s             integer default null,
  p_video_uploads_waiting integer default null,
  p_video_bytes_waiting   bigint  default null
)
returns jsonb
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
     hb_location_off_since, hb_rejected_points, hb_data_available, hb_app_state, hb_fix_age_s,
     hb_video_uploads_waiting, hb_video_bytes_waiting)
  values
    (v_me,
     exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
     v_at, p_sharing, p_location_on, p_permission, p_battery_pct, p_app_version, p_queued_points,
     case when v_ok then null else v_at end,
     p_rejected_points, p_data_available, p_app_state, p_fix_age_s,
     p_video_uploads_waiting, p_video_bytes_waiting)
  on conflict (employee_id) do update
    set hb_at                    = excluded.hb_at,
        hb_sharing               = excluded.hb_sharing,
        hb_location_on           = excluded.hb_location_on,
        hb_permission            = excluded.hb_permission,
        hb_battery_pct           = excluded.hb_battery_pct,
        hb_app_version           = excluded.hb_app_version,
        hb_queued_points         = excluded.hb_queued_points,
        hb_location_off_since    = case when v_ok then null else coalesce(dl.hb_location_off_since, excluded.hb_at) end,
        hb_rejected_points       = excluded.hb_rejected_points,
        hb_data_available        = excluded.hb_data_available,
        hb_app_state             = excluded.hb_app_state,
        hb_fix_age_s             = excluded.hb_fix_age_s,
        hb_video_uploads_waiting = excluded.hb_video_uploads_waiting,
        hb_video_bytes_waiting   = excluded.hb_video_bytes_waiting
    where dl.hb_at is null or excluded.hb_at > dl.hb_at;

  -- The answer: is the office watching this driver right now?
  return jsonb_build_object(
    'watched', coalesce((select dl.watched_until > now() from public.driver_latest dl where dl.employee_id = v_me), false)
  );
end;
$$;

revoke all on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer, integer, bigint)
  from public, anon;
grant execute on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer, integer, bigint)
  to authenticated, service_role;
