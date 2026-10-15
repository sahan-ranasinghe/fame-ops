-- =============================================================================
-- Phase 6, Part 5b (docs/phase6-plan.md 9.2)
--
--   task_stops.arrival_*   where the driver's own phone was when the stop was reached (the
--                          Arrived tap, else the arrival nudge, else Done): the location point
--                          nearest that moment (within 5 minutes, 100 m or better), copied from
--                          location_points. Our data: kept for good, never cleared with Google's.
--   fill_stop_arrivals()   fills them (pg_cron stop-arrivals, every 5 minutes: a point may reach
--                          the server after the tap, from the phone's offline queue).
--   task_stops.saved_place_id   the office saved a reached Google stop as one of our places
--                          (save_arrival_place: at the arrival point, with a name the office types).
--   nearest_town_name()    the towns table's nearest town (as the connector's nearestTown).
--   prune_google_content() a Google stop over 30 days old now reads "Google place · arrived near
--                          <town> HH:MM" when it was reached, else "Google place (details removed
--                          after 30 days)"; the arrival point stays.
--   route_gap_lines        the dashed "estimated" line of a gap between two points (more than
--                          300 m and 60 s apart), routed with openrouteservice and cached per gap
--                          (rounded ends) for 30 days; for the map only, never for km.
-- =============================================================================

-- 1. The arrival point ------------------------------------------------------------------------
alter table public.task_stops
  add column arrival_lat        double precision,
  add column arrival_lng        double precision,
  add column arrival_at         timestamptz,
  add column arrival_accuracy_m double precision,
  add column saved_place_id     uuid references public.places (id);
comment on column public.task_stops.arrival_lat is
  'Where the driver''s phone was when the stop was reached (a location point near the Arrived tap, the nudge or Done); ours, kept for good.';
comment on column public.task_stops.saved_place_id is
  'The office saved this reached stop as one of our places (at the arrival point, its own name).';

create function public.fill_stop_arrivals(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with reached as (
    select s.id, t.employee_id,
           coalesce(s.arrived_at, s.auto_detected_at, case when s.status = 'done' then s.done_at end) as at
      from public.task_stops s
      join public.tasks t on t.id = s.task_id
     where s.arrival_lat is null
       and s.status in ('arrived', 'done')
       and coalesce(s.arrived_at, s.auto_detected_at, s.done_at) > now() - make_interval(days => p_days)
  ),
  picked as (
    select r.id, p.lat, p.lng, p.recorded_at, p.accuracy_m
      from reached r
      cross join lateral (
        select lp.lat, lp.lng, lp.recorded_at, lp.accuracy_m
          from public.location_points lp
         where lp.employee_id = r.employee_id
           and lp.recorded_at between r.at - interval '5 minutes' and r.at + interval '5 minutes'
           and coalesce(lp.accuracy_m, 0) <= 100
         order by abs(extract(epoch from lp.recorded_at - r.at)), lp.accuracy_m nulls last
         limit 1
      ) p
     where r.at is not null
  ),
  done as (
    update public.task_stops s
       set arrival_lat = p.lat, arrival_lng = p.lng, arrival_at = p.recorded_at, arrival_accuracy_m = p.accuracy_m
      from picked p
     where s.id = p.id
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;
revoke all on function public.fill_stop_arrivals(integer) from public, anon, authenticated;
grant execute on function public.fill_stop_arrivals(integer) to service_role;

select cron.schedule('stop-arrivals', '*/5 * * * *', $$select public.fill_stop_arrivals()$$);

-- 2. The nearest town -------------------------------------------------------------------------
create function public.nearest_town_name(p_lat double precision, p_lng double precision)
returns text
language sql
stable
set search_path = ''
as $$
  select t.name
    from public.towns t
   where t.lat between p_lat - 0.4 and p_lat + 0.4
     and t.lng between p_lng - 0.4 and p_lng + 0.4
   order by power(t.lat - p_lat, 2) + power((t.lng - p_lng) * cos(radians(p_lat)), 2)
   limit 1
$$;
revoke all on function public.nearest_town_name(double precision, double precision) from public, anon, authenticated;
grant execute on function public.nearest_town_name(double precision, double precision) to service_role;

-- 3. The 30-day clean-up: a reached Google stop keeps where the driver arrived --------------------
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
  return jsonb_build_object('pins', v_pins, 'stops', v_stops, 'starts', v_starts, 'matched', v_matched);
end;
$$;

-- 4. The estimated lines of gaps ---------------------------------------------------------------
create table public.route_gap_lines (
  from_lat   double precision not null,
  from_lng   double precision not null,
  to_lat     double precision not null,
  to_lng     double precision not null,
  geometry   jsonb not null,
  km         double precision,
  provider   text not null default 'ors',
  fetched_at timestamptz not null default now(),
  primary key (from_lat, from_lng, to_lat, to_lng)
);
comment on table public.route_gap_lines is
  'A gap''s estimated road line (openrouteservice driving between the two points, ends rounded to 4 decimals), 30 days; drawn dashed, never km.';
alter table public.route_gap_lines enable row level security;

select cron.schedule('prune-gap-lines', '40 21 * * *', $$delete from public.route_gap_lines where fetched_at < now() - interval '30 days'$$);
