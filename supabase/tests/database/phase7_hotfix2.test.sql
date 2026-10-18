-- Phase 7, Hotfix 2, checked with pgTAP (docs/phase7-plan.md "Hotfix 2"): the notification centre (a row for everyone
-- told, with or without a browser; each person reads only their own), the accept window counted only at work, a task's
-- vehicle chosen on the day (the constraint, the driver's confirm_task_vehicle, the changed push), the driver's contacts for
-- their own task only, the push channels a phone registers, and the service-role-only tables.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000bd1', 'hf2.amal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000000bd2', 'hf2.sunil@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000000bd3', 'hf2.palitha@fame.test'),
  ('00000000-0000-0000-0000-000000000bd4', 'hf2.ruwan@fame.test');
insert into public.employees (id, code, name, username, email, phone, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000bd1', 'HF2A', 'Amal Silva', 'hf2.amal', null, '+94771110001', 'driver', '{}', true,
   '00000000-0000-0000-0000-000000000bd1'),
  ('10000000-0000-0000-0000-000000000bd2', 'HF2S', 'Sunil Perera', 'hf2.sunil', null, '+94771110002', 'driver', '{}', true,
   '00000000-0000-0000-0000-000000000bd2'),
  ('10000000-0000-0000-0000-000000000bd3', 'HF2P', 'Palitha Approver', null, 'hf2.palitha@fame.test', '+94712345678', 'fleet_admin',
   '{view,request,approve,assign_tasks,vehicles,issues}', true, '00000000-0000-0000-0000-000000000bd3'),
  ('10000000-0000-0000-0000-000000000bd4', 'HF2R', 'Ruwan Requester', null, 'hf2.ruwan@fame.test', null, 'staff', '{view,request}', true,
   '00000000-0000-0000-0000-000000000bd4');
insert into public.vehicles (id, reg_no, vehicle_type, current_odometer_km, active, in_garage) values
  ('20000000-0000-0000-0000-000000000bd1', 'WP HF2-0001', 'car', 1000, true, false),
  ('20000000-0000-0000-0000-000000000bd2', 'WP HF2-0002', 'van', 1000, true, false),
  ('20000000-0000-0000-0000-000000000bd3', 'WP HF2-0003', 'van', 1000, true, true);
insert into public.fleet_settings (key, value, updated_by) values ('office_phone', '"+94112345678"'::jsonb, 'test')
  on conflict (key) do update set value = excluded.value;

-- 1. The notification centre ----------------------------------------------------------------------------------------------
select is(public.queue_notification('request.created', '{"title": "Vehicle request · Galle", "body": "Ruwan", "url": "/requests/x", "who": "Ruwan"}'::jsonb,
                                    array['10000000-0000-0000-0000-000000000bd3', '10000000-0000-0000-0000-000000000bd4']::uuid[]),
  0, 'no browser registered: nothing for Web Push');
select is((select count(*) from public.office_inbox where url = '/requests/x'), 2::bigint,
  'but everyone told has it in their notification centre');
select is((select who || '|' || title from public.office_inbox where url = '/requests/x' and employee_id = '10000000-0000-0000-0000-000000000bd3'),
  'Ruwan|Vehicle request · Galle', 'with who and the title');
insert into public.notification_settings (employee_id, event, enabled) values ('10000000-0000-0000-0000-000000000bd4', 'request.created', false);
select public.queue_notification('request.created', '{"title": "Second", "url": "/requests/y"}'::jsonb,
                                 array['10000000-0000-0000-0000-000000000bd3', '10000000-0000-0000-0000-000000000bd4']::uuid[]);
select is((select count(*) from public.office_inbox where url = '/requests/y'), 1::bigint, 'an event someone switched off is not in their centre');
select public.queue_notification('request.created', '{"title": "Drivers never", "url": "/requests/z"}'::jsonb,
                                 array['10000000-0000-0000-0000-000000000bd1']::uuid[]);
select is((select count(*) from public.office_inbox where url = '/requests/z'), 0::bigint, 'a driver gets no office notification');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd4","role":"authenticated"}';
select is((select count(*) from public.office_inbox), 1::bigint, 'a person reads only their own notifications (RLS)');
select throws_ok($$ update public.office_inbox set read_at = now() $$, '42501', null, 'and marks them read only through the tools');
select throws_ok($$ select * from public.notification_prefs $$, '42501', null, 'the sound settings are the service role''s');
select throws_ok($$ select * from public.employee_changes $$, '42501', null, 'so is the log of number changes');
select throws_ok($$ select * from public.request_viewers $$, '42501', null, 'and who is reviewing');
select is(public.my_office_contacts(), null, 'an office person gets nothing from the driver''s Me contacts');
reset role;
set local request.jwt.claims to '{}';

-- 2. The accept window counts only at work (E) ------------------------------------------------------------------------------
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, sent_at, created_by) values
  -- Sent 40 minutes ago to Amal, who is off duty; leaves in 5 hours.
  ('30000000-0000-0000-0000-000000000bd1', 'HF2 off duty', '10000000-0000-0000-0000-000000000bd1', '20000000-0000-0000-0000-000000000bd1',
   now() + interval '5 hours', now() + interval '5 hours', 'assigned', now() - interval '40 minutes', 'test'),
  -- Sent 40 minutes ago to Sunil, off duty, but it leaves in 20 minutes.
  ('30000000-0000-0000-0000-000000000bd2', 'HF2 soon', '10000000-0000-0000-0000-000000000bd2', '20000000-0000-0000-0000-000000000bd2',
   now() + interval '20 minutes', now() + interval '20 minutes', 'assigned', now() - interval '40 minutes', 'test');
select public.queue_accept_reminders();
select is((select (needs_driver_since is null and accept_reminder_sent_at is null)::text from public.tasks where id = '30000000-0000-0000-0000-000000000bd1'),
  'true', 'off duty: no reminder and no "needs a driver", however long ago it was sent');
select is((select needs_driver_reason from public.tasks where id = '30000000-0000-0000-0000-000000000bd2'), 'not_accepted',
  '30 minutes before leave-by it needs a driver in any case');
-- Amal starts work 20 minutes ago: the window ran from then (15 minutes) and the reminder (5).
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('40000000-0000-0000-0000-000000000bd1', '10000000-0000-0000-0000-000000000bd1', '20000000-0000-0000-0000-000000000bd1', now() - interval '20 minutes');
select public.queue_accept_reminders();
select is((select (accept_reminder_sent_at is not null)::text || '|' || coalesce(needs_driver_reason, '-') from public.tasks
           where id = '30000000-0000-0000-0000-000000000bd1'),
  'true|not_accepted', 'at work for 20 minutes: reminded, and the 15-minute window is over');
-- Sent 5 minutes ago to Amal at work: not yet.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, sent_at, created_by) values
  ('30000000-0000-0000-0000-000000000bd3', 'HF2 just sent', '10000000-0000-0000-0000-000000000bd1', '20000000-0000-0000-0000-000000000bd1',
   now() + interval '6 hours', now() + interval '6 hours', 'assigned', now() - interval '4 minutes', 'test');
select public.queue_accept_reminders();
select is((select (needs_driver_since is null and accept_reminder_sent_at is null)::text from public.tasks where id = '30000000-0000-0000-0000-000000000bd3'),
  'true', 'sent 4 minutes ago while at work: the window counts from the sending');

-- 3. A vehicle chosen on the day (J) ----------------------------------------------------------------------------------------
select throws_like($$ insert into public.tasks (title, employee_id, start_at, status, created_by)
                      values ('no vehicle', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', 'test') $$,
  '%tasks_vehicle_present_check%', 'a task named "specific" needs its vehicle');
select throws_like($$ insert into public.tasks (title, employee_id, start_at, status, created_by, vehicle_mode)
                      values ('any what', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', 'test', 'any_type') $$,
  '%tasks_vehicle_present_check%', '"any" needs its type');
insert into public.tasks (id, title, employee_id, start_at, status, sent_at, created_by, vehicle_mode) values
  ('30000000-0000-0000-0000-000000000bd4', 'HF2 on the day', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', now(), 'test', 'driver_day');
insert into public.tasks (id, title, employee_id, start_at, status, sent_at, created_by, vehicle_mode, vehicle_type_wanted) values
  ('30000000-0000-0000-0000-000000000bd5', 'HF2 any van', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', now(), 'test', 'any_type', 'van');
select pass('a task with the driver''s vehicle on the day, and one for any van, are saved with no vehicle');
select throws_like($$ update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 1000
                      where id = '30000000-0000-0000-0000-000000000bd4' $$,
  '%tasks_vehicle_present_check%', 'but it never starts without one');
-- The office moves a task to "on the day" / "any van": the driver hears it.
update public.tasks set vehicle_id = null, vehicle_mode = 'driver_day' where id = '30000000-0000-0000-0000-000000000bd3';
select is((select convert_from(body, 'UTF8')::jsonb #> '{changes,vehicle_day}' from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000bd3'
           and (convert_from(body, 'UTF8')::jsonb ->> 'kind') = 'changed' order by id desc limit 1),
  'true'::jsonb, 'the changed push says the vehicle is now chosen on the day');
update public.tasks set vehicle_mode = 'any_type', vehicle_type_wanted = 'van' where id = '30000000-0000-0000-0000-000000000bd3';
select is((select convert_from(body, 'UTF8')::jsonb #>> '{changes,vehicle_any}' from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000bd3'
           and (convert_from(body, 'UTF8')::jsonb ->> 'kind') = 'changed' order by id desc limit 1),
  'van', 'and "any van"');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd1","role":"authenticated"}';
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd5', '20000000-0000-0000-0000-000000000bd1'), 'wrong_type',
  'the driver confirms a car for "any van": wrong_type');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd5', '20000000-0000-0000-0000-000000000bd3'), 'in_garage',
  'a van in the garage: in_garage');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd5', '20000000-0000-0000-0000-000000000bd2'), 'ok', 'a van: ok');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd4', '20000000-0000-0000-0000-000000000bd1'), 'ok',
  'the car they hold, for "on the day": ok');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd2', '20000000-0000-0000-0000-000000000bd1'), 'not_yours',
  'another driver''s task: not_yours');
reset role;
set local request.jwt.claims to '{}';
select is((select vehicle_id::text from public.tasks where id = '30000000-0000-0000-0000-000000000bd5'), '20000000-0000-0000-0000-000000000bd2',
  'the task takes the confirmed van');
select is((select vehicle_id from public.tasks where id = '30000000-0000-0000-0000-000000000bd2'), '20000000-0000-0000-0000-000000000bd2'::uuid,
  'the other driver''s task is unchanged');
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-000000000bd5'
           and (convert_from(body, 'UTF8')::jsonb ->> 'kind') = 'changed'), 0::bigint,
  'the driver''s own confirmation pushes them nothing');
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 1000 where id = '30000000-0000-0000-0000-000000000bd4';
select pass('with its vehicle confirmed the task starts');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd1","role":"authenticated"}';
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd4', '20000000-0000-0000-0000-000000000bd1'), 'started',
  'a started task: started (the queue counts it done)');

-- From the offline queue the driven vehicle is kept and what was wrong is noted for the office; a confirmed vehicle goes
-- with its driver (cleared when the task changes driver or is declined).
reset role;
set local request.jwt.claims to '{}';
insert into public.tasks (id, title, employee_id, start_at, status, sent_at, created_by, vehicle_mode, vehicle_type_wanted) values
  ('30000000-0000-0000-0000-000000000bd6', 'HF2 offline van', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', now(), 'test', 'any_type', 'van'),
  ('30000000-0000-0000-0000-000000000bd7', 'HF2 handed on', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', now(), 'test', 'driver_day', null),
  ('30000000-0000-0000-0000-000000000bd8', 'HF2 declined', '10000000-0000-0000-0000-000000000bd1', now() + interval '1 day', 'assigned', now(), 'test', 'driver_day', null);
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd1","role":"authenticated"}';
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd6', '20000000-0000-0000-0000-000000000bd1', true), 'ok',
  'from the offline queue a car for "any van" is taken (it was driven already)');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd7', '20000000-0000-0000-0000-000000000bd1'), 'ok', 'Amal confirms the car');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000bd8', '20000000-0000-0000-0000-000000000bd1'), 'ok', 'and on another task');
select is(public.decline_task('30000000-0000-0000-0000-000000000bd8', 'vehicle_problem', 'Brakes', now()), 'declined', 'then declines that one');
reset role;
set local request.jwt.claims to '{}';
select is((select vehicle_id::text || ' | ' || (warnings -> -1 ->> 'text') || ' | ' || (warnings -> -1 ->> 'by') from public.tasks
           where id = '30000000-0000-0000-0000-000000000bd6'),
  '20000000-0000-0000-0000-000000000bd1 | Started offline on WP HF2-0001, not a van as the task asked | Amal Silva',
  'the office sees why: noted on the task with the driver''s name');
update public.tasks set employee_id = '10000000-0000-0000-0000-000000000bd2' where id = '30000000-0000-0000-0000-000000000bd7';
select is((select vehicle_id from public.tasks where id = '30000000-0000-0000-0000-000000000bd7'), null::uuid,
  'given to Sunil: Amal''s confirmed car is cleared (Sunil confirms his own)');
select is((select vehicle_id from public.tasks where id = '30000000-0000-0000-0000-000000000bd8'), null::uuid,
  'declined: the confirmed car is cleared too');
update public.tasks set employee_id = '10000000-0000-0000-0000-000000000bd1', vehicle_id = '20000000-0000-0000-0000-000000000bd2', vehicle_mode = 'specific'
  where id = '30000000-0000-0000-0000-000000000bd7';
select is((select vehicle_id from public.tasks where id = '30000000-0000-0000-0000-000000000bd7'), '20000000-0000-0000-0000-000000000bd2'::uuid,
  'a vehicle the office sets with the new driver stays');
select is((select count(*) from cron.job where jobname = 'prune-request-viewers'), 1::bigint, '"reviewing" rows are pruned nightly');

-- 4. The driver's contacts: their own task only (F, I, K) --------------------------------------------------------------------
reset role;
set local request.jwt.claims to '{}';
update public.tasks set approved_by_employee_id = '10000000-0000-0000-0000-000000000bd3', approved_at = now()
  where id = '30000000-0000-0000-0000-000000000bd5';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd1","role":"authenticated"}';
select is(public.my_task_contacts('30000000-0000-0000-0000-000000000bd5') #>> '{approver,name}', 'Palitha Approver', 'who approved it, by name');
select is(public.my_task_contacts('30000000-0000-0000-0000-000000000bd5') #>> '{approver,phone}', '+94712345678', 'with their number');
select is(public.my_task_contacts('30000000-0000-0000-0000-000000000bd5') ->> 'office_phone', '+94112345678', 'and the office''s');
select ok(public.my_task_contacts('30000000-0000-0000-0000-000000000bd5') -> 'approvers' @> '[{"name": "Palitha Approver"}]'::jsonb,
  'the approvers with a number (when the one who approved has none)');
select is(public.my_task_contacts('30000000-0000-0000-0000-000000000bd2'), null, 'another driver''s task: nothing');
select is(public.my_office_contacts() ->> 'office_phone', '+94112345678', 'Me: Call office');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd4","role":"authenticated"}';
select is(public.my_task_contacts('30000000-0000-0000-0000-000000000bd5'), null, 'an office person gets nothing from a driver''s RPC');

-- 5. The push channels a phone has (B) ----------------------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000bd1","role":"authenticated"}';
select lives_ok($$ select public.register_device_token('ExponentPushToken[hf2-amal]', 'android', 'CPH2119', '1.2.0', 'en') $$,
  'the older app''s call (five arguments) still works');
select is((select channels from public.device_tokens where token = 'ExponentPushToken[hf2-amal]'), null::text[], 'with no channels named');
select lives_ok($$ select public.register_device_token('ExponentPushToken[hf2-amal]', 'android', 'CPH2119', '1.2.0', 'en', array['new-tasks']) $$,
  'the updated app names the channel it made');
select is((select channels from public.device_tokens where token = 'ExponentPushToken[hf2-amal]'), array['new-tasks'], 'new-tasks is kept');
select lives_ok($$ select public.register_device_token('ExponentPushToken[hf2-amal]', 'android', 'CPH2119', '1.2.0', 'si') $$, 'registered again without it');
select is((select channels from public.device_tokens where token = 'ExponentPushToken[hf2-amal]'), array['new-tasks'],
  'the channels stay (a call that names none keeps them)');
reset role;

select * from finish();
rollback;
