-- Round 4–7, feature 4a (Sahan, 22 October 2026): the vehicle check before work, Samsara / Motive's pre-trip inspection
-- and Turo's check-in. Whenever a driver takes a vehicle (Start work, Change vehicle, Start task, the vehicle confirmed on
-- the day) and has not checked it today, the app asks "Any damage or problem with <plate>?": "No, all good" is one tap;
-- "Yes" takes a category, 1–6 photos and a note and makes a vehicle report marked pre-trip (its check_id). A self-driver
-- or the person a someone-else trip is booked on answers the same question in Office mode, /m/ or the site (channel
-- office, through office-api). The office sees each vehicle's check of the day and the pre-trip problems in Issues.
-- One notification per check with a problem, to the people with the issues permission: breakdown and accident urgent
-- (vehicle.check_urgent), the rest normal (vehicle.check_problem). The switch vehicle_check (Settings → Dispatch) turns
-- the question off; what was recorded stays.

-- 1. A sixth category: Damage (dents, scratches, glass): what a check before work finds most.
alter table public.vehicle_reports drop constraint vehicle_reports_category_check;
alter table public.vehicle_reports add constraint vehicle_reports_category_check
  check (category in ('breakdown', 'accident', 'tyre', 'warning_light', 'damage', 'other'));

-- 2. The checks. The id is made where the check is answered, so a retry from the phone's queue never doubles it.
create table public.vehicle_checks (
  id          uuid primary key,
  vehicle_id  uuid not null references public.vehicles (id),
  employee_id uuid not null references public.employees (id),
  task_id     uuid references public.tasks (id),
  checked_at  timestamptz not null,
  result      text not null,
  odometer_km integer,
  how         text not null,
  channel     text not null default 'app',
  demo        boolean not null default false,
  received_at timestamptz not null default now(),
  constraint vehicle_checks_result_check check (result in ('ok', 'problem')),
  constraint vehicle_checks_how_check check (how in ('clock_in', 'change', 'task_start', 'vehicle_confirm', 'trip')),
  constraint vehicle_checks_channel_check check (channel in ('app', 'office')),
  constraint vehicle_checks_odometer_check check (odometer_km >= 0),
  -- A phone's clock may run a little ahead; never a check from the future.
  constraint vehicle_checks_not_future check (checked_at <= received_at + interval '10 minutes')
);
comment on table public.vehicle_checks is
  'Round 4–7 (4a): a vehicle check before work: ok = "No, all good", problem = the report (vehicle_reports.check_id) it made.';
create index vehicle_checks_vehicle_idx on public.vehicle_checks (vehicle_id, checked_at desc);
create index vehicle_checks_employee_idx on public.vehicle_checks (employee_id, checked_at desc);
create index vehicle_checks_task_idx on public.vehicle_checks (task_id) where task_id is not null;

alter table public.vehicle_checks enable row level security;
-- The driver writes and reads their own (the app reads today's back after a fresh sign-in; the queue's upsert reads too).
create policy vehicle_checks_select_own on public.vehicle_checks
  for select to authenticated using (employee_id = (select public.current_employee_id()));
create policy vehicle_checks_insert_own on public.vehicle_checks
  for insert to authenticated with check (employee_id = (select public.current_employee_id()) and channel = 'app');
grant select on public.vehicle_checks to authenticated;
grant insert (id, vehicle_id, employee_id, task_id, checked_at, result, odometer_km, how) on public.vehicle_checks to authenticated;

create trigger vehicle_checks_set_demo before insert on public.vehicle_checks
  for each row execute function public.set_demo_from_employee();

-- The driver app's check in the activity log, like its reports (the office's go through run.ts).
create function public.audit_driver_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'authenticated' then
    return null;
  end if;
  insert into public.office_audit (tool, args_summary, result_summary, actor_employee_id, actor_name, channel)
  select 'driver_vehicle_check',
         jsonb_build_object('check_id', new.id, 'vehicle_id', new.vehicle_id, 'result', new.result, 'how', new.how)::text,
         case new.result when 'ok' then 'all good' else 'a problem reported' end,
         new.employee_id, e.name, 'driver'
  from public.employees e
  where e.id = new.employee_id;
  return null;
end;
$$;
revoke all on function public.audit_driver_check() from public, anon, authenticated;
create trigger vehicle_checks_audit_driver after insert on public.vehicle_checks
  for each row execute function public.audit_driver_check();

-- 3. A report made by a check: pre-trip. The driver sends it right after the check (the queue keeps the order).
alter table public.vehicle_reports add column check_id uuid references public.vehicle_checks (id);
comment on column public.vehicle_reports.check_id is 'Round 4–7 (4a): the vehicle check that found this problem (a pre-trip problem).';
create unique index vehicle_reports_check_idx on public.vehicle_reports (check_id) where check_id is not null;
grant insert (check_id) on public.vehicle_reports to authenticated;

-- Only the driver's own check, of the same vehicle.
create function public.vehicle_reports_check_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.vehicle_checks c
                 where c.id = new.check_id and c.employee_id = new.employee_id and c.vehicle_id = new.vehicle_id) then
    raise exception 'check_mismatch: a pre-trip report belongs to the same person''s check of the same vehicle'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.vehicle_reports_check_matches() from public, anon, authenticated;
create trigger vehicle_reports_check_matches before insert or update of check_id on public.vehicle_reports
  for each row when (new.check_id is not null) execute function public.vehicle_reports_check_matches();

-- 4. Photos: the optional four of an all-good check (front, back, left, right). A problem's photos stay the report's.
alter table public.photos
  add column vehicle_check_id uuid references public.vehicle_checks (id),
  add column side text;
alter table public.photos add constraint photos_side_check check (side is null or side in ('front', 'back', 'left', 'right'));
alter table public.photos drop constraint photos_kind_check;
alter table public.photos add constraint photos_kind_check
  check (kind in ('odometer', 'fuel_receipt', 'vehicle_report', 'bill', 'profile', 'licence', 'vehicle_check'));
alter table public.photos drop constraint photos_one_link;
alter table public.photos add constraint photos_one_link
  check (num_nonnulls(odometer_log_id, fuel_log_id, vehicle_report_id, claim_line_id, vehicle_check_id) <= 1);
create index photos_vehicle_check_idx on public.photos (vehicle_check_id) where vehicle_check_id is not null;

drop policy photos_insert_own on public.photos;
create policy photos_insert_own on public.photos
  for insert to authenticated
  with check (
    employee_id = (select public.current_employee_id())
    and odometer_log_id is null
    and fuel_log_id is null
    and claim_line_id is null
    and (
      vehicle_report_id is null
      or exists (
        select 1 from public.vehicle_reports r
        where r.id = photos.vehicle_report_id
          and r.employee_id = (select public.current_employee_id())
      )
    )
    and (
      vehicle_check_id is null
      or exists (
        select 1 from public.vehicle_checks c
        where c.id = photos.vehicle_check_id
          and c.employee_id = (select public.current_employee_id())
      )
    )
  );

-- 5. One notification per check with a problem (never per photo): to everyone with the issues permission but the person
-- who found it. Breakdown and accident are urgent; the rest normal. The issue the sync opens for it does not push again.
create function public.notify_check_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg   text;
  v_name  text;
  v_cat   text;
  v_event text;
  v_to    uuid[];
begin
  if new.check_id is null or new.demo then
    return null;
  end if;
  select v.reg_no into v_reg from public.vehicles v where v.id = new.vehicle_id;
  select e.name into v_name from public.employees e where e.id = new.employee_id;
  v_cat := case new.category
    when 'breakdown' then 'Breakdown' when 'accident' then 'Accident' when 'tyre' then 'Tyre'
    when 'warning_light' then 'Warning light' when 'damage' then 'Damage' else 'Other problem' end;
  v_event := case when new.category in ('breakdown', 'accident') then 'vehicle.check_urgent' else 'vehicle.check_problem' end;
  select coalesce(array_agg(e.id), '{}') into v_to
  from public.employees e
  where e.active and not e.demo and 'issues' = any (e.permissions) and e.id <> new.employee_id;
  perform public.queue_notification(
    v_event,
    jsonb_build_object(
      'title', 'Pre-trip check: ' || v_cat || ' · ' || coalesce(v_reg, ''),
      'body', concat_ws(' · ', v_name, nullif(btrim(coalesce(new.note, '')), '')),
      'url', '/vehicles/' || replace(coalesce(v_reg, ''), ' ', '%20') || '?check=' || new.check_id,
      'tag', 'check:' || new.check_id,
      'who', v_name),
    v_to);
  return null;
end;
$$;
revoke all on function public.notify_check_problem() from public, anon, authenticated;
create trigger vehicle_reports_notify_check after insert on public.vehicle_reports
  for each row when (new.check_id is not null) execute function public.notify_check_problem();
