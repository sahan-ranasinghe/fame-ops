-- Phase 7, Part 3: tasks go to the fleet admin first (item 29, §33) and requests get the full planner (item 30, §34).
-- docs/phase7-plan.md §33–§35.
--
-- A request now carries a whole trip, in the model a task uses: its stops (request_stops, the same planning columns as
-- task_stops), where it starts, the plan and its times. A task proposed by someone without the approve permission is a
-- request too (kind 'task'), with the proposed driver and vehicle; no task row exists until it is approved, so the driver
-- sees nothing until then. Google's 30-day rule covers a request's stops and start as it covers a task's. The approvers
-- are pushed once when a waiting request is 30 minutes from its leave-by (and the person who asked), and once when the
-- leave-by passes undecided; nothing is ever sent to a driver by itself.

-- 1. The trip on a request ---------------------------------------------------------------------
alter table public.vehicle_requests
  add column kind text not null default 'request',
  add column proposed_employee_id uuid references public.employees (id),
  add column proposed_vehicle_id uuid references public.vehicles (id),
  add column title text,
  add column label text,
  add column contact_name text,
  add column contact_phone text,
  -- The proposed task's notes for the driver (the request's own `note` is for the fleet admin).
  add column task_notes text,
  -- The proposed task's project split: [{project_id, percent}] and the words shown.
  add column projects_json jsonb,
  add column start_place_id uuid references public.places (id),
  add column start_name text,
  add column start_lat double precision,
  add column start_lng double precision,
  add column start_google_place_id text,
  add column start_google_fetched_at timestamptz,
  add column return_to_base boolean not null default false,
  add column avoid_expressway boolean not null default false,
  add column leave_by timestamptz,
  add column leave_by_source text,
  add column buffer_min integer,
  add column plan_json jsonb,
  -- What the proposer saw when proposing: the warnings, the conflicts, the vehicle used and why.
  add column proposal_json jsonb,
  add column decide_reminder_sent_at timestamptz,
  add column late_push_sent_at timestamptz,
  -- When the asker last changed the trip itself (update_request): an approved booking's task takes the stops again
  -- only when this is after the decision (a one-step booking writes its trip after its own approval).
  add column trip_edited_at timestamptz;

alter table public.vehicle_requests
  add constraint vehicle_requests_kind_check check (kind in ('request', 'task')),
  add constraint vehicle_requests_proposed_check check (kind = 'request' or proposed_employee_id is not null),
  add constraint vehicle_requests_leave_by_source_check check (leave_by_source is null or leave_by_source in ('plan', 'manual')),
  add constraint vehicle_requests_buffer_check check (buffer_min is null or buffer_min between 0 and 240),
  add constraint vehicle_requests_start_lat_lng_together check ((start_lat is null) = (start_lng is null));

create index vehicle_requests_waiting_idx on public.vehicle_requests (needed_at) where status = 'waiting';

create table public.request_stops (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.vehicle_requests (id) on delete cascade,
  seq               integer not null check (seq >= 1),
  type              text not null check (type in ('pickup', 'drop', 'visit')),
  what              text check (what is null or what in ('people', 'goods', 'documents', 'other')),
  place_id          uuid references public.places (id),
  place_name        text not null check (btrim(place_name) <> ''),
  address           text,
  lat               double precision check (lat between -90 and 90),
  lng               double precision check (lng between -180 and 180),
  dwell_min         integer check (dwell_min is null or dwell_min between 0 and 1440),
  arrive_by         timestamptz,
  note              text,
  planned_arrive_at timestamptz,
  planned_depart_at timestamptz,
  is_start          boolean not null default false,
  dwell_source      text check (dwell_source is null or dwell_source in ('chosen', 'place', 'default')),
  google_place_id   text,
  google_fetched_at timestamptz,
  created_at        timestamptz not null default now(),
  -- An edit of the request marks its old stops removed and adds the new ones: nothing is deleted.
  removed_at        timestamptz,
  constraint request_stops_lat_lng_together check ((lat is null) = (lng is null))
);
create unique index request_stops_seq_key on public.request_stops (request_id, seq) where removed_at is null;
comment on table public.request_stops is
  'A request''s stops (Phase 7 §34): the planning columns of task_stops. Copied into task_stops when approved; an edit '
  'marks the old ones removed. Service role only.';

-- Service role only, as vehicle_requests: the office reads them through the tools.
alter table public.request_stops enable row level security;
revoke all on public.request_stops from anon, authenticated;

-- 2. Google's 30-day rule on a request's stops and start (the triggers of the tasks) -------------
create trigger request_stops_google_mark
  before insert or update of lat, lng on public.request_stops
  for each row execute function public.task_stops_google_mark();

create trigger vehicle_requests_start_google_mark
  before insert or update of start_lat, start_lng on public.vehicle_requests
  for each row execute function public.tasks_start_google_mark();

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
  with cleared as (
    update public.vehicle_requests r
       set plan_json = (r.plan_json - 'line_fetched_at')
                       || jsonb_build_object('legs', coalesce((select jsonb_agg(l - 'line' order by n)
                                                                from jsonb_array_elements(r.plan_json -> 'legs') with ordinality as x(l, n)), '[]'::jsonb))
     where r.plan_json ? 'line_fetched_at' and (r.plan_json ->> 'line_fetched_at')::timestamptz < v_cut
    returning 1
  ) select count(*) into v_rlines from cleared;
  return jsonb_build_object('pins', v_pins, 'stops', v_stops, 'starts', v_starts, 'matched', v_matched, 'lines', v_lines + v_rlines,
                            'request_stops', v_rstops, 'request_starts', v_rstarts);
end;
$$;
revoke all on function public.prune_google_content(integer) from public, anon, authenticated;

-- 3. Not decided 30 minutes before the leave-by; the leave-by passed (§33, §35 16 and 18) ----------
create function public.approve_recipients()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.employees
  where active
    and role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
    and 'approve' = any(permissions)
$$;
revoke all on function public.approve_recipients() from public, anon, authenticated;

create function public.queue_request_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_n        integer := 0;
  v_what     text;
  v_when     text;
  v_approve  uuid[] := public.approve_recipients();
begin
  -- 30 minutes before the leave-by, once: the approvers and the person who asked.
  for r in
    update public.vehicle_requests q
       set decide_reminder_sent_at = now()
     where q.status = 'waiting' and q.decide_reminder_sent_at is null
       and q.needed_at > now() and q.needed_at <= now() + interval '30 minutes'
    returning q.*
  loop
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') else 'Vehicle request · ' || r.requested_by_name end;
    v_when := to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'HH24:MI');
    perform public.queue_notification('request.not_decided',
      jsonb_build_object('title', 'Not decided yet: ' || v_what || ' leaves ' || v_when,
                         'body', case when r.kind = 'task' then 'Proposed by ' || r.requested_by_name else coalesce(r.route_from || ' → ' || r.route_to, '') end,
                         'url', '/requests/' || r.id::text || '/decide', 'tag', 'request:' || r.id::text, 'request_id', r.id),
      array(select x from unnest(v_approve) x where x is distinct from r.requested_by_employee_id));
    if r.requested_by_employee_id is not null then
      perform public.queue_notification('request.not_decided',
        jsonb_build_object('title', 'Not decided yet: ' || v_what || ' leaves ' || v_when,
                           'body', 'The fleet admin has been reminded.',
                           'url', '/requests/' || r.id::text, 'tag', 'request:' || r.id::text, 'request_id', r.id),
        array[r.requested_by_employee_id]);
    end if;
    v_n := v_n + 1;
  end loop;

  -- The leave-by passed undecided, once: the approvers. It stays in the queue, never sent by itself.
  for r in
    update public.vehicle_requests q
       set late_push_sent_at = now()
     where q.status = 'waiting' and q.late_push_sent_at is null
       and q.needed_at <= now() and q.needed_at > now() - interval '2 hours'
    returning q.*
  loop
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') else 'Vehicle request · ' || r.requested_by_name end;
    perform public.queue_notification('request.late',
      jsonb_build_object('title', 'Leave-by passed, not decided: ' || v_what,
                         'body', 'It was to leave at ' || to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'HH24:MI') ||
                                 '. It stays waiting until someone decides it.',
                         'url', '/requests/' || r.id::text || '/decide', 'tag', 'request:' || r.id::text, 'request_id', r.id),
      v_approve);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.queue_request_reminders() from public, anon, authenticated;

-- Requests already waiting when this arrives: no burst of reminders for what is already close or past.
update public.vehicle_requests
   set decide_reminder_sent_at = case when needed_at <= now() + interval '30 minutes' then now() end,
       late_push_sent_at = case when needed_at <= now() then now() end
 where status = 'waiting' and needed_at <= now() + interval '30 minutes';

select cron.schedule('request-reminders', '* * * * *', $$select public.queue_request_reminders()$$);
