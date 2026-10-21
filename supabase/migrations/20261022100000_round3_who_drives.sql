-- Round 3 (Phase 9, 21 October 2026): who drives? docs/phase8-plan.md section 30.
--
-- A trip is driven by one of three:
--   driver  a Fame Fleet driver with the app (as before; the default)
--   self    the person who asked drives it themselves (an office person; no app). The vehicle's custodian driving their
--           own vehicle (Phase 5 Part 6) is this too.
--   other   someone who is not in Fame Fleet: driver_name and driver_phone. The task stays on the account of the person
--           who asked or booked it (tasks.employee_id is never null), who is never shown as its driver.
-- A self or other trip has no app behind it: no accept, push or reminder (those already skip a task whose employee is
-- not a driver), and it needs a specific vehicle (nobody can confirm one on the day).
--
-- vehicle_requests carries the asker's choice (driver | self | other) or the old path (custodian: the vehicle's custodian
-- drives, what driver_required false meant), so the approver sees what was asked. driver_required stays and always
-- equals driven_by = 'driver' (the Teams artifact reads it).

alter table public.tasks
  add column driven_by text not null default 'driver',
  add column driver_name text,
  add column driver_phone text,
  add constraint tasks_driven_by_check check (driven_by in ('driver', 'self', 'other')),
  add constraint tasks_other_driver_named check (driven_by <> 'other' or nullif(trim(driver_name), '') is not null),
  add constraint tasks_driver_details_only_other check (driven_by = 'other' or (driver_name is null and driver_phone is null));
comment on column public.tasks.driven_by is
  'Who drives: driver (a driver with the app), self (the office person on the task drives it themselves), other (driver_name / driver_phone, not in Fame Fleet; the task is on the account of whoever asked or booked it)';
comment on column public.tasks.driver_name is 'The driver''s name when driven_by is other';
comment on column public.tasks.driver_phone is 'The driver''s phone (+94…) when driven_by is other';

-- The custodian tasks made so far: their request needed no driver and an office person drives (a person's role today
-- alone would relabel the past tasks of a driver who moved to the office; Checkpoint 3 review).
update public.tasks t set driven_by = 'self'
  from public.vehicle_requests r
 where r.id = t.request_id and not r.driver_required
   and exists (select 1 from public.employees e where e.id = t.employee_id and e.role <> 'driver');

-- A self or other trip names its vehicle (no app to confirm one on the day). Checked from now on (not valid for old rows).
alter table public.tasks
  add constraint tasks_no_app_needs_vehicle check (driven_by = 'driver' or vehicle_id is not null) not valid;

alter table public.vehicle_requests
  add column driven_by text not null default 'driver',
  add column driver_name text,
  add column driver_phone text,
  add constraint vehicle_requests_driven_by_check check (driven_by in ('driver', 'self', 'other', 'custodian')),
  add constraint vehicle_requests_other_driver_named check (driven_by <> 'other' or nullif(trim(driver_name), '') is not null);
comment on column public.vehicle_requests.driven_by is
  'Who the asker said drives: driver, self (the asker), other (driver_name / driver_phone), custodian (the vehicle''s custodian; driver_required false before Round 3)';

update public.vehicle_requests set driven_by = 'custodian' where not driver_required;

-- The task's insert takes who drives (Hotfix 2's office_create_task with the three columns added).
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
     vehicle_choice, warnings, assigned_by_employee_id,
     vehicle_mode, vehicle_type_wanted, approved_by_employee_id, approved_at,
     driven_by, driver_name, driver_phone)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by,
         t.start_place_id, t.start_name, t.start_lat, t.start_lng,
         coalesce(t.return_to_base, false), coalesce(t.avoid_expressway, false),
         t.leave_by, t.leave_by_source, t.buffer_min, t.plan_json,
         t.vehicle_choice, t.warnings, t.assigned_by_employee_id,
         coalesce(t.vehicle_mode, 'specific'), t.vehicle_type_wanted, t.approved_by_employee_id, t.approved_at,
         coalesce(t.driven_by, 'driver'), t.driver_name, t.driver_phone
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text,
    start_place_id uuid, start_name text, start_lat double precision, start_lng double precision,
    return_to_base boolean, avoid_expressway boolean,
    leave_by timestamptz, leave_by_source text, buffer_min integer, plan_json jsonb,
    vehicle_choice jsonb, warnings jsonb, assigned_by_employee_id uuid,
    vehicle_mode text, vehicle_type_wanted text, approved_by_employee_id uuid, approved_at timestamptz,
    driven_by text, driver_name text, driver_phone text)
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

-- A booking's request takes who drives too (phase7_dispatch.sql's office_book_vehicle with the three columns added).
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
     driver_required, one_step, seen_at, seen_by, on_behalf_of, from_dwell_min, to_dwell_min,
     driven_by, driver_name, driver_phone)
  select r.requested_by_name, r.requested_by_employee_id, r.requested_by_user_id, r.project_id, r.project_label,
         r.needed_at, r.back_by, r.route_from, r.route_to, r.need_type, r.pax, coalesce(r.tools, false), r.note,
         coalesce(r.driven_by, case when coalesce(r.driver_required, true) then 'driver' else 'custodian' end) = 'driver',
         true, now(), p_decided_by, r.on_behalf_of, r.from_dwell_min, r.to_dwell_min,
         coalesce(r.driven_by, case when coalesce(r.driver_required, true) then 'driver' else 'custodian' end),
         r.driver_name, r.driver_phone
  from jsonb_to_record(p_request) as r(
    requested_by_name text, requested_by_employee_id uuid, requested_by_user_id uuid, project_id uuid, project_label text,
    needed_at timestamptz, back_by timestamptz, route_from text, route_to text, need_type text, pax integer, tools boolean,
    note text, driver_required boolean, on_behalf_of text, from_dwell_min integer, to_dwell_min integer,
    driven_by text, driver_name text, driver_phone text)
  returning id into v_request_id;

  v_task_id := public.office_create_task(p_task, p_stops, p_projects, v_request_id, p_decided_by);
  return jsonb_build_object('request_id', v_request_id, 'task_id', v_task_id);
end;
$$;
