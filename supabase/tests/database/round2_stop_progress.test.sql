-- Round 2 (21 October 2026): live stop progress. The deltas against the plan are stored with the stop; each stop reached
-- after the first pickup tells the person who asked, with how late or early; the driver reads the deltas of their own
-- stops; the first pickup stays request.arrived's.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c2a01', 'r2.kanishka@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c2a02', 'r2.asker@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c2a01', 'R2K', 'Kanishka Fernando', 'r2.kanishka', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000c2a01'),
  ('10000000-0000-0000-0000-0000000c2a02', 'R2A', 'Asha Asker', null, 'r2.asker@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-0000000c2a02');
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000c2a01', 'WP R2-0001', 5000, true);
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-0000000c2a02', 'https://push.example/r2-asker', 'p', 'a');

select has_column('public', 'task_stops', 'arrive_delta_min', 'task_stops.arrive_delta_min');
select has_column('public', 'task_stops', 'leave_delta_min', 'task_stops.leave_delta_min');

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, route_from, route_to) values
  ('30000000-0000-0000-0000-0000000c2a01', 'Asha Asker', '10000000-0000-0000-0000-0000000c2a02', now() + interval '1 hour', 'waiting', 'Office', 'Wariyapola');
select public.office_create_task(
  jsonb_build_object('title', 'Team drop · Wariyapola', 'employee_id', '10000000-0000-0000-0000-0000000c2a01',
                     'vehicle_id', '20000000-0000-0000-0000-0000000c2a01', 'start_at', now() + interval '1 hour', 'created_by', 'Office'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'pickup', 'place_name', 'Office'),
                    jsonb_build_object('seq', 2, 'type', 'drop', 'place_name', 'Wariyapola'),
                    jsonb_build_object('seq', 3, 'type', 'drop', 'place_name', 'Kurunegala')),
  '[]'::jsonb, '30000000-0000-0000-0000-0000000c2a01', 'Office');
create temp table r2_task as select id from public.tasks where request_id = '30000000-0000-0000-0000-0000000c2a01';
grant select on r2_task to authenticated;
update public.task_stops set planned_arrive_at = '2026-10-21 10:30+05:30', planned_depart_at = '2026-10-21 11:30+05:30'
 where task_id = (select id from r2_task) and seq = 2;
update public.task_stops set planned_arrive_at = '2026-10-21 12:00+05:30', planned_depart_at = '2026-10-21 12:10+05:30'
 where task_id = (select id from r2_task) and seq = 3;
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 5000 where id = (select id from r2_task);

-- The driver slides Arrived and Left with their phone's times.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c2a01","role":"authenticated"}';
select lives_ok($$ update public.task_stops set status = 'arrived', arrived_at = '2026-10-21 09:00+05:30'
                    where task_id = (select id from r2_task) and seq = 1 $$, 'the first pickup: Arrived');
select lives_ok($$ update public.task_stops set status = 'arrived', arrived_at = '2026-10-21 10:52+05:30'
                    where task_id = (select id from r2_task) and seq = 2 $$, 'Wariyapola: Arrived at 10:52');
select is((select arrive_delta_min from public.task_stops where task_id = (select id from r2_task) and seq = 2), 22,
  'the driver reads their own stop''s delta: 22 min late');
select lives_ok($$ update public.task_stops set status = 'done', done_at = '2026-10-21 11:24+05:30'
                    where task_id = (select id from r2_task) and seq = 2 $$, 'Wariyapola: Left at 11:24');
select is((select leave_delta_min from public.task_stops where task_id = (select id from r2_task) and seq = 2), -6,
  'left 6 min before the planned 11:30');
select throws_ok($$ update public.task_stops set arrive_delta_min = 0 where task_id = (select id from r2_task) and seq = 2 $$,
  NULL, 'the delta is Postgres''s, never written by anyone');
reset role;

select is((select count(*) from public.notifications where event = 'request.arrived'
            and recipient_employee_id = '10000000-0000-0000-0000-0000000c2a02'), 1::bigint, 'the first pickup: request.arrived, once');
select is((select count(*) from public.notifications where event = 'request.stop_arrived'
            and recipient_employee_id = '10000000-0000-0000-0000-0000000c2a02'), 1::bigint, 'Wariyapola: request.stop_arrived (not the first pickup again)');
select is((select payload ->> 'title' from public.notifications where event = 'request.stop_arrived'), 'Kanishka arrived at Wariyapola',
  'the title: "Kanishka arrived at Wariyapola"');
select is((select payload ->> 'body' from public.notifications where event = 'request.stop_arrived'), '10:52, 22 min late · Team drop · Wariyapola',
  'the body: "10:52, 22 min late · …"');

-- The 150 m nudge alone tells nobody about a later stop; an early arrival says so.
update public.task_stops set auto_detected_at = now() where task_id = (select id from r2_task) and seq = 3;
select is((select count(*) from public.notifications where event = 'request.stop_arrived'), 1::bigint, 'the nudge is a suggestion: nothing sent');
update public.task_stops set status = 'arrived', arrived_at = '2026-10-21 11:50+05:30' where task_id = (select id from r2_task) and seq = 3;
select ok((select payload ->> 'body' from public.notifications where event = 'request.stop_arrived' order by created_at desc, id desc limit 1)
            like '11:50, 10 min early%', 'Kurunegala: "11:50, 10 min early"');

-- Checkpoint 2 review: an Undo and a second Arrived send nothing more; a skipped stop has no leave delta.
update public.task_stops set status = 'pending', arrived_at = null where task_id = (select id from r2_task) and seq = 3;
update public.task_stops set status = 'arrived', arrived_at = '2026-10-21 11:55+05:30' where task_id = (select id from r2_task) and seq = 3;
select is((select count(*) from public.notifications where event = 'request.stop_arrived'), 2::bigint,
  'Undo, then Arrived again at Kurunegala: still one notice for that stop');
update public.task_stops set status = 'skipped', skip_reason = 'closed', done_at = '2026-10-21 12:40+05:30'
 where task_id = (select id from r2_task) and seq = 3;
select is((select leave_delta_min from public.task_stops where task_id = (select id from r2_task) and seq = 3), null::integer,
  'a skipped stop: no leave delta (its done_at is when it was skipped)');

select * from finish();
rollback;
