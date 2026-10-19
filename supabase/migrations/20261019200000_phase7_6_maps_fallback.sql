-- =============================================================================
-- Phase 7 Part 6, the second round after the checkpoint (Sahan, 19 October 2026).
--
--   route_legs.line        openrouteservice's road line of a cached leg (encoded polyline), so a plan made from the
--                          cache keeps it: ours, drawn on any map (Google's lines are never cached).
--   prune_google_content   strips only Google's leg lines (legs whose source is google) after 30 days; openrouteservice's
--                          stay with the plan.
--   driver_map_state       failures (Google's map failed on this many tries in a row on the phone, 0 after a good load)
--                          and last_failed_at: the office's issue waits for a second try that fails, or two phones
--                          within an hour (issues.ts), so one weak-signal trip raises no alarm.
-- =============================================================================

alter table public.route_legs add column line text;
comment on column public.route_legs.line is
  'openrouteservice''s road line for the leg (encoded polyline, precision 5); null for the estimate and old rows.';

alter table public.driver_map_state
  add column failures       integer not null default 0,
  add column last_failed_at timestamptz;
comment on column public.driver_map_state.failures is
  'Google''s map failed on this many tries in a row (each try = one app open); 0 after a good load.';

create or replace function public.report_map_state(p_google_ok boolean, p_reason text, p_at timestamptz, p_app_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_at   timestamptz := least(coalesce(p_at, now()), now());
  v_last timestamptz;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  if p_google_ok is null then
    raise exception 'google_ok is needed' using errcode = '22023';
  end if;
  if not p_google_ok and (p_reason is null or p_reason not in ('timeout', 'error')) then
    raise exception 'A failure needs its reason: timeout or error' using errcode = '22023';
  end if;
  select greatest(last_failed_at, google_failed_at, google_ok_at) into v_last from public.driver_map_state where employee_id = v_me;
  if v_last is not null and v_at < v_last then
    return 'older';
  end if;
  insert into public.driver_map_state as s
    (employee_id, google_ok, reason, google_failed_at, google_ok_at, last_failed_at, failures, app_version, updated_at)
  values (
    v_me, p_google_ok, case when p_google_ok then null else p_reason end,
    case when p_google_ok then null else v_at end,
    case when p_google_ok then v_at else null end,
    case when p_google_ok then null else v_at end,
    case when p_google_ok then 0 else 1 end,
    left(p_app_version, 80), now()
  )
  on conflict (employee_id) do update set
    google_ok        = excluded.google_ok,
    reason           = excluded.reason,
    -- The first failure of a run is kept ("since"); a good load ends the run.
    google_failed_at = case when excluded.google_ok then s.google_failed_at
                            when s.google_ok then excluded.google_failed_at
                            else coalesce(s.google_failed_at, excluded.google_failed_at) end,
    google_ok_at     = case when excluded.google_ok then excluded.google_ok_at else s.google_ok_at end,
    last_failed_at   = case when excluded.google_ok then s.last_failed_at else excluded.last_failed_at end,
    failures         = case when excluded.google_ok then 0 else s.failures + 1 end,
    app_version      = coalesce(excluded.app_version, s.app_version),
    updated_at       = now();
  return 'ok';
end;
$$;
revoke all on function public.report_map_state(boolean, text, timestamptz, text) from public, anon;
grant execute on function public.report_map_state(boolean, text, timestamptz, text) to authenticated;

create or replace function public.prune_google_content(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut     timestamptz := now() - make_interval(days => p_days);
  v_pins    integer;
  v_stops   integer;
  v_starts  integer;
  v_matched integer;
  v_lines   integer;
  v_rstops  integer;
  v_rstarts integer;
  v_rlines  integer;
begin
  -- Every reached stop has its arrival point before Google's details go (points are kept 90 days).
  perform public.fill_stop_arrivals(p_days + 5);
  with gone as (delete from public.google_pins where fetched_at < v_cut returning 1)
  select count(*) into v_pins from gone;
  -- The stop keeps its place id, type, times, what the office wrote and the driver's arrival point.
  with cleared as (
    update public.task_stops s
       set lat = null, lng = null, address = null, google_fetched_at = null,
           place_name = case
             when s.arrival_lat is not null then
               'Google place · arrived near ' ||
               coalesce(public.nearest_town_name(s.arrival_lat, s.arrival_lng), 'an unnamed place') || ' ' ||
               to_char(coalesce(s.arrived_at, s.auto_detected_at, s.done_at, s.arrival_at) at time zone 'Asia/Colombo', 'HH24:MI')
             else 'Google place (details removed after 30 days)'
           end
     where s.google_fetched_at < v_cut
    returning 1
  ) select count(*) into v_stops from cleared;
  with cleared as (
    update public.tasks
       set start_lat = null, start_lng = null, start_name = 'Google place (details removed after 30 days)',
           start_google_fetched_at = null
     where start_google_fetched_at < v_cut
    returning 1
  ) select count(*) into v_starts from cleared;
  -- Phase 7 (§34): a request's stops and start, the same way (a request has no arrival point).
  with cleared as (
    update public.request_stops
       set lat = null, lng = null, address = null, google_fetched_at = null,
           place_name = 'Google place (details removed after 30 days)'
     where google_fetched_at < v_cut
    returning 1
  ) select count(*) into v_rstops from cleared;
  with cleared as (
    update public.vehicle_requests
       set start_lat = null, start_lng = null, start_name = 'Google place (details removed after 30 days)',
           start_google_fetched_at = null
     where start_google_fetched_at < v_cut
    returning 1
  ) select count(*) into v_rstarts from cleared;
  with gone as (
    delete from public.route_matched where provider = 'google_roads' and matched_at < v_cut returning 1
  ) select count(*) into v_matched from gone;
  -- Phase 7 (§20): Google's leg lines kept with a plan go 30 days after they were fetched; the pins, times and km stay.
  -- Part 6: only Google's (source google, or none: before Part 6 every stored line was Google's); openrouteservice's stay.
  perform set_config('fleet.quiet', 'on', true);
  with cleared as (
    update public.tasks t
       set plan_json = (t.plan_json - 'line_fetched_at')
                       || jsonb_build_object('legs', coalesce((select jsonb_agg(case when coalesce(l ->> 'source', 'google') = 'google' then l - 'line' else l end order by n)
                                                                from jsonb_array_elements(t.plan_json -> 'legs') with ordinality as x(l, n)), '[]'::jsonb))
     where t.plan_json ? 'line_fetched_at' and (t.plan_json ->> 'line_fetched_at')::timestamptz < v_cut
    returning 1
  ) select count(*) into v_lines from cleared;
  perform set_config('fleet.quiet', 'off', true);
  with cleared as (
    update public.vehicle_requests r
       set plan_json = (r.plan_json - 'line_fetched_at')
                       || jsonb_build_object('legs', coalesce((select jsonb_agg(case when coalesce(l ->> 'source', 'google') = 'google' then l - 'line' else l end order by n)
                                                                from jsonb_array_elements(r.plan_json -> 'legs') with ordinality as x(l, n)), '[]'::jsonb))
     where r.plan_json ? 'line_fetched_at' and (r.plan_json ->> 'line_fetched_at')::timestamptz < v_cut
    returning 1
  ) select count(*) into v_rlines from cleared;
  return jsonb_build_object('pins', v_pins, 'stops', v_stops, 'starts', v_starts, 'matched', v_matched, 'lines', v_lines + v_rlines,
                            'request_stops', v_rstops, 'request_starts', v_rstarts);
end;
$$;
revoke all on function public.prune_google_content(integer) from public, anon, authenticated;
