-- =============================================================================
-- Phase 5, Part 6: custodians and booking (docs/dispatch-plan.md, 3.6)
--
--   vehicles.custodian_employee_id / custodian_note   the office person a pooled
--       vehicle is assigned to ("Assigned to" on the Vehicles board; "ask first" when
--       the office books it). Office data: the driver app's column privileges on
--       vehicles are unchanged.
--   vehicle_requests   requested_by_user_id (the Auth account that submitted it),
--       driver_required (false = the custodian drives), one_step (booked directly by
--       the office: request and task in one go), seen_at / seen_by (the first time
--       someone who approves opens it), cancelled_at / cancelled_by / cancel_reason,
--       status 'cancelled'.
--   office_book_vehicle   the request (one_step, already seen) and its task in one
--       transaction: a refused task leaves no request behind.
--   A custodian-driven task has an office person as its employee: the leave-by and
--   accept reminders (and, in issues.ts, the not-accepted and late-start rules) skip
--   tasks whose employee is not a driver.
-- =============================================================================

-- 1. Columns ---------------------------------------------------------------------
alter table public.vehicles
  add column custodian_employee_id uuid references public.employees (id),
  add column custodian_note        text;

alter table public.vehicle_requests
  add column requested_by_user_id uuid,
  add column driver_required      boolean not null default true,
  add column one_step             boolean not null default false,
  add column seen_at              timestamptz,
  add column seen_by              text,
  add column cancelled_at         timestamptz,
  add column cancelled_by         text,
  add column cancel_reason        text;

alter table public.vehicle_requests drop constraint vehicle_requests_status_check;
alter table public.vehicle_requests add constraint vehicle_requests_status_check
  check (status in ('waiting', 'approved', 'declined', 'cancelled'));
-- vehicle_requests_decided_at_check ((status = 'waiting') = (decided_at is null)) still holds:
-- a cancelled request keeps (or gets) its decided_at.
alter table public.vehicle_requests add constraint vehicle_requests_cancelled_check
  check ((status = 'cancelled') = (cancelled_at is not null));

-- 2. One-step booking ------------------------------------------------------------------
-- Inserts the request (one_step, seen by the booker) and creates its task through
-- office_create_task, which approves it. One transaction: if the task is refused the
-- request is rolled back too. Runs as the caller (service_role), like office_create_task.
create function public.office_book_vehicle(
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
     driver_required, one_step, seen_at, seen_by)
  select r.requested_by_name, r.requested_by_employee_id, r.requested_by_user_id, r.project_id, r.project_label,
         r.needed_at, r.back_by, r.route_from, r.route_to, r.need_type, r.pax, coalesce(r.tools, false), r.note,
         coalesce(r.driver_required, true), true, now(), p_decided_by
  from jsonb_to_record(p_request) as r(
    requested_by_name text, requested_by_employee_id uuid, requested_by_user_id uuid, project_id uuid, project_label text,
    needed_at timestamptz, back_by timestamptz, route_from text, route_to text, need_type text, pax integer, tools boolean,
    note text, driver_required boolean)
  returning id into v_request_id;

  v_task_id := public.office_create_task(p_task, p_stops, p_projects, v_request_id, p_decided_by);
  return jsonb_build_object('request_id', v_request_id, 'task_id', v_task_id);
end;
$$;
revoke all on function public.office_book_vehicle(jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.office_book_vehicle(jsonb, jsonb, jsonb, jsonb, text) to service_role;

-- 3. The reminders skip a custodian-driven task (no app, no driver) -----------------------
create or replace function public.queue_task_reminders()
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
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'leave_30', v_task.employee_id);
    v_count := v_count + 1;
  end loop;

  for v_task in
    update public.tasks t
    set reminder_0_sent_at = now(), reminder_30_sent_at = coalesce(t.reminder_30_sent_at, now())
    where t.status = 'assigned' and t.leave_by is not null and t.reminder_0_sent_at is null and t.leave_by <= now()
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
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

create or replace function public.queue_accept_reminders()
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
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id, t.title, coalesce(t.leave_by, t.start_at) as leave_at
  loop
    perform public.send_push(v_task.id, 'accept_reminder', v_task.employee_id);
    perform public.queue_notification(
      'task.not_accepted',
      jsonb_build_object(
        'title', 'Not accepted yet · ' || v_task.title,
        'body', coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver')
                || ' · leave by ' || public.colombo_when(v_task.leave_at),
        'url', '/tasks?task=' || v_task.id::text,
        'tag', 'task:' || v_task.id::text,
        'task_id', v_task.id),
      public.dispatch_recipients());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
