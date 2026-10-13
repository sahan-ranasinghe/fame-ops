-- =============================================================================
-- Stops and the leave-by time (Phase 5, part 4; docs/dispatch-plan.md 3.2).
--
--   task_stops   what is picked up or dropped, a note for the driver, the dwell,
--                an arrive-by deadline, the planned times, the skip reason; a
--                stop the office edits out is marked 'removed' (never deleted)
--   tasks        the start place, return to base, no expressway, the leave-by
--                time and where it came from (plan | manual), the buffer, the
--                plan itself (plan_json), the reminder marks, the plan version
--   fleet_settings  dwell times, buffer, base place, estimate speed, the
--                accept windows, the rush-hour bands (docs section 6)
--   route_legs   the routing cache (30 days); routing_calls the daily counts
--   task_eta     the live ETA of a running task, recomputed at most every 2 min
--   task-reminders  a pg_cron minute job: push "Leave by" 30 minutes before
--                leave_by and at leave_by, once each (the reminder columns)
--   office_update_task_stops  replaces the pending stops of a task in one
--                transaction with a version check; office_create_task learns
--                the new fields
-- =============================================================================

-- 1. Stops -------------------------------------------------------------------
alter table public.task_stops
  add column what              text,
  add column note              text,
  add column dwell_min         integer,
  add column arrive_by         timestamptz,
  add column planned_arrive_at timestamptz,
  add column planned_depart_at timestamptz,
  add column skip_reason       text,
  add column skip_note         text,
  add column removed_at        timestamptz,
  add constraint task_stops_what_check check (what is null or what in ('people', 'goods', 'documents', 'other')),
  add constraint task_stops_dwell_check check (dwell_min is null or dwell_min between 0 and 1440),
  add constraint task_stops_skip_reason_check
    check (skip_reason is null or skip_reason in ('closed', 'nobody_there', 'not_needed', 'not_visited', 'other'));

alter table public.task_stops drop constraint task_stops_status_check;
alter table public.task_stops add constraint task_stops_status_check
  check (status in ('pending', 'arrived', 'done', 'skipped', 'removed'));

comment on column public.task_stops.status is
  'pending, arrived, done, skipped (by the driver, with skip_reason), removed (edited out by the office; kept for history, shown nowhere)';

-- Drivers mark stops: arrived, done, skipped with a reason. Never removed.
grant update (status, arrived_at, done_at, skip_reason, skip_note) on public.task_stops to authenticated;

drop policy task_stops_update_own_in_progress on public.task_stops;
create policy task_stops_update_own_in_progress on public.task_stops
  for update to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_stops.task_id
        and t.employee_id = (select public.current_employee_id())
        and t.status = 'in_progress'
    )
  )
  with check (
    status <> 'removed'
    and exists (
      select 1 from public.tasks t
      where t.id = task_stops.task_id
        and t.employee_id = (select public.current_employee_id())
        and t.status = 'in_progress'
    )
  );

-- 2. Tasks -------------------------------------------------------------------
alter table public.tasks
  add column start_place_id      uuid references public.places (id),
  add column start_name          text,
  add column start_lat           double precision,
  add column start_lng           double precision,
  add column return_to_base      boolean not null default false,
  add column avoid_expressway    boolean not null default false,
  add column leave_by            timestamptz,
  add column leave_by_source     text,
  add column buffer_min          integer,
  add column plan_json           jsonb,
  add column reminder_30_sent_at timestamptz,
  add column reminder_0_sent_at  timestamptz,
  add column plan_version        integer not null default 0,
  add constraint tasks_leave_by_source_check check (leave_by_source is null or leave_by_source in ('plan', 'manual')),
  add constraint tasks_start_lat_lng_together check ((start_lat is null) = (start_lng is null)),
  add constraint tasks_buffer_check check (buffer_min is null or buffer_min between 0 and 600);

comment on column public.tasks.leave_by is 'When the driver must leave; start_at equals it. plan = computed from the stops'' arrive-by times, manual = typed by the dispatcher.';
comment on column public.tasks.plan_json is 'The plan: legs (km, minutes, source ors|google|estimate, via_expressway, factor), planned times, warnings, settings used, computed_at.';

create index tasks_leave_by_idx on public.tasks (leave_by) where status = 'assigned';

-- A changed plan (stops edited) is pushed to the driver as "Task changed".
create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The driver's own app (seen, started, completed) never pushes.
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
    perform public.send_push(new.id, 'removed', old.employee_id);
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.send_push(new.id, 'cancelled', new.employee_id);
  elsif new.status in ('assigned', 'in_progress')
    and (new.start_at, new.end_by, new.vehicle_id, new.title, new.plan_version)
        is distinct from (old.start_at, old.end_by, old.vehicle_id, old.title, old.plan_version) then
    perform public.send_push(new.id, 'changed', new.employee_id);
  end if;
  return null;
end;
$$;

-- 3. Fleet settings -----------------------------------------------------------
create table public.fleet_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.fleet_settings enable row level security;
revoke all on public.fleet_settings from public, anon, authenticated;

insert into public.fleet_settings (key, value) values
  ('dwell_min', '{"pickup.people": 10, "pickup.goods": 15, "drop.people": 5, "drop.goods": 15, "visit": 60, "documents": 10, "default": 10}'),
  ('buffer_min', '15'),
  ('base_place_id', 'null'),   -- an admin picks the real head office in Settings; never seeded
  ('avg_speed_kmh', '35'),
  ('road_factor', '1.3'),
  ('accept_within_min', '30'),
  ('accept_before_leave_min', '60'),
  ('rush_hour', '{"factor": 1.3, "centre": {"lat": 6.9344, "lng": 79.8428}, "radius_km": 25, "bands": [{"days": [1, 2, 3, 4, 5], "from": "07:00", "to": "09:30"}, {"days": [1, 2, 3, 4, 5], "from": "16:30", "to": "19:00"}]}');

-- 4. Routing cache, daily counts, live ETAs -----------------------------------
create table public.route_legs (
  id               bigint generated always as identity primary key,
  from_lat         numeric(7, 3) not null,
  from_lng         numeric(7, 3) not null,
  to_lat           numeric(7, 3) not null,
  to_lng           numeric(7, 3) not null,
  avoid_expressway boolean not null,
  provider         text not null check (provider in ('ors', 'google', 'estimate')),
  km               real not null,
  minutes          real not null,
  via_expressway   boolean,
  computed_at      timestamptz not null default now(),
  constraint route_legs_key unique (from_lat, from_lng, to_lat, to_lng, avoid_expressway, provider)
);

create table public.routing_calls (
  day      date not null,
  provider text not null,
  calls    integer not null default 0,
  errors   integer not null default 0,
  primary key (day, provider)
);

create function public.bump_routing_calls(p_provider text, p_ok boolean)
returns void
language sql
set search_path = ''
as $$
  insert into public.routing_calls (day, provider, calls, errors)
  values ((now() at time zone 'Asia/Colombo')::date, p_provider, 1, case when p_ok then 0 else 1 end)
  on conflict (day, provider) do update
    set calls = public.routing_calls.calls + 1,
        errors = public.routing_calls.errors + case when p_ok then 0 else 1 end;
$$;

create table public.task_eta (
  task_id      uuid primary key references public.tasks (id),
  computed_at  timestamptz not null,
  next_seq     integer,
  next_eta_at  timestamptz,
  final_eta_at timestamptz,
  late_min     integer,
  source       text
);

alter table public.route_legs    enable row level security;
alter table public.routing_calls enable row level security;
alter table public.task_eta      enable row level security;
revoke all on public.route_legs, public.routing_calls, public.task_eta from public, anon, authenticated;
revoke all on function public.bump_routing_calls(text, boolean) from public, anon, authenticated;
grant execute on function public.bump_routing_calls(text, boolean) to service_role;

-- 5. Leave-by reminders -------------------------------------------------------
alter table public.push_log drop constraint push_log_kind_check;
alter table public.push_log add constraint push_log_kind_check
  check (kind in ('new', 'changed', 'cancelled', 'removed', 'leave_30', 'leave_now', 'accept_reminder'));

-- Every minute: "Leave by HH:MM" 30 minutes before leave_by, "Time to leave" at
-- leave_by, once each (the reminder columns are set in the same statement). A
-- task whose leave_by passed over two hours ago is marked, not pushed.
create function public.queue_task_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  record;
  v_count integer := 0;
begin
  for v_task in
    update public.tasks t
    set reminder_30_sent_at = now()
    where t.status = 'assigned' and t.leave_by is not null and t.reminder_30_sent_at is null
      and t.leave_by <= now() + interval '30 minutes' and t.leave_by > now()
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'leave_30', v_task.employee_id);
    v_count := v_count + 1;
  end loop;

  for v_task in
    update public.tasks t
    set reminder_0_sent_at = now(), reminder_30_sent_at = coalesce(t.reminder_30_sent_at, now())
    where t.status = 'assigned' and t.leave_by is not null and t.reminder_0_sent_at is null and t.leave_by <= now()
    returning t.id, t.employee_id, (t.leave_by > now() - interval '2 hours') as fresh
  loop
    if v_task.fresh then
      perform public.send_push(v_task.id, 'leave_now', v_task.employee_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.queue_task_reminders() from public, anon, authenticated;
select cron.schedule('task-reminders', '* * * * *', $$select public.queue_task_reminders()$$);

-- 6. The office writes a task with its plan, and replaces the pending stops ----
create or replace function public.office_create_task(
  p_task       jsonb,
  p_stops      jsonb,
  p_projects   jsonb default '[]'::jsonb,
  p_request_id uuid default null,
  p_decided_by text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_status  text;
begin
  if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops) = 0 then
    raise exception 'A task needs at least one stop';
  end if;

  if p_request_id is not null then
    select r.status into v_status
    from public.vehicle_requests r
    where r.id = p_request_id
    for update;

    if not found then
      raise exception 'Vehicle request % was not found', p_request_id;
    end if;
    if v_status <> 'waiting' then
      raise exception 'This vehicle request is already %', v_status;
    end if;
  end if;

  insert into public.tasks
    (title, label, employee_id, vehicle_id, start_at, end_by, passengers,
     contact_name, contact_phone, notes, request_id, created_by,
     start_place_id, start_name, start_lat, start_lng, return_to_base, avoid_expressway,
     leave_by, leave_by_source, buffer_min, plan_json)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by,
         t.start_place_id, t.start_name, t.start_lat, t.start_lng,
         coalesce(t.return_to_base, false), coalesce(t.avoid_expressway, false),
         t.leave_by, t.leave_by_source, t.buffer_min, t.plan_json
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text,
    start_place_id uuid, start_name text, start_lat double precision, start_lng double precision,
    return_to_base boolean, avoid_expressway boolean,
    leave_by timestamptz, leave_by_source text, buffer_min integer, plan_json jsonb)
  returning id into v_task_id;

  insert into public.task_stops
    (task_id, seq, type, place_id, place_name, address, lat, lng, what, note, dwell_min, arrive_by, planned_arrive_at, planned_depart_at)
  select v_task_id, s.seq, s.type, s.place_id, s.place_name, s.address, s.lat, s.lng,
         s.what, s.note, s.dwell_min, s.arrive_by, s.planned_arrive_at, s.planned_depart_at
  from jsonb_to_recordset(p_stops) as s(
    seq integer, type text, place_id uuid, place_name text, address text,
    lat double precision, lng double precision, what text, note text, dwell_min integer,
    arrive_by timestamptz, planned_arrive_at timestamptz, planned_depart_at timestamptz);

  insert into public.task_projects (task_id, project_id, percent)
  select v_task_id, p.project_id, p.percent
  from jsonb_to_recordset(coalesce(p_projects, '[]'::jsonb)) as p(project_id uuid, percent numeric);

  if p_request_id is not null then
    update public.vehicle_requests
    set status     = 'approved',
        decided_at = now(),
        decided_by = p_decided_by,
        task_id    = v_task_id
    where id = p_request_id;
  end if;

  return v_task_id;
end;
$$;

-- Replaces the pending stops of a task (the arrived, done and skipped ones stay),
-- marks the old pending ones removed, writes the new plan, bumps plan_version.
-- Refuses when the version the office loaded is not the current one.
create function public.office_update_task_stops(
  p_task_id uuid,
  p_version integer,
  p_task    jsonb,
  p_stops   jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_version integer;
  v_next    integer;
begin
  update public.tasks t
  set plan_version     = t.plan_version + 1,
      start_place_id   = coalesce((p_task ->> 'start_place_id')::uuid, t.start_place_id),
      start_name       = coalesce(p_task ->> 'start_name', t.start_name),
      start_lat        = case when p_task ? 'start_lat' then (p_task ->> 'start_lat')::double precision else t.start_lat end,
      start_lng        = case when p_task ? 'start_lng' then (p_task ->> 'start_lng')::double precision else t.start_lng end,
      return_to_base   = coalesce((p_task ->> 'return_to_base')::boolean, t.return_to_base),
      avoid_expressway = coalesce((p_task ->> 'avoid_expressway')::boolean, t.avoid_expressway),
      leave_by         = coalesce((p_task ->> 'leave_by')::timestamptz, t.leave_by),
      leave_by_source  = coalesce(p_task ->> 'leave_by_source', t.leave_by_source),
      start_at         = coalesce((p_task ->> 'start_at')::timestamptz, t.start_at),
      end_by           = case when p_task ? 'end_by' then (p_task ->> 'end_by')::timestamptz else t.end_by end,
      buffer_min       = coalesce((p_task ->> 'buffer_min')::integer, t.buffer_min),
      plan_json        = coalesce(p_task -> 'plan_json', t.plan_json)
  where t.id = p_task_id and t.plan_version = p_version and t.status in ('assigned', 'in_progress')
  returning t.plan_version into v_version;

  if v_version is null then
    raise exception 'This task changed since it was loaded (or it is finished): reload it and try again'
      using errcode = 'P0001';
  end if;

  update public.task_stops
  set status = 'removed', removed_at = now()
  where task_id = p_task_id and status = 'pending';

  select coalesce(max(seq), 0) into v_next from public.task_stops where task_id = p_task_id;

  insert into public.task_stops
    (task_id, seq, type, place_id, place_name, address, lat, lng, what, note, dwell_min, arrive_by, planned_arrive_at, planned_depart_at)
  select p_task_id, v_next + e.ord, e.elem ->> 'type', (e.elem ->> 'place_id')::uuid, e.elem ->> 'place_name', e.elem ->> 'address',
         (e.elem ->> 'lat')::double precision, (e.elem ->> 'lng')::double precision, e.elem ->> 'what', e.elem ->> 'note',
         (e.elem ->> 'dwell_min')::integer, (e.elem ->> 'arrive_by')::timestamptz,
         (e.elem ->> 'planned_arrive_at')::timestamptz, (e.elem ->> 'planned_depart_at')::timestamptz
  from jsonb_array_elements(p_stops) with ordinality as e(elem, ord);

  return v_version;
end;
$$;

revoke all on function public.office_update_task_stops(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.office_update_task_stops(uuid, integer, jsonb, jsonb) to service_role;
