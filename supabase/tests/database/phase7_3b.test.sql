-- Phase 7, Part 3b, checked with pgTAP (docs/phase7-plan.md "Part 3b"): the driver's licence photos, availability for
-- dispatch (the driver's own entries only), questions to drivers (their own answers only, before they expire; the push and
-- the asker's notification), Running late (the driver's own open tasks; the office and the requester told).
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003b01', 'p3b.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000003b02', 'p3b.nuwan@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000003b03', 'p3b.dispatch@fame.test'),
  ('00000000-0000-0000-0000-000000003b04', 'p3b.asker@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000003b01', 'P3BK', 'Kamal Perera', 'p3b.kamal', null, 'driver', '{}', true, '00000000-0000-0000-0000-000000003b01'),
  ('10000000-0000-0000-0000-000000003b02', 'P3BN', 'Nuwan Silva', 'p3b.nuwan', null, 'driver', '{}', true, '00000000-0000-0000-0000-000000003b02'),
  ('10000000-0000-0000-0000-000000003b03', 'P3BD', 'Dilini Dispatch', null, 'p3b.dispatch@fame.test', 'office', '{view,request,assign_tasks}', true, '00000000-0000-0000-0000-000000003b03'),
  ('10000000-0000-0000-0000-000000003b04', 'P3BA', 'Amal Asker', null, 'p3b.asker@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-000000003b04');
insert into public.vehicles (id, reg_no, vehicle_type, current_odometer_km, active) values
  ('20000000-0000-0000-0000-000000003b01', 'WP P3B-0001', 'van', 1000, true);
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, route_from, route_to, need_type, pax, status,
                                     decided_at, decided_by)
values ('40000000-0000-0000-0000-000000003b01', 'Amal Asker', '10000000-0000-0000-0000-000000003b04', now() + interval '1 hour',
        'Head office', 'Kandy', 'van', 2, 'approved', now(), 'Dilini Dispatch');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, sent_at, created_by, request_id, assigned_by_employee_id) values
  ('30000000-0000-0000-0000-000000003b01', 'P3B team drop', '10000000-0000-0000-0000-000000003b01', '20000000-0000-0000-0000-000000003b01',
   now() + interval '1 hour', now() + interval '1 hour', 'assigned', now(), 'test', '40000000-0000-0000-0000-000000003b01',
   '10000000-0000-0000-0000-000000003b03'),
  ('30000000-0000-0000-0000-000000003b02', 'P3B cancelled', '10000000-0000-0000-0000-000000003b01', '20000000-0000-0000-0000-000000003b01',
   now() + interval '1 day', now() + interval '1 day', 'assigned', now(), 'test', null, null);
update public.tasks set status = 'cancelled', cancelled_reason = 'test' where id = '30000000-0000-0000-0000-000000003b02';
update public.vehicle_requests set task_id = '30000000-0000-0000-0000-000000003b01' where id = '40000000-0000-0000-0000-000000003b01';
-- The pushes and notifications of the inserts above are not this test's business.
delete from net.http_request_queue;
delete from public.office_inbox where employee_id in ('10000000-0000-0000-0000-000000003b03', '10000000-0000-0000-0000-000000003b04');

-- 1. Availability ----------------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b01","role":"authenticated"}';
select is((public.set_my_unavailability(null, (now() at time zone 'Asia/Colombo')::date + 1, null, 'morning', null, null, 'half_day', 'doctor')) ->> 'result',
  'ok', 'the driver adds a morning off tomorrow');
select is((public.set_my_unavailability(null, (now() at time zone 'Asia/Colombo')::date - 1, null, 'full_day', null, null, 'leave', null)) ->> 'reason',
  'That day has passed.', 'a day that has passed is refused in words');
select is((public.set_my_unavailability(null, (now() at time zone 'Asia/Colombo')::date + 2, null, 'hours', '11:00', '10:00', 'other', null)) ->> 'result',
  'refused', 'from–to the wrong way round is refused');
select is((public.set_my_unavailability(null, (now() at time zone 'Asia/Colombo')::date + 2, (now() at time zone 'Asia/Colombo')::date + 4, 'full_day', null, null, 'leave', null)) ->> 'result',
  'ok', 'several full days at once');
select is((select count(*) from public.driver_unavailability), 2::bigint, 'the driver reads their own two entries');
select is((select to_char(ends_at at time zone 'Asia/Colombo', 'HH24:MI') from public.driver_unavailability where part = 'morning'),
  '13:00', 'the morning ends at the half-day split (13:00)');
select throws_ok($$ select public.save_unavailability('10000000-0000-0000-0000-000000003b02', null, current_date + 1, null, 'full_day', null, null, 'leave', null, 'x', null, 'driver') $$,
  '42501', null, 'a driver cannot save an entry for someone else');
select throws_ok($$ insert into public.driver_unavailability (employee_id, starts_at, ends_at, part, reason, created_by_name, channel)
                    values ('10000000-0000-0000-0000-000000003b01', now(), now() + interval '1 hour', 'hours', 'other', 'x', 'driver') $$,
  '42501', null, 'nor write the table directly');
reset role;
-- Nuwan's entry, made by the office; Kamal neither sees it nor removes it.
select is((public.save_unavailability('10000000-0000-0000-0000-000000003b02', null, (now() at time zone 'Asia/Colombo')::date + 1, null, 'full_day',
  null, null, 'leave', null, 'Dilini Dispatch', '10000000-0000-0000-0000-000000003b03', 'web')) ->> 'result', 'ok', 'the office adds an entry for Nuwan');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b01","role":"authenticated"}';
select is((select count(*) from public.driver_unavailability), 2::bigint, 'Kamal still sees only his own');
select is(public.remove_my_unavailability((select id from public.driver_unavailability where part = 'morning')), 'ok', 'Kamal removes his morning');
select is(public.remove_my_unavailability((select id from public.driver_unavailability where employee_id = '10000000-0000-0000-0000-000000003b02' limit 1)),
  'not_found', 'and cannot remove Nuwan''s (he cannot even see it)');
reset role;
select is((select removed_by_name from public.driver_unavailability where part = 'morning' and employee_id = '10000000-0000-0000-0000-000000003b01'), 'Kamal Perera', 'a removed entry is kept, with who removed it');
select is(public.get_driver_settings() ->> 'half_day_split', '13:00', 'the phone reads the half-day split');

-- 2. Questions ----------------------------------------------------------------------------------------------------------------
insert into public.driver_asks (id, kind, trip_from, trip_to, asked_by_employee_id, asked_by_name, channel, expires_at) values
  ('50000000-0000-0000-0000-000000003b01', 'free_for_trip', now() + interval '3 hours', now() + interval '5 hours',
   '10000000-0000-0000-0000-000000003b03', 'Dilini Dispatch', 'web', now() + interval '3 hours'),
  ('50000000-0000-0000-0000-000000003b02', 'office_time', null, null,
   '10000000-0000-0000-0000-000000003b03', 'Dilini Dispatch', 'web', now() - interval '1 minute');
insert into public.driver_ask_answers (ask_id, employee_id) values
  ('50000000-0000-0000-0000-000000003b01', '10000000-0000-0000-0000-000000003b01'),
  ('50000000-0000-0000-0000-000000003b01', '10000000-0000-0000-0000-000000003b02'),
  ('50000000-0000-0000-0000-000000003b02', '10000000-0000-0000-0000-000000003b01');
select is((select count(*) from net.http_request_queue where url like '%/push-task' and convert_from(body, 'UTF8') like '%"kind": "ask"%'), 3::bigint,
  'each driver asked gets a push (kind ask)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b01","role":"authenticated"}';
select is((select count(*) from public.driver_asks), 2::bigint, 'Kamal reads the two questions he was asked');
select is((select count(*) from public.driver_ask_answers), 2::bigint, 'and only his own answer rows');
select is(public.answer_ask('50000000-0000-0000-0000-000000003b01', 'seen'), 'ok', 'opening it marks it seen');
select is(public.answer_ask('50000000-0000-0000-0000-000000003b01', 'time', now()), 'bad', 'a time is not an answer to a trip question');
select is(public.answer_ask('50000000-0000-0000-0000-000000003b01', 'yes'), 'ok', 'Yes');
select is(public.answer_ask('50000000-0000-0000-0000-000000003b02', 'time', now() + interval '1 hour'), 'expired', 'a closed question takes no answer');
select is(public.answer_ask('50000000-0000-0000-0000-000000003b01', 'no', null, null, null, null, now() - interval '1 hour'), 'ok',
  'an older answer sent late (the queue) ...');
select is((select answer from public.driver_ask_answers where ask_id = '50000000-0000-0000-0000-000000003b01'), 'yes',
  '... does not replace the newer one');
select throws_ok($$ update public.driver_ask_answers set answer = 'no' $$, '42501', null, 'the answer goes only through answer_ask');
reset role;
select is((select title from public.office_inbox where employee_id = '10000000-0000-0000-0000-000000003b03' and event = 'ask.answered'),
  'Kamal: Yes, free', 'the person who asked hears the answer');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b02","role":"authenticated"}';
select is(public.answer_ask('50000000-0000-0000-0000-000000003b02', 'call_me'), 'not_yours', 'Nuwan was not asked that one');
select is((select count(*) from public.driver_asks), 1::bigint, 'Nuwan reads only the question he was asked');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b04","role":"authenticated"}';
select is((select count(*) from public.driver_ask_answers), 0::bigint, 'a requester reads no answers');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b03","role":"authenticated"}';
select is((select count(*) from public.driver_ask_answers where ask_id::text like '50000000-0000-0000-0000-000000003b0%'), 3::bigint,
  'a dispatcher reads every answer (the page shows them live)');
reset role;

-- 3. Running late -------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b01","role":"authenticated"}';
select is(public.report_running_late('30000000-0000-0000-0000-000000003b01', 15), 'ok', 'Kamal is running late 15 min');
select is(public.report_running_late('30000000-0000-0000-0000-000000003b02', 15), 'closed', 'not for a task that is cancelled (or over)');
select throws_ok($$ update public.tasks set late_report_min = 5 where id = '30000000-0000-0000-0000-000000003b01' $$, '42501', null,
  'the late report goes only through report_running_late');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b02","role":"authenticated"}';
select is(public.report_running_late('30000000-0000-0000-0000-000000003b01', 30), 'not_yours', 'not for someone else''s task');
reset role;
select is((select late_report_min || '|' || (select note from public.task_assignment_events e where e.task_id = t.id and e.action = 'running_late')
           from public.tasks t where id = '30000000-0000-0000-0000-000000003b01'), '15|15 min', 'kept on the task, with a history event');
select is((select count(*) from public.office_inbox where employee_id = '10000000-0000-0000-0000-000000003b03' and event = 'task.running_late'),
  1::bigint, 'the dispatcher who assigned it is told');
select is((select count(*) from public.office_inbox where employee_id = '10000000-0000-0000-0000-000000003b04' and event = 'request.running_late'),
  1::bigint, 'and the person who asked for the trip');

-- 4. The licence photos -------------------------------------------------------------------------------------------------------
insert into public.photos (id, employee_id, kind, storage_path, taken_at) values
  ('60000000-0000-0000-0000-000000003b01', '10000000-0000-0000-0000-000000003b01', 'licence', '10000000-0000-0000-0000-000000003b01/licence/a.jpg', now()),
  ('60000000-0000-0000-0000-000000003b02', '10000000-0000-0000-0000-000000003b01', 'licence', '10000000-0000-0000-0000-000000003b01/odometer/b.jpg', now());
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000003b01","role":"authenticated"}';
select is(public.set_my_licence_photo('front', '60000000-0000-0000-0000-000000003b02'), 'not_yours', 'a photo outside the licence folder is refused');
select is(public.set_my_licence_photo('front', '60000000-0000-0000-0000-000000003b01'), 'ok', 'the front of the licence is set');
select is((select licence_front_photo_id::text from public.employees), '60000000-0000-0000-0000-000000003b01', 'the driver reads it on their row');
reset role;
select is((select changed_by_name || '|' || channel from public.employee_changes
           where employee_id = '10000000-0000-0000-0000-000000003b01' and field = 'licence_front_photo'),
  'Kamal Perera|driver', 'the change is logged as the driver''s');

select * from finish();
rollback;
