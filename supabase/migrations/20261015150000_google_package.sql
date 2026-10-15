-- =============================================================================
-- Phase 6, Part 5: the Google package (docs/phase6-plan.md 9, docs/google-maps-setup.md)
--
--   google_calls        every Google call, counted per feature and Colombo day BEFORE it
--                       is made: map_loads (one per Maps JavaScript map, before the
--                       script loads), places_autocomplete (every request: a session that
--                       ends in a Place Details Essentials call still pays for its first 12
--                       requests), places_details, routes, roads. calls = recorded,
--                       refused = turned away at a cap.
--   google_take(feature, day_cap, month_cap)   the one gate: under an advisory lock per
--                       feature, refuses at the daily cap or the monthly ceiling (each
--                       clamped to the hard ceiling below), else records the call and allows
--                       it. The caller refuses the call on any error (fail closed).
--   google_hard_ceiling(feature)   95 % of Google's free monthly usage: no setting goes above.
--   google_pins         a picked Google place's coordinates and address from Place Details,
--                       by place id, kept at most 30 days (Places terms 14.3); never a row in
--                       places (the terms allow keeping the place id, not names or addresses).
--   task_stops.google_place_id / google_fetched_at, tasks.start_google_place_id /
--   start_google_fetched_at   set by trigger when a stop's (start's) coordinates are a Google
--                       pin's; such coordinates, the address and the name are removed 30 days
--                       after the fetch (the place id stays).
--   prune_google_content()   the nightly clean-up of everything Google over 30 days old: pins,
--                       stops' and starts' Google details, Google-snapped lines. fleet-jobs runs
--                       it after fetching again the pins of the stops still to be driven.
--   recent_places()     "Used before" leaves out Google stops (search Google again).
-- =============================================================================

-- 1. The counter ---------------------------------------------------------------------------
create table public.google_calls (
  feature     text not null,
  day         date not null,
  calls       integer not null default 0,
  refused     integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (feature, day),
  constraint google_calls_feature_check
    check (feature in ('map_loads', 'places_autocomplete', 'places_details', 'routes', 'roads'))
);
comment on table public.google_calls is
  'Google calls per feature and Asia/Colombo day, recorded before each call by google_take(); refused = turned away at a cap.';
alter table public.google_calls enable row level security;

-- 95 % of the free monthly usage (Google Maps Platform pricing since March 2025): Dynamic Maps,
-- Place Details Essentials and Autocomplete Requests 10,000; Compute Routes Pro and Roads 5,000.
create function public.google_hard_ceiling(p_feature text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_feature
    when 'map_loads' then 9500
    when 'places_autocomplete' then 9500
    when 'places_details' then 9500
    when 'routes' then 4750
    when 'roads' then 4750
    else 0
  end
$$;

create function public.google_take(p_feature text, p_day_cap integer, p_month_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day        date := (now() at time zone 'Asia/Colombo')::date;
  v_month      date := date_trunc('month', (now() at time zone 'Asia/Colombo'))::date;
  v_ceiling    integer := public.google_hard_ceiling(p_feature);
  v_month_cap  integer;
  v_day_cap    integer;
  v_day_used   integer;
  v_month_used integer;
begin
  if v_ceiling = 0 then
    raise exception 'google_take: unknown feature %', p_feature;
  end if;
  v_month_cap := greatest(0, least(coalesce(p_month_cap, 0), v_ceiling));
  v_day_cap := greatest(0, least(coalesce(p_day_cap, 0), v_month_cap));
  -- One caller at a time per feature: two tabs cannot both pass at the cap.
  perform pg_advisory_xact_lock(hashtext('google_take:' || p_feature));
  select coalesce(sum(c.calls) filter (where c.day = v_day), 0), coalesce(sum(c.calls), 0)
    into v_day_used, v_month_used
    from public.google_calls c
   where c.feature = p_feature and c.day >= v_month and c.day <= v_day;
  if v_day_used >= v_day_cap or v_month_used >= v_month_cap then
    insert into public.google_calls (feature, day, refused) values (p_feature, v_day, 1)
      on conflict (feature, day) do update set refused = public.google_calls.refused + 1, updated_at = now();
    return jsonb_build_object(
      'allowed', false,
      'reason', case when v_month_used >= v_month_cap then 'month' else 'day' end,
      'day', v_day_used, 'day_cap', v_day_cap, 'month', v_month_used, 'month_cap', v_month_cap
    );
  end if;
  insert into public.google_calls (feature, day, calls) values (p_feature, v_day, 1)
    on conflict (feature, day) do update set calls = public.google_calls.calls + 1, updated_at = now();
  return jsonb_build_object(
    'allowed', true,
    'day', v_day_used + 1, 'day_cap', v_day_cap, 'month', v_month_used + 1, 'month_cap', v_month_cap
  );
end;
$$;

revoke all on function public.google_hard_ceiling(text) from public, anon, authenticated;
revoke all on function public.google_take(text, integer, integer) from public, anon, authenticated;
grant execute on function public.google_hard_ceiling(text) to service_role;
grant execute on function public.google_take(text, integer, integer) to service_role;

-- 2. Google pins: 30 days at most, never a saved place ---------------------------------------
create table public.google_pins (
  google_place_id text primary key,
  lat             double precision not null,
  lng             double precision not null,
  address         text,
  short_address   text,
  district        text,
  fetched_at      timestamptz not null default now()
);
create index google_pins_point_idx on public.google_pins (lat, lng);
comment on table public.google_pins is
  'Place Details (Essentials) answers by Google place id: coordinates and address, deleted 30 days after fetched_at.';
alter table public.google_pins enable row level security;

alter table public.task_stops
  add column google_place_id   text,
  add column google_fetched_at timestamptz;
comment on column public.task_stops.google_place_id is
  'The stop is a Google place: its coordinates, address and name are Google''s, removed 30 days after google_fetched_at (the id stays).';
alter table public.tasks
  add column start_google_place_id   text,
  add column start_google_fetched_at timestamptz;
comment on column public.tasks.start_google_place_id is
  'The start is a Google place: its coordinates and name are removed 30 days after start_google_fetched_at (the id stays).';

-- A stop (a start) whose coordinates are a Google pin's is marked with the pin's id and fetch
-- time, whichever path wrote it (create, change stops, book, redecide); any other pin unmarks it.
create function public.task_stops_google_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin public.google_pins%rowtype;
begin
  if new.lat is null or new.lng is null then
    new.google_fetched_at := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    return new;
  end if;
  select * into v_pin from public.google_pins p where p.lat = new.lat and p.lng = new.lng order by p.fetched_at desc limit 1;
  if found then
    new.google_place_id := v_pin.google_place_id;
    new.google_fetched_at := v_pin.fetched_at;
  else
    new.google_place_id := null;
    new.google_fetched_at := null;
  end if;
  return new;
end;
$$;
create trigger task_stops_google_mark before insert or update of lat, lng on public.task_stops
  for each row execute function public.task_stops_google_mark();

create function public.tasks_start_google_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin public.google_pins%rowtype;
begin
  if new.start_lat is null or new.start_lng is null then
    new.start_google_fetched_at := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.start_lat is not distinct from old.start_lat and new.start_lng is not distinct from old.start_lng then
    return new;
  end if;
  select * into v_pin from public.google_pins p where p.lat = new.start_lat and p.lng = new.start_lng order by p.fetched_at desc limit 1;
  if found then
    new.start_google_place_id := v_pin.google_place_id;
    new.start_google_fetched_at := v_pin.fetched_at;
  else
    new.start_google_place_id := null;
    new.start_google_fetched_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_start_google_mark before insert or update of start_lat, start_lng on public.tasks
  for each row execute function public.tasks_start_google_mark();

revoke all on function public.task_stops_google_mark() from public, anon, authenticated;
revoke all on function public.tasks_start_google_mark() from public, anon, authenticated;

-- 3. The 30-day clean-up ---------------------------------------------------------------------
create function public.prune_google_content(p_days integer default 30)
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
  with gone as (delete from public.google_pins where fetched_at < v_cut returning 1)
  select count(*) into v_pins from gone;
  -- The stop keeps its place id, type, times and what the office wrote (the note, the task's title).
  with cleared as (
    update public.task_stops
       set lat = null, lng = null, address = null, place_name = 'Google place (details removed after 30 days)',
           google_fetched_at = null
     where google_fetched_at < v_cut
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
revoke all on function public.prune_google_content(integer) from public, anon, authenticated;
grant execute on function public.prune_google_content(integer) to service_role;

-- fleet-jobs fetches again the pins of stops still to be driven (counted Place Details calls),
-- then runs prune_google_content(): every night at 03:30 Colombo.
select cron.schedule('google-content', '0 22 * * *', $$select public.call_edge_function('fleet-jobs', '{"job": "google_content"}'::jsonb)$$);

-- 4. "Used before" never offers a Google stop (its details are Google's, for 30 days at most) --
create or replace function public.recent_places(p_text text, p_since timestamptz, p_limit integer default 5)
returns table (name text, address text, lat double precision, lng double precision, last_used timestamptz, uses bigint)
language sql
stable
set search_path = public, extensions
as $$
  with q as (select replace(replace(replace(lower(trim(p_text)), '\', '\\'), '%', '\%'), '_', '\_') as e),
  used as (
    select s.place_name as name, s.address, s.lat, s.lng, t.start_at as at
    from public.task_stops s join public.tasks t on t.id = s.task_id, q
    where s.place_id is null and s.google_place_id is null and s.status <> 'removed' and t.start_at >= p_since
      and s.place_name ilike '%' || q.e || '%'
    union all
    select t.start_name, null, t.start_lat, t.start_lng, t.start_at
    from public.tasks t, q
    where t.start_place_id is null and t.start_google_place_id is null and t.start_name is not null and t.start_at >= p_since
      and t.start_name ilike '%' || q.e || '%'
    union all
    select r.route_from, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_from ilike '%' || q.e || '%'
    union all
    select r.route_to, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_to ilike '%' || q.e || '%'
  ),
  grouped as (
    select lower(trim(u.name)) as k,
           (array_agg(trim(u.name) order by (u.lat is null), u.at desc))[1] as name,
           (array_agg(u.address order by (u.address is null), u.at desc))[1] as address,
           (array_agg(u.lat order by (u.lat is null), u.at desc))[1] as lat,
           (array_agg(u.lng order by (u.lat is null), u.at desc))[1] as lng,
           max(u.at) as last_used,
           count(*) as uses
    from used u
    where trim(coalesce(u.name, '')) <> ''
    group by lower(trim(u.name))
  )
  select g.name, g.address, g.lat, g.lng, g.last_used, g.uses
  from grouped g, q
  -- not the name of one of our places (those show in the first layer)
  where not exists (select 1 from public.places p where lower(p.name) = g.k)
  order by (g.k like q.e || '%') desc, g.uses desc, g.last_used desc
  limit greatest(1, least(p_limit, 20))
$$;

-- 5. No Google road times were ever cached (no key was set); none will be (Routes terms 19.3).
delete from public.route_legs where provider = 'google';
