-- =============================================================================
-- Phase 5, Part 5: the driver accepts or declines a task (docs/dispatch-plan.md, 3.3)
--
--   tasks            status 'declined'; accepted_at, declined_at / by / reason /
--                    note, declined_after_accept, accept_reminder_sent_at
--   task_assignment_events   who had the task when: assigned, accepted, declined,
--                    reassigned, cancelled (drivers read their own tasks' rows)
--   accept_task / decline_task   the driver's RPCs (security definer; only the
--                    task's driver, only while assigned; idempotent answers)
--   tasks_driver_guard   starting a task counts as accepting it
--   tasks_notify_push    a declined task reassigned to a new driver pushes 'new'
--                    to him; the previous driver hears 'removed' only when he had
--                    accepted the task and did not decline it
--   queue_accept_reminders   with the task-reminders minute job: "Please accept
--                    your task" once, accept_within_min after it was sent or
--                    accept_before_leave_min before leave-by, whichever is first
-- =============================================================================

-- 1. tasks --------------------------------------------------------------------
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('assigned', 'in_progress', 'completed', 'cancelled', 'declined'));

alter table public.tasks
  add column accepted_at             timestamptz,
  add column declined_at             timestamptz,
  add column declined_by             uuid references public.employees (id),
  add column declined_reason         text
    constraint tasks_declined_reason_check check (declined_reason in ('vehicle_problem', 'not_available', 'unwell', 'other')),
  add column declined_note           text,
  add column declined_after_accept   boolean not null default false,
  add column accept_reminder_sent_at timestamptz;

create index tasks_declined_idx on public.tasks (declined_at) where status = 'declined';

-- 2. task_assignment_events ---------------------------------------------------
create table public.task_assignment_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id),
  at          timestamptz not null default now(),
  action      text not null check (action in ('assigned', 'accepted', 'declined', 'reassigned', 'cancelled')),
  employee_id uuid references public.employees (id),
  vehicle_id  uuid references public.vehicles (id),
  actor       text,
  note        text
);
create index task_assignment_events_task_idx on public.task_assignment_events (task_id, at);
create index task_assignment_events_employee_idx on public.task_assignment_events (employee_id, at);

alter table public.task_assignment_events enable row level security;
grant select on public.task_assignment_events to authenticated;
-- Drivers read the history of their own tasks; the office reads it through the tools.
create policy task_assignment_events_select_own on public.task_assignment_events
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_assignment_events.task_id
        and t.employee_id = (select public.current_employee_id())
    )
  );

-- A new task is an 'assigned' event (the office's name from created_by); a task the
-- driver starts without tapping Accept is accepted by starting it.
create function public.tasks_assignment_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor)
    values (new.id, new.sent_at, 'assigned', new.employee_id, new.vehicle_id, new.created_by);
  elsif old.status = 'assigned' and new.status = 'in_progress' and old.accepted_at is null then
    insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor, note)
    select new.id, coalesce(new.accepted_at, now()), 'accepted', new.employee_id, new.vehicle_id, e.name, 'by starting the task'
    from public.employees e where e.id = new.employee_id;
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_assignment_events() from public, anon, authenticated;
create trigger tasks_assignment_events
  after insert or update of status on public.tasks
  for each row execute function public.tasks_assignment_events();

-- 3. The driver's RPCs --------------------------------------------------------
-- 'accepted' | 'already_started' | 'already_reassigned' | 'already_declined' | 'cancelled'
create function public.accept_task(p_task_id uuid, p_at timestamptz default now())
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

-- 'declined' | 'already_started' | 'already_reassigned' | 'already_declined' | 'cancelled'
create function public.decline_task(p_task_id uuid, p_reason text, p_note text default null, p_at timestamptz default now())
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
      declined_after_accept = (v_task.accepted_at is not null)
  where id = p_task_id;
  insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor, note)
  select p_task_id, v_at, 'declined', v_me, v_task.vehicle_id, e.name,
         p_reason || case when v_note is null then '' else ': ' || v_note end
  from public.employees e where e.id = v_me;
  return 'declined';
end;
$$;

revoke all on function public.accept_task(uuid, timestamptz) from public, anon;
revoke all on function public.decline_task(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.accept_task(uuid, timestamptz) to authenticated;
grant execute on function public.decline_task(uuid, text, text, timestamptz) to authenticated;

-- 4. Starting a task accepts it -------------------------------------------------
create or replace function public.tasks_driver_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
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
    if new.end_odometer_km < new.start_odometer_km then
      raise exception 'End odometer (%) is lower than start odometer (%)',
        new.end_odometer_km, new.start_odometer_km;
    end if;
    -- Kept between the start time and now.
    new.completed_at := greatest(least(coalesce(new.completed_at, now()), now()), new.started_at);

  else
    raise exception 'Drivers cannot change a task from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- 5. Pushes ---------------------------------------------------------------------
create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    and (new.start_at, new.end_by, new.vehicle_id, new.title, new.plan_version)
        is distinct from (old.start_at, old.end_by, old.vehicle_id, old.title, old.plan_version) then
    perform public.send_push(new.id, 'changed', new.employee_id);
  end if;
  return null;
end;
$$;

-- 6. "Please accept your task" ----------------------------------------------------
create function public.queue_accept_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_within integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_within_min'), 30);
  v_before integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_before_leave_min'), 60);
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
      and (t.sent_at + make_interval(mins => v_within) < now()
           or coalesce(t.leave_by, t.start_at) - make_interval(mins => v_before) < now())
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'accept_reminder', v_task.employee_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.queue_accept_reminders() from public, anon, authenticated;

select cron.unschedule('task-reminders');
select cron.schedule('task-reminders', '* * * * *', $$select public.queue_task_reminders(), public.queue_accept_reminders()$$);
