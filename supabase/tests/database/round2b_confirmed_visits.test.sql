-- Round 2b (Sahan, 21 October 2026): a stop driven past without Arrived, confirmed later ("Yes, I was there"). Its times
-- come only from the driver's own location points within 150 m of the pin (the first and the last inside), never from
-- the phone's time of the answer; with no points it is visited with no times; points uploaded later are picked up by the
-- 5-minute job; a place visited twice takes the right visit; nobody following the trip is told; Undo clears it.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000cf101', 'cv.nimal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000cf102', 'cv.asker@fame.test'),
  ('00000000-0000-0000-0000-0000000cf103', 'cv.other@drivers.fame.invalid');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000cf101', 'CV1', 'Nimal Perera', 'cv.nimal', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000cf101'),
  ('10000000-0000-0000-0000-0000000cf102', 'CV2', 'Asha Asker', null, 'cv.asker@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-0000000cf102'),
  ('10000000-0000-0000-0000-0000000cf103', 'CV3', 'Other Driver', 'cv.other', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000cf103');
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000cf101', 'WP CV-0001', 5000, true);
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-0000000cf102', 'https://push.example/cv-asker', 'p', 'a');

select has_column('public', 'task_stops', 'confirmed_later_at', 'task_stops.confirmed_later_at');

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, route_from, route_to) values
  ('30000000-0000-0000-0000-0000000cf101', 'Asha Asker', '10000000-0000-0000-0000-0000000cf102', now(), 'waiting', 'Office', 'Wariyapola');
select public.office_create_task(
  jsonb_build_object('title', 'Team drop · Wariyapola', 'employee_id', '10000000-0000-0000-0000-0000000cf101',
                     'vehicle_id', '20000000-0000-0000-0000-0000000cf101', 'start_at', now() - interval '3 hours', 'created_by', 'Office'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'pickup', 'place_name', 'Office', 'lat', 6.9000, 'lng', 79.8500),
                    jsonb_build_object('seq', 2, 'type', 'drop', 'place_name', 'Wariyapola', 'lat', 7.6200, 'lng', 80.2400),
                    jsonb_build_object('seq', 3, 'type', 'drop', 'place_name', 'Kurunegala', 'lat', 7.4800, 'lng', 80.3600),
                    jsonb_build_object('seq', 4, 'type', 'drop', 'place_name', 'Office again', 'lat', 6.9000, 'lng', 79.8500),
                    jsonb_build_object('seq', 5, 'type', 'drop', 'place_name', 'No pin')),
  '[]'::jsonb, '30000000-0000-0000-0000-0000000cf101', 'Office');
create temp table cv_task as select id from public.tasks where request_id = '30000000-0000-0000-0000-0000000cf101';
grant select on cv_task to authenticated;
update public.task_stops set planned_arrive_at = now() - interval '130 minutes', planned_depart_at = now() - interval '110 minutes'
 where task_id = (select id from cv_task) and seq = 2;
update public.tasks set status = 'in_progress', started_at = now() - interval '3 hours', start_odometer_km = 5000 where id = (select id from cv_task);

insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('60000000-0000-0000-0000-0000000cf101', '10000000-0000-0000-0000-0000000cf101', '20000000-0000-0000-0000-0000000cf101', now() - interval '4 hours');
-- The office at the start (a pickup marked as usual), Wariyapola passed (three points within 150 m, one 100 m off,
-- one 400 m off and one inside but a poor fix), nothing yet at Kurunegala.
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m, source) values
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '170 minutes', 6.9001, 79.8501, 10, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '169 minutes', 6.9002, 79.8500, 10, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '125 minutes', 7.6236, 80.2400, 10, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '122 minutes', 7.6209, 80.2401, 8, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '120 minutes', 7.6200, 80.2400, 8, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '118 minutes', 7.6201, 80.2399, 9, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '117 minutes', 7.6200, 80.2400, 400, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '116 minutes', 7.6209, 80.2400, 9, 'app');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000cf101","role":"authenticated"}';
update public.task_stops set status = 'arrived', arrived_at = now() - interval '168 minutes' where task_id = (select id from cv_task) and seq = 1;
update public.task_stops set status = 'done', done_at = now() - interval '166 minutes' where task_id = (select id from cv_task) and seq = 1;

-- "Yes, I was there" at Wariyapola: the phone sends its own time too; the server takes the points instead.
select lives_ok($$ update public.task_stops set status = 'done', confirmed_later_at = now(), arrived_at = now(), done_at = now()
                    where task_id = (select id from cv_task) and seq = 2 $$, 'the driver confirms Wariyapola later');
select is((select status from public.task_stops where task_id = (select id from cv_task) and seq = 2), 'done', 'Wariyapola is visited');
select is((select arrived_at from public.task_stops where task_id = (select id from cv_task) and seq = 2), now() - interval '122 minutes',
  'Arrived = the first point within 150 m (one 100 m off counts, one 400 m off does not)');
select is((select done_at from public.task_stops where task_id = (select id from cv_task) and seq = 2), now() - interval '116 minutes',
  'Left = the last point within 150 m (a poor fix inside is not counted)');
select is((select arrival_flag from public.task_stops where task_id = (select id from cv_task) and seq = 2), null,
  'no arrival flag: it is marked "confirmed later" instead');
select is((select arrive_delta_min from public.task_stops where task_id = (select id from cv_task) and seq = 2), 8,
  'with the points'' times it has its difference against the plan (8 min late)');

-- Sent again from the phone's queue: nothing changes.
update public.task_stops set status = 'done', confirmed_later_at = now() + interval '1 minute', arrived_at = now(), done_at = now()
 where task_id = (select id from cv_task) and seq = 2;
select is((select arrived_at from public.task_stops where task_id = (select id from cv_task) and seq = 2), now() - interval '122 minutes',
  'the same write again from the queue: the times from the points stay');

-- Kurunegala: no point there yet, so visited with no times ("time not recorded").
select lives_ok($$ update public.task_stops set status = 'done', confirmed_later_at = now()
                    where task_id = (select id from cv_task) and seq = 3 $$, 'the driver confirms Kurunegala later');
select results_eq($$ select status, arrived_at, done_at, arrive_delta_min, leave_delta_min from public.task_stops
                     where task_id = (select id from cv_task) and seq = 3 $$,
  $$ values ('done'::text, null::timestamptz, null::timestamptz, null::integer, null::integer) $$,
  'no points: visited, no times, never late or early');

-- A stop with no pin: visited, no times.
update public.task_stops set status = 'done', confirmed_later_at = now() where task_id = (select id from cv_task) and seq = 5;
select results_eq($$ select status, arrived_at from public.task_stops where task_id = (select id from cv_task) and seq = 5 $$,
  $$ values ('done'::text, null::timestamptz) $$, 'a stop with no pin: visited, time not recorded');

-- Another driver gets nothing from the helper for this task.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000cf103","role":"authenticated"}';
select is((select count(*) from public.confirmed_visit_times((select id from cv_task), 2, 7.62, 80.24, now())), 0::bigint,
  'another driver reads nobody''s points through the helper');
reset role;

-- The points of Kurunegala reach the server later: the 5-minute job takes them.
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m, source) values
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '60 minutes', 7.4805, 80.3600, 12, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '52 minutes', 7.4801, 80.3602, 12, 'app');
set local request.jwt.claims to '';
select is(public.fill_confirmed_visits(), 1, 'the job fills one stop (Kurunegala; the stop with no pin waits for nothing)');
select results_eq($$ select arrived_at, done_at from public.task_stops where task_id = (select id from cv_task) and seq = 3 $$,
  $$ values (now() - interval '60 minutes', now() - interval '52 minutes') $$, 'Kurunegala: Arrived and Left from the late points');
select ok(exists (select 1 from cron.job where jobname = 'confirmed-visits' and schedule = '*/5 * * * *'), 'the job runs every 5 minutes');

-- The office again (the trip's start): the points at the start are not this visit.
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m, source) values
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '6 minutes', 6.9003, 79.8502, 10, 'app'),
  ('10000000-0000-0000-0000-0000000cf101', '60000000-0000-0000-0000-0000000cf101', now() - interval '4 minutes', 6.9001, 79.8500, 10, 'app');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000cf101","role":"authenticated"}';
update public.task_stops set status = 'done', confirmed_later_at = now() where task_id = (select id from cv_task) and seq = 4;
select results_eq($$ select arrived_at, done_at from public.task_stops where task_id = (select id from cv_task) and seq = 4 $$,
  $$ values (now() - interval '6 minutes', now() - interval '4 minutes') $$,
  'a place visited twice: only the points after the stop before it (not the trip''s start)');

-- Undo: the stop is to do again.
select lives_ok($$ update public.task_stops set status = 'pending', confirmed_later_at = null, arrived_at = null, done_at = null
                    where task_id = (select id from cv_task) and seq = 4 $$, 'Undo');
select results_eq($$ select status, confirmed_later_at, arrived_at, done_at from public.task_stops where task_id = (select id from cv_task) and seq = 4 $$,
  $$ values ('pending'::text, null::timestamptz, null::timestamptz, null::timestamptz) $$, 'Undo clears the confirmation and its times');
-- Done without Arrived and without a confirmation is still refused.
select throws_ok($$ update public.task_stops set status = 'done', done_at = now() where task_id = (select id from cv_task) and seq = 4 $$,
  'P0001', 'Mark Arrived first: a stop is Done only after Arrived', 'Done alone still needs Arrived first');
reset role;

-- Nobody following the trip hears about a stop reached in the past.
select is((select count(*) from public.notifications where event = 'request.stop_arrived'), 0::bigint,
  'no "arrived at" notice for a stop confirmed later (or for its late points)');
select is((select count(*) from public.notifications where event = 'request.arrived'), 1::bigint,
  'the first pickup, marked as usual, told the requester once');

select * from finish();
rollback;
