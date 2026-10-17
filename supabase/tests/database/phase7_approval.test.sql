-- Phase 7, Part 3, checked with pgTAP (docs/phase7-plan.md §33–§35): a request carries a whole trip in the model of a
-- task (request_stops, the start, the plan); a task proposed without the approve permission is a request of kind task
-- with the proposed driver; Google's 30-day rule covers a request's stops, start and lines; the approvers are pushed
-- 30 minutes before an undecided leave-by (and the person who asked) and once when it passes; nobody but the service
-- role reads or writes the request stops.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000aa1', 'p7a.nimal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000000aa2', 'p7a.boss@fame.test'),
  ('00000000-0000-0000-0000-000000000aa3', 'p7a.dispatch@fame.test'),
  ('00000000-0000-0000-0000-000000000aa4', 'p7a.staff@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000aa1', 'P7AN', 'Nimal Perera', 'p7a.nimal', null, 'driver', '{}', true, '00000000-0000-0000-0000-000000000aa1'),
  ('10000000-0000-0000-0000-000000000aa2', 'P7AB', 'Boss Approver', null, 'p7a.boss@fame.test', 'admin',
   '{view,request,approve,assign_tasks}', true, '00000000-0000-0000-0000-000000000aa2'),
  ('10000000-0000-0000-0000-000000000aa3', 'P7AD', 'Dina Dispatch', null, 'p7a.dispatch@fame.test', 'office',
   '{view,request,assign_tasks}', true, '00000000-0000-0000-0000-000000000aa3'),
  ('10000000-0000-0000-0000-000000000aa4', 'P7AS', 'Sunil Staff', null, 'p7a.staff@fame.test', 'staff',
   '{view,request}', true, '00000000-0000-0000-0000-000000000aa4');
insert into public.vehicles (id, reg_no, current_odometer_km) values ('20000000-0000-0000-0000-000000000aa1', 'WP P7A-0001', 5000);
-- Everyone has a browser for the office pushes (queue_notification writes a row only for a person with one).
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-000000000aa2', 'https://push.example/p7a-boss', 'p', 'a'),
  ('10000000-0000-0000-0000-000000000aa3', 'https://push.example/p7a-dispatch', 'p', 'a'),
  ('10000000-0000-0000-0000-000000000aa4', 'https://push.example/p7a-staff', 'p', 'a');

-- 1. The columns and the rules ----------------------------------------------------------------------------------------
select has_table('public', 'request_stops', 'request_stops exists');
select has_column('public', 'vehicle_requests', 'kind', 'a request has a kind (request or task)');
select has_column('public', 'vehicle_requests', 'proposed_employee_id', 'and the proposed driver');
select has_column('public', 'vehicle_requests', 'plan_json', 'and the plan');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind) values ('X', now(), 'trip') $$,
  '23514', null, 'kind is request or task');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind) values ('X', now(), 'task') $$,
  '23514', null, 'a proposed task names its driver');

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, kind, title, proposed_employee_id,
                                     proposed_vehicle_id, route_from, route_to, leave_by, leave_by_source) values
  ('30000000-0000-0000-0000-000000000aa1', 'Dina Dispatch', '10000000-0000-0000-0000-000000000aa3', now() + interval '20 minutes',
   'task', 'Team drop · Kandy', '10000000-0000-0000-0000-000000000aa1', '20000000-0000-0000-0000-000000000aa1',
   'Head office', 'Kandy', now() + interval '20 minutes', 'manual');
insert into public.request_stops (request_id, seq, type, place_name, lat, lng) values
  ('30000000-0000-0000-0000-000000000aa1', 1, 'pickup', 'Head office', 6.8868, 79.8612),
  ('30000000-0000-0000-0000-000000000aa1', 2, 'drop', 'Kandy', 7.2906, 80.6337);
select throws_ok($$ insert into public.request_stops (request_id, seq, type, place_name) values
  ('30000000-0000-0000-0000-000000000aa1', 2, 'visit', 'Again') $$, '23505', null, 'one current stop per number');
update public.request_stops set removed_at = now() where request_id = '30000000-0000-0000-0000-000000000aa1' and seq = 2;
select lives_ok($$ insert into public.request_stops (request_id, seq, type, place_name) values
  ('30000000-0000-0000-0000-000000000aa1', 2, 'drop', 'Kandy City Centre') $$, 'an edit marks the old stop removed and adds the new one');
select is((select count(*) from public.request_stops where request_id = '30000000-0000-0000-0000-000000000aa1'), 3::bigint,
  'nothing is deleted');

-- 2. Nobody but the service role reads or writes the request stops ------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000aa1","role":"authenticated"}';
select throws_ok($$ select * from public.request_stops $$, '42501', null, 'a driver cannot read a request''s stops');
select throws_ok($$ insert into public.request_stops (request_id, seq, type, place_name) values
  ('30000000-0000-0000-0000-000000000aa1', 9, 'drop', 'X') $$, '42501', null, 'nor write them');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000aa4","role":"authenticated"}';
select throws_ok($$ select * from public.request_stops $$, '42501', null, 'an office person neither (the tools answer)');
reset role;

-- 3. Google's 30-day rule on a request's stops, start and lines ---------------------------------------------------------
insert into public.google_pins (google_place_id, lat, lng, address, fetched_at) values
  ('ChIJ-p7a-old', 7.1001, 80.1001, 'Old pin road', now() - interval '31 days'),
  ('ChIJ-p7a-new', 7.2002, 80.2002, 'New pin road', now() - interval '1 day');
insert into public.request_stops (id, request_id, seq, type, place_name, address, lat, lng) values
  ('40000000-0000-0000-0000-000000000aa1', '30000000-0000-0000-0000-000000000aa1', 3, 'visit', 'Old Google place', 'Old pin road', 7.1001, 80.1001),
  ('40000000-0000-0000-0000-000000000aa2', '30000000-0000-0000-0000-000000000aa1', 4, 'visit', 'New Google place', 'New pin road', 7.2002, 80.2002);
select is((select google_place_id from public.request_stops where id = '40000000-0000-0000-0000-000000000aa1'), 'ChIJ-p7a-old',
  'a stop on a Google pin is marked with its place id');
update public.vehicle_requests set start_name = 'New Google place', start_lat = 7.2002, start_lng = 80.2002,
       plan_json = jsonb_build_object('line_fetched_at', now() - interval '31 days',
                                      'legs', jsonb_build_array(jsonb_build_object('km', 10, 'line', 'abc')))
 where id = '30000000-0000-0000-0000-000000000aa1';
select is((select start_google_place_id from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa1'), 'ChIJ-p7a-new',
  'the request''s start on a Google pin too');
select ok((public.prune_google_content() ->> 'request_stops')::int >= 1, 'the 30-day clean-up counts the request stops');
select is((select row(lat, lng, address, place_name)::text from public.request_stops where id = '40000000-0000-0000-0000-000000000aa1'),
  row(null::float8, null::float8, null::text, 'Google place (details removed after 30 days)'::text)::text,
  'a request stop on a pin over 30 days old loses its pin, address and name');
select is((select google_place_id from public.request_stops where id = '40000000-0000-0000-0000-000000000aa1'), 'ChIJ-p7a-old',
  'the place id stays');
select isnt((select lat from public.request_stops where id = '40000000-0000-0000-0000-000000000aa2'), null, 'a fresh pin stays');
select is((select plan_json -> 'legs' -> 0 ? 'line' from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa1'), false,
  'Google''s road line kept with the request''s plan goes after 30 days');
select is((select plan_json -> 'legs' -> 0 ->> 'km' from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa1'), '10',
  'the km stay');

-- 4. Not decided 30 minutes before the leave-by; the leave-by passed ---------------------------------------------------
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, route_from, route_to) values
  ('30000000-0000-0000-0000-000000000aa2', 'Sunil Staff', '10000000-0000-0000-0000-000000000aa4', now() - interval '10 minutes', 'Office', 'Galle'),
  ('30000000-0000-0000-0000-000000000aa3', 'Sunil Staff', '10000000-0000-0000-0000-000000000aa4', now() - interval '3 hours', 'Office', 'Matara'),
  ('30000000-0000-0000-0000-000000000aa4', 'Sunil Staff', '10000000-0000-0000-0000-000000000aa4', now() + interval '2 hours', 'Office', 'Jaffna');
-- Any other waiting request in this database is left out of the count.
update public.vehicle_requests set decide_reminder_sent_at = now(), late_push_sent_at = now()
 where id not in ('30000000-0000-0000-0000-000000000aa1', '30000000-0000-0000-0000-000000000aa2', '30000000-0000-0000-0000-000000000aa3',
                  '30000000-0000-0000-0000-000000000aa4');
select is(public.queue_request_reminders(), 2, 'two reminders: the proposal leaving in 20 minutes, the request 10 minutes late');
select is((select count(*) from public.notifications where event = 'request.not_decided'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000aa2'), 1::bigint, 'the approver hears it is not decided');
select is((select count(*) from public.notifications where event = 'request.not_decided'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000aa3'), 1::bigint, 'and so does the person who proposed it');
select ok((select payload ->> 'title' from public.notifications where event = 'request.not_decided'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000aa2') like 'Not decided yet: Team drop · Kandy leaves %',
  'in words: "Not decided yet: <title> leaves HH:MM"');
select is((select count(*) from public.notifications where event = 'request.late'
             and payload ->> 'request_id' = '30000000-0000-0000-0000-000000000aa2'
             and recipient_employee_id in ('10000000-0000-0000-0000-000000000aa2', '10000000-0000-0000-0000-000000000aa3',
                                           '10000000-0000-0000-0000-000000000aa4')), 1::bigint, 'one late push');
select is((select recipient_employee_id from public.notifications where event = 'request.late'
             and payload ->> 'request_id' = '30000000-0000-0000-0000-000000000aa2'
             and recipient_employee_id in ('10000000-0000-0000-0000-000000000aa2', '10000000-0000-0000-0000-000000000aa3',
                                           '10000000-0000-0000-0000-000000000aa4')), '10000000-0000-0000-0000-000000000aa2'::uuid,
  'to the approvers only (not the person who asked)');
select is(public.queue_request_reminders(), 0, 'each once');
select is((select status from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa2'), 'waiting',
  'a late request stays waiting: never sent by itself');
select is((select late_push_sent_at from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa3'), null,
  'one over two hours late is left alone');
select is((select decide_reminder_sent_at from public.vehicle_requests where id = '30000000-0000-0000-0000-000000000aa4'), null,
  'nor one leaving in two hours');
select is((select schedule from cron.job where jobname = 'request-reminders'), '* * * * *', 'the reminders run every minute');
set local role authenticated;
select throws_ok($$ select public.queue_request_reminders() $$, '42501', null, 'a signed-in person cannot run the reminders');
reset role;

select * from finish();
rollback;
