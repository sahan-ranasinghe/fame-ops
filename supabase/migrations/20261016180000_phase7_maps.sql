-- Phase 7, Part 2b (docs/phase7-plan.md §20–26, and the Part 2 go's additions):
--   1. App stops (Sahan, 16 October): a stop is 10 minutes or more with neither a location point nor a heartbeat
--      (the phone's own times), while on duty and before the cut-off. Gaps where points kept arriving don't count; a
--      gap across an app update (the version changed) is not one either. A silence still going on is not counted
--      yet: a phone offline with its points queued would otherwise count until it uploads (Live's "No signal" and the
--      30-minute no-fix rule cover the present).
--   2. Google's leg lines kept with a plan (plan_json.legs[].line, from the Routes call of the road times) go 30 days
--      after they were fetched, in the nightly google_content job; that write sends the driver no push.

-- 1. App stops ---------------------------------------------------------------------------------------------------------
create or replace function public.app_stops(p_from timestamptz, p_to timestamptz)
returns table (employee_id uuid, stops integer, last_stop_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with cut as (
    select coalesce((select s.value #>> '{}' from public.fleet_settings s where s.key = 'duty_cutoff'), '21:00') as v
  ),
  -- Each duty period inside the window, up to the cut-off of its day (or Finish work); `closed`: that end is past,
  -- so a silence up to it is over (an open period's end is now: a silence still going on is not an app stop yet).
  periods as (
    select x.id, x.employee_id, x.from_at, least(x.end_at, now(), p_to) as to_at, x.end_at <= now() as closed
    from (
      select d.id, d.employee_id, greatest(d.started_at, p_from) as from_at,
             least(coalesce(d.ended_at, 'infinity'::timestamptz),
                   coalesce(public.duty_cutoff_after(d.started_at, (select v from cut)), 'infinity'::timestamptz)) as end_at
      from public.duty_sessions d
      where d.started_at < p_to and coalesce(d.ended_at, now()) > p_from
    ) x
  ),
  -- What the phone produced while on duty: its heartbeats and its location points (the phone's own times, so a
  -- stretch uploaded later still counts as the app running), with the period's start and end as the edges.
  events as (
    select pr.id as period_id, pr.employee_id, pr.from_at as at from periods pr
    union all
    select pr.id, pr.employee_id, h.at from periods pr
      join public.driver_heartbeats h on h.employee_id = pr.employee_id and h.at > pr.from_at and h.at <= pr.to_at
    union all
    select pr.id, pr.employee_id, p.recorded_at from periods pr
      join public.location_points p on p.employee_id = pr.employee_id and p.recorded_at > pr.from_at and p.recorded_at <= pr.to_at
    union all
    select pr.id, pr.employee_id, pr.to_at from periods pr where pr.to_at > pr.from_at and pr.closed
  ),
  steps as (
    select e.period_id, e.employee_id, e.at, lag(e.at) over (partition by e.period_id order by e.at) as prev_at
    from events e
  ),
  gaps as (
    select s.employee_id, s.prev_at, s.at from steps s
    where s.prev_at is not null and s.at - s.prev_at >= interval '10 minutes'
  )
  select g.employee_id, count(*)::integer, max(g.at)
  from gaps g
  -- An update or a new install (the app version on the two sides differs) is not an app stop: the heartbeats right
  -- at the gap's two edges (within 5 minutes), so an update the next morning does not excuse last night's silence.
  where not coalesce((
    select (b.app_version is not null and a.app_version is not null and b.app_version <> a.app_version)
    from (select h.app_version from public.driver_heartbeats h where h.employee_id = g.employee_id and h.at <= g.prev_at
            and h.at >= g.prev_at - interval '5 minutes' order by h.at desc limit 1) b,
         (select h.app_version from public.driver_heartbeats h where h.employee_id = g.employee_id and h.at >= g.at
            and h.at <= g.at + interval '5 minutes' order by h.at limit 1) a), false)
  group by g.employee_id
$$;
revoke all on function public.app_stops(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.app_stops(timestamptz, timestamptz) to service_role;

-- 2. Google's leg lines: 30 days, then gone (the plan's pins, times and km stay) --------------------------------------
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
  with gone as (
    delete from public.route_matched where provider = 'google_roads' and matched_at < v_cut returning 1
  ) select count(*) into v_matched from gone;
  -- Phase 7 (§20): Google's leg lines kept with a plan go 30 days after they were fetched; the pins, times and km stay.
  perform set_config('fleet.quiet', 'on', true);
  with cleared as (
    update public.tasks t
       set plan_json = (t.plan_json - 'line_fetched_at')
                       || jsonb_build_object('legs', coalesce((select jsonb_agg(l - 'line' order by n)
                                                                from jsonb_array_elements(t.plan_json -> 'legs') with ordinality as x(l, n)), '[]'::jsonb))
     where t.plan_json ? 'line_fetched_at' and (t.plan_json ->> 'line_fetched_at')::timestamptz < v_cut
    returning 1
  ) select count(*) into v_lines from cleared;
  perform set_config('fleet.quiet', 'off', true);
  return jsonb_build_object('pins', v_pins, 'stops', v_stops, 'starts', v_starts, 'matched', v_matched, 'lines', v_lines);
end;
$$;

-- The housekeeping write above changes nothing the driver sees: tasks_notify_push skips it (fleet.quiet).
create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  -- A housekeeping write (the 30-day removal of Google's lines) changes nothing the driver sees: no push.
  if coalesce(current_setting('fleet.quiet', true), '') = 'on' then
    return null;
  end if;
  -- The driver's own app (seen, accepted, declined, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
    return null;
  end if;

  if new.employee_id <> old.employee_id then
    -- The previous driver hears that the task is gone only if he had accepted it
    -- (a task he never accepted simply leaves his list) and did not decline it himself.
    if old.status <> 'declined' and old.accepted_at is not null then
      perform public.send_push(new.id, 'removed', old.employee_id);
    end if;
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.status <> 'declined' then
      perform public.send_push(new.id, 'cancelled', new.employee_id);
    end if;
  elsif old.status = 'declined' and new.status = 'assigned' then
    -- The same driver gets a declined task back (the office talked to him): as a new task.
    perform public.send_push(new.id, 'new', new.employee_id);
  elsif new.status in ('assigned', 'in_progress')
    and (new.start_at, new.end_by, new.vehicle_id, new.title, new.plan_version, new.notes, new.passengers, new.contact_name, new.contact_phone)
        is distinct from
        (old.start_at, old.end_by, old.vehicle_id, old.title, old.plan_version, old.notes, old.passengers, old.contact_name, old.contact_phone) then
    -- What changed, in the words the push shows ("Task changed: new time 09:30 · vehicle WP KL-1234").
    if new.start_at is distinct from old.start_at then
      v_changes := v_changes || jsonb_build_object('time', public.colombo_when(new.start_at));
    end if;
    if new.end_by is distinct from old.end_by then
      v_changes := v_changes || jsonb_build_object('end_by',
        case when new.end_by is null then 'none' else to_char(new.end_by at time zone 'Asia/Colombo', 'HH24:MI') end);
    end if;
    if new.vehicle_id is distinct from old.vehicle_id then
      v_changes := v_changes || jsonb_build_object('vehicle', (select v.reg_no from public.vehicles v where v.id = new.vehicle_id));
    end if;
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', new.title);
    end if;
    if new.plan_json is distinct from old.plan_json then
      -- Phase 7 (§11): which stops changed, by their place in the order, when update_task_stops said so.
      v_changes := v_changes || jsonb_build_object('stops', coalesce(new.plan_json -> 'stop_changes', 'true'::jsonb));
    end if;
    if new.passengers is distinct from old.passengers then
      v_changes := v_changes || jsonb_build_object('passengers', new.passengers);
    end if;
    if (new.notes, new.contact_name, new.contact_phone) is distinct from (old.notes, old.contact_name, old.contact_phone) then
      v_changes := v_changes || jsonb_build_object('notes', true);
    end if;
    perform public.send_push(new.id, 'changed', new.employee_id, jsonb_build_object('changes', v_changes));
  end if;
  return null;
end;
$$;
