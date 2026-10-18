-- Phase 7, Hotfix 3 (docs/phase7-plan.md "Hotfix 3"; Sahan, 18 October): no endless lists anywhere. A task never started
-- whose leave-by passed over a day ago is missed (it leaves the boards and needs-a-driver; History shows it); an issue can
-- be snoozed; each office person's page preferences (the Overview's collapsed sections, the menu's) are kept on the server.

-- L2. Missed tasks --------------------------------------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('assigned', 'in_progress', 'completed', 'cancelled', 'declined', 'missed'));
alter table public.tasks add column missed_at timestamptz;
comment on column public.tasks.missed_at is
  'When the system marked the task missed (assigned or declined, never started, its leave-by over 24 hours ago). A start '
  'the phone sends later (queued offline) un-misses it.';

-- The driver's own status changes: as in 20261016090000_phase7_dispatch.sql, and a missed task may still be started.
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

  -- Hotfix 3 (L2): a start the phone sends late (queued offline) un-misses a task marked missed meanwhile.
  elsif old.status in ('assigned', 'missed') and new.status = 'in_progress' then
    new.missed_at := null;
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

-- Marks missed every task never started whose leave-by passed over 24 hours ago (the issue sync calls it, fleet-jobs every
-- 5 minutes). No push: the driver's app stops listing it. Answers the tasks marked.
create function public.mark_missed_tasks()
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.tasks
  set status = 'missed', missed_at = now(), needs_driver_since = null, needs_driver_reason = null
  where status in ('assigned', 'declined')
    and coalesce(leave_by, start_at) < now() - interval '24 hours'
    -- A task the custodian drives (an office person, no app) is missed the same way.
  returning id
$$;
revoke all on function public.mark_missed_tasks() from public, anon, authenticated;
grant execute on function public.mark_missed_tasks() to service_role;

-- L2. Snooze ----------------------------------------------------------------------------------------------------------------
alter table public.issues
  add column snoozed_until timestamptz,
  add column snoozed_by text;
comment on column public.issues.snoozed_until is
  'Snoozed (update_issue snooze: until 07:00 tomorrow, or a week): left out of the Overview and the counts until then.';

-- L1, L5. Each office person's page preferences ------------------------------------------------------------------------------
create table public.office_prefs (
  employee_id uuid primary key references public.employees (id),
  prefs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.office_prefs enable row level security;
comment on table public.office_prefs is
  'An office person''s page preferences (the Overview''s collapsed sections, the menu''s): my_prefs / set_my_prefs. '
  'Service role only.';

-- L2. A missed task is the dispatcher's too (as in 20261016090000_phase7_dispatch.sql, with missed_task).
create or replace function public.issue_visible(p_kind text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.office_can('issues'))
      or (p_kind in ('signal', 'late_start', 'running_late', 'not_accepted', 'declined',
                     'vehicle_conflict', 'arrival_override', 'completed_early', 'vehicle_needed', 'missed_task')
          and (select public.office_can('assign_tasks')))
$$;

-- L2. A missed task and the driver's own calls: accept and decline answer "cancelled" (the app drops it; no needs-a-driver
-- for an old task, no push), and a vehicle confirmed offline for it still counts (its queued start un-misses it).
-- As in 20261016090000_phase7_dispatch.sql (decline_task), 20261014120000_task_accept_decline.sql (accept_task) and
-- 20261018150000_phase7_hotfix2.sql (confirm_task_vehicle), with the missed status.
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
  -- Hotfix 3: a missed task is gone for the driver too (an answer the app already knows).
  if v_task.status = 'missed' then return 'cancelled'; end if;

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

create or replace function public.accept_task(p_task_id uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_at   timestamptz := least(coalesce(p_at, now()), now());
begin
  if v_me is null then
    raise exception 'Not signed in as a driver' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.employee_id <> v_me then
    return 'already_reassigned';
  end if;
  if v_task.status in ('in_progress', 'completed') then return 'already_started'; end if;
  if v_task.status = 'declined' then return 'already_declined'; end if;
  if v_task.status = 'cancelled' then return 'cancelled'; end if;
  -- Hotfix 3: a missed task is gone for the driver too (an answer the app already knows).
  if v_task.status = 'missed' then return 'cancelled'; end if;

  -- The earliest acceptance wins: a replay of the same tap changes nothing.
  if v_task.accepted_at is null or v_at < v_task.accepted_at then
    update public.tasks set accepted_at = v_at where id = p_task_id;
  end if;
  if v_task.accepted_at is null then
    insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor)
    select p_task_id, v_at, 'accepted', v_me, v_task.vehicle_id, e.name from public.employees e where e.id = v_me;
  end if;
  return 'accepted';
end;
$$;

create or replace function public.confirm_task_vehicle(p_task uuid, p_vehicle uuid, p_queued boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_employee_id();
  v_task  public.tasks%rowtype;
  v_car   public.vehicles%rowtype;
  v_issue text;
  v_name  text;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or v_me is null or v_task.employee_id <> v_me then
    return 'not_yours';
  end if;
  -- Hotfix 3: a missed task may still be started (a start queued offline), so its vehicle is still confirmed.
  if v_task.status not in ('assigned', 'declined', 'missed') then
    return 'started';
  end if;
  select * into v_car from public.vehicles where id = p_vehicle;
  if not found then
    return 'inactive';
  end if;
  v_issue := case
    when v_task.vehicle_mode = 'specific' and v_task.vehicle_id is not null and v_task.vehicle_id <> p_vehicle then 'has_vehicle'
    when not v_car.active then 'inactive'
    when v_car.in_garage then 'in_garage'
    when v_task.vehicle_mode = 'any_type' and v_car.vehicle_type is distinct from v_task.vehicle_type_wanted then 'wrong_type'
  end;
  if v_issue is not null and not p_queued then
    return v_issue;
  end if;
  if v_issue is not null then
    select name into v_name from public.employees where id = v_me;
    update public.tasks
    set vehicle_id = p_vehicle,
        warnings = coalesce(warnings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'text', 'Started offline on ' || v_car.reg_no || case v_issue
            when 'has_vehicle' then ', not the vehicle the office set meanwhile'
            when 'inactive' then ', a vehicle no longer in the fleet list'
            when 'in_garage' then ', a vehicle in the garage'
            else ', not a ' || replace(coalesce(v_task.vehicle_type_wanted, 'vehicle'), '_', ' ') || ' as the task asked'
          end,
          'by', coalesce(v_name, 'the driver')))
    where id = p_task;
    return 'ok';
  end if;
  update public.tasks set vehicle_id = p_vehicle where id = p_task;
  return 'ok';
end;
$$;
