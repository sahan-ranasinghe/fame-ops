-- Round 50 (29 October 2026; docs/phase8-plan.md §37): office people who drive themselves get the driver flow (Uber's one
-- account with a driver mode; Samsara / Motive's driver capability on any user). The audit (§37.8) found that every driver
-- table's policy is already "own rows" (current_employee_id(), no role); what refused an office person who owns a task was a
-- short list of explicit role = 'driver' checks. This migration:
--   1. employees.can_drive (null = never decided, true, false = taken away; granted automatically when the person's own
--      self-drive trip is made, never over a false, never for a custodian driving a trip someone else booked), the switch
--      self_drive_mode (fleet_switch: on unless set false);
--   2. drives_with_app(employee) and app_trip(driven_by, employee): the one rule every check below uses;
--   3. tasks.driven_in app | web | office: where a trip was started (the app's own in_progress write sets app; /m/'s
--      web_trip_action web; my_trip_check office); the no-app close (no_app_trips) runs only without app or web activity;
--   4. a self-drive task is accepted when it is made (the person booked it);
--   5. the role checks of send_heartbeat, my_office_contacts, tasks_take_vehicle, queue_task_reminders and duty_jobs' server
--      session become drives_with_app / app_trip; no "new" push for a self-drive trip;
--   6. privacy, enforced here: an office person may open a duty session only while a self trip of theirs started in the
--      app is in progress; their location points must fall inside a session's time; their session is closed when their
--      last running self trip ends (which releases the vehicle, as a clock-out does);
--   8. the fresh review's hardening (§37.10): the cut-off ends an office person's recording even while their trip runs
--      (the brief's safety net), the trip's own times bound their points and heartbeat rows, a session cannot start before
--      the trip or end in the future, a heartbeat outside a trip writes nothing, their last position is cleared when the
--      trip ends, the two helpers answer only about the caller;
--   7. web_trip_actions: a /m/ trip's actions (start, arrive, leave, finish), each with ONE browser position taken at that
--      moment (or none), the action's answer kept so a retry never doubles. Never location points: no GPS line, no Live
--      state, nothing for Realtime's trails (a web trip has no tracking); odometer_logs.entry and vehicle_checks.channel
--      take 'web'.

-- 1 ---------------------------------------------------------------------------------------------------------------------
alter table public.employees add column can_drive boolean;
comment on column public.employees.can_drive is
  'Round 50: an office person may drive their own self-drive trips with the app (Driving mode). null = never decided (granted automatically by their first self-drive task), true, false = an admin took it away.';

-- 3 ---------------------------------------------------------------------------------------------------------------------
alter table public.tasks add column driven_in text;
alter table public.tasks add constraint tasks_driven_in_check check (driven_in in ('app', 'web', 'office'));
comment on column public.tasks.driven_in is
  'Round 50: where the trip was started: app (the driver screens), web (/m/ driver-lite), office (the manual My trip check). null = not started.';

-- 7 ---------------------------------------------------------------------------------------------------------------------
create table public.web_trip_actions (
  client_id   uuid primary key,
  task_id     uuid not null references public.tasks (id),
  employee_id uuid not null references public.employees (id),
  action      text not null,
  stop_id     uuid references public.task_stops (id),
  at          timestamptz not null,
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  answer      jsonb not null,
  created_at  timestamptz not null default now(),
  constraint web_trip_actions_action_check check (action in ('start', 'arrive', 'leave', 'finish')),
  constraint web_trip_actions_position_check check ((lat is null) = (lng is null)),
  constraint web_trip_actions_lat_check check (lat between -90 and 90),
  constraint web_trip_actions_lng_check check (lng between -180 and 180)
);
create index web_trip_actions_task on public.web_trip_actions (task_id, at);
create index web_trip_actions_employee on public.web_trip_actions (employee_id, at);
comment on table public.web_trip_actions is
  'Round 50: a /m/ (browser) trip''s actions, each with one position taken at that moment or none, and the answer given (a retry with the same client_id gets it again). Never location points. Service role only (office-api web_trip_action).';
alter table public.web_trip_actions enable row level security;
revoke all on public.web_trip_actions from public, anon, authenticated;
grant select, insert on public.web_trip_actions to service_role;

alter table public.odometer_logs drop constraint odometer_logs_entry_check;
alter table public.odometer_logs add constraint odometer_logs_entry_check
  check (entry in ('photo', 'photo_changed', 'typed_unreadable', 'typed_offline', 'office', 'web'));
alter table public.vehicle_checks drop constraint vehicle_checks_channel_check;
alter table public.vehicle_checks add constraint vehicle_checks_channel_check check (channel in ('app', 'office', 'web'));

-- 2 ---------------------------------------------------------------------------------------------------------------------
/** A driver, or an office person with can_drive while the switch self_drive_mode is on. */
create or replace function public.drives_with_app(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- A signed-in person asks only about themselves (the policies and RPCs pass their own id); the server's jobs, triggers
  -- and office-api about anyone.
  select (coalesce(auth.role(), '') <> 'authenticated' or p_employee = public.current_employee_id())
    and exists (
      select 1 from public.employees e
      where e.id = p_employee and e.active
        and (e.role = 'driver' or (e.can_drive is true and public.fleet_switch('self_drive_mode'))));
$$;
revoke all on function public.drives_with_app(uuid) from public, anon;
grant execute on function public.drives_with_app(uuid) to authenticated, service_role;

/** A trip the driver flow serves: a driver's, or a self-drive trip of someone who drives with the app (never "someone else"). */
create or replace function public.app_trip(p_driven_by text, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case coalesce(p_driven_by, 'driver')
    when 'driver' then exists (select 1 from public.employees e where e.id = p_employee and e.role = 'driver')
    when 'self' then public.drives_with_app(p_employee)
    else false
  end;
$$;
revoke all on function public.app_trip(text, uuid) from public, anon, authenticated;
grant execute on function public.app_trip(text, uuid) to service_role;

/** Round 50: the duty cut-off after a trip's start (the setting duty_cutoff, 21:00 by default); none when it is not set. */
create or replace function public.trip_cutoff(p_started timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with cut as (select coalesce((select s.value #>> '{}' from public.fleet_settings s where s.key = 'duty_cutoff'), '21:00') as v)
  select case when cut.v ~ '^\d{2}:\d{2}$' then public.duty_cutoff_after(p_started, cut.v) else 'infinity'::timestamptz end from cut;
$$;
revoke all on function public.trip_cutoff(timestamptz) from public, anon;
grant execute on function public.trip_cutoff(timestamptz) to authenticated, service_role;

/**
 * Round 50: the time an office person's own self trip started in the app covers: from its start (2 minutes' grace) to its
 * completion, or now while it runs, never past the duty cut-off of its day (the brief's safety net). Their points, their
 * heartbeat history and their duty session must fall inside it.
 */
create or replace function public.self_trip_covers(p_employee uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.employee_id = p_employee and t.driven_by = 'self' and t.driven_in = 'app' and t.started_at is not null
      and p_at >= t.started_at - interval '2 minutes'
      and p_at <= least(coalesce(t.completed_at, now()), public.trip_cutoff(t.started_at)) + interval '2 minutes');
$$;
revoke all on function public.self_trip_covers(uuid, timestamptz) from public, anon;
grant execute on function public.self_trip_covers(uuid, timestamptz) to authenticated, service_role;

-- 1, 4: a self-drive task grants can_drive (never over a false) and is accepted when made ------------------------------
create or replace function public.tasks_self_drive_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driven_by = 'self' then
    if new.accepted_at is null and new.status in ('assigned', 'in_progress') then
      new.accepted_at := coalesce(new.created_at, now());
    end if;
    -- Their own self-drive booking grants it; a vehicle's custodian driving a trip someone else booked does not.
    if not exists (select 1 from public.vehicle_requests r where r.id = new.request_id and r.driven_by = 'custodian') then
      update public.employees set can_drive = true
       where id = new.employee_id and can_drive is null and role <> 'driver';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_self_drive_defaults() from public, anon, authenticated;
create trigger tasks_self_drive_defaults
  before insert or update of driven_by, employee_id on public.tasks
  for each row execute function public.tasks_self_drive_defaults();

-- The self-drive tasks there are: accepted (quietly: no push, no requester notice), and their people granted.
select set_config('fleet.quiet', 'on', true);
update public.tasks set accepted_at = coalesce(created_at, now())
 where driven_by = 'self' and accepted_at is null and status in ('assigned', 'in_progress');
-- (Sahan, Checkpoint 50: a switched-off account is skipped.)
update public.employees e set can_drive = true
 where e.can_drive is null and e.role <> 'driver' and e.active
   and exists (select 1 from public.tasks t
               where t.employee_id = e.id and t.driven_by = 'self'
                 and not exists (select 1 from public.vehicle_requests r where r.id = t.request_id and r.driven_by = 'custodian'));
select set_config('fleet.quiet', '', true);

-- 3: the app's own start says "app" -------------------------------------------------------------------------------------
create or replace function public.tasks_driven_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A signed-in person's own write (the driver screens; RLS, never office-api) taking the trip in progress.
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' and new.driven_in is null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated'
     and public.app_trip(new.driven_by, new.employee_id) then
    new.driven_in := 'app';
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_driven_in() from public, anon, authenticated;
create trigger tasks_driven_in
  before update of status on public.tasks
  for each row execute function public.tasks_driven_in();

-- 6: privacy for office people who drive ----------------------------------------------------------------------------------
drop policy duty_sessions_insert_own on public.duty_sessions;
create policy duty_sessions_insert_own on public.duty_sessions
  for insert to authenticated
  with check (
    employee_id = (select public.current_employee_id())
    and (end_reason is null or end_reason in ('driver', 'auto'))
    -- A driver clocks in as before; an office person only while a self trip of theirs started in the app is in progress,
    -- open (no end of their own choosing), from no earlier than the trip's start, and before the day's cut-off.
    and (exists (select 1 from public.employees e where e.id = employee_id and e.role = 'driver')
         or (public.drives_with_app(employee_id)
             and ended_at is null
             and exists (select 1 from public.tasks t
                         where t.employee_id = duty_sessions.employee_id and t.driven_by = 'self'
                           and t.status = 'in_progress' and t.driven_in = 'app'
                           and duty_sessions.started_at >= t.started_at - interval '2 minutes'
                           and now() < public.trip_cutoff(t.started_at)))));

drop policy location_points_insert_own on public.location_points;
create policy location_points_insert_own on public.location_points
  for insert to authenticated
  with check (
    employee_id = (select public.current_employee_id())
    and exists (
      select 1 from public.duty_sessions s
      where s.id = location_points.session_id
        and s.employee_id = (select public.current_employee_id())
        -- An office person's points only inside their own trip's time (self_trip_covers); a driver's as before.
        and (exists (select 1 from public.employees e where e.id = s.employee_id and e.role = 'driver')
             or public.self_trip_covers(s.employee_id, location_points.recorded_at))));

-- Their heartbeat history the same way (battery, Location on or off, the app's state: only during their trip).
drop policy driver_heartbeats_insert_own on public.driver_heartbeats;
create policy driver_heartbeats_insert_own on public.driver_heartbeats
  for insert to authenticated
  with check (
    employee_id = (select public.current_employee_id())
    and (exists (select 1 from public.employees e where e.id = employee_id and e.role = 'driver')
         or public.self_trip_covers(employee_id, at)));

/**
 * An office person's session never ends in the future (a phone clock running ahead, or a hand-made close, cannot keep one
 * "open" by closing it later); never before it started either. A driver's sessions are as before.
 */
create or replace function public.duty_sessions_end_not_ahead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null and new.ended_at > now()
     and not exists (select 1 from public.employees e where e.id = new.employee_id and e.role = 'driver') then
    new.ended_at := greatest(now(), new.started_at);
  end if;
  return new;
end;
$$;
revoke all on function public.duty_sessions_end_not_ahead() from public, anon, authenticated;
create trigger duty_sessions_end_not_ahead
  before insert or update of ended_at on public.duty_sessions
  for each row execute function public.duty_sessions_end_not_ahead();

/** An office person's last running self trip ended: their duty session closes and the vehicle is released (no holding a
    vehicle, no sharing, after their trip). */
create or replace function public.tasks_end_self_drive_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driven_by = 'self' and new.status in ('completed', 'cancelled') and old.status is distinct from new.status
     and not exists (select 1 from public.employees e where e.id = new.employee_id and e.role = 'driver')
     and not exists (select 1 from public.tasks t
                     where t.employee_id = new.employee_id and t.status = 'in_progress' and t.id <> new.id
                       and t.driven_by = 'self' and t.driven_in = 'app') then
    perform set_config('fleet.by', 'system', true);
    update public.duty_sessions set ended_at = now(), end_reason = 'auto'
     where employee_id = new.employee_id and ended_at is null;
    -- A /m/ trip has no session: the vehicle its start took is given back here (as a clock-out does for the app's).
    if exists (select 1 from public.vehicle_assignments a where a.employee_id = new.employee_id and a.to_at is null) then
      perform public.release_vehicle(new.employee_id, now(), 'auto', 'system');
    end if;
    -- Their last position is not kept after the trip (where they finished may be their home): Live never shows them then.
    delete from public.driver_latest where employee_id = new.employee_id;
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_end_self_drive_session() from public, anon, authenticated;
create trigger tasks_end_self_drive_session
  after update of status on public.tasks
  for each row execute function public.tasks_end_self_drive_session();

-- 5: the role checks (each function as it was, only the check changed) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_heartbeat(p_at timestamp with time zone, p_sharing boolean, p_location_on boolean, p_permission text, p_battery_pct integer DEFAULT NULL::integer, p_app_version text DEFAULT NULL::text, p_queued_points integer DEFAULT NULL::integer, p_rejected_points integer DEFAULT NULL::integer, p_data_available boolean DEFAULT NULL::boolean, p_app_state text DEFAULT NULL::text, p_fix_age_s integer DEFAULT NULL::integer, p_video_uploads_waiting integer DEFAULT NULL::integer, p_video_bytes_waiting bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me  uuid := public.current_employee_id();
  v_at  timestamptz := least(coalesce(p_at, now()), now());
  v_ok  boolean := coalesce(p_location_on, false) and coalesce(p_permission, 'unknown') = 'always';
begin
  -- Drivers, and (Round 50) office people who drive with the app: their phone reports while a trip of theirs shares.
  if v_me is null or not public.drives_with_app(v_me) then
    raise exception 'Only a signed-in driver can send a heartbeat';
  end if;
  -- An office person's phone reports only while their trip's session is open: outside it nothing is written, and the
  -- answer tells the app to stop sharing.
  if not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver')
     and not exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null) then
    return jsonb_build_object('on_duty', false);
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
$function$;

CREATE OR REPLACE FUNCTION public.my_office_contacts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := public.current_employee_id();
begin
  -- Round 50: also an office person driving their own trip with the app (the task screen's Call office).
  if v_me is null or not public.drives_with_app(v_me) then
    return null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'office_phone', (select value #>> '{}' from public.fleet_settings where key = 'office_phone'),
    -- Round 1: the chosen contacts, each person once.
    'contacts', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone, 'fleet_admin', 'approve' = any (e.permissions))
                                  order by ('approve' = any (e.permissions)) desc, e.name)
                 from public.employees e
                 where e.active and e.driver_contact and e.phone is not null and e.role <> 'driver'),
    -- The app before Round 1 reads this one and calls everyone in it "fleet admin": only the chosen contacts who approve.
    'approvers', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone) order by e.name)
                  from public.employees e
                  where e.active and e.driver_contact and e.phone is not null and e.role <> 'driver'
                    and 'approve' = any (e.permissions))
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.tasks_take_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress'
     and public.app_trip(new.driven_by, new.employee_id) then
    -- A reopened task (completed → in progress) takes the vehicle now, not at its first start.
    perform public.take_vehicle(new.employee_id, new.vehicle_id, 'task_start',
                                case when old.status = 'completed' then now() else coalesce(new.started_at, now()) end,
                                (select e.name from public.employees e where e.id = new.employee_id), new.id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.queue_task_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task  record;
  v_count integer := 0;
begin
  for v_task in
    update public.tasks t
    set reminder_30_sent_at = now()
    where t.status = 'assigned' and t.leave_by is not null and t.reminder_30_sent_at is null
      and t.leave_by <= now() + interval '30 minutes' and t.leave_by > now()
      and public.app_trip(t.driven_by, t.employee_id)
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'leave_30', v_task.employee_id);
    v_count := v_count + 1;
  end loop;

  for v_task in
    update public.tasks t
    set reminder_0_sent_at = now(), reminder_30_sent_at = coalesce(t.reminder_30_sent_at, now())
    where t.status = 'assigned' and t.leave_by is not null and t.reminder_0_sent_at is null and t.leave_by <= now()
      and public.app_trip(t.driven_by, t.employee_id)
    returning t.id, t.employee_id, (t.leave_by > now() - interval '2 hours') as fresh
  loop
    if v_task.fresh then
      perform public.send_push(v_task.id, 'leave_now', v_task.employee_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.duty_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        -- A driver is never clocked out while a task runs; an office person's recording ends at the cut-off whatever runs
        -- (Round 50: the brief's safety net; they finish the trip in the app later).
        and (not exists (select 1 from public.tasks t where t.employee_id = s.employee_id and t.status = 'in_progress')
             or not exists (select 1 from public.employees e where e.id = s.employee_id and e.role = 'driver'))
    loop
      v_end := least(now(), greatest(
        v_session.cutoff_at,
        coalesce((select max(t.completed_at) from public.tasks t
                  where t.employee_id = v_session.employee_id and t.completed_at > v_session.started_at), v_session.started_at)));
      perform set_config('fleet.by', 'system', true);
      update public.duty_sessions set ended_at = v_end, end_reason = 'auto' where id = v_session.id;
      if (v_end at time zone 'Asia/Colombo')::date = v_today
         and exists (select 1 from public.employees e where e.id = v_session.employee_id and e.role = 'driver') then
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
  join public.employees e on e.id = t.employee_id
  where t.status = 'in_progress'
    -- A driver's task, or (Round 50) a self trip started in the app by someone who drives with it; never a web or
    -- office-started trip (they have no phone sharing).
    and (e.role = 'driver'
         or (t.driven_by = 'self' and t.driven_in = 'app' and public.drives_with_app(e.id) and now() < public.trip_cutoff(t.started_at)))
    and t.started_at < now() - interval '5 minutes'
    and not exists (select 1 from public.duty_sessions s
                    where s.employee_id = t.employee_id and (s.ended_at is null or s.ended_at >= t.started_at));
  get diagnostics v_opened = row_count;

  return jsonb_build_object('clocked_out', v_out, 'closed_silently', v_silent, 'vehicles_released', v_held, 'sessions_opened', v_opened);
end;
$function$;

CREATE OR REPLACE FUNCTION public.no_app_trips()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r       record;
  v_asked integer := 0;
  v_closed integer := 0;
  v_end   timestamptz;
  v_plate text;
begin
  if not public.fleet_switch('trip_close_prompt') then
    return jsonb_build_object('asked', 0, 'closed', 0, 'off', true);
  end if;

  for r in
    select t.* from public.tasks t
    where t.driven_by in ('self', 'other')
      -- Round 50: only a trip with no app or web activity (a trip started in the app or on /m/ finishes there).
      and (t.driven_in is null or t.driven_in = 'office')
      and t.status in ('assigned', 'in_progress')
      and not t.demo
      and t.start_at is not null
      and t.start_at > now() - interval '14 days'
  loop
    v_end := public.no_app_trip_end(r.start_at, r.end_by);
    -- Closed: 09:00 Colombo on the day after the trip's end.
    if now() >= ((((v_end at time zone 'Asia/Colombo')::date + 1)::timestamp + time '09:00') at time zone 'Asia/Colombo') then
      update public.tasks
         set status = 'completed',
             started_at = coalesce(started_at, start_at),
             completed_at = greatest(v_end, coalesce(started_at, start_at)),
             finish_flag = jsonb_build_object('kind', 'not_confirmed', 'closed_at', now(), 'checked', r.started_at is not null)
       where id = r.id and status in ('assigned', 'in_progress');
      v_closed := v_closed + 1;
    elsif now() >= v_end and r.finish_ask_sent_at is null then
      select v.reg_no into v_plate from public.vehicles v where v.id = r.vehicle_id;
      perform public.queue_notification(
        'trip.finish_ask',
        jsonb_build_object(
          'title', 'Trip finished? Enter the odometer',
          'body', concat_ws(' · ', r.title, v_plate),
          'url', '/my-trips/' || r.id,
          'tag', 'finish:' || r.id,
          'task_id', r.id),
        array[r.employee_id]);
      update public.tasks set finish_ask_sent_at = now() where id = r.id;
      v_asked := v_asked + 1;
    end if;
  end loop;
  return jsonb_build_object('asked', v_asked, 'closed', v_closed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tasks_notify_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  -- A housekeeping write (the 30-day removal of Google's lines) changes nothing the driver sees: no push.
  if coalesce(current_setting('fleet.quiet', true), '') = 'on' then
    return null;
  end if;
  -- The driver's own app (seen, accepted, declined, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    return null;
  end if;

  -- Phase 7 (§13): a trip the driver started is theirs: no "new" push for it, and none when they cancel it themselves
  -- before it starts (driver-api writes as the service role, so the check above does not see it). The office changing,
  -- reassigning or cancelling it still tells them (below); a stop the driver adds on the way writes no task row.
  if new.kind = 'self' and tg_op = 'INSERT' then
    return null;
  end if;
  if new.kind = 'self' and tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
     and new.cancelled_reason = 'Cancelled by the driver before starting' then
    return null;
  end if;

  -- Round 50: a self-drive trip is the person's own booking: no "new" push to them for it (approving it already told
  -- them through the office's notice; booking it themselves needs none). Changes, cancelling and reminders still go.
  if new.driven_by = 'self' and tg_op = 'INSERT' then
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
    and (new.start_at, new.end_by, new.vehicle_id, new.vehicle_mode, new.vehicle_type_wanted, new.title, new.plan_version, new.notes,
         new.passengers, new.contact_name, new.contact_phone)
        is distinct from
        (old.start_at, old.end_by, old.vehicle_id, old.vehicle_mode, old.vehicle_type_wanted, old.title, old.plan_version, old.notes,
         old.passengers, old.contact_name, old.contact_phone) then
    -- What changed, in the words the push shows ("Task changed: new time 09:30 · vehicle WP KL-1234").
    if new.start_at is distinct from old.start_at then
      v_changes := v_changes || jsonb_build_object('time', public.colombo_when(new.start_at));
    end if;
    if new.end_by is distinct from old.end_by then
      v_changes := v_changes || jsonb_build_object('end_by',
        case when new.end_by is null then 'none' else to_char(new.end_by at time zone 'Asia/Colombo', 'HH24:MI') end);
    end if;
    if (new.vehicle_id, new.vehicle_mode, new.vehicle_type_wanted) is distinct from (old.vehicle_id, old.vehicle_mode, old.vehicle_type_wanted) then
      -- Hotfix 2 (J): a plate, or the vehicle chosen on the day (vehicle_day), or any vehicle of a type (vehicle_any).
      v_changes := v_changes || case
        when new.vehicle_id is not null then
          jsonb_build_object('vehicle', (select v.reg_no from public.vehicles v where v.id = new.vehicle_id))
        when new.vehicle_mode = 'any_type' then jsonb_build_object('vehicle_any', coalesce(new.vehicle_type_wanted, 'other'))
        else jsonb_build_object('vehicle_day', true)
      end;
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
$function$;

-- 8 (one-off): an office person's open duty session with no self trip of theirs in progress in the app (sessions any
-- signed-in employee could open before this round: tests, the demo) is closed, and their kept last position cleared.
select set_config('fleet.by', 'system', true);
update public.duty_sessions s set ended_at = now(), end_reason = 'auto'
 where s.ended_at is null
   and not exists (select 1 from public.employees e where e.id = s.employee_id and e.role = 'driver')
   and not exists (select 1 from public.tasks t
                   where t.employee_id = s.employee_id and t.status = 'in_progress' and t.driven_by = 'self' and t.driven_in = 'app');
delete from public.driver_latest d
 where not exists (select 1 from public.employees e where e.id = d.employee_id and e.role = 'driver')
   and not exists (select 1 from public.duty_sessions s where s.employee_id = d.employee_id and s.ended_at is null);
