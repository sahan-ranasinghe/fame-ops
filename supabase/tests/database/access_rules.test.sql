-- Access rules of the Fame Fleet database, checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)
--
-- Cast: driver A (Nuwan) and driver B (Kasun) are active; C has been
-- deactivated; D has an Auth account but no employee row.

begin;

-- The checks below count rows, so they need a database with no fleet data in it.
do $$
begin
  if exists (select 1 from public.employees) or exists (select 1 from public.vehicles) then
    raise exception 'These tests need an empty local database. Run first: npx supabase db reset --local';
  end if;
end;
$$;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (created as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 't.nuwan@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 't.kasun@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000c1', 't.left@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000d1', 'stranger@example.invalid');

insert into public.rental_companies (id, name) values
  ('21000000-0000-0000-0000-000000000001', 'Test Rent-a-Car');

insert into public.vehicles (id, reg_no, make_model, vehicle_type, seats, rental_company_id,
                             monthly_rent_cents, monthly_km_allowance, current_odometer_km, active) values
  ('20000000-0000-0000-0000-000000000001', 'WP CAB-4521', 'Toyota HiAce', 'van', 14,
   '21000000-0000-0000-0000-000000000001', 18000000, 3000, 84512, true),
  ('20000000-0000-0000-0000-000000000002', 'WP PH-2087', 'Nissan Caravan', 'van', 12,
   '21000000-0000-0000-0000-000000000001', 16000000, 3000, 51200, true),
  ('20000000-0000-0000-0000-000000000003', 'WP ZZ-0001', 'Returned van', 'van', 10,
   null, null, null, null, false);

insert into public.employees (id, code, name, username, auth_user_id, active, current_vehicle_id) values
  ('10000000-0000-0000-0000-0000000000a1', 'T001', 'Test Nuwan', 't.nuwan',
   '00000000-0000-0000-0000-0000000000a1', true, '20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-0000000000b1', 'T002', 'Test Kasun', 't.kasun',
   '00000000-0000-0000-0000-0000000000b1', true, '20000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-0000000000c1', 'T003', 'Test Left', 't.left',
   '00000000-0000-0000-0000-0000000000c1', false, null);

insert into public.places (id, name, kind) values
  ('30000000-0000-0000-0000-000000000001', 'Test head office', 'office');

insert into public.projects (id, zoho_project_id, job_no, short_name, name, customer_name, status) values
  ('40000000-0000-0000-0000-000000000001', 'test-1', '13021', 'TRKAN1', '13021_TRKAN1', 'Test customer 1', 'active'),
  ('40000000-0000-0000-0000-000000000002', 'test-2', '13036', 'MS', '13036_MS', 'Test customer 2', 'active');

insert into public.tasks (id, title, label, employee_id, vehicle_id, start_at, passengers, created_by) values
  ('50000000-0000-0000-0000-000000000001', 'Team drop · Kurunegala site', 'ESL rollout',
   '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001', now() + interval '1 hour', 5, 'test'),
  ('50000000-0000-0000-0000-000000000002', 'Material pickup', 'Stores',
   '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000002', now() + interval '1 hour', null, 'test'),
  ('50000000-0000-0000-0000-000000000003', 'Return team · Head office', 'ESL rollout',
   '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001', now() + interval '6 hours', 5, 'test');

insert into public.task_stops (id, task_id, seq, type, place_id, place_name) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, 'pickup',
   '30000000-0000-0000-0000-000000000001', 'Test head office'),
  ('51000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 2, 'drop', null, 'Kurunegala tower site'),
  ('51000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 1, 'pickup', null, 'Colombo 10 store'),
  ('51000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 1, 'pickup', null, 'Kurunegala tower site');

insert into public.task_projects (task_id, project_id, percent) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 60),
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 40),
  ('50000000-0000-0000-0000-000000000002', null, 100);

insert into public.duty_sessions (id, employee_id, vehicle_id) values
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000002');

insert into public.photos (id, employee_id, kind, storage_path) values
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000b1', 'odometer',
   '10000000-0000-0000-0000-0000000000b1/2026-10-07/70000000-0000-0000-0000-000000000004.jpg');

insert into public.vehicle_reports (id, vehicle_id, employee_id, category, note) values
  ('82000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-0000000000b1', 'other', 'Kasun''s report');

-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  23::bigint, 'there are 23 tables in public');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'RLS is on for every table');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
           or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE'))),
  0::bigint, 'anon has no privilege on any table');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint, 'anon cannot call any function');

select is(
  (select count(*) from pg_policies where schemaname = 'public'),
  24::bigint, 'there are 24 policies on public tables');

select is(
  (select count(*) from pg_policies
    where (schemaname = 'public' or (schemaname = 'storage' and policyname like 'driver_photos%'))
      and roles <> '{authenticated}'::name[]),
  0::bigint, 'every policy is for signed-in users only (none for anon)');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE')
           or has_table_privilege('service_role', c.oid, 'DELETE, TRUNCATE'))),
  0::bigint, 'neither drivers nor the office connector can delete from any table');

select results_eq(
  $$ select a.attname::text collate "default" from pg_attribute a
     where a.attrelid = 'public.vehicles'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
     order by a.attname $$,
  array['active', 'current_odometer_km', 'id', 'in_garage', 'make_model',
        'monthly_km_allowance', 'reg_no', 'seats', 'vehicle_type'],
  'drivers can read exactly nine vehicle columns, no others');

select is(
  (select public from storage.buckets where id = 'driver-photos'),
  false, 'bucket driver-photos exists and is private');

select is(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('tasks', 'task_stops')),
  2::bigint, 'tasks and task_stops are published to Realtime');

select is((select count(*) from public.towns), 17837::bigint, 'towns seed has 17,837 rows');

select is(
  (select name from public.towns where id = 1229950),
  'Polgahawela', 'towns contains Polgahawela');

create table public._later_table (id integer);

select is(
  has_table_privilege('anon', 'public._later_table', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public._later_table', 'SELECT, INSERT, UPDATE, DELETE'),
  false, 'a table created by a later migration is not open to anon or drivers by default');

-- ---------------------------------------------------------------------------
-- 2. anon (the key inside the app, before sign-in)
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok('select count(*) from public.employees', '42501',
  'permission denied for table employees', 'anon cannot read employees');
select throws_ok('select count(*) from public.tasks', '42501',
  'permission denied for table tasks', 'anon cannot read tasks');
select throws_ok('select count(*) from public.towns', '42501',
  'permission denied for table towns', 'anon cannot read towns');
select throws_ok('select public.current_employee_id()', '42501',
  'permission denied for function current_employee_id', 'anon cannot call current_employee_id()');

reset role;

-- ---------------------------------------------------------------------------
-- 3. Driver A: reading
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(public.current_employee_id(), '10000000-0000-0000-0000-0000000000a1'::uuid,
  'current_employee_id() is the signed-in driver');

select results_eq('select code from public.employees', array['T001'],
  'driver sees only their own employee row');

select results_eq('select reg_no from public.vehicles order by reg_no', array['WP CAB-4521', 'WP PH-2087'],
  'driver sees active vehicles only');

select results_eq(
  $$ select id::text, reg_no, make_model, vehicle_type, seats, current_odometer_km,
            monthly_km_allowance, in_garage, active
     from public.vehicles where reg_no = 'WP CAB-4521' $$,
  $$ values ('20000000-0000-0000-0000-000000000001', 'WP CAB-4521', 'Toyota HiAce', 'van',
             14, 84512, 3000, false, true) $$,
  'driver can read the nine allowed vehicle columns by name');

select throws_ok('select monthly_rent_cents from public.vehicles', '42501',
  'permission denied for table vehicles', 'driver cannot read monthly_rent_cents');
select throws_ok('select rent_until from public.vehicles', '42501',
  'permission denied for table vehicles', 'driver cannot read rent_until');
select throws_ok('select rental_company_id from public.vehicles', '42501',
  'permission denied for table vehicles', 'driver cannot read rental_company_id');
select throws_ok(
  'select regular_driver_id, next_service_date, garage_booked_date, licence_expiry, insurance_expiry, emission_expiry from public.vehicles',
  '42501', 'permission denied for table vehicles',
  'driver cannot read regular driver, service or document details');
select throws_ok('select * from public.vehicles', '42501',
  'permission denied for table vehicles', 'select * on vehicles fails for a driver, so the app must name the columns');
select throws_ok('select reg_no from public.vehicles where monthly_rent_cents > 0', '42501',
  'permission denied for table vehicles', 'driver cannot filter on a hidden column');
select throws_ok('select reg_no from public.vehicles order by rent_until', '42501',
  'permission denied for table vehicles', 'driver cannot sort by a hidden column');
select throws_ok(
  $$ select t.title, v.monthly_rent_cents from public.tasks t join public.vehicles v on v.id = t.vehicle_id $$,
  '42501', 'permission denied for table vehicles', 'driver cannot reach rent through their tasks');

select is((select count(*) from public.places), 1::bigint, 'driver can read places');
select is((select count(*) from public.projects), 2::bigint, 'driver can read projects');
select is((select count(*) from public.towns), 17837::bigint, 'driver can read towns');

select results_eq('select id::text from public.tasks order by id',
  array['50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003'],
  'driver sees only their own tasks');

select is((select count(*) from public.task_stops), 3::bigint, 'driver sees only the stops of their own tasks');
select is((select count(*) from public.task_projects), 2::bigint, 'driver sees only the project split of their own tasks');

select throws_ok('select 1 from public.vehicle_requests', '42501',
  'permission denied for table vehicle_requests', 'driver cannot read vehicle requests');
select throws_ok('select 1 from public.office_audit', '42501',
  'permission denied for table office_audit', 'driver cannot read the office audit log');
select throws_ok('select 1 from public.driver_latest', '42501',
  'permission denied for table driver_latest', 'driver cannot read driver_latest');
select throws_ok('select 1 from public.rental_companies', '42501',
  'permission denied for table rental_companies', 'driver cannot read rental companies');
select throws_ok('select 1 from public.claims', '42501',
  'permission denied for table claims', 'driver cannot read claims (Phase C)');

-- ---------------------------------------------------------------------------
-- 4. Driver A: own employee row
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.employees set language = 'si', current_vehicle_id = '20000000-0000-0000-0000-000000000002'
     where id = '10000000-0000-0000-0000-0000000000a1' $$,
  'driver can change their language and current vehicle');

select throws_ok(
  $$ update public.employees set current_vehicle_id = '20000000-0000-0000-0000-000000000003'
     where id = '10000000-0000-0000-0000-0000000000a1' $$,
  '42501', 'new row violates row-level security policy for table "employees"',
  'driver cannot pick a vehicle that is not active');

select throws_ok(
  $$ update public.employees set name = 'Boss', role = 'admin' where id = '10000000-0000-0000-0000-0000000000a1' $$,
  '42501', 'permission denied for table employees', 'driver cannot change their name or role');

select is_empty(
  $$ update public.employees set language = 'si' where id = '10000000-0000-0000-0000-0000000000b1' returning 1 $$,
  'driver cannot change another employee');

-- ---------------------------------------------------------------------------
-- 5. Driver A: tasks and stops
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.tasks set seen_at = now() + interval '3 days' where id = '50000000-0000-0000-0000-000000000001' $$,
  'driver can record seen_at');

select is((select seen_at from public.tasks where id = '50000000-0000-0000-0000-000000000001'), now(),
  'seen_at is never later than now');

select lives_ok(
  $$ update public.tasks set seen_at = now() - interval '1 hour' where id = '50000000-0000-0000-0000-000000000001' $$,
  'a second seen_at write is accepted');

select is((select seen_at from public.tasks where id = '50000000-0000-0000-0000-000000000001'), now(),
  'but seen_at keeps its first value');

select throws_ok(
  $$ update public.tasks set title = 'Changed' where id = '50000000-0000-0000-0000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'driver cannot edit task details');

select throws_ok(
  $$ update public.tasks set status = 'in_progress' where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Start odometer is required to start a task', 'starting a task needs the start odometer');

select throws_ok(
  $$ update public.tasks set status = 'cancelled' where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Drivers cannot change a task from assigned to cancelled', 'driver cannot cancel a task');

select throws_ok(
  $$ update public.tasks set status = 'completed', start_odometer_km = 1, end_odometer_km = 2
     where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Drivers cannot change a task from assigned to completed', 'driver cannot skip straight to completed');

select is_empty(
  $$ update public.task_stops set status = 'arrived' where id = '51000000-0000-0000-0000-000000000001' returning 1 $$,
  'driver cannot mark a stop before the task is started');

select lives_ok(
  $$ update public.tasks set status = 'in_progress', start_odometer_km = 84512
     where id = '50000000-0000-0000-0000-000000000001' $$,
  'driver can start their own task');

select isnt((select started_at from public.tasks where id = '50000000-0000-0000-0000-000000000001'), null,
  'started_at is filled in by the server');

select throws_ok(
  $$ update public.tasks set status = 'in_progress', start_odometer_km = 84512
     where id = '50000000-0000-0000-0000-000000000003' $$,
  '23505', 'duplicate key value violates unique constraint "tasks_one_in_progress_per_driver"',
  'driver cannot have two tasks in progress');

select isnt_empty(
  $$ update public.task_stops set status = 'arrived', arrived_at = now()
     where id = '51000000-0000-0000-0000-000000000001' returning 1 $$,
  'driver can mark a stop of the task in progress');

select throws_ok(
  $$ update public.task_stops set place_name = 'Elsewhere' where id = '51000000-0000-0000-0000-000000000001' $$,
  '42501', 'permission denied for table task_stops', 'driver cannot change where a stop is');

select is_empty(
  $$ update public.task_stops set status = 'done' where id = '51000000-0000-0000-0000-000000000003' returning 1 $$,
  'driver cannot touch the stops of another driver''s task');

select throws_ok(
  $$ update public.tasks set status = 'completed', end_odometer_km = 84000
     where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'End odometer (84000) is lower than start odometer (84512)', 'end odometer below start is refused');

select lives_ok(
  $$ update public.tasks set status = 'completed', end_odometer_km = 84563
     where id = '50000000-0000-0000-0000-000000000001' $$,
  'driver can complete their own task');

select is((select km from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 51,
  'task km = end odometer - start odometer');

select throws_ok(
  $$ update public.tasks set end_odometer_km = 90000 where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Times and odometer readings are set only when starting or completing a task',
  'driver cannot edit a finished task');

select throws_ok(
  $$ update public.tasks set status = 'in_progress' where id = '50000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Drivers cannot change a task from completed to in_progress', 'driver cannot reopen a finished task');

select is_empty(
  $$ update public.tasks set seen_at = now() where id = '50000000-0000-0000-0000-000000000002' returning 1 $$,
  'driver cannot update another driver''s task');

select lives_ok(
  $$ update public.tasks set status = 'in_progress', start_odometer_km = 84563
     where id = '50000000-0000-0000-0000-000000000003' $$,
  'driver can start the next task once the first is finished');

select is((select seen_at from public.tasks where id = '50000000-0000-0000-0000-000000000003'), null,
  'starting a task does not invent a seen_at');

select throws_ok(
  $$ delete from public.tasks where id = '50000000-0000-0000-0000-000000000003' $$,
  '42501', 'permission denied for table tasks', 'driver cannot delete a task');

-- ---------------------------------------------------------------------------
-- 6. Driver A: sharing location
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.duty_sessions (id, employee_id, vehicle_id)
     values ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1',
             '20000000-0000-0000-0000-000000000001') $$,
  'driver can start sharing');

select throws_ok(
  $$ insert into public.duty_sessions (employee_id) values ('10000000-0000-0000-0000-0000000000a1') $$,
  '23505', 'duplicate key value violates unique constraint "duty_sessions_one_open_per_employee"',
  'only one open sharing period per driver');

select throws_ok(
  $$ insert into public.duty_sessions (employee_id) values ('10000000-0000-0000-0000-0000000000c1') $$,
  '42501', 'new row violates row-level security policy for table "duty_sessions"',
  'driver cannot start sharing for someone else');

select lives_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, speed_mps, battery_pct) values
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() - interval '2 minutes', 7.3381, 80.3003, 15, 80),
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() - interval '1 minute', 7.35, 80.31, 15, 79) $$,
  'driver can upload their own location points');

select lives_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() - interval '10 minutes', 7.0, 80.0),
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() + interval '2 hours', 9.0, 81.0) $$,
  'an older point and a point with a future time are stored');

select lives_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() - interval '1 minute', 1, 1)
     on conflict (employee_id, recorded_at) do nothing $$,
  'a retried upload is ignored, not an error');

select is((select count(*) from public.location_points), 4::bigint,
  'driver sees their own 4 points (the retry added nothing)');

select throws_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
       ('10000000-0000-0000-0000-0000000000b1', '60000000-0000-0000-0000-0000000000b1', now(), 7, 80) $$,
  '42501', 'new row violates row-level security policy for table "location_points"',
  'driver cannot upload points as another driver');

select throws_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000b1', now(), 7, 80) $$,
  '42501', 'new row violates row-level security policy for table "location_points"',
  'driver cannot upload points into another driver''s sharing period');

select throws_ok(
  $$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, received_at) values
       ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        now() - interval '3 minutes', 7, 80, now() - interval '1 day') $$,
  '42501', 'permission denied for table location_points', 'driver cannot set received_at');

reset role;

select is(
  (select (lat, lng, sharing)::text from public.driver_latest
    where employee_id = '10000000-0000-0000-0000-0000000000a1'),
  '(7.35,80.31,t)',
  'driver_latest holds the newest point (older and future-dated points do not replace it) and sharing = true');

set local role authenticated;

select throws_ok(
  $$ update public.duty_sessions set ended_at = now(), end_reason = 'admin'
     where id = '60000000-0000-0000-0000-0000000000a1' $$,
  '42501', 'new row violates row-level security policy for table "duty_sessions"',
  'driver cannot use the office''s end reason');

select throws_ok(
  $$ update public.duty_sessions set vehicle_id = null where id = '60000000-0000-0000-0000-0000000000a1' $$,
  '42501', 'permission denied for table duty_sessions', 'driver cannot rewrite a sharing period');

select lives_ok(
  $$ update public.duty_sessions set ended_at = now(), end_reason = 'driver'
     where id = '60000000-0000-0000-0000-0000000000a1' $$,
  'driver can stop sharing');

select is_empty(
  $$ update public.duty_sessions set ended_at = now(), end_reason = 'auto'
     where id = '60000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'a closed sharing period cannot be changed again');

reset role;

select is(
  (select sharing from public.driver_latest where employee_id = '10000000-0000-0000-0000-0000000000a1'),
  false, 'driver_latest.sharing turns off when sharing stops');

-- ---------------------------------------------------------------------------
-- 7. Driver A: photos, odometer, fuel, vehicle reports, files
-- ---------------------------------------------------------------------------

set local role authenticated;

select lives_ok(
  $$ insert into public.photos (id, employee_id, kind, storage_path) values
       ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'odometer',
        '10000000-0000-0000-0000-0000000000a1/2026-10-07/70000000-0000-0000-0000-000000000001.jpg'),
       ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 'fuel_receipt',
        '10000000-0000-0000-0000-0000000000a1/2026-10-07/70000000-0000-0000-0000-000000000002.jpg') $$,
  'driver can add their own photo records');

select throws_ok(
  $$ insert into public.photos (employee_id, kind, storage_path) values
       ('10000000-0000-0000-0000-0000000000a1', 'odometer',
        '10000000-0000-0000-0000-0000000000b1/2026-10-07/x.jpg') $$,
  '23514', 'new row for relation "photos" violates check constraint "photos_path_in_own_folder"',
  'a photo record must point inside the driver''s own folder');

select throws_ok(
  $$ insert into public.photos (employee_id, kind, storage_path) values
       ('10000000-0000-0000-0000-0000000000b1', 'odometer',
        '10000000-0000-0000-0000-0000000000b1/2026-10-07/y.jpg') $$,
  '42501', 'new row violates row-level security policy for table "photos"',
  'driver cannot add a photo record as another driver');

select lives_ok(
  $$ insert into public.odometer_logs (id, vehicle_id, employee_id, task_id, reading_km, ocr_value, photo_id, kind) values
       ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000000001',
        84563, 84563, '70000000-0000-0000-0000-000000000001', 'task_end') $$,
  'driver can log an odometer reading with its photo');

select lives_ok(
  $$ insert into public.odometer_logs (vehicle_id, employee_id, reading_km, kind, logged_at) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1',
        84000, 'manual', now() - interval '1 day') $$,
  'an older reading that arrives late is stored');

-- Vehicle 2: a reading stamped tomorrow (wrong phone clock), then a normal one.
select lives_ok(
  $$ insert into public.odometer_logs (vehicle_id, employee_id, reading_km, kind, logged_at) values
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1',
        51210, 'manual', now() + interval '1 day') $$,
  'a reading with a future time is stored');

select lives_ok(
  $$ insert into public.odometer_logs (vehicle_id, employee_id, reading_km, kind) values
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 51230, 'manual') $$,
  'a normal reading after it is stored');

select throws_ok(
  $$ insert into public.odometer_logs (vehicle_id, employee_id, reading_km, kind) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 1, 'manual') $$,
  '42501', 'new row violates row-level security policy for table "odometer_logs"',
  'driver cannot log an odometer reading as another driver');

select throws_ok(
  $$ insert into public.odometer_logs (vehicle_id, employee_id, reading_km, kind, photo_id) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 84600, 'manual',
        '70000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Photo 70000000-0000-0000-0000-000000000004 is not an unused odometer photo of this employee',
  'driver cannot attach another driver''s photo to a reading');

select lives_ok(
  $$ insert into public.fuel_logs (id, vehicle_id, employee_id, task_id, litres, amount_cents, receipt_photo_id, odometer_km) values
       ('81000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000000001',
        32, 1184000, '70000000-0000-0000-0000-000000000002', 84563) $$,
  'driver can log fuel with its receipt photo');

select throws_ok(
  $$ insert into public.fuel_logs (vehicle_id, employee_id, litres) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 10) $$,
  '42501', 'new row violates row-level security policy for table "fuel_logs"',
  'driver cannot log fuel as another driver');

select lives_ok(
  $$ insert into public.vehicle_reports (id, vehicle_id, employee_id, category, note) values
       ('82000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-0000000000a1', 'tyre', 'Front left tyre is worn') $$,
  'driver can report a vehicle problem');

select is((select status from public.vehicle_reports where id = '82000000-0000-0000-0000-000000000001'),
  'open', 'a new report starts as open');

select throws_ok(
  $$ insert into public.vehicle_reports (vehicle_id, employee_id, category, status) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'tyre', 'closed') $$,
  '42501', 'permission denied for table vehicle_reports', 'driver cannot set a report''s status');

select throws_ok(
  $$ update public.vehicle_reports set note = 'Changed' where id = '82000000-0000-0000-0000-000000000001' $$,
  '42501', 'permission denied for table vehicle_reports', 'driver cannot edit a report after sending it');

select lives_ok(
  $$ insert into public.photos (id, employee_id, kind, storage_path, vehicle_report_id) values
       ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000a1', 'vehicle_report',
        '10000000-0000-0000-0000-0000000000a1/2026-10-07/70000000-0000-0000-0000-000000000003.jpg',
        '82000000-0000-0000-0000-000000000001') $$,
  'driver can attach a photo to their own report');

select throws_ok(
  $$ insert into public.photos (employee_id, kind, storage_path, vehicle_report_id) values
       ('10000000-0000-0000-0000-0000000000a1', 'vehicle_report',
        '10000000-0000-0000-0000-0000000000a1/2026-10-07/z.jpg', '82000000-0000-0000-0000-000000000002') $$,
  '42501', 'new row violates row-level security policy for table "photos"',
  'driver cannot attach a photo to another driver''s report');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('driver-photos', '10000000-0000-0000-0000-0000000000a1/2026-10-07/70000000-0000-0000-0000-000000000001.jpg') $$,
  'driver can upload a file into their own folder');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('driver-photos', '10000000-0000-0000-0000-0000000000b1/2026-10-07/evil.jpg') $$,
  '42501', 'new row violates row-level security policy for table "objects"',
  'driver cannot upload a file into another driver''s folder');

select is((select count(*) from storage.objects where bucket_id = 'driver-photos'), 1::bigint,
  'driver can read the file in their own folder');

reset role;

select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-000000000001'),
  84563, 'the newest odometer log sets the vehicle odometer; the late older log does not');

select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-000000000002'),
  51230, 'a reading dated in the future does not block later readings');

select is((select odometer_log_id::text from public.photos where id = '70000000-0000-0000-0000-000000000001'),
  '80000000-0000-0000-0000-000000000001', 'the odometer photo is linked back to its log');

select is((select fuel_log_id::text from public.photos where id = '70000000-0000-0000-0000-000000000002'),
  '81000000-0000-0000-0000-000000000001', 'the fuel receipt photo is linked back to its log');

-- ---------------------------------------------------------------------------
-- 8. Driver B, a deactivated driver, a stranger: nothing of A's
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select results_eq('select id::text from public.tasks', array['50000000-0000-0000-0000-000000000002'],
  'driver B sees only their own task');

select is_empty(
  $$ select 'employees' from public.employees where id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'duty_sessions' from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'location_points' from public.location_points where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'photos' from public.photos where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'odometer_logs' from public.odometer_logs where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'fuel_logs' from public.fuel_logs where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'vehicle_reports' from public.vehicle_reports where employee_id = '10000000-0000-0000-0000-0000000000a1'
     union all select 'task_stops' from public.task_stops where task_id = '50000000-0000-0000-0000-000000000001'
     union all select 'task_projects' from public.task_projects where task_id = '50000000-0000-0000-0000-000000000001' $$,
  'driver B sees nothing that belongs to driver A');

select is_empty($$ select 1 from storage.objects where bucket_id = 'driver-photos' $$,
  'driver B cannot read files in driver A''s folder');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select is(public.current_employee_id(), null, 'a deactivated driver has no employee id');

select is_empty(
  $$ select 'employees' from public.employees
     union all select 'vehicles' from public.vehicles
     union all select 'places' from public.places
     union all select 'projects' from public.projects
     union all (select 'towns' from public.towns limit 1)
     union all select 'tasks' from public.tasks $$,
  'a deactivated driver sees nothing');

select throws_ok(
  $$ insert into public.duty_sessions (employee_id) values ('10000000-0000-0000-0000-0000000000c1') $$,
  '42501', 'new row violates row-level security policy for table "duty_sessions"',
  'a deactivated driver cannot start sharing');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

select is_empty(
  $$ select 'employees' from public.employees
     union all select 'vehicles' from public.vehicles
     union all select 'places' from public.places
     union all select 'projects' from public.projects
     union all (select 'towns' from public.towns limit 1)
     union all select 'tasks' from public.tasks $$,
  'a signed-in user with no employee row sees nothing');

reset role;

-- ---------------------------------------------------------------------------
-- 9. Project split totals 100
-- ---------------------------------------------------------------------------

-- Written one row at a time, checked together at commit.
insert into public.task_projects (task_id, project_id, percent) values
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 60);
insert into public.task_projects (task_id, project_id, percent) values
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 40);

select lives_ok('set constraints all immediate', 'rows written one by one are checked together at the end');

select throws_ok(
  $$ update public.task_projects set percent = 70
     where task_id = '50000000-0000-0000-0000-000000000003'
       and project_id = '40000000-0000-0000-0000-000000000001' $$,
  '23514', 'Project percentages for task 50000000-0000-0000-0000-000000000003 must total 100, not 110.00',
  'a split that totals 110 is refused');

select throws_ok(
  $$ delete from public.task_projects
     where task_id = '50000000-0000-0000-0000-000000000003'
       and project_id = '40000000-0000-0000-0000-000000000002' $$,
  '23514', 'Project percentages for task 50000000-0000-0000-0000-000000000003 must total 100, not 60.00',
  'removing one project without re-splitting is refused');

select lives_ok(
  $$ delete from public.task_projects where task_id = '50000000-0000-0000-0000-000000000003' $$,
  'a task may have no project rows (Fame internal)');

select lives_ok(
  $$ insert into public.task_projects (task_id, project_id, percent) values
       ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 33.33),
       ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 33.33),
       ('50000000-0000-0000-0000-000000000003', null, 33.34) $$,
  'a three-way split that totals 100 is accepted');

select throws_ok(
  $$ insert into public.task_projects (task_id, project_id, percent) values
       ('50000000-0000-0000-0000-000000000002', null, 50) $$,
  '23505', 'duplicate key value violates unique constraint "task_projects_task_project_key"',
  'Fame internal (no project) can appear only once per task');

-- ---------------------------------------------------------------------------
-- 10. Office connector (service_role)
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
  (select count(*) from public.tasks where id in (
     '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
     '50000000-0000-0000-0000-000000000003')),
  3::bigint, 'the office connector sees every driver''s tasks');

select is(
  (select monthly_rent_cents from public.vehicles where id = '20000000-0000-0000-0000-000000000001'),
  18000000::bigint, 'the office connector still reads rent and every other vehicle column');

select lives_ok(
  $$ update public.tasks set status = 'cancelled', cancelled_reason = 'Site visit moved'
     where id = '50000000-0000-0000-0000-000000000003' $$,
  'the office connector can cancel a task');

select lives_ok(
  $$ insert into public.office_audit (tool, args_summary, result_summary)
     values ('cancel_task', 'task 5000...0003', 'cancelled') $$,
  'the office connector can write the audit log');

select throws_ok(
  $$ delete from public.tasks where id = '50000000-0000-0000-0000-000000000003' $$,
  '42501', 'permission denied for table tasks', 'the office connector cannot delete');

reset role;

-- ---------------------------------------------------------------------------
-- 11. office_create_task: task + stops + project split (+ request) in one go
-- ---------------------------------------------------------------------------

insert into public.vehicle_requests (id, requested_by_name, project_label, needed_at, route_from, route_to, need_type, pax) values
  ('90000000-0000-0000-0000-000000000001', 'Test Dilini', 'Mobitel MS', now() + interval '1 day', 'Colombo', 'Matara sites', 'van', 6);

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select public.office_create_task('{}'::jsonb, '[]'::jsonb) $$,
  '42501', 'permission denied for function office_create_task', 'a driver cannot call office_create_task');

reset role;
set local role service_role;

select lives_ok(
  $$ select public.office_create_task(
       '{"title":"RPC task one","label":"Mobitel MS","employee_id":"10000000-0000-0000-0000-0000000000b1",
         "vehicle_id":"20000000-0000-0000-0000-000000000002","start_at":"2026-10-08T06:30:00+05:30",
         "end_by":"2026-10-08T18:00:00+05:30","passengers":6,"created_by":"test"}'::jsonb,
       '[{"seq":1,"type":"pickup","place_id":"30000000-0000-0000-0000-000000000001","place_name":"Test head office"},
         {"seq":2,"type":"drop","place_name":"Matara town site"}]'::jsonb,
       '[{"project_id":"40000000-0000-0000-0000-000000000001","percent":60},
         {"project_id":"40000000-0000-0000-0000-000000000002","percent":40}]'::jsonb) $$,
  'the office connector can create a task with stops and a project split');

select is(
  (select (t.status, t.passengers, (select count(*) from public.task_stops s where s.task_id = t.id),
           (select sum(p.percent) from public.task_projects p where p.task_id = t.id))::text
     from public.tasks t where t.title = 'RPC task one'),
  '(assigned,6,2,100.00)', 'the task, its 2 stops and its 100 % split were all saved');

select throws_ok(
  $$ select public.office_create_task(
       '{"title":"RPC task bad split","employee_id":"10000000-0000-0000-0000-0000000000b1",
         "vehicle_id":"20000000-0000-0000-0000-000000000002","start_at":"2026-10-09T06:30:00+05:30"}'::jsonb,
       '[{"seq":1,"type":"pickup","place_name":"A"},{"seq":2,"type":"drop","place_name":"B"}]'::jsonb,
       '[{"project_id":"40000000-0000-0000-0000-000000000001","percent":90}]'::jsonb) $$,
  '23514', null, 'a split that does not total 100 is refused');

select is((select count(*) from public.tasks where title = 'RPC task bad split'), 0::bigint,
  'and nothing of that task was saved');

select throws_ok(
  $$ select public.office_create_task(
       '{"title":"RPC task no stops","employee_id":"10000000-0000-0000-0000-0000000000b1",
         "vehicle_id":"20000000-0000-0000-0000-000000000002","start_at":"2026-10-09T06:30:00+05:30"}'::jsonb,
       '[]'::jsonb) $$,
  'P0001', 'A task needs at least one stop', 'a task without stops is refused');

select lives_ok(
  $$ select public.office_create_task(
       '{"title":"RPC task from request","label":"Mobitel MS","employee_id":"10000000-0000-0000-0000-0000000000b1",
         "vehicle_id":"20000000-0000-0000-0000-000000000002","start_at":"2026-10-10T06:30:00+05:30","passengers":6}'::jsonb,
       '[{"seq":1,"type":"pickup","place_name":"Colombo"},{"seq":2,"type":"drop","place_name":"Matara sites"}]'::jsonb,
       '[]'::jsonb, '90000000-0000-0000-0000-000000000001', 'Test admin') $$,
  'approving a request creates its task');

select is(
  (select (r.status, r.decided_by, r.decided_at is not null,
           (select t.title from public.tasks t where t.id = r.task_id),
           (select t.request_id = r.id from public.tasks t where t.id = r.task_id))::text
     from public.vehicle_requests r where r.id = '90000000-0000-0000-0000-000000000001'),
  '(approved,"Test admin",t,"RPC task from request",t)',
  'the request is approved and linked to the new task, both ways');

select throws_ok(
  $$ select public.office_create_task(
       '{"title":"RPC task second approval","employee_id":"10000000-0000-0000-0000-0000000000b1",
         "vehicle_id":"20000000-0000-0000-0000-000000000002","start_at":"2026-10-10T06:30:00+05:30"}'::jsonb,
       '[{"seq":1,"type":"pickup","place_name":"Colombo"}]'::jsonb,
       '[]'::jsonb, '90000000-0000-0000-0000-000000000001', 'Someone else') $$,
  'P0001', 'This vehicle request is already approved', 'a request cannot be approved twice');

select is((select count(*) from public.tasks where title = 'RPC task second approval'), 0::bigint,
  'and the second approval created no task');

reset role;

-- ---------------------------------------------------------------------------
-- odometer_reads (the AI odometer reader's log) is for the Edge Function only
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.odometer_reads', 'SELECT'),
  'drivers cannot read odometer_reads');
select ok(not has_table_privilege('authenticated', 'public.odometer_reads', 'INSERT'),
  'drivers cannot write odometer_reads');
select ok(not has_table_privilege('anon', 'public.odometer_reads', 'SELECT'),
  'anon cannot read odometer_reads');
select ok((select relrowsecurity from pg_class where oid = 'public.odometer_reads'::regclass),
  'odometer_reads has row level security on');

-- ---------------------------------------------------------------------------
-- Retention of location points: nightly job, 90 days
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.prune_location_points(integer, integer)', 'EXECUTE'),
  'drivers cannot run prune_location_points');
select is((select count(*) from cron.job where jobname = 'prune-location-points'), 1::bigint,
  'the nightly prune job is scheduled');
select is((select schedule from cron.job where jobname = 'prune-location-points'), '30 21 * * *',
  'it runs at 21:30 UTC (03:00 Colombo)');

insert into public.duty_sessions (id, employee_id, started_at, ended_at, end_reason) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000a1', now() - interval '100 days', now() - interval '100 days' + interval '1 hour', 'driver');
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
  ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-00000000000a', now() - interval '100 days', 6.9, 79.9),
  ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-00000000000a', now() - interval '91 days', 6.9, 79.9),
  ('10000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-00000000000a', now() - interval '89 days', 6.9, 79.9);

select is(public.prune_location_points(), 2, 'prune_location_points removes the two points older than 90 days');
select is((select count(*) from public.location_points where session_id = '60000000-0000-0000-0000-00000000000a'), 1::bigint,
  'and keeps the newer one');
select is((select count(*) from public.duty_sessions where id = '60000000-0000-0000-0000-00000000000a'), 1::bigint,
  'the sharing period itself stays');

select * from finish();

rollback;
