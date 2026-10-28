-- Round 48 snap hotfix (28 October 2026): one real two-hour test drive, watched live by two office viewers, consumed the
-- whole Google snap-to-roads day cap (215 calls + 10 refused). Every route poll that landed on a cold isolate snapped
-- the whole day again (the in-memory cache is per isolate), and a growing leg went out in whole 100-point chunks only.
-- Three things the database adds for the fix:
--   1. google_call_sources: the Google calls per day, feature and SOURCE (site_route, site_live, site_task, app_route,
--      app_live, app_task, claude, web; "_playback" for a past day), so the next anomaly reads at a glance
--      (routing_usage / get_settings answer them). google_take gains p_source; the 3-argument form stays for callers
--      that have none.
--   2. roads_day_calls + roads_trip_take: a per-driver-day budget of Roads calls (the setting roads_trip_daily_cap,
--      20 by default), taken BEFORE the fleet-wide counter: past it that driver's route shows the GPS line and one info
--      issue opens, instead of one trip eating the fleet's day cap.
--   3. Nothing of Google's geometry is stored (Sahan's decision at Checkpoint 48 stands): the shared cache stays in the
--      server's memory, short-lived.

create table public.google_call_sources (
  day         date not null,
  feature     text not null,
  source      text not null,
  calls       integer not null default 0,
  refused     integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (day, feature, source),
  constraint google_call_sources_feature_check
    check (feature in ('map_loads', 'places_autocomplete', 'places_details', 'routes', 'roads')),
  constraint google_call_sources_source_check check (source ~ '^[a-z_]{1,40}$')
);
comment on table public.google_call_sources is
  'Google calls per Asia/Colombo day, feature and source (which screen asked), recorded by google_take() beside google_calls; refused = turned away at a cap.';
alter table public.google_call_sources enable row level security;
revoke all on public.google_call_sources from public, anon, authenticated;
grant select, insert, update on public.google_call_sources to service_role;

create or replace function public.google_take(p_feature text, p_day_cap integer, p_month_cap integer, p_source text)
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
  v_source     text := nullif(regexp_replace(lower(coalesce(p_source, '')), '[^a-z_]', '', 'g'), '');
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
    if v_source is not null then
      insert into public.google_call_sources (day, feature, source, refused) values (v_day, p_feature, left(v_source, 40), 1)
        on conflict (day, feature, source) do update set refused = public.google_call_sources.refused + 1, updated_at = now();
    end if;
    return jsonb_build_object(
      'allowed', false,
      'reason', case when v_month_used >= v_month_cap then 'month' else 'day' end,
      'day', v_day_used, 'day_cap', v_day_cap, 'month', v_month_used, 'month_cap', v_month_cap
    );
  end if;
  insert into public.google_calls (feature, day, calls) values (p_feature, v_day, 1)
    on conflict (feature, day) do update set calls = public.google_calls.calls + 1, updated_at = now();
  if v_source is not null then
    insert into public.google_call_sources (day, feature, source, calls) values (v_day, p_feature, left(v_source, 40), 1)
      on conflict (day, feature, source) do update set calls = public.google_call_sources.calls + 1, updated_at = now();
  end if;
  return jsonb_build_object(
    'allowed', true,
    'day', v_day_used + 1, 'day_cap', v_day_cap, 'month', v_month_used + 1, 'month_cap', v_month_cap
  );
end;
$$;

-- The 3-argument form (every caller before this round): the same counter, no source.
create or replace function public.google_take(p_feature text, p_day_cap integer, p_month_cap integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.google_take(p_feature, p_day_cap, p_month_cap, null);
$$;

revoke all on function public.google_take(text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.google_take(text, integer, integer) from public, anon, authenticated;
grant execute on function public.google_take(text, integer, integer, text) to service_role;
grant execute on function public.google_take(text, integer, integer) to service_role;

-- 2. The per-driver-day budget of Roads calls ----------------------------------------------------------------------
create table public.roads_day_calls (
  day          date not null,
  employee_id  uuid not null references public.employees (id),
  calls        integer not null default 0,
  refused      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (day, employee_id)
);
comment on table public.roads_day_calls is
  'Google Roads (snap to roads) calls per driver and Asia/Colombo day, taken by roads_trip_take() before the fleet counter; past the setting roads_trip_daily_cap the driver''s route shows the GPS line.';
alter table public.roads_day_calls enable row level security;
revoke all on public.roads_day_calls from public, anon, authenticated;
grant select, insert, update on public.roads_day_calls to service_role;

create function public.roads_trip_take(p_employee uuid, p_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   date := (now() at time zone 'Asia/Colombo')::date;
  v_cap   integer := greatest(0, coalesce(p_cap, 0));
  v_used  integer;
begin
  if p_employee is null then
    raise exception 'roads_trip_take: no driver';
  end if;
  perform pg_advisory_xact_lock(hashtext('roads_trip_take:' || p_employee::text));
  select coalesce(c.calls, 0) into v_used from public.roads_day_calls c where c.day = v_day and c.employee_id = p_employee;
  v_used := coalesce(v_used, 0);
  if v_used >= v_cap then
    insert into public.roads_day_calls (day, employee_id, refused) values (v_day, p_employee, 1)
      on conflict (day, employee_id) do update set refused = public.roads_day_calls.refused + 1, updated_at = now();
    return jsonb_build_object('allowed', false, 'reason', 'trip', 'used', v_used, 'cap', v_cap, 'day', v_day);
  end if;
  insert into public.roads_day_calls (day, employee_id, calls) values (v_day, p_employee, 1)
    on conflict (day, employee_id) do update set calls = public.roads_day_calls.calls + 1, updated_at = now();
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'cap', v_cap, 'day', v_day);
end;
$$;
revoke all on function public.roads_trip_take(uuid, integer) from public, anon, authenticated;
grant execute on function public.roads_trip_take(uuid, integer) to service_role;

-- Both tables are a few rows a day; they join the counters' retention rule (counters_days) in a later round.
