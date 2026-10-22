-- Round 4–7, feature 6 (Sahan, 22 October 2026): passengers on trips (Google Calendar's guests: people found with their
-- photo, chips, a typed name for someone outside; Uber's ride for someone else: the rider is told and follows the trip). A
-- request, an assigned task or a booking may name its passengers: registered office people, or a typed name and an optional
-- phone (+94…). The count (tasks.passengers, vehicle_requests.pax) stays: never under the names. Registered passengers are
-- told the trip's moments (passenger.trip: assigned, accepted, changed, cancelled; passenger.moving: on the way, running
-- late, arrived at each stop) and see it in My trips, view only. The switch passengers (Settings → Dispatch) hides the
-- field and stops the notices; the names stay.

create table public.task_passengers (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id),
  employee_id uuid references public.employees (id),
  name        text not null,
  phone       text,
  added_by    text,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  constraint task_passengers_name_check check (length(btrim(name)) between 1 and 120),
  constraint task_passengers_phone_check check (phone is null or phone ~ '^\+[0-9]{8,15}$')
);
create index task_passengers_task_idx on public.task_passengers (task_id) where removed_at is null;
create index task_passengers_person_idx on public.task_passengers (employee_id) where employee_id is not null and removed_at is null;
create unique index task_passengers_once on public.task_passengers (task_id, employee_id)
  where employee_id is not null and removed_at is null;
comment on table public.task_passengers is
  'Round 4–7 (6): who rides on a task: a registered office person or a typed name and phone; removed, never deleted.';

create table public.request_passengers (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.vehicle_requests (id),
  employee_id uuid references public.employees (id),
  name        text not null,
  phone       text,
  added_by    text,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  constraint request_passengers_name_check check (length(btrim(name)) between 1 and 120),
  constraint request_passengers_phone_check check (phone is null or phone ~ '^\+[0-9]{8,15}$')
);
create index request_passengers_request_idx on public.request_passengers (request_id) where removed_at is null;
create unique index request_passengers_once on public.request_passengers (request_id, employee_id)
  where employee_id is not null and removed_at is null;

alter table public.task_passengers enable row level security;
alter table public.request_passengers enable row level security;
-- The driver reads their own tasks' passengers (the names and Call on the task); the office reads through the tools.
create policy task_passengers_select_driver on public.task_passengers
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_passengers.task_id and t.employee_id = (select public.current_employee_id())));
grant select (id, task_id, name, phone, removed_at) on public.task_passengers to authenticated;

-- A request's passengers ride on its task: copied when the task is made (approve, book, a proposed task sent).
create function public.task_passengers_from_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_passengers (task_id, employee_id, name, phone, added_by, created_at)
  select new.id, p.employee_id, p.name, p.phone, p.added_by, p.created_at
  from public.request_passengers p
  where p.request_id = new.request_id and p.removed_at is null;
  return null;
end;
$$;
revoke all on function public.task_passengers_from_request() from public, anon, authenticated;
create trigger tasks_passengers_from_request after insert on public.tasks
  for each row when (new.request_id is not null) execute function public.task_passengers_from_request();

-- Tell a task's registered passengers (never its own person, the driver, nor the person who asked: they have their own).
create function public.notify_passengers(p_task_id uuid, p_event text, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to   uuid[];
  v_task public.tasks%rowtype;
  v_asker uuid;
begin
  if not public.fleet_switch('passengers') or current_setting('fleet.quiet', true) = 'on' then
    return 0;
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found or v_task.demo then
    return 0;
  end if;
  select r.requested_by_employee_id into v_asker from public.vehicle_requests r where r.id = v_task.request_id;
  select coalesce(array_agg(distinct p.employee_id), '{}') into v_to
  from public.task_passengers p
  join public.employees e on e.id = p.employee_id and e.active
  where p.task_id = p_task_id and p.removed_at is null and p.employee_id is not null
    and p.employee_id is distinct from v_task.employee_id and p.employee_id is distinct from v_asker;
  if coalesce(array_length(v_to, 1), 0) = 0 then
    return 0;
  end if;
  return public.queue_notification(p_event, jsonb_build_object(
    'title', p_title, 'body', p_body, 'url', '/my-trips/' || p_task_id, 'tag', 'passenger:' || p_task_id, 'task_id', p_task_id), v_to);
end;
$$;
revoke all on function public.notify_passengers(uuid, text, text, text) from public, anon, authenticated;

-- "Fri 24 Oct 08:00 · Team drop · Kurunegala site": the trip in one line for a passenger's notice.
create function public.passenger_trip_line(p_leave timestamptz, p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' · ', to_char(p_leave at time zone 'Asia/Colombo', 'Dy DD Mon HH24:MI'), p_title)
$$;
revoke all on function public.passenger_trip_line(timestamptz, text) from public, anon, authenticated;

-- The task's moments, whoever made them (the app, the office's tools, the jobs).
create function public.tasks_notify_passengers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver text;
  v_plate  text;
  v_line   text := public.passenger_trip_line(coalesce(new.leave_by, new.start_at), new.title);
begin
  if not exists (select 1 from public.task_passengers p where p.task_id = new.id and p.removed_at is null and p.employee_id is not null) then
    return null;
  end if;
  select split_part(name, ' ', 1) into v_driver from public.employees where id = new.employee_id;
  select reg_no into v_plate from public.vehicles where id = new.vehicle_id;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.notify_passengers(new.id, 'passenger.trip', 'Trip cancelled', v_line);
  elsif new.status = 'in_progress' and old.status in ('assigned', 'declined') then
    perform public.notify_passengers(new.id, 'passenger.moving', 'On the way · ' || coalesce(v_driver, '') || ' · ' || coalesce(v_plate, ''), v_line);
  elsif new.accepted_at is not null and old.accepted_at is null and new.status = 'assigned' then
    perform public.notify_passengers(new.id, 'passenger.trip', 'Driver accepted · ' || coalesce(v_driver, ''), v_line);
  elsif new.late_report_min is not null and new.late_report_at is distinct from old.late_report_at then
    perform public.notify_passengers(new.id, 'passenger.moving', 'Running late · ' || new.late_report_min || ' min', v_line);
  elsif new.status in ('assigned', 'in_progress') and (
          new.employee_id is distinct from old.employee_id or new.vehicle_id is distinct from old.vehicle_id
          or new.start_at is distinct from old.start_at or new.leave_by is distinct from old.leave_by
          or new.plan_version is distinct from old.plan_version) then
    perform public.notify_passengers(new.id, 'passenger.trip', 'Trip changed',
      concat_ws(' · ', v_line,
        case when new.employee_id is distinct from old.employee_id then 'driver ' || coalesce(v_driver, '') end,
        case when new.vehicle_id is distinct from old.vehicle_id then 'vehicle ' || coalesce(v_plate, '') end,
        case when new.plan_version is distinct from old.plan_version and new.start_at is not distinct from old.start_at
             and new.leave_by is not distinct from old.leave_by then 'stops changed' end));
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_notify_passengers() from public, anon, authenticated;
create trigger tasks_notify_passengers after update on public.tasks
  for each row execute function public.tasks_notify_passengers();

-- Each stop reached.
create function public.task_stops_notify_passengers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = new.task_id;
  perform public.notify_passengers(new.task_id, 'passenger.moving',
    'Arrived at ' || new.place_name || ' · ' || to_char(coalesce(new.arrived_at, now()) at time zone 'Asia/Colombo', 'HH24:MI'),
    public.passenger_trip_line(coalesce(v_task.leave_by, v_task.start_at), v_task.title));
  return null;
end;
$$;
revoke all on function public.task_stops_notify_passengers() from public, anon, authenticated;
create trigger task_stops_notify_passengers after update of status on public.task_stops
  for each row when (new.status = 'arrived' and old.status is distinct from 'arrived')
  execute function public.task_stops_notify_passengers();

-- Added to a trip: told once, with the trip (a registered person only).
create function public.task_passengers_notify_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  if new.employee_id is null or not public.fleet_switch('passengers') then
    return null;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if not found or v_task.demo or v_task.status not in ('assigned', 'in_progress')
     or new.employee_id = v_task.employee_id then
    return null;
  end if;
  perform public.queue_notification('passenger.trip', jsonb_build_object(
    'title', 'You''re on a trip', 'body', public.passenger_trip_line(coalesce(v_task.leave_by, v_task.start_at), v_task.title),
    'url', '/my-trips/' || new.task_id, 'tag', 'passenger:' || new.task_id, 'task_id', new.task_id, 'who', new.added_by),
    array[new.employee_id]);
  return null;
end;
$$;
revoke all on function public.task_passengers_notify_added() from public, anon, authenticated;
create trigger task_passengers_notify_added after insert on public.task_passengers
  for each row execute function public.task_passengers_notify_added();
