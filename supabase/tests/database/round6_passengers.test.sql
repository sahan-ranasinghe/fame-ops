-- Round 4–7, feature 6 (22 October 2026): passengers. A request's passengers ride on its task; a registered passenger is
-- told when added and as the trip moves, never the person who asked (they have their own notices); the driver reads their
-- own tasks' passengers only; with the switch off nobody is told.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c6a01', 'r6.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c6a02', 'r6.nuwan@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c6a01', 'R6K', 'Kamal Driver', 'r6.kamal', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c6a01'),
  ('10000000-0000-0000-0000-0000000c6a02', 'R6N', 'Nuwan Driver', 'r6.nuwan', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c6a02');
insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c6a03', 'R6A', 'Asha Rider', 'r6.asha@fame.test', 'viewer', '{view}', true),
  ('10000000-0000-0000-0000-0000000c6a04', 'R6P', 'Priya Asker', 'r6.priya@fame.test', 'staff', '{view,request}', true);
insert into public.vehicles (id, reg_no, active) values ('20000000-0000-0000-0000-0000000c6a01', 'WP R6-0001', true);

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status) values
  ('30000000-0000-0000-0000-0000000c6a01', 'Priya Asker', '10000000-0000-0000-0000-0000000c6a04', now() + interval '1 day', 'waiting');
insert into public.request_passengers (request_id, employee_id, name) values
  ('30000000-0000-0000-0000-0000000c6a01', '10000000-0000-0000-0000-0000000c6a03', 'Asha Rider'),
  ('30000000-0000-0000-0000-0000000c6a01', '10000000-0000-0000-0000-0000000c6a04', 'Priya Asker');
insert into public.request_passengers (request_id, name, phone) values
  ('30000000-0000-0000-0000-0000000c6a01', 'Guest Visitor', '+94771234567');
select throws_ok($$ insert into public.request_passengers (request_id, name, phone) values
  ('30000000-0000-0000-0000-0000000c6a01', 'Bad Phone', '0771234567') $$, '23514', NULL, 'a phone is stored +94…');

insert into public.tasks (id, title, employee_id, vehicle_id, start_at, request_id) values
  ('40000000-0000-0000-0000-0000000c6a01', 'Team drop', '10000000-0000-0000-0000-0000000c6a01', '20000000-0000-0000-0000-0000000c6a01',
   now() + interval '1 day', '30000000-0000-0000-0000-0000000c6a01');
select results_eq($$ select count(*)::int from public.task_passengers where task_id = '40000000-0000-0000-0000-0000000c6a01' $$,
  $$ values (3) $$, 'the request''s passengers ride on its task');
select results_eq($$ select employee_id from public.office_inbox where event = 'passenger.trip' $$,
  $$ values ('10000000-0000-0000-0000-0000000c6a03'::uuid) $$, 'only the registered passenger who did not ask is told "You''re on a trip"');

update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 100 where id = '40000000-0000-0000-0000-0000000c6a01';
select results_eq($$ select title from public.office_inbox where event = 'passenger.moving' $$,
  $$ values ('On the way · Kamal · WP R6-0001'::text) $$, 'on the way, with the driver and the plate');

-- The driver reads their own task's passengers; another driver none.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c6a01","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.task_passengers $$, $$ values (3) $$, 'the driver reads the passengers');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c6a02","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.task_passengers $$, $$ values (0) $$, 'another driver reads none');
reset role;

-- The switch off: no more notices.
insert into public.fleet_settings (key, value) values ('passengers', 'false'::jsonb) on conflict (key) do update set value = excluded.value;
update public.tasks set status = 'cancelled', cancelled_reason = 'test' where id = '40000000-0000-0000-0000-0000000c6a01';
select results_eq($$ select count(*)::int from public.office_inbox where event like 'passenger.%' $$, $$ values (2) $$,
  'with passengers off, the cancel tells nobody');

-- Saved with the trip, in the same statement (Sahan, before the deploy): a task with its names keeps them, the column stays
-- empty; a name that cannot be saved undoes the trip; a request's names reach its task too; one no longer named is removed.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, passenger_list) values
  ('40000000-0000-0000-0000-0000000c6a02', 'With names', '10000000-0000-0000-0000-0000000c6a01', '20000000-0000-0000-0000-0000000c6a01',
   now() + interval '2 days',
   '{"by": "Office", "rows": [{"employee_id": "10000000-0000-0000-0000-0000000c6a03", "name": "Asha Rider", "phone": null},
                               {"employee_id": null, "name": "Guest Two", "phone": "+94771234568"}]}'::jsonb);
select results_eq($$ select count(*)::int from public.task_passengers where task_id = '40000000-0000-0000-0000-0000000c6a02' and removed_at is null $$,
  $$ values (2) $$, 'a task saved with its names keeps them');
select results_eq($$ select passenger_list is null from public.tasks where id = '40000000-0000-0000-0000-0000000c6a02' $$,
  $$ values (true) $$, 'the names are never stored on the task row');
select throws_ok($$ insert into public.tasks (id, title, employee_id, vehicle_id, start_at, passenger_list) values
  ('40000000-0000-0000-0000-0000000c6a03', 'Bad name', '10000000-0000-0000-0000-0000000c6a01', '20000000-0000-0000-0000-0000000c6a01',
   now() + interval '2 days', '{"by": "Office", "rows": [{"employee_id": null, "name": "Bad Phone", "phone": "0771234567"}]}'::jsonb) $$,
  '23514', NULL, 'a name that cannot be saved stops the trip''s insert');
select results_eq($$ select count(*)::int from public.tasks where id = '40000000-0000-0000-0000-0000000c6a03' $$, $$ values (0) $$,
  'so the trip is never saved without its names');
update public.tasks set passenger_list = '{"by": "Office", "rows": [{"employee_id": null, "name": "Guest Two", "phone": "+94771234568"}]}'::jsonb
  where id = '40000000-0000-0000-0000-0000000c6a02';
select results_eq($$ select name from public.task_passengers where task_id = '40000000-0000-0000-0000-0000000c6a02' and removed_at is null $$,
  $$ values ('Guest Two'::text) $$, 'an edit keeps the same ones and removes the one no longer named');
select results_eq($$ select count(*)::int from public.task_passengers where task_id = '40000000-0000-0000-0000-0000000c6a02' and removed_at is not null $$,
  $$ values (1) $$, 'removed, never deleted');
update public.vehicle_requests set task_id = '40000000-0000-0000-0000-0000000c6a01' where id = '30000000-0000-0000-0000-0000000c6a01';
update public.vehicle_requests set passenger_list = '{"by": "Priya", "rows": [{"employee_id": null, "name": "Guest Visitor", "phone": "+94771234567"}]}'::jsonb
  where id = '30000000-0000-0000-0000-0000000c6a01';
select results_eq($$ select (select count(*)::int from public.request_passengers where request_id = '30000000-0000-0000-0000-0000000c6a01' and removed_at is null),
                            (select count(*)::int from public.task_passengers where task_id = '40000000-0000-0000-0000-0000000c6a01' and removed_at is null) $$,
  $$ values (1, 1) $$, 'a request''s names reach its task in the same statement');

select * from finish();
rollback;
