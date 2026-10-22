-- Round 4–7, feature 6 (Sahan, 22 October 2026, before the deploy): a trip is never saved without its passengers. The names
-- go in the SAME statement as the trip's own write: a write-only column `passenger_list` ({by, rows: [{employee_id, name,
-- phone}]}) on tasks and vehicle_requests, lifted out by a BEFORE trigger (the column is never stored: always null) and
-- applied by an AFTER trigger to task_passengers / request_passengers (and a request's task) in the same transaction, so a
-- failure of either undoes both. office_create_task and office_book_vehicle carry it from their JSON (the task of a request
-- copies the request's passengers on insert, as before). The rules are keepPassengers' (tools/passengers.ts): a registered
-- person matched by id, someone without an account by name and phone; one no longer named is marked removed, never deleted.

alter table public.tasks add column passenger_list jsonb;
alter table public.vehicle_requests add column passenger_list jsonb;
comment on column public.tasks.passenger_list is
  'Write-only (Round 4–7): the passengers kept with this write ({by, rows}); applied in the same statement, never stored.';
comment on column public.vehicle_requests.passenger_list is
  'Write-only (Round 4–7): the passengers kept with this write ({by, rows}); applied in the same statement, never stored.';

-- One trip's passengers made equal to the list (owner 'task' or 'request').
create function public.apply_passenger_list(p_owner text, p_id uuid, p_list jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by   text := p_list ->> 'by';
  v_rows jsonb := coalesce(p_list -> 'rows', '[]'::jsonb);
begin
  if p_owner = 'task' then
    update public.task_passengers c set removed_at = now()
    where c.task_id = p_id and c.removed_at is null
      and not exists (
        select 1 from jsonb_to_recordset(v_rows) as r(employee_id uuid, name text, phone text)
        where (r.employee_id is not null and r.employee_id = c.employee_id)
           or (r.employee_id is null and c.employee_id is null and r.name = c.name and r.phone is not distinct from c.phone));
    insert into public.task_passengers (task_id, employee_id, name, phone, added_by)
    select p_id, r.employee_id, r.name, r.phone, v_by
    from jsonb_to_recordset(v_rows) as r(employee_id uuid, name text, phone text)
    where not exists (
      select 1 from public.task_passengers c
      where c.task_id = p_id and c.removed_at is null
        and ((r.employee_id is not null and r.employee_id = c.employee_id)
          or (r.employee_id is null and c.employee_id is null and r.name = c.name and r.phone is not distinct from c.phone)));
  elsif p_owner = 'request' then
    update public.request_passengers c set removed_at = now()
    where c.request_id = p_id and c.removed_at is null
      and not exists (
        select 1 from jsonb_to_recordset(v_rows) as r(employee_id uuid, name text, phone text)
        where (r.employee_id is not null and r.employee_id = c.employee_id)
           or (r.employee_id is null and c.employee_id is null and r.name = c.name and r.phone is not distinct from c.phone));
    insert into public.request_passengers (request_id, employee_id, name, phone, added_by)
    select p_id, r.employee_id, r.name, r.phone, v_by
    from jsonb_to_recordset(v_rows) as r(employee_id uuid, name text, phone text)
    where not exists (
      select 1 from public.request_passengers c
      where c.request_id = p_id and c.removed_at is null
        and ((r.employee_id is not null and r.employee_id = c.employee_id)
          or (r.employee_id is null and c.employee_id is null and r.name = c.name and r.phone is not distinct from c.phone)));
  else
    raise exception 'apply_passenger_list: no owner %', p_owner;
  end if;
end;
$$;
revoke all on function public.apply_passenger_list(text, uuid, jsonb) from public, anon, authenticated;

-- BEFORE: the list is lifted out of the row (kept for this transaction, by the row's id) so the column stays empty.
create function public.passenger_list_take()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.passenger_list is not null then
    perform set_config('fleet.pl_' || replace(new.id::text, '-', ''), new.passenger_list::text, true);
    new.passenger_list := null;
  end if;
  return new;
end;
$$;

-- AFTER: the list applied, in the same statement; a request's names also ride on its task (no new approval needed).
create function public.passenger_list_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text := 'fleet.pl_' || replace(new.id::text, '-', '');
  v_list text := current_setting(v_key, true);
begin
  if v_list is null or v_list = '' then
    return null;
  end if;
  perform set_config(v_key, '', true);
  if tg_table_name = 'tasks' then
    perform public.apply_passenger_list('task', new.id, v_list::jsonb);
  else
    perform public.apply_passenger_list('request', new.id, v_list::jsonb);
    if new.task_id is not null then
      perform public.apply_passenger_list('task', new.task_id, v_list::jsonb);
    end if;
  end if;
  return null;
end;
$$;

-- Only the triggers run them (a trigger needs no EXECUTE grant to fire).
revoke all on function public.passenger_list_take() from public, anon, authenticated;
revoke all on function public.passenger_list_apply() from public, anon, authenticated;

create trigger tasks_passenger_list_take before insert or update of passenger_list on public.tasks
  for each row execute function public.passenger_list_take();
create trigger tasks_passenger_list_apply after insert or update of passenger_list on public.tasks
  for each row execute function public.passenger_list_apply();
create trigger vehicle_requests_passenger_list_take before insert or update of passenger_list on public.vehicle_requests
  for each row execute function public.passenger_list_take();
create trigger vehicle_requests_passenger_list_apply after insert or update of passenger_list on public.vehicle_requests
  for each row execute function public.passenger_list_apply();

-- The two booking functions carry the list from their JSON (otherwise as in 20261022100000_round3_who_drives.sql).
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
     driven_by, driver_name, driver_phone, passenger_list)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by,
         t.start_place_id, t.start_name, t.start_lat, t.start_lng,
         coalesce(t.return_to_base, false), coalesce(t.avoid_expressway, false),
         t.leave_by, t.leave_by_source, t.buffer_min, t.plan_json,
         t.vehicle_choice, t.warnings, t.assigned_by_employee_id,
         coalesce(t.vehicle_mode, 'specific'), t.vehicle_type_wanted, t.approved_by_employee_id, t.approved_at,
         coalesce(t.driven_by, 'driver'), t.driver_name, t.driver_phone, t.passenger_list
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text,
    start_place_id uuid, start_name text, start_lat double precision, start_lng double precision,
    return_to_base boolean, avoid_expressway boolean,
    leave_by timestamptz, leave_by_source text, buffer_min integer, plan_json jsonb,
    vehicle_choice jsonb, warnings jsonb, assigned_by_employee_id uuid,
    vehicle_mode text, vehicle_type_wanted text, approved_by_employee_id uuid, approved_at timestamptz,
    driven_by text, driver_name text, driver_phone text, passenger_list jsonb)
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
     driven_by, driver_name, driver_phone, passenger_list)
  select r.requested_by_name, r.requested_by_employee_id, r.requested_by_user_id, r.project_id, r.project_label,
         r.needed_at, r.back_by, r.route_from, r.route_to, r.need_type, r.pax, coalesce(r.tools, false), r.note,
         coalesce(r.driven_by, case when coalesce(r.driver_required, true) then 'driver' else 'custodian' end) = 'driver',
         true, now(), p_decided_by, r.on_behalf_of, r.from_dwell_min, r.to_dwell_min,
         coalesce(r.driven_by, case when coalesce(r.driver_required, true) then 'driver' else 'custodian' end),
         r.driver_name, r.driver_phone, r.passenger_list
  from jsonb_to_record(p_request) as r(
    requested_by_name text, requested_by_employee_id uuid, requested_by_user_id uuid, project_id uuid, project_label text,
    needed_at timestamptz, back_by timestamptz, route_from text, route_to text, need_type text, pax integer, tools boolean,
    note text, driver_required boolean, on_behalf_of text, from_dwell_min integer, to_dwell_min integer,
    driven_by text, driver_name text, driver_phone text, passenger_list jsonb)
  returning id into v_request_id;

  v_task_id := public.office_create_task(p_task, p_stops, p_projects, v_request_id, p_decided_by);
  return jsonb_build_object('request_id', v_request_id, 'task_id', v_task_id);
end;
$$;
