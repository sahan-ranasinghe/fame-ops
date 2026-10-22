-- Round 4–7, feature 4b (22 October 2026): closing a trip nobody drives with the app. Completed · not confirmed is the only
-- completed task without its readings; no_app_trips asks once at the trip's end and closes it at 09:00 the day after; a
-- driver's task is never touched; with trip_close_prompt off nothing happens; the requester is not told "On the way".
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c4b01', 'R4B', 'Asha Self', 'r4b.asha@fame.test', 'staff', '{view,request}', true);
insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c4b02', 'R4BD', 'Kamal Driver', 'r4b.kamal', 'driver', '{}', true);
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000c4b01', 'WP R4B-0001', 5000, true);

-- Three trips: Asha's own, two days ago with a back-by (to close), today later (to leave), and a driver's from two days ago.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, end_by, driven_by) values
  ('30000000-0000-0000-0000-0000000c4b01', 'Asha · Galle', '10000000-0000-0000-0000-0000000c4b01', '20000000-0000-0000-0000-0000000c4b01',
   now() - interval '2 days', now() - interval '2 days' + interval '4 hours', 'self'),
  ('30000000-0000-0000-0000-0000000c4b02', 'Asha · later today', '10000000-0000-0000-0000-0000000c4b01', '20000000-0000-0000-0000-0000000c4b01',
   now() + interval '3 hours', null, 'self');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at) values
  ('30000000-0000-0000-0000-0000000c4b03', 'Kamal · old', '10000000-0000-0000-0000-0000000c4b02', '20000000-0000-0000-0000-0000000c4b01',
   now() - interval '2 days');

-- The checks on the readings.
select throws_ok($$ update public.tasks set status = 'completed', completed_at = now() where id = '30000000-0000-0000-0000-0000000c4b02' $$,
  '23514', NULL, 'a completed task still needs its readings');
select lives_ok($$ update public.tasks set status = 'completed', completed_at = now(), started_at = now(),
  finish_flag = '{"kind": "not_confirmed"}'::jsonb where id = '30000000-0000-0000-0000-0000000c4b02' $$,
  'except Completed · not confirmed');
update public.tasks set status = 'assigned', completed_at = null, started_at = null, finish_flag = null
  where id = '30000000-0000-0000-0000-0000000c4b02';

-- The switch off: nothing.
insert into public.fleet_settings (key, value) values ('trip_close_prompt', 'false'::jsonb) on conflict (key) do update set value = excluded.value;
select is((public.no_app_trips() ->> 'off')::boolean, true, 'with trip_close_prompt off, nothing is asked or closed');
select results_eq($$ select status from public.tasks where id = '30000000-0000-0000-0000-0000000c4b01' $$, $$ values ('assigned'::text) $$,
  'the old trip stays as it was');
update public.fleet_settings set value = 'true'::jsonb where key = 'trip_close_prompt';

-- On: the old trip is closed (09:00 the day after its end has passed), the later one left, the driver's untouched.
select is((public.no_app_trips() ->> 'closed')::int, 1, 'one trip closed');
select results_eq($$ select status, finish_flag ->> 'kind' from public.tasks where id = '30000000-0000-0000-0000-0000000c4b01' $$,
  $$ values ('completed'::text, 'not_confirmed'::text) $$, 'Completed · not confirmed');
select results_eq($$ select status from public.tasks where id = '30000000-0000-0000-0000-0000000c4b02' $$, $$ values ('assigned'::text) $$,
  'a trip still to come is left');
select results_eq($$ select status from public.tasks where id = '30000000-0000-0000-0000-0000000c4b03' $$, $$ values ('assigned'::text) $$,
  'a driver''s task is never closed this way');

-- The question at the trip's end: a trip whose back-by passed today, before the 09:00 close.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, end_by, driven_by) values
  ('30000000-0000-0000-0000-0000000c4b04', 'Asha · this morning', '10000000-0000-0000-0000-0000000c4b01', '20000000-0000-0000-0000-0000000c4b01',
   now() - interval '3 hours', now() - interval '1 hour', 'self');
select is((public.no_app_trips() ->> 'asked')::int, 1, 'asked once at its back-by');
select is((public.no_app_trips() ->> 'asked')::int, 0, 'and never twice');
select results_eq($$ select count(*)::int from public.office_inbox where event = 'trip.finish_ask'
                    and employee_id = '10000000-0000-0000-0000-0000000c4b01' $$, $$ values (1) $$,
  '"Trip finished? Enter the odometer" in the person''s notification centre');

-- On the way: a self-driven trip with a request tells no requester.
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, driven_by, driver_required, decided_at, decided_by)
  values ('40000000-0000-0000-0000-0000000c4b01', 'Asha Self', '10000000-0000-0000-0000-0000000c4b01', now(), 'approved', 'self', false, now(), 'Office');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, driven_by, request_id) values
  ('30000000-0000-0000-0000-0000000c4b05', 'Asha · requested', '10000000-0000-0000-0000-0000000c4b01', '20000000-0000-0000-0000-0000000c4b01',
   now(), 'self', '40000000-0000-0000-0000-0000000c4b01');
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 5000 where id = '30000000-0000-0000-0000-0000000c4b05';
select results_eq($$ select count(*)::int from public.office_inbox where event = 'request.on_the_way' $$, $$ values (0) $$,
  'no "On the way" to the person who is driving');
-- Finished with far fewer km than any plan: never flagged completed early (that is the driver app's check).
update public.tasks set plan_json = '{"legs": [{"km": 100, "minutes": 120}]}'::jsonb where id = '30000000-0000-0000-0000-0000000c4b05';
update public.tasks set status = 'completed', completed_at = now(), end_odometer_km = 5002 where id = '30000000-0000-0000-0000-0000000c4b05';
select results_eq($$ select finish_flag is null from public.tasks where id = '30000000-0000-0000-0000-0000000c4b05' $$, $$ values (true) $$,
  'no completed-early flag on a no-app trip');

select * from finish();
rollback;
