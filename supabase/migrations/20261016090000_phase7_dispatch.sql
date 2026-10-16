-- =============================================================================
-- Phase 7, Part 2 (16 October 2026, docs/phase7-plan.md §2 addition, §3, §11, §12, §17, §19): dispatch.
--
--   1. Any permission implies view (§12): every office person with a permission and no view gets it.
--   2. The time at each stop (§17): task_stops.dwell_source, places.usual_dwell_min (the last time
--      used there), the request's from/to times; the setting's defaults pickup 5, drop 5, visit 60.
--   3. Passengers get in at the start (§11): task_stops.is_start, arrived at Start task.
--   4. A different vehicle and the warnings approved past (§3, §17): tasks.vehicle_choice, tasks.warnings.
--   5. Needs a driver (§19): who assigned the task, needs_driver_since / reason, the accept window
--      (15 min after sending or 30 min before the start, the reminder at 5), the pushes to the
--      dispatchers, the assigner and the requester, the issue's "notified" line.
--   6. A vehicle swap during a task (§2 addition): task_vehicle_segments, task km = the sum of the
--      segments, the office's swap with the readings typed or asked from the phone, "I need another
--      vehicle" on a breakdown or accident report.
--   7. From the Part 2 go: earlier days close silently at the cut-off; an app restart after an update
--      or a new install is not an app stop.
-- =============================================================================

-- 1. Any permission implies view ------------------------------------------------------------------
update public.employees
set permissions = array_append(permissions, 'view')
where cardinality(permissions) > 0 and not ('view' = any(permissions));

-- 2. The time at each stop --------------------------------------------------------------------------
alter table public.task_stops
  add column dwell_source text,
  add constraint task_stops_dwell_source_check check (dwell_source is null or dwell_source in ('chosen', 'place', 'default'));
comment on column public.task_stops.dwell_source is
  'Where the time at the stop came from: chosen (typed or picked), place (the place''s usual time), default (the setting by type).';

alter table public.places
  add column usual_dwell_min integer,
  add column usual_dwell_at timestamptz,
  add constraint places_usual_dwell_check check (usual_dwell_min is null or usual_dwell_min between 0 and 1440);
comment on column public.places.usual_dwell_min is 'The time last used at this place (a stop saved with a chosen or usual time): offered first.';

create function public.task_stops_usual_dwell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.place_id is not null and new.dwell_min is not null and new.dwell_source in ('chosen', 'place') and new.status <> 'removed' then
    update public.places set usual_dwell_min = new.dwell_min, usual_dwell_at = now() where id = new.place_id;
  end if;
  return null;
end;
$$;
revoke all on function public.task_stops_usual_dwell() from public, anon, authenticated;

create trigger task_stops_usual_dwell
  after insert or update of dwell_min, place_id on public.task_stops
  for each row execute function public.task_stops_usual_dwell();

alter table public.vehicle_requests
  add column from_dwell_min integer,
  add column to_dwell_min integer,
  add constraint vehicle_requests_dwell_check
    check ((from_dwell_min is null or from_dwell_min between 0 and 1440) and (to_dwell_min is null or to_dwell_min between 0 and 1440));

-- The defaults Sahan set (16 October): pickup and drop 5 minutes, a visit 1 hour.
update public.fleet_settings
set value = '{"pickup": 5, "drop": 5, "visit": 60, "default": 5}'::jsonb, updated_at = now(), updated_by = 'Phase 7 migration'
where key = 'dwell_min';

-- 3. Passengers get in at the start -------------------------------------------------------------------
alter table public.task_stops add column is_start boolean not null default false;
comment on column public.task_stops.is_start is
  'The pickup at the start ("Passengers get in here"): Stop 1, no leg to it; marked arrived when the task starts.';

create function public.tasks_start_stop_arrived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'in_progress' and old.status = 'assigned' then
    update public.task_stops
    set status = 'arrived', arrived_at = coalesce(new.started_at, now()), arrival_flag = 'ok', arrival_distance_m = 0
    where task_id = new.id and is_start and status = 'pending';
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_start_stop_arrived() from public, anon, authenticated;

create trigger tasks_start_stop_arrived
  after update of status on public.tasks
  for each row execute function public.tasks_start_stop_arrived();

-- 4 and 5. The task's new columns -------------------------------------------------------------------
alter table public.tasks
  add column vehicle_choice jsonb,
  add column warnings jsonb,
  add column assigned_by_employee_id uuid references public.employees (id),
  add column needs_driver_since timestamptz,
  add column needs_driver_reason text,
  add constraint tasks_needs_driver_reason_check check (needs_driver_reason is null or needs_driver_reason in ('declined', 'not_accepted'));
comment on column public.tasks.vehicle_choice is
  'When the office picked another vehicle than the default: {default_vehicle_id, default_reg_no, why, chosen_vehicle_id, chosen_reg_no, by, at}.';
comment on column public.tasks.warnings is 'The warnings the office saved the task past: [{text, by, at}].';
comment on column public.tasks.needs_driver_since is
  'Declined, or not accepted within the accept window: the task needs a driver (cleared by reassign, accept or cancel).';

-- The task is saved with the new columns, its stops with is_start and dwell_source (one transaction).
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
     leave_by, leave_by_source, buffer_min, plan_json,
     vehicle_choice, warnings, assigned_by_employee_id)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by,
         t.start_place_id, t.start_name, t.start_lat, t.start_lng,
         coalesce(t.return_to_base, false), coalesce(t.avoid_expressway, false),
         t.leave_by, t.leave_by_source, t.buffer_min, t.plan_json,
         t.vehicle_choice, t.warnings, t.assigned_by_employee_id
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text,
    start_place_id uuid, start_name text, start_lat double precision, start_lng double precision,
    return_to_base boolean, avoid_expressway boolean,
    leave_by timestamptz, leave_by_source text, buffer_min integer, plan_json jsonb,
    vehicle_choice jsonb, warnings jsonb, assigned_by_employee_id uuid)
  returning id into v_task_id;

  insert into public.task_stops
    (task_id, seq, type, place_id, place_name, address, lat, lng, what, note, dwell_min, arrive_by, planned_arrive_at, planned_depart_at,
     is_start, dwell_source)
  select v_task_id, s.seq, s.type, s.place_id, s.place_name, s.address, s.lat, s.lng,
         s.what, s.note, s.dwell_min, s.arrive_by, s.planned_arrive_at, s.planned_depart_at,
         coalesce(s.is_start, false), s.dwell_source
  from jsonb_to_recordset(p_stops) as s(
    seq integer, type text, place_id uuid, place_name text, address text,
    lat double precision, lng double precision, what text, note text, dwell_min integer,
    arrive_by timestamptz, planned_arrive_at timestamptz, planned_depart_at timestamptz,
    is_start boolean, dwell_source text);

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

create or replace function public.office_update_task_stops(
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
      plan_json        = coalesce(p_task -> 'plan_json', t.plan_json),
      warnings         = case when p_task ? 'warnings' then p_task -> 'warnings' else t.warnings end
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
    (task_id, seq, type, place_id, place_name, address, lat, lng, what, note, dwell_min, arrive_by, planned_arrive_at, planned_depart_at,
     is_start, dwell_source)
  select p_task_id, v_next + e.ord, e.elem ->> 'type', (e.elem ->> 'place_id')::uuid, e.elem ->> 'place_name', e.elem ->> 'address',
         (e.elem ->> 'lat')::double precision, (e.elem ->> 'lng')::double precision, e.elem ->> 'what', e.elem ->> 'note',
         (e.elem ->> 'dwell_min')::integer, (e.elem ->> 'arrive_by')::timestamptz,
         (e.elem ->> 'planned_arrive_at')::timestamptz, (e.elem ->> 'planned_depart_at')::timestamptz,
         coalesce((e.elem ->> 'is_start')::boolean, false), e.elem ->> 'dwell_source'
  from jsonb_array_elements(p_stops) with ordinality as e(elem, ord);

  return v_version;
end;
$$;

-- 5. Needs a driver --------------------------------------------------------------------------------------
-- Who hears that a task needs a driver: the dispatchers (approve or assign_tasks), the person who assigned it,
-- and (on their own link) the requester. One push each; the dispatcher link opens the task's change page.
create function public.notify_needs_driver(p_task uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task      record;
  v_dispatch  uuid[];
  v_requester uuid;
begin
  select t.id, t.assigned_by_employee_id, r.id as request_id, r.requested_by_employee_id
  into v_task
  from public.tasks t left join public.vehicle_requests r on r.id = t.request_id
  where t.id = p_task;
  v_dispatch := public.dispatch_recipients();
  if v_task.assigned_by_employee_id is not null and not (v_task.assigned_by_employee_id = any(v_dispatch))
     and exists (select 1 from public.employees e where e.id = v_task.assigned_by_employee_id and e.active) then
    v_dispatch := v_dispatch || v_task.assigned_by_employee_id;
  end if;
  -- The change page needs assign_tasks; someone who only approves opens the Overview's Needs a driver block.
  perform public.queue_notification(
    (select case when needs_driver_reason = 'not_accepted' then 'task.not_accepted' else 'task.declined' end from public.tasks where id = p_task),
    jsonb_build_object('title', p_title, 'body', p_body, 'url', '/tasks/' || p_task::text || '/edit?driver=1',
                       'tag', 'needs-driver:' || p_task::text, 'task_id', p_task),
    array(select e.id from public.employees e where e.id = any(v_dispatch) and 'assign_tasks' = any(e.permissions)));
  perform public.queue_notification(
    (select case when needs_driver_reason = 'not_accepted' then 'task.not_accepted' else 'task.declined' end from public.tasks where id = p_task),
    jsonb_build_object('title', p_title, 'body', p_body, 'url', '/',
                       'tag', 'needs-driver:' || p_task::text, 'task_id', p_task),
    array(select e.id from public.employees e where e.id = any(v_dispatch) and not ('assign_tasks' = any(e.permissions))));
  v_requester := v_task.requested_by_employee_id;
  if v_requester is not null and not (v_requester = any(v_dispatch)) then
    perform public.queue_notification(
      (select case when needs_driver_reason = 'not_accepted' then 'task.not_accepted' else 'task.declined' end from public.tasks where id = p_task),
      jsonb_build_object('title', p_title, 'body', p_body, 'url', '/requests/' || v_task.request_id::text,
                         'tag', 'needs-driver:' || p_task::text, 'task_id', p_task),
      array[v_requester]);
  end if;
end;
$$;
revoke all on function public.notify_needs_driver(uuid, text, text) from public, anon, authenticated;

-- "Kamal declined 'Team drop · Kurunegala' 09:00" / "Vehicle problem · needs a driver"
create or replace function public.decline_task(p_task_id uuid, p_reason text, p_note text default null, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_at   timestamptz := least(coalesce(p_at, now()), now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
  v_reason_text text;
begin
  if v_me is null then
    raise exception 'Not signed in as a driver' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('vehicle_problem', 'not_available', 'unwell', 'other') then
    raise exception 'reason must be vehicle_problem, not_available, unwell or other' using errcode = '22023';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.employee_id <> v_me then
    return 'already_reassigned';
  end if;
  if v_task.status in ('in_progress', 'completed') then return 'already_started'; end if;
  if v_task.status = 'declined' then return 'already_declined'; end if;
  if v_task.status = 'cancelled' then return 'cancelled'; end if;

  update public.tasks
  set status = 'declined',
      declined_at = v_at,
      declined_by = v_me,
      declined_reason = p_reason,
      declined_note = v_note,
      declined_after_accept = (v_task.accepted_at is not null),
      needs_driver_since = v_at,
      needs_driver_reason = 'declined'
  where id = p_task_id;
  select e.name into v_name from public.employees e where e.id = v_me;
  insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor, note)
  values (p_task_id, v_at, 'declined', v_me, v_task.vehicle_id, v_name,
          p_reason || case when v_note is null then '' else ': ' || v_note end);

  v_reason_text := case p_reason
    when 'vehicle_problem' then 'Vehicle problem'
    when 'not_available' then 'Not available'
    when 'unwell' then 'Unwell'
    else 'Other' end || case when v_note is null then '' else ': ' || v_note end;
  perform public.notify_needs_driver(
    p_task_id,
    split_part(coalesce(v_name, 'The driver'), ' ', 1) || ' declined ''' || v_task.title || ''' '
      || to_char(coalesce(v_task.leave_by, v_task.start_at) at time zone 'Asia/Colombo', 'HH24:MI'),
    v_reason_text || ' · needs a driver');
  return 'declined';
end;
$$;

-- The accept window: one reminder to the driver 5 minutes after sending; at 15 minutes after sending or 30
-- before the start (whichever comes first) the task needs a driver and the office hears it at once.
create or replace function public.queue_accept_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remind integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_reminder_min'), 5);
  v_within integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_within_min'), 15);
  v_before integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_before_leave_min'), 30);
  v_task   record;
  v_count  integer := 0;
begin
  for v_task in
    update public.tasks t
    set accept_reminder_sent_at = now()
    where t.status = 'assigned'
      and t.accepted_at is null
      and t.accept_reminder_sent_at is null
      and coalesce(t.leave_by, t.start_at) > now()
      and t.sent_at + make_interval(mins => v_remind) < now()
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'accept_reminder', v_task.employee_id);
    v_count := v_count + 1;
  end loop;

  for v_task in
    update public.tasks t
    set needs_driver_since = now(), needs_driver_reason = 'not_accepted'
    where t.status = 'assigned'
      and t.accepted_at is null
      and t.needs_driver_since is null
      -- Today's and later tasks only (the list the office sees): no burst of pushes for old unaccepted tasks.
      and coalesce(t.leave_by, t.start_at) >= (date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')
      and (t.sent_at + make_interval(mins => v_within) < now()
           or coalesce(t.leave_by, t.start_at) - make_interval(mins => v_before) < now())
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id, t.title, coalesce(t.leave_by, t.start_at) as leave_at
  loop
    perform public.notify_needs_driver(
      v_task.id,
      split_part(coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver'), ' ', 1)
        || ' hasn''t accepted ''' || v_task.title || ''' ' || to_char(v_task.leave_at at time zone 'Asia/Colombo', 'HH24:MI'),
      'needs a driver');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Accepting late, a reassignment (another driver, or back to the same one: the task is sent again) and a cancel clear it.
create function public.tasks_needs_driver_clear()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.needs_driver_since is not null and new.needs_driver_since is not distinct from old.needs_driver_since and (
       (new.accepted_at is not null and old.accepted_at is null)
       or new.employee_id <> old.employee_id
       or (old.status = 'declined' and new.status = 'assigned')
       or new.sent_at is distinct from old.sent_at
       or new.status in ('cancelled', 'in_progress', 'completed')) then
    new.needs_driver_since := null;
    new.needs_driver_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_needs_driver_clear() from public, anon, authenticated;

create trigger tasks_needs_driver_clear
  before update on public.tasks
  for each row execute function public.tasks_needs_driver_clear();

-- The accept window Sahan set (15 October): 15 minutes after sending, or 30 before the start (the rows say 30 and 60).
update public.fleet_settings set value = '15'::jsonb, updated_at = now(), updated_by = 'Phase 7 migration' where key = 'accept_within_min';
update public.fleet_settings set value = '30'::jsonb, updated_at = now(), updated_by = 'Phase 7 migration' where key = 'accept_before_leave_min';

-- The issue's history says who was told and when.
alter table public.issue_events drop constraint issue_events_action_check;
alter table public.issue_events add constraint issue_events_action_check
  check (action in ('opened', 'assigned', 'note', 'status', 'auto_resolved', 'notified'));

-- 6. A vehicle swap during a task ------------------------------------------------------------------
create table public.task_vehicle_segments (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks (id),
  seq               integer not null,
  vehicle_id        uuid not null references public.vehicles (id),
  start_odometer_km integer,
  end_odometer_km   integer,
  from_at           timestamptz not null,
  to_at             timestamptz,
  reason            text,
  by_name           text,
  created_at        timestamptz not null default now(),
  constraint task_vehicle_segments_seq_key unique (task_id, seq),
  constraint task_vehicle_segments_km_check check (
    start_odometer_km is null or end_odometer_km is null or end_odometer_km >= start_odometer_km)
);
comment on table public.task_vehicle_segments is
  'A task driven with more than one vehicle (a swap after a breakdown): each vehicle''s stretch and its readings. Task km = the sum.';
create index task_vehicle_segments_vehicle_idx on public.task_vehicle_segments (vehicle_id, from_at);

alter table public.task_vehicle_segments enable row level security;
grant select on public.task_vehicle_segments to authenticated;
-- The driver reads the segments of their own tasks (the phone asks for the swap's readings); the office reads
-- them through the tools.
create policy task_vehicle_segments_select_own on public.task_vehicle_segments
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_vehicle_segments.task_id
                 and t.employee_id = (select public.current_employee_id())));

-- Task km: the sum of the segments when there are any, else end − start (as before; the column stops being
-- generated and is kept by a trigger).
alter table public.tasks alter column km drop expression;
-- After a swap the end reading is the new vehicle's (it may be lower than the first vehicle's start): the rule is now on
-- the km themselves (the stretches have their own end ≥ start check).
alter table public.tasks drop constraint tasks_km_not_negative;
alter table public.tasks add constraint tasks_km_not_negative check (km is null or km >= 0);

create function public.task_km(p_task uuid, p_start integer, p_end integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.task_vehicle_segments s where s.task_id = p_task)
      then (select case when bool_and(s.start_odometer_km is not null and s.end_odometer_km is not null)
                        then sum(s.end_odometer_km - s.start_odometer_km)::integer end
            from public.task_vehicle_segments s where s.task_id = p_task)
    else p_end - p_start
  end
$$;
revoke all on function public.task_km(uuid, integer, integer) from public, anon, authenticated;

create function public.tasks_set_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The last segment ends with the task's own end reading (a reopen clears it again). The segments' own
  -- trigger is told not to write the task back: this row is being written now.
  if tg_op = 'UPDATE' and new.end_odometer_km is distinct from old.end_odometer_km then
    perform set_config('fleet.setting_km', 'on', true);
    update public.task_vehicle_segments s
    set end_odometer_km = new.end_odometer_km,
        to_at = case when new.end_odometer_km is null then null else coalesce(new.completed_at, now()) end
    where s.task_id = new.id and s.seq = (select max(x.seq) from public.task_vehicle_segments x where x.task_id = new.id)
      and s.vehicle_id = new.vehicle_id;
    perform set_config('fleet.setting_km', 'off', true);
  end if;
  new.km := public.task_km(new.id, new.start_odometer_km, new.end_odometer_km);
  return new;
end;
$$;
revoke all on function public.tasks_set_km() from public, anon, authenticated;

create trigger tasks_set_km
  before insert or update of start_odometer_km, end_odometer_km on public.tasks
  for each row execute function public.tasks_set_km();

-- A segment's readings change → the task's km follows.
create function public.task_vehicle_segments_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fleet.setting_km', true), '') = 'on' then
    return null;
  end if;
  update public.tasks t set km = public.task_km(t.id, t.start_odometer_km, t.end_odometer_km) where t.id = new.task_id;
  return null;
end;
$$;
revoke all on function public.task_vehicle_segments_km() from public, anon, authenticated;

create trigger task_vehicle_segments_km
  after insert or update on public.task_vehicle_segments
  for each row execute function public.task_vehicle_segments_km();

-- The swap's readings come as odometer logs with the task: the old vehicle's task_end, the new one's
-- task_start (from the phone's photo flow, or typed by the office, entry 'office').
alter table public.odometer_logs drop constraint odometer_logs_entry_check;
alter table public.odometer_logs add constraint odometer_logs_entry_check
  check (entry in ('photo', 'photo_changed', 'typed_unreadable', 'typed_offline', 'office'));

create function public.odometer_logs_swap_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is null or new.kind not in ('task_start', 'task_end') then
    return null;
  end if;
  -- Only a reading of the task's own driver fills its stretches.
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.employee_id = new.employee_id) then
    return null;
  end if;
  if new.kind = 'task_end' then
    update public.task_vehicle_segments s
    set end_odometer_km = new.reading_km
    where s.task_id = new.task_id and s.vehicle_id = new.vehicle_id and s.to_at is not null and s.end_odometer_km is null;
  else
    update public.task_vehicle_segments s
    set start_odometer_km = new.reading_km
    where s.task_id = new.task_id and s.vehicle_id = new.vehicle_id and s.seq > 1 and s.start_odometer_km is null;
  end if;
  return null;
end;
$$;
revoke all on function public.odometer_logs_swap_reading() from public, anon, authenticated;

create trigger odometer_logs_swap_reading
  after insert on public.odometer_logs
  for each row execute function public.odometer_logs_swap_reading();

-- Completing a swapped task: the end reading is the new vehicle's, so it is checked against that vehicle's
-- start (the first segment's start stays the task's start_odometer_km).
create or replace function public.tasks_driver_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_start integer;
  v_segments   integer;
begin
  -- The office connector (service_role) and SQL run by an admin are not
  -- restricted here.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- seen_at is recorded once, the first time the task is shown, and never
  -- later than now.
  if old.seen_at is not null then
    new.seen_at := old.seen_at;
  elsif new.seen_at is not null then
    new.seen_at := least(new.seen_at, now());
  end if;

  if new.status = old.status then
    if (new.started_at, new.completed_at, new.start_odometer_km, new.end_odometer_km)
       is distinct from
       (old.started_at, old.completed_at, old.start_odometer_km, old.end_odometer_km) then
      raise exception 'Times and odometer readings are set only when starting or completing a task';
    end if;

  elsif old.status = 'assigned' and new.status = 'in_progress' then
    if new.start_odometer_km is null then
      raise exception 'Start odometer is required to start a task';
    end if;
    if new.completed_at is not null or new.end_odometer_km is not null then
      raise exception 'A task cannot be started and completed in one step';
    end if;
    -- The phone may send its own time (a start saved while offline); never
    -- later than now.
    new.started_at := least(coalesce(new.started_at, now()), now());
    -- Starting counts as accepting (the driver may never have tapped Accept).
    new.accepted_at := coalesce(old.accepted_at, new.started_at);

  elsif old.status = 'in_progress' and new.status = 'completed' then
    if (new.started_at, new.start_odometer_km)
       is distinct from (old.started_at, old.start_odometer_km) then
      raise exception 'Start time and start odometer cannot change when completing a task';
    end if;
    if new.end_odometer_km is null then
      raise exception 'End odometer is required to complete a task';
    end if;
    -- After a swap, the end reading belongs to the last vehicle: checked against its own start, and not checked while
    -- that start is still to come (the office may type it later).
    select count(*)::integer, (array_agg(s.start_odometer_km order by s.seq desc))[1] into v_segments, v_last_start
    from public.task_vehicle_segments s where s.task_id = new.id;
    if v_segments = 0 and new.end_odometer_km < new.start_odometer_km then
      raise exception 'End odometer (%) is lower than start odometer (%)', new.end_odometer_km, new.start_odometer_km;
    elsif v_segments > 0 and v_last_start is not null and new.end_odometer_km < v_last_start then
      raise exception 'End odometer (%) is lower than start odometer (%)', new.end_odometer_km, v_last_start;
    end if;
    -- Kept between the start time and now.
    new.completed_at := greatest(least(coalesce(new.completed_at, now()), now()), new.started_at);

  else
    raise exception 'Drivers cannot change a task from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- The finish check reads the km driven (the segments' sum after a swap).
create or replace function public.tasks_finish_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The plan up to the last stop: a driver completes there, before any drive back to base (to_seq -1).
  v_plan_km  numeric := (select sum((l ->> 'km')::numeric) from jsonb_array_elements(coalesce(new.plan_json -> 'legs', '[]'::jsonb)) l
                         where coalesce((l ->> 'to_seq')::integer, 0) <> -1);
  v_plan_min numeric := (select sum((l ->> 'minutes')::numeric) from jsonb_array_elements(coalesce(new.plan_json -> 'legs', '[]'::jsonb)) l
                         where coalesce((l ->> 'to_seq')::integer, 0) <> -1);
  v_km       numeric;
  v_min      numeric;
  -- After a swap: a stretch whose start (or, before the last, end) reading is still owed leaves the km unknown.
  v_owed     boolean := exists (
    select 1 from public.task_vehicle_segments s
    where s.task_id = new.id
      and (s.start_odometer_km is null
           or (s.end_odometer_km is null and s.seq < (select max(x.seq) from public.task_vehicle_segments x where x.task_id = new.id))));
begin
  if new.status = 'completed' and old.status = 'in_progress' then
    new.finish_flag := null;
    if v_plan_km >= 3 and new.start_odometer_km is not null and new.end_odometer_km is not null and not v_owed
       and new.started_at is not null and new.completed_at is not null then
      v_km := coalesce(
        (select sum(coalesce(case when s.seq = (select max(x.seq) from public.task_vehicle_segments x where x.task_id = new.id)
                                  then new.end_odometer_km else s.end_odometer_km end, s.start_odometer_km) - s.start_odometer_km)
         from public.task_vehicle_segments s where s.task_id = new.id),
        new.end_odometer_km - new.start_odometer_km);
      v_min := extract(epoch from (new.completed_at - new.started_at)) / 60;
      if v_km < 0.7 * v_plan_km or (coalesce(v_plan_min, 0) > 0 and v_min < 0.5 * v_plan_min) then
        new.finish_flag := jsonb_build_object(
          'kind', 'completed_early',
          'odometer_km', v_km,
          'planned_km', round(v_plan_km, 1),
          'minutes', round(v_min),
          'planned_minutes', round(coalesce(v_plan_min, 0)));
      end if;
    end if;
  elsif new.status = 'in_progress' and old.status = 'completed' then
    new.finish_flag := null;
  end if;
  return new;
end;
$$;

-- The office's swap: the task moves to the new vehicle (the driver holds it, the old one is free) and keeps
-- both stretches; the readings are typed now or come from the phone. Answers {result: swapped | not_running |
-- same_vehicle | vehicle_on_task, segment}.
create function public.office_swap_vehicle(
  p_task      uuid,
  p_vehicle   uuid,
  p_by        text,
  p_old_end   integer default null,
  p_new_start integer default null,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_now  timestamptz := now();
  v_seq  integer;
  v_old  text;
  v_new  text;
begin
  select t.* into v_task from public.tasks t where t.id = p_task for update;
  if v_task.id is null or v_task.status <> 'in_progress' then
    return jsonb_build_object('result', 'not_running');
  end if;
  if v_task.vehicle_id = p_vehicle then
    return jsonb_build_object('result', 'same_vehicle');
  end if;
  if exists (select 1 from public.tasks t where t.vehicle_id = p_vehicle and t.status = 'in_progress' and t.id <> p_task) then
    return jsonb_build_object('result', 'vehicle_on_task');
  end if;
  if p_old_end is not null and p_old_end < coalesce(
       (select s.start_odometer_km from public.task_vehicle_segments s where s.task_id = p_task order by s.seq desc limit 1),
       v_task.start_odometer_km) then
    raise exception 'The old vehicle''s end reading (%) is below its start reading', p_old_end;
  end if;

  -- The first swap records the stretch so far as segment 1.
  if not exists (select 1 from public.task_vehicle_segments s where s.task_id = p_task) then
    insert into public.task_vehicle_segments (task_id, seq, vehicle_id, start_odometer_km, from_at, by_name)
    values (p_task, 1, v_task.vehicle_id, v_task.start_odometer_km, coalesce(v_task.started_at, v_now), 'driver');
  end if;
  update public.task_vehicle_segments s set to_at = v_now, reason = p_reason
  where s.task_id = p_task and s.to_at is null;
  select coalesce(max(seq), 0) + 1 into v_seq from public.task_vehicle_segments where task_id = p_task;
  insert into public.task_vehicle_segments (task_id, seq, vehicle_id, from_at, by_name)
  values (p_task, v_seq, p_vehicle, v_now, p_by);

  -- Readings typed by the office: logged like the phone's (the trigger fills the segments).
  if p_old_end is not null then
    insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, logged_at, entry)
    values (v_task.vehicle_id, v_task.employee_id, p_task, p_old_end, 'task_end', v_now, 'office');
  end if;
  if p_new_start is not null then
    insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, logged_at, entry)
    values (p_vehicle, v_task.employee_id, p_task, p_new_start, 'task_start', v_now, 'office');
  end if;

  update public.tasks set vehicle_id = p_vehicle where id = p_task;
  perform public.take_vehicle(v_task.employee_id, p_vehicle, 'office', v_now, coalesce(p_by, 'office'), p_task);
  select reg_no into v_old from public.vehicles where id = v_task.vehicle_id;
  select reg_no into v_new from public.vehicles where id = p_vehicle;
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note)
  values (p_task, 'changed', v_task.employee_id, p_vehicle, p_by,
          concat_ws(' · ', 'vehicle ' || v_old || ' → ' || v_new || ' (swap during the task)', p_reason));
  return jsonb_build_object('result', 'swapped', 'segment', v_seq, 'from', v_old, 'to', v_new,
                            'readings', case when p_old_end is not null and p_new_start is not null then 'typed' else 'from_the_phone' end);
end;
$$;
revoke all on function public.office_swap_vehicle(uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.office_swap_vehicle(uuid, uuid, text, integer, integer, text) to service_role;

-- A swap reading still owed, typed by the office afterwards (a towed vehicle; the phone never sent it): the old vehicle's
-- end (`end`) or the new vehicle's start (`start`), logged at the swap's own time so the vehicle's readings stay in order.
create function public.office_swap_reading(p_task uuid, p_vehicle uuid, p_kind text, p_km integer, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_seg  record;
  v_reg  text;
begin
  if p_kind is null or p_kind not in ('end', 'start') then
    raise exception 'kind must be end or start' using errcode = '22023';
  end if;
  select t.id, t.employee_id into v_task from public.tasks t where t.id = p_task;
  if v_task.id is null then
    return jsonb_build_object('result', 'no_task');
  end if;
  if p_kind = 'end' then
    select s.* into v_seg from public.task_vehicle_segments s
    where s.task_id = p_task and s.vehicle_id = p_vehicle and s.to_at is not null and s.end_odometer_km is null
    order by s.seq limit 1;
  else
    select s.* into v_seg from public.task_vehicle_segments s
    where s.task_id = p_task and s.vehicle_id = p_vehicle and s.seq > 1 and s.start_odometer_km is null
    order by s.seq limit 1;
  end if;
  if v_seg.id is null then
    return jsonb_build_object('result', 'not_owed');
  end if;
  if p_kind = 'end' and v_seg.start_odometer_km is not null and p_km < v_seg.start_odometer_km then
    return jsonb_build_object('result', 'below_start', 'start_km', v_seg.start_odometer_km);
  end if;
  insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, logged_at, entry)
  values (p_vehicle, v_task.employee_id, p_task, p_km, case p_kind when 'end' then 'task_end' else 'task_start' end,
          case p_kind when 'end' then v_seg.to_at else v_seg.from_at end, 'office');
  select reg_no into v_reg from public.vehicles where id = p_vehicle;
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note)
  values (p_task, 'changed', v_task.employee_id, p_vehicle, p_by,
          'odometer typed by the office: ' || v_reg || ' ' || case p_kind when 'end' then 'end' else 'start' end || ' ' || p_km || ' km');
  return jsonb_build_object('result', 'saved', 'task_km', (select km from public.tasks where id = p_task));
end;
$$;
revoke all on function public.office_swap_reading(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.office_swap_reading(uuid, uuid, text, integer, text) to service_role;

-- "I need another vehicle": on a breakdown or accident report during a task.
alter table public.vehicle_reports add column needs_vehicle boolean not null default false;
comment on column public.vehicle_reports.needs_vehicle is
  'The driver asked for another vehicle (a breakdown or accident during a task): a critical issue and a push to the fleet admins.';
grant insert (needs_vehicle) on public.vehicle_reports to authenticated;

create function public.vehicle_reports_need_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  record;
  v_plate text;
  v_name  text;
begin
  if not new.needs_vehicle then
    return null;
  end if;
  -- Only during the reporting driver's own running task (the issue is opened for the same).
  select t.id, t.title into v_task from public.tasks t
  where t.id = new.task_id and t.employee_id = new.employee_id and t.status = 'in_progress';
  if v_task.id is null then
    return null;
  end if;
  select v.reg_no into v_plate from public.vehicles v where v.id = new.vehicle_id;
  select e.name into v_name from public.employees e where e.id = new.employee_id;
  perform public.queue_notification(
    'task.vehicle_needed',
    jsonb_build_object(
      'title', 'Another vehicle needed · ' || coalesce(v_plate, 'a vehicle'),
      'body', coalesce(v_name, 'The driver') || ' · ' || initcap(replace(new.category, '_', ' '))
              || coalesce(' · ' || v_task.title, '') || coalesce(' · ' || new.note, ''),
      'url', case when v_task.id is not null then '/tasks/' || v_task.id::text else '/maintenance' end,
      'tag', 'vehicle-needed:' || new.id::text,
      'task_id', v_task.id),
    public.dispatch_recipients());
  return null;
end;
$$;
revoke all on function public.vehicle_reports_need_vehicle() from public, anon, authenticated;

create trigger vehicle_reports_need_vehicle
  after insert on public.vehicle_reports
  for each row execute function public.vehicle_reports_need_vehicle();

-- The new task kind is the dispatcher's too.
create or replace function public.issue_visible(p_kind text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.office_can('issues'))
      or (p_kind in ('signal', 'late_start', 'running_late', 'not_accepted', 'declined',
                     'vehicle_conflict', 'arrival_override', 'completed_early', 'vehicle_needed')
          and (select public.office_can('assign_tasks')))
$$;

-- 7. From the Part 2 go -------------------------------------------------------------------------------------
-- Earlier days close silently at their own day's cut-off (no push); "You were clocked out" only the same day.
create or replace function public.duty_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut     text := coalesce((select s.value #>> '{}' from public.fleet_settings s where s.key = 'duty_cutoff'), '21:00');
  v_today   date := (now() at time zone 'Asia/Colombo')::date;
  v_session record;
  v_end     timestamptz;
  v_out     integer := 0;
  v_silent  integer := 0;
  v_held    integer := 0;
  v_opened  integer := 0;
begin
  if v_cut ~ '^\d{2}:\d{2}$' then
    for v_session in
      select s.id, s.employee_id, s.started_at, public.duty_cutoff_after(s.started_at, v_cut) as cutoff_at
      from public.duty_sessions s
      where s.ended_at is null
        and public.duty_cutoff_after(s.started_at, v_cut) <= now()
        and not exists (select 1 from public.tasks t where t.employee_id = s.employee_id and t.status = 'in_progress')
    loop
      v_end := least(now(), greatest(
        v_session.cutoff_at,
        coalesce((select max(t.completed_at) from public.tasks t
                  where t.employee_id = v_session.employee_id and t.completed_at > v_session.started_at), v_session.started_at)));
      perform set_config('fleet.by', 'system', true);
      update public.duty_sessions set ended_at = v_end, end_reason = 'auto' where id = v_session.id;
      if (v_end at time zone 'Asia/Colombo')::date = v_today then
        perform public.send_push(null, 'duty_auto_out', v_session.employee_id,
                                 jsonb_build_object('time', to_char(v_end at time zone 'Asia/Colombo', 'HH24:MI')));
        v_out := v_out + 1;
      else
        v_silent := v_silent + 1;
      end if;
    end loop;

    for v_session in
      select a.employee_id, public.duty_cutoff_after(a.from_at, v_cut) as cutoff_at
      from public.vehicle_assignments a
      where a.to_at is null
        and public.duty_cutoff_after(a.from_at, v_cut) <= now()
        and not exists (select 1 from public.duty_sessions s where s.employee_id = a.employee_id and s.ended_at is null)
        and not exists (select 1 from public.tasks t where t.employee_id = a.employee_id and t.status = 'in_progress')
    loop
      perform public.release_vehicle(v_session.employee_id, v_session.cutoff_at, 'auto', 'system');
      v_held := v_held + 1;
    end loop;
  end if;

  insert into public.duty_sessions (employee_id, vehicle_id, started_at, device_info)
  select t.employee_id, t.vehicle_id, t.started_at, jsonb_build_object('opened_by', 'server', 'task_id', t.id)
  from public.tasks t
  join public.employees e on e.id = t.employee_id and e.role = 'driver'
  where t.status = 'in_progress'
    and t.started_at < now() - interval '5 minutes'
    and not exists (select 1 from public.duty_sessions s
                    where s.employee_id = t.employee_id and (s.ended_at is null or s.ended_at >= t.started_at));
  get diagnostics v_opened = row_count;

  return jsonb_build_object('clocked_out', v_out, 'closed_silently', v_silent, 'vehicles_released', v_held, 'sessions_opened', v_opened);
end;
$$;

-- An app restart after an update or a new install is not an app stop (the version or the update id differs on
-- the two sides of the gap). A sign-out and Finish work end the duty period, and gaps count inside one only.
create or replace function public.app_stops(p_from timestamptz, p_to timestamptz)
returns table (employee_id uuid, stops integer, last_stop_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.employee_id, count(*)::integer, max(x.at)
  from (
    select h.employee_id, h.at, h.app_version,
           lag(h.at) over w as prev_at,
           lag(h.app_version) over w as prev_version
    from public.driver_heartbeats h
    where h.at >= p_from and h.at < p_to and h.session_id is not null and h.sharing is not false
    window w as (partition by h.employee_id, h.session_id order by h.at)
  ) x
  where x.prev_at is not null and x.at - x.prev_at > interval '3 minutes'
    and x.app_version is not distinct from x.prev_version
  group by x.employee_id
$$;

-- The one-step booking keeps the request's times at From and To too.
create or replace function public.office_book_vehicle(
  p_request    jsonb,
  p_task       jsonb,
  p_stops      jsonb,
  p_projects   jsonb default '[]'::jsonb,
  p_decided_by text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_task_id    uuid;
begin
  insert into public.vehicle_requests
    (requested_by_name, requested_by_employee_id, requested_by_user_id, project_id, project_label,
     needed_at, back_by, route_from, route_to, need_type, pax, tools, note,
     driver_required, one_step, seen_at, seen_by, on_behalf_of, from_dwell_min, to_dwell_min)
  select r.requested_by_name, r.requested_by_employee_id, r.requested_by_user_id, r.project_id, r.project_label,
         r.needed_at, r.back_by, r.route_from, r.route_to, r.need_type, r.pax, coalesce(r.tools, false), r.note,
         coalesce(r.driver_required, true), true, now(), p_decided_by, r.on_behalf_of, r.from_dwell_min, r.to_dwell_min
  from jsonb_to_record(p_request) as r(
    requested_by_name text, requested_by_employee_id uuid, requested_by_user_id uuid, project_id uuid, project_label text,
    needed_at timestamptz, back_by timestamptz, route_from text, route_to text, need_type text, pax integer, tools boolean,
    note text, driver_required boolean, on_behalf_of text, from_dwell_min integer, to_dwell_min integer)
  returning id into v_request_id;

  v_task_id := public.office_create_task(p_task, p_stops, p_projects, v_request_id, p_decided_by);
  return jsonb_build_object('request_id', v_request_id, 'task_id', v_task_id);
end;
$$;

-- The driver's "Task changed" push names the stops that changed (Phase 7, §11: "Stop 2 added: Kurunegala site").
create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
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
