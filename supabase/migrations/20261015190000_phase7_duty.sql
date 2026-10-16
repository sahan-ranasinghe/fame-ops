-- =============================================================================
-- Phase 7, Part 1 (15 October 2026, docs/phase7-plan.md §1, §2, §7, §18): a driver's day.
--
--   1. vehicle_assignments: who held which vehicle, from when to when, and how it began and
--      ended. One open row per driver and one per vehicle (one vehicle, one driver).
--      employees.current_vehicle_id always equals the driver's open row: take_vehicle() keeps
--      them together, and a deferred constraint trigger refuses any commit where they differ.
--   2. Every app version gives the same result: triggers translate what the phones already
--      write (a duty session with a vehicle = clock in; the session's end = clock out; a
--      driver's own change of current_vehicle_id = change; a task going in_progress = the
--      task's vehicle) into take_vehicle(). The new app adds change_vehicle() (the phone's
--      time, idempotent by its id) and my_vehicle_choices().
--   3. The duty cut-off (setting duty_cutoff, "21:00" by default, "" = off): duty_jobs() every
--      15 minutes clocks out whoever is still on duty after it (not while a task is running),
--      and opens a duty session for a running task whose phone never sent one.
--   4. The office: office_clock_out(), office_move_vehicle(), office_reopen_task(); app_stops()
--      for "App stopped by phone N× today".
--   5. A task can't be finished before it is driven: task_stops.arrival_flag and
--      arrival_distance_m (the new app's Arrived), Done needs Arrived (the new app's write is
--      refused without it; an old app's combined write passes, flagged not_arrived), and
--      tasks.finish_flag (completed_early: the odometer or the time far under the plan).
--   6. Pushes without a task (vehicle_taken, vehicle_moved, duty_auto_out, duty_office_out) and
--      reopened; send_heartbeat() also answers on_duty; the new issue kinds for assign_tasks.
-- =============================================================================

-- 1. vehicle_assignments -------------------------------------------------------------------
create table public.vehicle_assignments (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees (id),
  vehicle_id    uuid not null references public.vehicles (id),
  from_at       timestamptz not null,
  to_at         timestamptz,
  how           text not null check (how in ('clock_in', 'change', 'task_start', 'office')),
  ended_how     text check (ended_how in ('change', 'taken_over', 'clock_out', 'office', 'auto')),
  -- Who began it (the driver, the office person, "system") and who ended it (for taken_over: the
  -- driver who took the vehicle, so the previous holder's app can say "now with Kamal").
  by_name       text not null,
  ended_by_name text,
  task_id       uuid references public.tasks (id),
  -- The phone's id for change_vehicle(): the offline queue may send it twice.
  client_id     uuid unique,
  created_at    timestamptz not null default now(),
  constraint vehicle_assignments_end_together check ((to_at is null) = (ended_how is null)),
  constraint vehicle_assignments_ordered check (to_at is null or to_at >= from_at)
);
comment on table public.vehicle_assignments is
  'Who held which vehicle when (Phase 7 §1–2). One open row per driver and per vehicle; employees.current_vehicle_id equals the open row.';

create unique index vehicle_assignments_one_open_per_driver on public.vehicle_assignments (employee_id) where to_at is null;
create unique index vehicle_assignments_one_open_per_vehicle on public.vehicle_assignments (vehicle_id) where to_at is null;
create index vehicle_assignments_employee_from_idx on public.vehicle_assignments (employee_id, from_at desc);
create index vehicle_assignments_vehicle_from_idx on public.vehicle_assignments (vehicle_id, from_at desc);

alter table public.vehicle_assignments enable row level security;
-- Drivers read their own rows (the "taken over" banner, the last vehicle); they write nothing here.
grant select on public.vehicle_assignments to authenticated;
create policy vehicle_assignments_select_own on public.vehicle_assignments
  for select to authenticated
  using (employee_id = (select public.current_employee_id()));

-- Today's holders keep their vehicle: one open row each. Two drivers on one vehicle (possible
-- before this rule): the one on duty keeps it, else the one who changed their row last.
with ranked as (
  select e.id, e.current_vehicle_id, s.started_at,
         row_number() over (partition by e.current_vehicle_id
                            order by (s.id is not null) desc, e.updated_at desc) as rn
  from public.employees e
  left join public.duty_sessions s on s.employee_id = e.id and s.ended_at is null
  where e.current_vehicle_id is not null
)
insert into public.vehicle_assignments (employee_id, vehicle_id, from_at, how, by_name)
select r.id, r.current_vehicle_id, coalesce(r.started_at, now()),
       case when r.started_at is null then 'change' else 'clock_in' end, 'system'
from ranked r where r.rn = 1;

update public.employees e
set current_vehicle_id = null
where e.current_vehicle_id is not null
  and not exists (select 1 from public.vehicle_assignments a where a.employee_id = e.id and a.to_at is null);

-- The one function that changes who holds a vehicle --------------------------------------------
-- p_vehicle null = the driver holds none. Answers the driver's open row (null when none).
create function public.take_vehicle(
  p_employee uuid,
  p_vehicle  uuid,
  p_how      text,
  p_at       timestamptz,
  p_by       text,
  p_task     uuid default null,
  p_client   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at     timestamptz := least(coalesce(p_at, now()), now());
  v_prev   text := coalesce(current_setting('fleet.assigning', true), '');
  v_name   text;
  v_mine   public.vehicle_assignments%rowtype;
  v_other  public.vehicle_assignments%rowtype;
  v_id     uuid;
  v_plate  text;
begin
  if p_how not in ('clock_in', 'change', 'task_start', 'office') then
    raise exception 'Unknown way of taking a vehicle: %', p_how;
  end if;
  if p_client is not null then
    select a.id into v_id from public.vehicle_assignments a where a.client_id = p_client;
    if found then
      return (select a.id from public.vehicle_assignments a where a.employee_id = p_employee and a.to_at is null);
    end if;
  end if;

  perform set_config('fleet.assigning', 'on', true);
  select e.name into v_name from public.employees e where e.id = p_employee;
  select * into v_mine from public.vehicle_assignments a where a.employee_id = p_employee and a.to_at is null for update;
  if p_vehicle is not null then
    select * into v_other from public.vehicle_assignments a where a.vehicle_id = p_vehicle and a.to_at is null for update;
  end if;

  -- Already mine, or nothing to give up: nothing changes.
  if (p_vehicle is not null and v_mine.id is not null and v_mine.vehicle_id = p_vehicle)
     or (p_vehicle is null and v_mine.id is null) then
    perform set_config('fleet.assigning', v_prev, true);
    return v_mine.id;
  end if;

  -- A late write older than the driver's own current row (an office move or a task start came
  -- after it): the newer state stands.
  if v_mine.id is not null and v_mine.from_at > v_at then
    perform set_config('fleet.assigning', v_prev, true);
    return v_mine.id;
  end if;

  -- A late write (sent offline): someone else took the vehicle after this time. Record the
  -- stretch the driver had it, ended by that take, and do not take the vehicle back.
  if v_other.id is not null and v_other.employee_id <> p_employee and v_other.from_at > v_at then
    if v_mine.id is not null then
      update public.vehicle_assignments
      set to_at = greatest(v_at, from_at), ended_how = 'change', ended_by_name = p_by
      where id = v_mine.id;
    end if;
    insert into public.vehicle_assignments (employee_id, vehicle_id, from_at, to_at, how, ended_how, by_name, ended_by_name, task_id, client_id)
    values (p_employee, p_vehicle, v_at, v_other.from_at, p_how, 'taken_over', p_by,
            (select e.name from public.employees e where e.id = v_other.employee_id), p_task, p_client);
    update public.employees set current_vehicle_id = null where id = p_employee;
    perform set_config('fleet.assigning', v_prev, true);
    return null;
  end if;

  if v_mine.id is not null then
    update public.vehicle_assignments
    set to_at = greatest(v_at, from_at),
        ended_how = case when p_how = 'office' then 'office' else 'change' end,
        ended_by_name = p_by
    where id = v_mine.id;
  end if;

  -- One vehicle, one driver: whoever held it no longer does, and is told.
  if v_other.id is not null and v_other.employee_id <> p_employee then
    update public.vehicle_assignments
    set to_at = greatest(v_at, from_at), ended_how = 'taken_over', ended_by_name = v_name
    where id = v_other.id;
    update public.employees set current_vehicle_id = null where id = v_other.employee_id;
    select v.reg_no into v_plate from public.vehicles v where v.id = p_vehicle;
    perform public.send_push(null, 'vehicle_taken', v_other.employee_id,
                             jsonb_build_object('plate', v_plate, 'name', split_part(v_name, ' ', 1)));
  end if;

  if p_vehicle is not null then
    insert into public.vehicle_assignments (employee_id, vehicle_id, from_at, how, by_name, task_id, client_id)
    values (p_employee, p_vehicle, v_at, p_how, p_by, p_task, p_client)
    returning id into v_id;
  end if;
  update public.employees set current_vehicle_id = p_vehicle where id = p_employee;
  perform set_config('fleet.assigning', v_prev, true);
  return v_id;
end;
$$;
revoke all on function public.take_vehicle(uuid, uuid, text, timestamptz, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.take_vehicle(uuid, uuid, text, timestamptz, text, uuid, uuid) to service_role;

-- Closes the driver's open row (clock out, auto, office) without giving the vehicle to anyone.
create function public.release_vehicle(p_employee uuid, p_at timestamptz, p_ended_how text, p_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('fleet.assigning', true), '');
begin
  perform set_config('fleet.assigning', 'on', true);
  update public.vehicle_assignments
  set to_at = greatest(least(coalesce(p_at, now()), now()), from_at), ended_how = p_ended_how, ended_by_name = p_by
  where employee_id = p_employee and to_at is null;
  update public.employees set current_vehicle_id = null where id = p_employee and current_vehicle_id is not null;
  perform set_config('fleet.assigning', v_prev, true);
end;
$$;
revoke all on function public.release_vehicle(uuid, timestamptz, text, text) from public, anon, authenticated;

-- current_vehicle_id = the open row, checked at commit ---------------------------------------
create function public.vehicle_assignment_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := (to_jsonb(new) ->> case when tg_table_name = 'employees' then 'id' else 'employee_id' end)::uuid;
begin
  -- Inside take_vehicle() the rows are mid-change (a test may set constraints immediate); its end state is checked.
  if coalesce(current_setting('fleet.assigning', true), '') = 'on' then
    return null;
  end if;
  if (select e.current_vehicle_id from public.employees e where e.id = v_employee)
     is distinct from
     (select a.vehicle_id from public.vehicle_assignments a where a.employee_id = v_employee and a.to_at is null) then
    raise exception 'employees.current_vehicle_id must equal the open vehicle assignment (employee %)', v_employee;
  end if;
  return null;
end;
$$;
revoke all on function public.vehicle_assignment_check() from public, anon, authenticated;

create constraint trigger employees_vehicle_matches_assignment
  after insert or update of current_vehicle_id on public.employees
  deferrable initially deferred
  for each row execute function public.vehicle_assignment_check();
create constraint trigger vehicle_assignments_match_employee
  after insert or update on public.vehicle_assignments
  deferrable initially deferred
  for each row execute function public.vehicle_assignment_check();

-- 2. What the phones write, translated --------------------------------------------------------
-- A write of current_vehicle_id from outside take_vehicle(): an old app's "Change" (the driver,
-- signed in), or SQL run by an admin or a test. Either way the assignments follow.
create function public.employees_take_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fleet.assigning', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.current_vehicle_id is null then
    return null;
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    perform public.take_vehicle(new.id, new.current_vehicle_id, 'change', now(), new.name);
  else
    perform public.take_vehicle(new.id, new.current_vehicle_id, 'office', now(), 'system');
  end if;
  return null;
end;
$$;
revoke all on function public.employees_take_vehicle() from public, anon, authenticated;

create trigger employees_take_vehicle
  after insert or update of current_vehicle_id on public.employees
  for each row execute function public.employees_take_vehicle();

-- Duty sessions: opening one with a vehicle is the clock-in; closing one is the clock-out. A
-- session the server opened for a running task (duty_jobs) gives way to the phone's own.
create function public.duty_sessions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The vehicle stays with the driver across the swap (duty_sessions_assign skips this close).
  perform set_config('fleet.replacing_session', 'on', true);
  update public.duty_sessions s
  set ended_at = greatest(s.started_at, new.started_at), end_reason = 'auto'
  where s.employee_id = new.employee_id and s.ended_at is null
    and s.device_info ->> 'opened_by' = 'server';
  perform set_config('fleet.replacing_session', 'off', true);
  return new;
end;
$$;
revoke all on function public.duty_sessions_before_insert() from public, anon, authenticated;

create trigger duty_sessions_before_insert
  before insert on public.duty_sessions
  for each row execute function public.duty_sessions_before_insert();

create function public.duty_sessions_assign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := (select e.name from public.employees e where e.id = new.employee_id);
  v_by   text := nullif(coalesce(current_setting('fleet.by', true), ''), '');
begin
  if tg_op = 'INSERT' then
    if new.ended_at is null and new.device_info ->> 'opened_by' is distinct from 'server' then
      perform public.take_vehicle(new.employee_id, new.vehicle_id, 'clock_in', new.started_at, v_name);
    end if;
    return null;
  end if;
  -- The vehicle stays with the driver when the phone's own session replaces one the server opened
  -- (the BEFORE INSERT swap, or the app closing it first as an old open session).
  if old.ended_at is null and new.ended_at is not null
     and coalesce(current_setting('fleet.replacing_session', true), '') <> 'on'
     and not (coalesce(old.device_info ->> 'opened_by', '') = 'server' and new.end_reason = 'auto'
              and coalesce(current_setting('fleet.by', true), '') <> 'system') then
    perform public.release_vehicle(
      new.employee_id, new.ended_at,
      case new.end_reason when 'admin' then 'office' when 'auto' then 'auto' else 'clock_out' end,
      case new.end_reason when 'driver' then v_name else coalesce(v_by, 'system') end);
  end if;
  return null;
end;
$$;
revoke all on function public.duty_sessions_assign() from public, anon, authenticated;

create trigger duty_sessions_assign
  after insert or update of ended_at on public.duty_sessions
  for each row execute function public.duty_sessions_assign();

-- A task going in progress: the driver now holds the task's vehicle (a custodian's task has no app).
create function public.tasks_take_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress'
     and exists (select 1 from public.employees e where e.id = new.employee_id and e.role = 'driver') then
    -- A reopened task (completed → in progress) takes the vehicle now, not at its first start.
    perform public.take_vehicle(new.employee_id, new.vehicle_id, 'task_start',
                                case when old.status = 'completed' then now() else coalesce(new.started_at, now()) end,
                                (select e.name from public.employees e where e.id = new.employee_id), new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_take_vehicle() from public, anon, authenticated;

create trigger tasks_take_vehicle
  after update of status on public.tasks
  for each row execute function public.tasks_take_vehicle();

-- The new app's RPCs ---------------------------------------------------------------------------
-- Every active vehicle for the picker: who holds it now (first name), and which is my last and
-- my regular one (drivers cannot read regular_driver_id or other drivers' rows themselves).
create function public.my_vehicle_choices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_last uuid;
begin
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver') then
    raise exception 'Only a signed-in driver can list the vehicles to choose from';
  end if;
  -- Two rows can start in the same millisecond (Start work, then Change vehicle at once): the later insert wins.
  select a.vehicle_id into v_last from public.vehicle_assignments a
  where a.employee_id = v_me order by a.from_at desc, a.created_at desc limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id,
             'reg_no', v.reg_no,
             'make_model', v.make_model,
             'vehicle_type', v.vehicle_type,
             'seats', v.seats,
             'in_garage', v.in_garage,
             'current_odometer_km', v.current_odometer_km,
             'held_by', case when a.employee_id <> v_me then split_part(e.name, ' ', 1) end,
             'held_since', a.from_at,
             'mine_now', coalesce(a.employee_id = v_me, false),
             'my_last', v.id is not distinct from v_last,
             'my_regular', v.regular_driver_id is not distinct from v_me)
           order by v.reg_no)
    from public.vehicles v
    left join public.vehicle_assignments a on a.vehicle_id = v.id and a.to_at is null
    left join public.employees e on e.id = a.employee_id
    where v.active), '[]'::jsonb);
end;
$$;
revoke all on function public.my_vehicle_choices() from public, anon;
grant execute on function public.my_vehicle_choices() to authenticated;

-- Change vehicle (or "No vehicle", p_vehicle null) with the phone's time; the same p_client twice
-- changes nothing. Only on duty and never while a task runs (the task holds its vehicle; the office's
-- move follows the same rule): then nothing changes, and the answer says why. Answers the vehicle the
-- driver holds afterwards.
create function public.change_vehicle(p_vehicle uuid, p_at timestamptz, p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_name text;
begin
  select e.name into v_name from public.employees e where e.id = v_me and e.role = 'driver' and e.active;
  if v_name is null then
    raise exception 'Only a signed-in driver can change their vehicle';
  end if;
  if p_vehicle is not null and not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.active) then
    raise exception 'That vehicle is not in use';
  end if;
  if not exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null) then
    return jsonb_build_object('vehicle_id', (select e.current_vehicle_id from public.employees e where e.id = v_me), 'refused', 'off_duty');
  end if;
  if exists (select 1 from public.tasks t where t.employee_id = v_me and t.status = 'in_progress') then
    return jsonb_build_object('vehicle_id', (select e.current_vehicle_id from public.employees e where e.id = v_me), 'refused', 'task_running');
  end if;
  perform public.take_vehicle(v_me, p_vehicle, 'change', p_at, v_name, null, p_client);
  return jsonb_build_object('vehicle_id', (select e.current_vehicle_id from public.employees e where e.id = v_me));
end;
$$;
revoke all on function public.change_vehicle(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.change_vehicle(uuid, timestamptz, uuid) to authenticated;

-- 3. The duty cut-off ----------------------------------------------------------------------------
-- The first cut-off moment after p_at (Colombo time); null when the cut-off is off.
create function public.duty_cutoff_after(p_at timestamptz, p_cutoff text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_cutoff, '') !~ '^\d{2}:\d{2}$' then null
    when (p_at at time zone 'Asia/Colombo')::time < p_cutoff::time
      then (((p_at at time zone 'Asia/Colombo')::date + p_cutoff::time) at time zone 'Asia/Colombo')
    else (((p_at at time zone 'Asia/Colombo')::date + 1 + p_cutoff::time) at time zone 'Asia/Colombo')
  end
$$;
revoke all on function public.duty_cutoff_after(timestamptz, text) from public, anon, authenticated;

create function public.duty_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut     text := coalesce((select s.value #>> '{}' from public.fleet_settings s where s.key = 'duty_cutoff'), '21:00');
  v_session record;
  v_end     timestamptz;
  v_out     integer := 0;
  v_held    integer := 0;
  v_opened  integer := 0;
begin
  if v_cut ~ '^\d{2}:\d{2}$' then
    -- Still on duty after the cut-off, with no task running: clocked out at the cut-off (or when
    -- the last task finished, for a driver who worked past it).
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
      perform public.send_push(null, 'duty_auto_out', v_session.employee_id,
                               jsonb_build_object('time', to_char(v_end at time zone 'Asia/Colombo', 'HH24:MI')));
      v_out := v_out + 1;
    end loop;

    -- A vehicle held while off duty (an old app's pick) is given up at the cut-off too.
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

  -- A task running with no duty session (the phone's never came): the server opens one, so
  -- the office sees the driver on duty. The phone's own session replaces it when it comes.
  insert into public.duty_sessions (employee_id, vehicle_id, started_at, device_info)
  select t.employee_id, t.vehicle_id, t.started_at, jsonb_build_object('opened_by', 'server', 'task_id', t.id)
  from public.tasks t
  join public.employees e on e.id = t.employee_id and e.role = 'driver'
  where t.status = 'in_progress'
    and t.started_at < now() - interval '5 minutes'
    and not exists (select 1 from public.duty_sessions s
                    where s.employee_id = t.employee_id and (s.ended_at is null or s.ended_at >= t.started_at));
  get diagnostics v_opened = row_count;

  return jsonb_build_object('clocked_out', v_out, 'vehicles_released', v_held, 'sessions_opened', v_opened);
end;
$$;
revoke all on function public.duty_jobs() from public, anon, authenticated;
grant execute on function public.duty_jobs() to service_role;

select cron.schedule('duty-jobs', '*/15 * * * *', $$select public.duty_jobs()$$);

-- 4. The office's actions ------------------------------------------------------------------------
-- Clock a driver out (not while a task runs). Answers {result: clocked_out | off_duty | task_in_progress}.
create function public.office_clock_out(p_employee uuid, p_by text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_now     timestamptz := now();
begin
  if exists (select 1 from public.tasks t where t.employee_id = p_employee and t.status = 'in_progress') then
    return jsonb_build_object('result', 'task_in_progress');
  end if;
  perform set_config('fleet.by', coalesce(p_by, 'office'), true);
  update public.duty_sessions set ended_at = greatest(v_now, started_at), end_reason = 'admin'
  where employee_id = p_employee and ended_at is null
  returning id into v_session;
  if v_session is null then
    -- Off duty already; a vehicle still held (an old app's pick) is given up all the same.
    perform public.release_vehicle(p_employee, v_now, 'office', coalesce(p_by, 'office'));
    return jsonb_build_object('result', 'off_duty');
  end if;
  perform public.send_push(null, 'duty_office_out', p_employee,
                           jsonb_build_object('time', to_char(v_now at time zone 'Asia/Colombo', 'HH24:MI'),
                                              'reason', p_reason));
  return jsonb_build_object('result', 'clocked_out', 'at', v_now);
end;
$$;
revoke all on function public.office_clock_out(uuid, text, text) from public, anon, authenticated;
grant execute on function public.office_clock_out(uuid, text, text) to service_role;

-- Move a driver on duty to a vehicle (or to none). Answers {result: moved | off_duty |
-- task_in_progress | vehicle_on_task, taken_from?}: never off a running task, theirs or the holder's.
create function public.office_move_vehicle(p_employee uuid, p_vehicle uuid, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   record;
  v_holder text;
  v_plate  text;
begin
  if not exists (select 1 from public.duty_sessions s where s.employee_id = p_employee and s.ended_at is null) then
    return jsonb_build_object('result', 'off_duty');
  end if;
  select t.id, t.vehicle_id into v_task from public.tasks t
  where t.employee_id = p_employee and t.status = 'in_progress' limit 1;
  if v_task.id is not null and v_task.vehicle_id is distinct from p_vehicle then
    return jsonb_build_object('result', 'task_in_progress');
  end if;
  if exists (select 1 from public.tasks t
             where t.vehicle_id = p_vehicle and t.status = 'in_progress' and t.employee_id <> p_employee) then
    return jsonb_build_object('result', 'vehicle_on_task');
  end if;
  select e.name into v_holder from public.vehicle_assignments a join public.employees e on e.id = a.employee_id
  where a.vehicle_id = p_vehicle and a.to_at is null and a.employee_id <> p_employee;
  perform public.take_vehicle(p_employee, p_vehicle, 'office', now(), coalesce(p_by, 'office'));
  select v.reg_no into v_plate from public.vehicles v where v.id = p_vehicle;
  perform public.send_push(null, 'vehicle_moved', p_employee, jsonb_build_object('plate', v_plate));
  return jsonb_build_object('result', 'moved', 'taken_from', v_holder);
end;
$$;
revoke all on function public.office_move_vehicle(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.office_move_vehicle(uuid, uuid, text) to service_role;

-- "App stopped by phone": heartbeat gaps of over 3 minutes inside one duty period, per driver.
create function public.app_stops(p_from timestamptz, p_to timestamptz)
returns table (employee_id uuid, stops integer, last_stop_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.employee_id, count(*)::integer, max(x.at)
  from (
    select h.employee_id, h.at,
           lag(h.at) over (partition by h.employee_id, h.session_id order by h.at) as prev_at
    from public.driver_heartbeats h
    where h.at >= p_from and h.at < p_to and h.session_id is not null and h.sharing is not false
  ) x
  where x.prev_at is not null and x.at - x.prev_at > interval '3 minutes'
  group by x.employee_id
$$;
revoke all on function public.app_stops(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.app_stops(timestamptz, timestamptz) to service_role;

-- 5. A task can't be finished before it is driven --------------------------------------------------
alter table public.task_stops
  add column arrival_flag text,
  add column arrival_distance_m integer,
  add constraint task_stops_arrival_flag_check
    check (arrival_flag is null or arrival_flag in ('ok', 'override', 'no_gps', 'no_pin', 'not_arrived')),
  add constraint task_stops_arrival_distance_check check (arrival_distance_m is null or arrival_distance_m >= 0);
comment on column public.task_stops.arrival_flag is
  'How Arrived was marked: ok (within 300 m), override ("I''m here, the pin is wrong"), no_gps (no fix after 60 s), no_pin (a stop without a pin), not_arrived (an older app marked Done without Arrived).';
comment on column public.task_stops.arrival_distance_m is 'The phone''s distance from the stop''s pin when Arrived was tapped.';
grant update (arrival_flag, arrival_distance_m) on public.task_stops to authenticated;

-- Done needs Arrived first. The new app sends Done alone after its own Arrived; a Done with no
-- arrival is refused. An older app sends Done and arrived_at in one write: it passes, flagged.
create function public.task_stops_driver_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- How Arrived was marked stands once recorded (an override cannot be turned into ok later).
  if old.arrival_flag is not null then
    new.arrival_flag := old.arrival_flag;
    new.arrival_distance_m := old.arrival_distance_m;
  end if;
  if new.status = 'done' and old.status is distinct from 'done' and old.arrived_at is null then
    if new.arrived_at is null then
      raise exception 'Mark Arrived first: a stop is Done only after Arrived';
    end if;
    new.arrival_flag := coalesce(new.arrival_flag, 'not_arrived');
  end if;
  return new;
end;
$$;
revoke all on function public.task_stops_driver_rules() from public, anon, authenticated;

create trigger task_stops_driver_rules
  before update on public.task_stops
  for each row execute function public.task_stops_driver_rules();

alter table public.tasks add column finish_flag jsonb;
comment on column public.tasks.finish_flag is
  'Set at completion when the odometer km is under 70 % of the planned km or the time under half the planned drive time, both up to the last stop (not the drive back to base): {kind: completed_early, odometer_km, planned_km, minutes, planned_minutes}. Cleared by a reopen.';

-- The check at completion, for every app version (the new app asks the driver first). Plans under
-- 3 km are not checked (an odometer counts whole km).
create function public.tasks_finish_check()
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
begin
  if new.status = 'completed' and old.status = 'in_progress' then
    new.finish_flag := null;
    if v_plan_km >= 3 and new.start_odometer_km is not null and new.end_odometer_km is not null
       and new.started_at is not null and new.completed_at is not null then
      v_km := new.end_odometer_km - new.start_odometer_km;
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
revoke all on function public.tasks_finish_check() from public, anon, authenticated;

create trigger tasks_finish_check
  before update of status on public.tasks
  for each row execute function public.tasks_finish_check();

-- Reopen a task completed today (Colombo): back to in progress, the end reading and the time
-- cleared (the odometer log and this event keep them), the stops skipped as "not visited" at
-- the finish open again. Answers {result: reopened | not_completed | not_today | driver_busy}.
alter table public.task_assignment_events drop constraint task_assignment_events_action_check;
alter table public.task_assignment_events add constraint task_assignment_events_action_check
  check (action in ('assigned', 'accepted', 'declined', 'reassigned', 'cancelled', 'changed', 'reopened', 'stop_skipped'));

create function public.office_reopen_task(p_task uuid, p_by text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
begin
  select t.* into v_task from public.tasks t where t.id = p_task for update;
  if v_task.id is null or v_task.status <> 'completed' then
    return jsonb_build_object('result', 'not_completed');
  end if;
  if (v_task.completed_at at time zone 'Asia/Colombo')::date <> (now() at time zone 'Asia/Colombo')::date then
    return jsonb_build_object('result', 'not_today');
  end if;
  if exists (select 1 from public.tasks t where t.employee_id = v_task.employee_id and t.status = 'in_progress' and t.id <> p_task) then
    return jsonb_build_object('result', 'driver_busy');
  end if;
  update public.tasks set status = 'in_progress', completed_at = null, end_odometer_km = null where id = p_task;
  -- A driver who had finished work is on duty again for the task (the server's session; the phone's own replaces it).
  insert into public.duty_sessions (employee_id, vehicle_id, started_at, device_info)
  select v_task.employee_id, v_task.vehicle_id, now(), jsonb_build_object('opened_by', 'server', 'task_id', p_task)
  where not exists (select 1 from public.duty_sessions s where s.employee_id = v_task.employee_id and s.ended_at is null);
  update public.task_stops
  set status = 'pending', done_at = null, skip_reason = null, skip_note = null
  where task_id = p_task and status = 'skipped' and skip_reason = 'not_visited'
    and done_at between v_task.completed_at - interval '2 minutes' and v_task.completed_at + interval '2 minutes';
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note)
  values (p_task, 'reopened', v_task.employee_id, v_task.vehicle_id, p_by,
          concat_ws(' · ', p_reason,
                    'was completed ' || to_char(v_task.completed_at at time zone 'Asia/Colombo', 'HH24:MI'),
                    'end odometer ' || v_task.end_odometer_km || ' km'));
  perform public.send_push(p_task, 'reopened', v_task.employee_id);
  return jsonb_build_object('result', 'reopened');
end;
$$;
revoke all on function public.office_reopen_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.office_reopen_task(uuid, text, text) to service_role;

-- A stop the driver skips (with a reason; not the "not visited" ones at the finish): a line in the task's
-- history and a web push to the dispatchers (event task.stop_skipped, assign_tasks).
create function public.task_stops_skipped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   record;
  v_n      integer;
  v_reason text := case new.skip_reason when 'closed' then 'Closed' when 'nobody_there' then 'Nobody there'
                                        when 'not_needed' then 'Not needed' else 'Other' end;
  v_line   text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'authenticated'
     or new.status <> 'skipped' or old.status = 'skipped' or coalesce(new.skip_reason, '') = 'not_visited' then
    return null;
  end if;
  select t.id, t.title, t.employee_id, t.vehicle_id into v_task from public.tasks t where t.id = new.task_id;
  select count(*) into v_n from public.task_stops s where s.task_id = new.task_id and s.status <> 'removed' and s.seq <= new.seq;
  v_line := 'Stop ' || v_n || ' · ' || new.place_name || ': ' || v_reason || coalesce(' · ' || nullif(new.skip_note, ''), '');
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note)
  values (v_task.id, 'stop_skipped', v_task.employee_id, v_task.vehicle_id,
          (select e.name from public.employees e where e.id = v_task.employee_id), v_line);
  perform public.queue_notification(
    'task.stop_skipped',
    jsonb_build_object(
      'title', 'Stop skipped · ' || v_task.title,
      'body', coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver') || ' · ' || v_line,
      'url', '/tasks?task=' || v_task.id::text,
      'tag', 'task:' || v_task.id::text || ':skip:' || new.id::text,
      'task_id', v_task.id),
    (select coalesce(array_agg(e.id), '{}'::uuid[]) from public.employees e
     where e.active and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
       and 'assign_tasks' = any(e.permissions)));
  return null;
end;
$$;
revoke all on function public.task_stops_skipped() from public, anon, authenticated;

create trigger task_stops_skipped
  after update of status on public.task_stops
  for each row execute function public.task_stops_skipped();

-- 6. Pushes, the heartbeat's answer, the issue kinds ----------------------------------------------
alter table public.push_log drop constraint push_log_kind_check;
alter table public.push_log add constraint push_log_kind_check
  check (kind in ('new', 'changed', 'cancelled', 'removed', 'leave_30', 'leave_now', 'accept_reminder',
                  'vehicle_taken', 'vehicle_moved', 'duty_auto_out', 'duty_office_out', 'reopened'));

-- The new kinds about a task are the dispatcher's too (assign_tasks), as the older task kinds.
create or replace function public.issue_visible(p_kind text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.office_can('issues'))
      or (p_kind in ('signal', 'late_start', 'running_late', 'not_accepted', 'declined',
                     'vehicle_conflict', 'arrival_override', 'completed_early')
          and (select public.office_can('assign_tasks')))
$$;

-- send_heartbeat() answers on_duty too: an app that missed the clock-out push stops by itself.
create or replace function public.send_heartbeat(
  p_at                    timestamptz,
  p_sharing               boolean,
  p_location_on           boolean,
  p_permission            text,
  p_battery_pct           integer default null,
  p_app_version           text    default null,
  p_queued_points         integer default null,
  p_rejected_points       integer default null,
  p_data_available        boolean default null,
  p_app_state             text    default null,
  p_fix_age_s             integer default null,
  p_video_uploads_waiting integer default null,
  p_video_bytes_waiting   bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := public.current_employee_id();
  v_at  timestamptz := least(coalesce(p_at, now()), now());
  v_ok  boolean := coalesce(p_location_on, false) and coalesce(p_permission, 'unknown') = 'always';
begin
  -- Drivers only: office people have employee rows too, but no phone to report.
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver') then
    raise exception 'Only a signed-in driver can send a heartbeat';
  end if;
  if p_permission is not null and p_permission not in ('always', 'foreground', 'denied', 'unknown') then
    raise exception 'Unknown permission value %', p_permission;
  end if;
  if p_app_state is not null and p_app_state not in ('foreground', 'background') then
    raise exception 'Unknown app state %', p_app_state;
  end if;

  insert into public.driver_latest as dl
    (employee_id, sharing, hb_at, hb_sharing, hb_location_on, hb_permission, hb_battery_pct, hb_app_version, hb_queued_points,
     hb_location_off_since, hb_rejected_points, hb_data_available, hb_app_state, hb_fix_age_s,
     hb_video_uploads_waiting, hb_video_bytes_waiting)
  values
    (v_me,
     exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
     v_at, p_sharing, p_location_on, p_permission, p_battery_pct, p_app_version, p_queued_points,
     case when v_ok then null else v_at end,
     p_rejected_points, p_data_available, p_app_state, p_fix_age_s,
     p_video_uploads_waiting, p_video_bytes_waiting)
  on conflict (employee_id) do update
    set hb_at                    = excluded.hb_at,
        hb_sharing               = excluded.hb_sharing,
        hb_location_on           = excluded.hb_location_on,
        hb_permission            = excluded.hb_permission,
        hb_battery_pct           = excluded.hb_battery_pct,
        hb_app_version           = excluded.hb_app_version,
        hb_queued_points         = excluded.hb_queued_points,
        hb_location_off_since    = case when v_ok then null else coalesce(dl.hb_location_off_since, excluded.hb_at) end,
        hb_rejected_points       = excluded.hb_rejected_points,
        hb_data_available        = excluded.hb_data_available,
        hb_app_state             = excluded.hb_app_state,
        hb_fix_age_s             = excluded.hb_fix_age_s,
        hb_video_uploads_waiting = excluded.hb_video_uploads_waiting,
        hb_video_bytes_waiting   = excluded.hb_video_bytes_waiting
    where dl.hb_at is null or excluded.hb_at > dl.hb_at;

  -- The answer: is the office watching this driver right now, is the driver on duty, and if not, how
  -- the last duty period ended (the app's "You were clocked out at 21:00" when the push was missed).
  return jsonb_build_object(
    'watched', coalesce((select dl.watched_until > now() from public.driver_latest dl where dl.employee_id = v_me), false),
    'on_duty', exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
    'duty_end', (select jsonb_build_object('at', s.ended_at, 'reason', s.end_reason)
                 from public.duty_sessions s
                 where s.employee_id = v_me and s.ended_at is not null
                   and not exists (select 1 from public.duty_sessions o where o.employee_id = v_me and o.ended_at is null)
                 order by s.ended_at desc limit 1)
  );
end;
$$;
