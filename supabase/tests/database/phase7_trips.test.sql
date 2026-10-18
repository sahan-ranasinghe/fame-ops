-- Phase 7, Part 4, checked with pgTAP (docs/phase7-plan.md §13): trips a driver starts. tasks.kind and purpose with their
-- defaults and checks; a driver reads them but never writes them; a self trip (made by driver-api as service role) pushes
-- the driver nothing when it is made or when they cancel it themselves, while the office changing or cancelling it still
-- tells them; the driver app reads the setting driver_personal_trips; "Used before" never offers a personal trip's place.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000ac1', 'p7t.ruwan@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000ac1', 'P7TR', 'Ruwan Jayasuriya', 'p7t.ruwan', 'driver', '{}', true, '00000000-0000-0000-0000-000000000ac1');
insert into public.vehicles (id, reg_no, current_odometer_km, active) values ('20000000-0000-0000-0000-000000000ac1', 'WP P7T-0001', 9000, true);

-- 1. The columns ------------------------------------------------------------------------------------------------------
select has_column('public', 'tasks', 'kind', 'tasks have kind');
select has_column('public', 'tasks', 'purpose', 'and purpose');
select col_default_is('public', 'tasks', 'kind', 'dispatch', 'a task is the office''s by default');
select col_default_is('public', 'tasks', 'purpose', 'company', 'and company work');

-- A dispatched task: pushed "new" as before.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, sent_at, created_by) values
  ('30000000-0000-0000-0000-000000000ac1', 'Office task', '10000000-0000-0000-0000-000000000ac1', '20000000-0000-0000-0000-000000000ac1',
   now() + interval '2 hours', 'assigned', now(), 'test');
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac1'), 1::bigint,
  'an office task pushes "new" to its driver');
select throws_ok($$ update public.tasks set kind = 'other' where id = '30000000-0000-0000-0000-000000000ac1' $$, '23514', null,
  'kind is dispatch or self');
select throws_ok($$ update public.tasks set purpose = 'leisure' where id = '30000000-0000-0000-0000-000000000ac1' $$, '23514', null,
  'purpose is company or personal');

-- 2. A self trip, as driver-api makes it (service role): no "new" push, no "Task changed" push ---------------------------
insert into public.tasks (id, kind, purpose, title, employee_id, vehicle_id, start_at, leave_by, leave_by_source, status, sent_at, seen_at,
                          accepted_at, reminder_30_sent_at, reminder_0_sent_at, accept_reminder_sent_at, created_by) values
  ('30000000-0000-0000-0000-000000000ac2', 'self', 'personal', 'Personal trip · Kadawatha', '10000000-0000-0000-0000-000000000ac1',
   '20000000-0000-0000-0000-000000000ac1', now(), now(), 'manual', 'assigned', now(), now(), now(), now(), now(), now(), 'driver: Ruwan Jayasuriya');
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac2'), 0::bigint,
  'a trip the driver started is not pushed to them as a new task');
insert into public.task_stops (task_id, seq, type, place_name, status) values
  ('30000000-0000-0000-0000-000000000ac2', 1, 'visit', 'P7T Kadawatha home', 'pending'),
  ('30000000-0000-0000-0000-000000000ac2', 2, 'visit', 'P7T Kadawatha shop', 'pending');
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac2'), 0::bigint,
  'nor when a stop is added on the way (driver-api writes stops, no task row)');
select is((select count(*) from public.recent_places('P7T Kadawatha', now() - interval '1 day', 10)), 0::bigint,
  '"Used before" never offers where a driver went on a personal trip');
update public.tasks set purpose = 'company' where id = '30000000-0000-0000-0000-000000000ac2';
select is((select count(*) from public.recent_places('P7T Kadawatha', now() - interval '1 day', 10)), 2::bigint, 'a company trip''s places are offered');
update public.tasks set purpose = 'personal' where id = '30000000-0000-0000-0000-000000000ac2';
update public.tasks set title = 'Personal trip · Kadawatha town', plan_version = plan_version + 1 where id = '30000000-0000-0000-0000-000000000ac2';
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac2'
           and (convert_from(body, 'UTF8')::jsonb ->> 'kind') = 'changed'), 1::bigint,
  'the office changing the trip tells the driver ("Task changed")');

-- 3. The driver reads kind and purpose, and never writes them ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ac1","role":"authenticated"}';
select is((select kind || '/' || purpose from public.tasks where id = '30000000-0000-0000-0000-000000000ac2'), 'self/personal',
  'the driver reads their trip''s kind and purpose');
select throws_ok($$ update public.tasks set purpose = 'company' where id = '30000000-0000-0000-0000-000000000ac2' $$, '42501', null,
  'but cannot switch the purpose (the office does: set_trip_purpose)');
select throws_ok($$ update public.tasks set kind = 'dispatch' where id = '30000000-0000-0000-0000-000000000ac2' $$, '42501', null,
  'nor the kind');
select is((public.get_driver_settings() ->> 'driver_personal_trips'), 'allowed', 'the app reads driver_personal_trips: allowed by default');
reset role;
insert into public.fleet_settings (key, value, updated_by) values ('driver_personal_trips', '"off"'::jsonb, 'test')
  on conflict (key) do update set value = excluded.value;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ac1","role":"authenticated"}';
select is((public.get_driver_settings() ->> 'driver_personal_trips'), 'off', 'and the office''s choice');
reset role;

-- 4. The driver cancelling their trip before it starts hears nothing; the office cancelling one still tells the driver --------
set local request.jwt.claims to '{}'; -- driver-api and the office both write as the service role
insert into public.tasks (id, kind, title, employee_id, vehicle_id, start_at, status, sent_at, accepted_at, created_by) values
  ('30000000-0000-0000-0000-000000000ac3', 'self', 'Trip · by mistake', '10000000-0000-0000-0000-000000000ac1', '20000000-0000-0000-0000-000000000ac1',
   now(), 'assigned', now(), now(), 'driver: Ruwan Jayasuriya');
update public.tasks set status = 'cancelled', cancelled_reason = 'Cancelled by the driver before starting' where id = '30000000-0000-0000-0000-000000000ac3';
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac3'), 0::bigint,
  'the driver cancelling their own trip before it starts gets no "Task cancelled" push');
update public.tasks set status = 'cancelled', cancelled_reason = 'Not needed' where id = '30000000-0000-0000-0000-000000000ac2';
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000ac2'
           and (convert_from(body, 'UTF8')::jsonb ->> 'kind') = 'cancelled'), 1::bigint,
  'the office cancelling the trip pushes "cancelled" to the driver');

select * from finish();
rollback;
