-- Round 3 (21 October 2026): who drives. tasks and vehicle_requests carry driven_by (and someone else's name and phone);
-- the custodian tasks made before are self-driven; a no-app trip names its vehicle; the task and booking inserts take the
-- new fields; drivers still read their own tasks with the new columns.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_column('public', 'tasks', 'driven_by', 'tasks.driven_by');
select has_column('public', 'tasks', 'driver_name', 'tasks.driver_name');
select has_column('public', 'tasks', 'driver_phone', 'tasks.driver_phone');
select has_column('public', 'vehicle_requests', 'driven_by', 'vehicle_requests.driven_by');
select col_default_is('public', 'tasks', 'driven_by', 'driver', 'a task is a driver''s unless said otherwise');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c3d01', 'r3.driver@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c3d02', 'r3.asha@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c3d01', 'R3D', 'Kamal Driver', 'r3.driver', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000c3d01'),
  ('10000000-0000-0000-0000-0000000c3d02', 'R3A', 'Asha Office', null, 'r3.asha@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-0000000c3d02');
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000c3d01', 'WP R3-0001', 5000, true);

-- The checks.
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, start_at, driven_by)
                    values ('x', '10000000-0000-0000-0000-0000000c3d02', '20000000-0000-0000-0000-0000000c3d01', now(), 'boss') $$,
  '23514', NULL, 'driven_by is driver, self or other');
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, start_at, driven_by)
                    values ('x', '10000000-0000-0000-0000-0000000c3d02', '20000000-0000-0000-0000-0000000c3d01', now(), 'other') $$,
  '23514', NULL, 'someone else needs a name');
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, start_at, driven_by, driver_name)
                    values ('x', '10000000-0000-0000-0000-0000000c3d01', '20000000-0000-0000-0000-0000000c3d01', now(), 'driver', 'Nimal') $$,
  '23514', NULL, 'a name and a phone only for someone else');
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, vehicle_mode, start_at, driven_by)
                    values ('x', '10000000-0000-0000-0000-0000000c3d02', null, 'driver_day', now(), 'self') $$,
  '23514', NULL, 'a self-driven trip names its vehicle (no app to pick one on the day)');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, driven_by)
                    values ('Asha', now(), 'other') $$,
  '23514', NULL, 'a request for someone else names them');

-- The task insert takes who drives.
select lives_ok($$ select public.office_create_task(
  jsonb_build_object('title', 'Asha drives · Galle', 'employee_id', '10000000-0000-0000-0000-0000000c3d02',
                     'vehicle_id', '20000000-0000-0000-0000-0000000c3d01', 'start_at', now() + interval '1 day', 'created_by', 'Office',
                     'driven_by', 'other', 'driver_name', 'Nimal Perera', 'driver_phone', '+94771234567'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'drop', 'place_name', 'Galle')), '[]'::jsonb, null, 'Office') $$,
  'office_create_task saves someone else driving');
select results_eq($$ select driven_by, driver_name, driver_phone from public.tasks where title = 'Asha drives · Galle' $$,
  $$ values ('other'::text, 'Nimal Perera'::text, '+94771234567'::text) $$, 'the task says who drives');

-- The booking insert records what was asked, and driver_required follows it.
select lives_ok($$ select public.office_book_vehicle(
  jsonb_build_object('requested_by_name', 'Asha Office', 'requested_by_employee_id', '10000000-0000-0000-0000-0000000c3d02',
                     'needed_at', now() + interval '2 days', 'driven_by', 'self'),
  jsonb_build_object('title', 'Asha drives herself', 'employee_id', '10000000-0000-0000-0000-0000000c3d02',
                     'vehicle_id', '20000000-0000-0000-0000-0000000c3d01', 'start_at', now() + interval '2 days', 'created_by', 'Office',
                     'driven_by', 'self'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'drop', 'place_name', 'Kandy')), '[]'::jsonb, 'Office') $$,
  'office_book_vehicle saves a self-driven booking');
select results_eq($$ select r.driven_by, r.driver_required, t.driven_by from public.vehicle_requests r join public.tasks t on t.request_id = r.id
                     where t.title = 'Asha drives herself' $$,
  $$ values ('self'::text, false, 'self'::text) $$, 'the request asked self (no driver required), the task is self-driven');
select lives_ok($$ select public.office_book_vehicle(
  jsonb_build_object('requested_by_name', 'Old caller', 'needed_at', now() + interval '2 days', 'driver_required', false),
  jsonb_build_object('title', 'The custodian drives', 'employee_id', '10000000-0000-0000-0000-0000000c3d02',
                     'vehicle_id', '20000000-0000-0000-0000-0000000c3d01', 'start_at', now() + interval '2 days', 'created_by', 'Office',
                     'driven_by', 'self'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'drop', 'place_name', 'Kandy')), '[]'::jsonb, 'Office') $$,
  'an older caller sends driver_required false');
select is((select r.driven_by from public.vehicle_requests r join public.tasks t on t.request_id = r.id where t.title = 'The custodian drives'),
  'custodian', 'driver_required false alone is the old custodian path');

-- A driver still reads their own tasks with the new columns.
select public.office_create_task(
  jsonb_build_object('title', 'Kamal drives', 'employee_id', '10000000-0000-0000-0000-0000000c3d01',
                     'vehicle_id', '20000000-0000-0000-0000-0000000c3d01', 'start_at', now() + interval '1 day', 'created_by', 'Office'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'drop', 'place_name', 'Matara')), '[]'::jsonb, null, 'Office');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c3d01","role":"authenticated"}';
select results_eq($$ select title, driven_by from public.tasks $$, $$ values ('Kamal drives'::text, 'driver'::text) $$,
  'the driver reads only their own task, a driver''s');
reset role;

select * from finish();
rollback;
