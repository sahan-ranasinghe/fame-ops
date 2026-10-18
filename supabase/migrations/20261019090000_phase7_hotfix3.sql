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
