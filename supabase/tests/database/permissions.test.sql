-- Permissions per person (Phase 5, part 2), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)
--
-- Cast: an admin (every permission), a requester (request only), a staff member
-- with the default view, a switched-off admin, and driver A with a position.

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'p.admin@fame.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'p.requester@fame.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'p.staff@fame.test'),
  ('00000000-0000-0000-0000-0000000000f4', 'p.left@fame.test'),
  ('00000000-0000-0000-0000-0000000000f5', 'p.driver@drivers.fame.invalid');

insert into public.employees (id, code, name, email, role, permissions, auth_user_id, active) values
  ('10000000-0000-0000-0000-00000000f001', 'P-ADMIN', 'Perm Admin', 'p.admin@fame.test', 'admin',
   array['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'], '00000000-0000-0000-0000-0000000000f1', true),
  ('10000000-0000-0000-0000-00000000f002', 'P-REQ', 'Perm Requester', 'p.requester@fame.test', 'staff',
   array['request'], '00000000-0000-0000-0000-0000000000f2', true),
  ('10000000-0000-0000-0000-00000000f004', 'P-LEFT', 'Perm Left', 'p.left@fame.test', 'admin',
   array['view', 'users'], '00000000-0000-0000-0000-0000000000f4', false);
-- A staff member inserted without permissions gets the default: view.
insert into public.employees (id, code, name, email, role, auth_user_id, active) values
  ('10000000-0000-0000-0000-00000000f003', 'P-STAFF', 'Perm Staff', 'p.staff@fame.test', 'staff',
   '00000000-0000-0000-0000-0000000000f3', true);
-- A driver: no office permissions, whatever the column says.
insert into public.employees (id, code, name, username, role, permissions, auth_user_id, active) values
  ('10000000-0000-0000-0000-00000000f005', 'P-DRV', 'Perm Driver', 'p.driver', 'driver', '{}', '00000000-0000-0000-0000-0000000000f5', true);
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-00000000f001', 'WP PERM-0001');
insert into public.driver_latest (employee_id, lat, lng, recorded_at, sharing)
  values ('10000000-0000-0000-0000-00000000f005', 6.9, 79.9, now(), true);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by) values
  ('50000000-0000-0000-0000-00000000f001', 'Perm task', '10000000-0000-0000-0000-00000000f005',
   '20000000-0000-0000-0000-00000000f001', now(), 'test');
insert into public.task_stops (task_id, seq, type, place_name) values
  ('50000000-0000-0000-0000-00000000f001', 1, 'pickup', 'Somewhere');

-- The column and its rules
select is((select permissions from public.employees where id = '10000000-0000-0000-0000-00000000f003'), array['view'],
  'a new office row without permissions gets view');
select throws_ok($$ update public.employees set permissions = array['view', 'boss'] where id = '10000000-0000-0000-0000-00000000f003' $$,
  '23514', null, 'an unknown permission is refused');
select lives_ok($$ update public.employees set permissions = '{}' where id = '10000000-0000-0000-0000-00000000f003' $$,
  'an empty list is allowed');
update public.employees set permissions = array['view', 'request'] where id = '10000000-0000-0000-0000-00000000f003';

-- office_can() as each person, and the three office read policies
set role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(public.office_can('view'), true, 'the admin has view');
select is(public.office_can('users'), true, 'the admin has users');
select is((select count(*) from public.driver_latest where employee_id = '10000000-0000-0000-0000-00000000f005'), 1::bigint,
  'the admin reads the driver position');
select is((select count(*) from public.tasks where id = '50000000-0000-0000-0000-00000000f001'), 1::bigint, 'the admin reads the task');
select is((select count(*) from public.task_stops where task_id = '50000000-0000-0000-0000-00000000f001'), 1::bigint, 'the admin reads the stop');
reset role;

set role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is(public.office_can('request'), true, 'the requester has request');
select is(public.office_can('view'), false, 'the requester has no view');
select is((select count(*) from public.driver_latest), 0::bigint, 'the requester reads no driver position');
select is((select count(*) from public.tasks), 0::bigint, 'the requester reads no task through RLS');
select is((select count(*) from public.task_stops), 0::bigint, 'the requester reads no stop through RLS');
reset role;

set role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select is(public.office_can('view'), true, 'the staff member with view has view');
select is(public.office_can('approve'), false, 'but not approve');
select is((select count(*) from public.driver_latest where employee_id = '10000000-0000-0000-0000-00000000f005'), 1::bigint,
  'the staff member with view reads the driver position');
select is((select count(*) from public.tasks where id = '50000000-0000-0000-0000-00000000f001'), 1::bigint, 'and the task');
reset role;

set role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select is(public.office_can('view'), false, 'a switched-off person has nothing');
select is((select count(*) from public.driver_latest), 0::bigint, 'and reads no position');
reset role;

set role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select is(public.office_can('view'), false, 'a driver has no office permission');
select is((select count(*) from public.driver_latest), 0::bigint, 'a driver reads no driver position');
select is((select count(*) from public.tasks where id = '50000000-0000-0000-0000-00000000f001'), 1::bigint,
  'a driver still reads their own task (the driver policy)');
reset role;

set role anon;
select throws_ok('select public.office_can(''view'')', '42501', 'permission denied for function office_can',
  'anon cannot call office_can()');
reset role;

select * from finish();

rollback;
