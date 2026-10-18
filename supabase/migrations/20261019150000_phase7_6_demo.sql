-- Phase 7, Part 6 (store readiness): a demo driver for the stores' reviewers, with seeded tasks, that never touches the
-- live drivers or the office's work (docs/store-release.md "The reviewers' account").
--
--   - employees.demo / vehicles.demo mark the demo driver and the demo vehicle; tasks, fuel_logs, odometer_logs,
--     vehicle_reports and duty_sessions carry demo too, set from the row's employee by a trigger (whatever the phone
--     sends), so the office's lists leave them out with demo = false (_shared/fleet: loadRefs and the list queries).
--   - Never mixed: a demo driver only with a demo vehicle and the other way round (tasks, vehicle_assignments,
--     duty_sessions refuse it), a real driver never sees the demo vehicle (my_vehicle_choices, the vehicles policy).
--   - Quiet: queue_notification tells the office nothing about a demo task or a demo vehicle's report.
--   - seed_demo_driver(username, days): marks a driver made with create_driver as the demo (refused for a driver with any
--     real history), makes the demo vehicle, and adds the tasks of the next days, quietly (no pushes, no reminders);
--     top_up_demo_tasks (pg_cron demo-tasks, nightly) keeps three days ahead.
--   - The office's "Used before" search leaves the demo's stops out (recent_places).

alter table public.employees add column demo boolean not null default false;
alter table public.vehicles add column demo boolean not null default false;
alter table public.tasks add column demo boolean not null default false;
alter table public.fuel_logs add column demo boolean not null default false;
alter table public.odometer_logs add column demo boolean not null default false;
alter table public.vehicle_reports add column demo boolean not null default false;
alter table public.duty_sessions add column demo boolean not null default false;

comment on column public.employees.demo is 'Part 6: the stores'' reviewers'' driver (seed_demo_driver); left out of every office list.';
comment on column public.vehicles.demo is 'Part 6: the demo driver''s vehicle; never offered to a real driver.';

-- The row's demo flag from its employee, and the vehicle must agree.
create function public.set_demo_from_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo boolean;
  v_vehicle_demo boolean;
begin
  select e.demo into v_demo from public.employees e where e.id = new.employee_id;
  new.demo := coalesce(v_demo, false);
  if new.vehicle_id is not null then
    select v.demo into v_vehicle_demo from public.vehicles v where v.id = new.vehicle_id;
    if coalesce(v_vehicle_demo, false) <> new.demo then
      raise exception 'demo_mix: the demo driver only drives the demo vehicle, and nobody else does'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_set_demo before insert or update of employee_id, vehicle_id on public.tasks
  for each row execute function public.set_demo_from_employee();
create trigger fuel_logs_set_demo before insert on public.fuel_logs
  for each row execute function public.set_demo_from_employee();
create trigger odometer_logs_set_demo before insert on public.odometer_logs
  for each row execute function public.set_demo_from_employee();
create trigger vehicle_reports_set_demo before insert on public.vehicle_reports
  for each row execute function public.set_demo_from_employee();
create trigger duty_sessions_set_demo before insert or update of vehicle_id on public.duty_sessions
  for each row execute function public.set_demo_from_employee();

-- Who holds which vehicle: the same rule (vehicle_assignments has no demo column of its own).
create function public.vehicle_assignments_no_demo_mix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select e.demo from public.employees e where e.id = new.employee_id), false)
     <> coalesce((select v.demo from public.vehicles v where v.id = new.vehicle_id), false) then
    raise exception 'demo_mix: the demo driver only drives the demo vehicle, and nobody else does'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger vehicle_assignments_no_demo_mix before insert or update of employee_id, vehicle_id on public.vehicle_assignments
  for each row execute function public.vehicle_assignments_no_demo_mix();

revoke all on function public.set_demo_from_employee() from public, anon, authenticated;
revoke all on function public.vehicle_assignments_no_demo_mix() from public, anon, authenticated;

-- Is the signed-in person the demo driver? Security definer: the vehicles policy reads it without reading employees through
-- RLS (the employees update policy reads vehicles: reading employees back from the vehicles policy loops).
create function public.current_employee_demo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.demo from public.employees e where e.id = public.current_employee_id()), false)
$$;
revoke all on function public.current_employee_demo() from public, anon;
grant execute on function public.current_employee_demo() to authenticated;

-- A real driver never sees the demo vehicle; the demo driver sees only it.
drop policy vehicles_select_active on public.vehicles;
create policy vehicles_select_active on public.vehicles
  for select to authenticated
  using (active and (select public.current_employee_id()) is not null and demo = (select public.current_employee_demo()));

-- my_vehicle_choices (Phase 7 Part 1, 20261015190000_phase7_duty.sql) with the same rule.
create or replace function public.my_vehicle_choices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_last uuid;
  v_demo boolean;
begin
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver') then
    raise exception 'Only a signed-in driver can list the vehicles to choose from';
  end if;
  select e.demo into v_demo from public.employees e where e.id = v_me;
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
    where v.active and v.demo = coalesce(v_demo, false)), '[]'::jsonb);
end;
$$;

-- queue_notification (Hotfix 2, 20261018150000_phase7_hotfix2.sql) says nothing about a demo task or a demo vehicle's
-- report: every SQL caller about a task puts its task_id in the payload, "Another vehicle needed" its report in the tag.
create or replace function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_event is null or p_payload is null or coalesce(array_length(p_recipients, 1), 0) = 0 then
    return 0;
  end if;
  -- Part 6: the reviewers' demo stays out of the office's notifications.
  if (p_payload ->> 'task_id') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.tasks t where t.id = (p_payload ->> 'task_id')::uuid and t.demo) then
    return 0;
  end if;
  if (p_payload ->> 'tag') ~ '^vehicle-needed:[0-9a-f-]{36}$'
     and exists (select 1 from public.vehicle_reports r
                 where r.id = split_part(p_payload ->> 'tag', ':', 2)::uuid and r.demo) then
    return 0;
  end if;
  -- Hotfix 2 (A): everyone told has it in their notification centre, with or without a browser for Web Push.
  insert into public.office_inbox (employee_id, event, title, body, url, who)
  select r.id, p_event, coalesce(nullif(p_payload ->> 'title', ''), p_event), p_payload ->> 'body', p_payload ->> 'url',
         p_payload ->> 'who'
  from (select distinct unnest(p_recipients) as id) r
  join public.employees e on e.id = r.id
  where e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
    and not exists (select 1 from public.notification_settings s
                    where s.employee_id = r.id and s.event = p_event and not s.enabled);
  -- The Web Push outbox, as before: only for a browser that has it on.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id)
    select p_event, p_payload, r.id
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.web_push_subscriptions w
                  where w.employee_id = r.id and w.removed_at is null)
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- The reviewers' driver: made first with create_driver (the sign-in and the phone), then marked here. The tasks: one every
-- four hours around the clock (a reviewer anywhere in the world finds one coming up), on public places in Colombo, for
-- each of the next p_days days that has none yet. Run again later to top them up. Answers what it did.
create function public.seed_demo_driver(p_username text, p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver  public.employees%rowtype;
  v_vehicle uuid;
  v_day     date;
  v_slot    integer;
  v_start   timestamptz;
  v_task    uuid;
  v_added   integer := 0;
  v_trips   constant jsonb := '[
    {"title": "Demo · Station pickup", "from": "Colombo Fort Railway Station", "flat": 6.9339, "flng": 79.8500,
     "to": "Galle Face Green", "tlat": 6.9271, "tlng": 79.8446},
    {"title": "Demo · Park drop", "from": "Viharamahadevi Park", "flat": 6.9134, "flng": 79.8618,
     "to": "Colombo National Museum", "tlat": 6.9100, "tlng": 79.8610},
    {"title": "Demo · Harbour visit", "from": "Galle Face Green", "flat": 6.9271, "flng": 79.8446,
     "to": "Gangaramaya Temple", "tlat": 6.9167, "tlng": 79.8567}]';
  v_trip    jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'p_days: 1 to 60';
  end if;
  select * into v_driver from public.employees e where e.username = lower(btrim(p_username));
  if v_driver.id is null or v_driver.role <> 'driver' or not v_driver.active then
    raise exception 'No active driver with the username %: make them with create_driver first', p_username;
  end if;
  if not v_driver.demo then
    if v_driver.current_vehicle_id is not null
       or exists (select 1 from public.tasks t where t.employee_id = v_driver.id)
       or exists (select 1 from public.duty_sessions d where d.employee_id = v_driver.id)
       or exists (select 1 from public.vehicle_assignments a where a.employee_id = v_driver.id)
       or exists (select 1 from public.location_points l where l.employee_id = v_driver.id)
       or exists (select 1 from public.driver_heartbeats h where h.employee_id = v_driver.id)
       or exists (select 1 from public.fuel_logs f where f.employee_id = v_driver.id)
       or exists (select 1 from public.odometer_logs o where o.employee_id = v_driver.id)
       or exists (select 1 from public.vehicle_reports r where r.employee_id = v_driver.id) then
      raise exception '% already has real history (a vehicle, tasks, duty, locations, logs): a live driver is never made the demo', v_driver.name;
    end if;
    update public.employees set demo = true where id = v_driver.id;
  end if;

  select v.id into v_vehicle from public.vehicles v where v.demo order by v.created_at limit 1;
  if v_vehicle is null then
    insert into public.vehicles (reg_no, make_model, vehicle_type, seats, current_odometer_km, monthly_km_allowance, demo)
    values ('DEMO-0001', 'Toyota HiAce (demo)', 'van', 12, 100000, 3000, true)
    returning id into v_vehicle;
  end if;

  -- Quiet: no "new task" push for each seeded task (tasks_notify_push), and no reminder bursts at Start work.
  perform set_config('fleet.quiet', 'on', true);
  for v_day in select generate_series((now() at time zone 'Asia/Colombo')::date,
                                      (now() at time zone 'Asia/Colombo')::date + (p_days - 1), interval '1 day')::date loop
    continue when exists (select 1 from public.tasks t where t.employee_id = v_driver.id and t.kind = 'dispatch'
                          and (t.start_at at time zone 'Asia/Colombo')::date = v_day);
    for v_slot in 0..5 loop
      v_start := (v_day + make_interval(hours => 2 + v_slot * 4, mins => 30)) at time zone 'Asia/Colombo';
      continue when v_start < now();
      v_trip := v_trips -> (v_slot % 3);
      insert into public.tasks (title, label, employee_id, vehicle_id, start_at, leave_by, leave_by_source, end_by,
                                passengers, contact_name, notes, created_by,
                                accept_reminder_sent_at, reminder_30_sent_at, reminder_0_sent_at)
      values (v_trip ->> 'title', 'Demo', v_driver.id, v_vehicle, v_start, v_start, 'manual', v_start + interval '2 hours',
              2, 'Demo contact', 'A demo task for the store review. Nothing here is real.', 'seed_demo_driver',
              now(), now(), now())
      returning id into v_task;
      insert into public.task_stops (task_id, seq, type, place_name, lat, lng, what)
      values (v_task, 1, 'pickup', v_trip ->> 'from', (v_trip ->> 'flat')::double precision, (v_trip ->> 'flng')::double precision, 'people'),
             (v_task, 2, 'drop', v_trip ->> 'to', (v_trip ->> 'tlat')::double precision, (v_trip ->> 'tlng')::double precision, 'people');
      v_added := v_added + 1;
    end loop;
  end loop;

  perform set_config('fleet.quiet', 'off', true);
  return jsonb_build_object('driver', v_driver.username, 'vehicle', 'DEMO-0001', 'tasks_added', v_added,
                            'days', p_days);
end;
$$;

revoke all on function public.seed_demo_driver(text, integer) from public, anon, authenticated;
grant execute on function public.seed_demo_driver(text, integer) to service_role;

-- Nightly: every active demo driver keeps three days of tasks ahead (a reviewer may come back days later).
create function public.top_up_demo_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_added    integer := 0;
begin
  for v_username in select e.username from public.employees e where e.demo and e.active and e.username is not null loop
    v_added := v_added + coalesce((public.seed_demo_driver(v_username, 3) ->> 'tasks_added')::integer, 0);
  end loop;
  return v_added;
end;
$$;
revoke all on function public.top_up_demo_tasks() from public, anon, authenticated;
select cron.schedule('demo-tasks', '20 21 * * *', $$select public.top_up_demo_tasks()$$);

-- recent_places (as in 20261018090000_phase7_trips.sql, which left personal trips out): the office's "Used before" layer
-- also leaves the demo's stops and starts out.
create or replace function public.recent_places(p_text text, p_since timestamptz, p_limit integer default 5)
returns table (name text, address text, lat double precision, lng double precision, last_used timestamptz, uses bigint)
language sql
stable
set search_path = public, extensions
as $$
  with q as (select replace(replace(replace(lower(trim(p_text)), '\', '\\'), '%', '\%'), '_', '\_') as e),
  used as (
    select s.place_name as name, s.address, s.lat, s.lng, t.start_at as at
    from public.task_stops s join public.tasks t on t.id = s.task_id, q
    where s.place_id is null and s.google_place_id is null and s.status <> 'removed' and t.start_at >= p_since
      and t.purpose <> 'personal' and not t.demo
      and s.place_name ilike '%' || q.e || '%'
    union all
    select t.start_name, null, t.start_lat, t.start_lng, t.start_at
    from public.tasks t, q
    where t.start_place_id is null and t.start_google_place_id is null and t.start_name is not null and t.start_at >= p_since
      and t.purpose <> 'personal' and not t.demo
      and t.start_name ilike '%' || q.e || '%'
    union all
    select r.route_from, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_from ilike '%' || q.e || '%'
    union all
    select r.route_to, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_to ilike '%' || q.e || '%'
  ),
  grouped as (
    select lower(trim(u.name)) as k,
           (array_agg(trim(u.name) order by (u.lat is null), u.at desc))[1] as name,
           (array_agg(u.address order by (u.address is null), u.at desc))[1] as address,
           (array_agg(u.lat order by (u.lat is null), u.at desc))[1] as lat,
           (array_agg(u.lng order by (u.lat is null), u.at desc))[1] as lng,
           max(u.at) as last_used,
           count(*) as uses
    from used u
    where trim(coalesce(u.name, '')) <> ''
    group by lower(trim(u.name))
  )
  select g.name, g.address, g.lat, g.lng, g.last_used, g.uses
  from grouped g, q
  -- not the name of one of our places (those show in the first layer)
  where not exists (select 1 from public.places p where lower(p.name) = g.k)
  order by (g.k like q.e || '%') desc, g.uses desc, g.last_used desc
  limit greatest(1, least(p_limit, 20))
$$;
