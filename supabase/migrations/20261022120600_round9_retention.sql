-- Round 4–7, item 9 (Sahan, 22 October 2026): data retention (Slack / Google Workspace / Samsara retention policies). One
-- nightly job (fleet-jobs "retention", 02:45 Colombo) removes what is past its period, in batches (no long locks), and
-- writes ONE activity-log row per run. Each period is an admin setting (Settings → Data retention; `retention` in
-- fleet_settings, minimums that cannot be lowered: GPS 30 days, activity-log changes 6 months). Business records are NEVER
-- removed automatically: tasks, stops, requests, odometer and fuel logs, their photos, vehicle reports, documents,
-- employees, vehicles, places, projects, duty sessions. retention_batch knows only the tables below.
--   - location points 6 months, each driver's day kept forever as a summary (driver_day_summaries: km, driving and stopped
--     time, stops, first and last point); a point goes only once its day has its summary.
--   - notifications read 30 days / unread 90; delivery records 14; the activity log's routine entries 30 days, changes 2
--     years; resolved and dismissed issues 12 months (their events with them); heartbeats and the usage counters 90 days;
--     app errors 90 days (as before).
-- It replaces the old nightly prunes of points, heartbeats and route matches (prune-location-points), the inbox
-- (prune-office-inbox) and app errors (prune-app-errors). The Google content and cache rules (30 days, Google's terms) and
-- the fuel videos' (fuel_video_keep_months) stay as they are.

create table public.driver_day_summaries (
  employee_id  uuid not null references public.employees (id),
  day          date not null,
  km           numeric(8, 1) not null default 0,
  driving_min  integer not null default 0,
  stopped_min  integer not null default 0,
  stops        integer not null default 0,
  first_at     timestamptz,
  last_at      timestamptz,
  points       integer not null default 0,
  computed_at  timestamptz not null default now(),
  primary key (employee_id, day)
);
comment on table public.driver_day_summaries is
  'Round 4–7 (item 9): a driver''s day from the location points (the route builder''s rules), kept forever; the points go after 6 months.';
alter table public.driver_day_summaries enable row level security;
-- The office reads through the tools (service role).

-- The driver-days to summarise before their points may go: yesterday's again (late uploads), then every older day with
-- points and no summary, the oldest first after yesterday.
create function public.days_without_summary(p_before timestamptz, p_limit integer)
returns table (employee_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select distinct p.employee_id, (p.recorded_at at time zone 'Asia/Colombo')::date as day
    from public.location_points p
    where p.recorded_at < p_before
  )
  select d.employee_id, d.day
  from days d
  where d.day = (p_before at time zone 'Asia/Colombo')::date - 1
     or not exists (select 1 from public.driver_day_summaries s where s.employee_id = d.employee_id and s.day = d.day)
  order by (d.day = (p_before at time zone 'Asia/Colombo')::date - 1) desc, d.day
  limit greatest(1, least(coalesce(p_limit, 300), 5000))
$$;
revoke all on function public.days_without_summary(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.days_without_summary(timestamptz, integer) to service_role;

-- The run's activity-log row is the system's.
alter table public.office_audit drop constraint office_audit_channel_check;
alter table public.office_audit add constraint office_audit_channel_check check (channel in ('claude', 'web', 'driver', 'system'));

-- One batch of one rule: removes up to p_limit rows older than p_before (or, dry, counts them all). p_tools: the activity
-- log's routine tools (reads and the routine writes). Only these tables, only these conditions.
create function public.retention_batch(p_rule text, p_before timestamptz, p_limit integer, p_dry boolean, p_tools text[] default '{}')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_where text;
  v_n     integer;
begin
  select r.t, r.w into v_table, v_where
  from (values
    ('inbox_read', 'office_inbox', 'read_at is not null and created_at < $1'),
    ('inbox_unread', 'office_inbox', 'read_at is null and created_at < $1'),
    ('delivery', 'notifications', 'created_at < $1'),
    ('push_log', 'push_log', 'created_at < $1'),
    ('audit_routine', 'office_audit', 'at < $1 and tool = any($2)'),
    ('audit_changes', 'office_audit', 'at < $1 and not (tool = any($2))'),
    ('issue_events', 'issue_events',
       'issue_id in (select i.id from public.issues i where i.status in (''resolved'', ''dismissed'') and i.resolved_at < $1)'),
    ('issues_resolved', 'issues',
       'status in (''resolved'', ''dismissed'') and resolved_at < $1 '
       'and not exists (select 1 from public.issue_events e where e.issue_id = issues.id)'),
    ('location_points', 'location_points',
       'recorded_at < $1 and exists (select 1 from public.driver_day_summaries d where d.employee_id = location_points.employee_id '
       'and d.day = (location_points.recorded_at at time zone ''Asia/Colombo'')::date)'),
    ('heartbeats', 'driver_heartbeats', 'at < $1'),
    ('google_calls', 'google_calls', 'day < ($1 at time zone ''Asia/Colombo'')::date'),
    ('routing_calls', 'routing_calls', 'day < ($1 at time zone ''Asia/Colombo'')::date'),
    ('api_minute_calls', 'api_minute_calls', 'minute < $1'),
    ('app_errors', 'app_errors', 'received_at < $1')
  ) as r(k, t, w)
  where r.k = p_rule;
  if v_table is null then
    raise exception 'retention_batch: no rule %', p_rule;
  end if;
  if p_dry then
    execute format('select count(*)::integer from public.%I where %s', v_table, v_where) into v_n using p_before, p_tools;
  else
    execute format(
      'with gone as (delete from public.%I where ctid = any(array(select ctid from public.%I where %s limit %s)) returning 1) '
      'select count(*)::integer from gone',
      v_table, v_table, v_where, greatest(1, least(coalesce(p_limit, 5000), 20000)))
    into v_n using p_before, p_tools;
  end if;
  return v_n;
end;
$$;
revoke all on function public.retention_batch(text, timestamptz, integer, boolean, text[]) from public, anon, authenticated;
grant execute on function public.retention_batch(text, timestamptz, integer, boolean, text[]) to service_role;

-- The old nightly prunes give way to the one job (its periods are the settings'); route matches keep their 90 days in it.
select cron.unschedule('prune-location-points');
select cron.unschedule('prune-office-inbox');
select cron.unschedule('prune-app-errors');
select cron.schedule('retention', '15 21 * * *', $$select public.call_edge_function('fleet-jobs', '{"job": "retention"}'::jsonb)$$);
