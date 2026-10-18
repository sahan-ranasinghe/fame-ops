-- Phase 7, Part 2, checked with pgTAP (docs/phase7-plan.md §2 addition, §11, §12, §17, §19): view implied by any
-- permission, the usual time at a place, the start stop, needs a driver and who hears it, the vehicle swap during a
-- task (typed by the office or from the phone), "I need another vehicle", app stops across an update.
-- The driver's writes are made as the driver role.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'p72.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000008b1', 'p72.dispatch@fame.test'),
  ('00000000-0000-0000-0000-0000000008c1', 'p72.assigner@fame.test'),
  ('00000000-0000-0000-0000-0000000008d1', 'p72.requester@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000008a1', 'P72A', 'Kamal Perera', 'p72.kamal', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000008a1'),
  ('10000000-0000-0000-0000-0000000008b1', 'P72B', 'Dilini Dispatch', null, 'p72.dispatch@fame.test', 'office', '{view,assign_tasks}', true, '00000000-0000-0000-0000-0000000008b1'),
  ('10000000-0000-0000-0000-0000000008c1', 'P72C', 'Palitha Assigner', null, 'p72.assigner@fame.test', 'office', '{view,vehicles}', true, '00000000-0000-0000-0000-0000000008c1'),
  ('10000000-0000-0000-0000-0000000008d1', 'P72D', 'Ruwani Requester', null, 'p72.requester@fame.test', 'staff', '{request}', true, '00000000-0000-0000-0000-0000000008d1');
-- Each office person has a browser for web push (queue_notification only writes for a device).
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-0000000008b1', 'https://push.example/p72b', 'p', 'a'),
  ('10000000-0000-0000-0000-0000000008c1', 'https://push.example/p72c', 'p', 'a'),
  ('10000000-0000-0000-0000-0000000008d1', 'https://push.example/p72d', 'p', 'a');
insert into public.vehicles (id, reg_no, current_odometer_km) values
  ('20000000-0000-0000-0000-0000000008a1', 'WP P72-0001', 10000),
  ('20000000-0000-0000-0000-0000000008a2', 'WP P72-0002', 52000);
insert into public.places (id, name, lat, lng, kind) values
  ('40000000-0000-0000-0000-0000000008a1', 'P72 Kurunegala site', 7.48, 80.36, 'site');

-- 1. Any permission implies view (the backfill ran on the people who had a permission and no view) --------------
select ok(not exists (select 1 from public.employees where cardinality(permissions) > 0 and not ('view' = any(permissions))
                      and id not in ('10000000-0000-0000-0000-0000000008d1')),
  'nobody saved before this migration holds a permission without view');

-- 2. A task saved with the new columns; the time at a place is remembered ---------------------------------------
select lives_ok($$ select public.office_create_task(
  jsonb_build_object('title', 'Team drop', 'employee_id', '10000000-0000-0000-0000-0000000008a1', 'vehicle_id', '20000000-0000-0000-0000-0000000008a1',
    'start_at', now() + interval '2 hours', 'leave_by', now() + interval '2 hours', 'created_by', 'Palitha Assigner',
    'assigned_by_employee_id', '10000000-0000-0000-0000-0000000008c1',
    'vehicle_choice', jsonb_build_object('default_reg_no', 'WP P72-0002', 'why', 'Kamal''s regular vehicle', 'chosen_reg_no', 'WP P72-0001'),
    'warnings', jsonb_build_array(jsonb_build_object('text', 'Leave by 07:24 to arrive at 09:00', 'by', 'Palitha Assigner'))),
  jsonb_build_array(
    jsonb_build_object('seq', 1, 'type', 'pickup', 'place_name', 'Head office', 'lat', 6.9, 'lng', 79.85, 'is_start', true, 'dwell_source', 'default', 'dwell_min', 5),
    jsonb_build_object('seq', 2, 'type', 'drop', 'place_id', '40000000-0000-0000-0000-0000000008a1', 'place_name', 'P72 Kurunegala site',
                       'lat', 7.48, 'lng', 80.36, 'dwell_min', 90, 'dwell_source', 'chosen')),
  '[]'::jsonb) $$, 'office_create_task takes the start stop, the time sources, the vehicle choice, the warnings and who assigned it');
select is((select count(*) from public.tasks where title = 'Team drop' and assigned_by_employee_id = '10000000-0000-0000-0000-0000000008c1'
           and vehicle_choice ->> 'why' = 'Kamal''s regular vehicle' and jsonb_array_length(warnings) = 1), 1::bigint, '… all kept on the task');
select is((select is_start::text || '|' || dwell_source from public.task_stops s join public.tasks t on t.id = s.task_id
           where t.title = 'Team drop' and s.seq = 1), 'true|default', 'the start stop and its default time');
select is((select usual_dwell_min from public.places where id = '40000000-0000-0000-0000-0000000008a1'), 90,
  'the place remembers the time chosen there (1 h 30)');
select is((select value from public.fleet_settings where key = 'dwell_min'), '{"pickup": 5, "drop": 5, "visit": 60, "default": 5}'::jsonb,
  'the defaults: pickup and drop 5 minutes, a visit 1 hour');

-- 3. Passengers get in at the start: arrived when the task starts --------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select lives_ok($$ update public.tasks set status = 'in_progress', start_odometer_km = 10000 where title = 'Team drop' $$, 'Kamal starts the task');
reset role;
select is((select s.status || '|' || (s.arrived_at is not null)::text from public.task_stops s join public.tasks t on t.id = s.task_id
           where t.title = 'Team drop' and s.seq = 1), 'arrived|true', 'the start stop is arrived at the start');
select is((select s.status from public.task_stops s join public.tasks t on t.id = s.task_id where t.title = 'Team drop' and s.seq = 2), 'pending',
  'the next stop is still to do');

-- 4. A swap during the task, the readings typed by the office ---------------------------------------------------------
select is((public.office_swap_vehicle((select id from public.tasks where title = 'Team drop'), '20000000-0000-0000-0000-0000000008a2',
                                      'Palitha Assigner', 10042, 52000, 'Breakdown at Kegalle')) ->> 'result', 'swapped', 'the office swaps the vehicle');
select is((select count(*) from public.task_vehicle_segments s join public.tasks t on t.id = s.task_id where t.title = 'Team drop'), 2::bigint,
  'two segments');
select is((select string_agg(v.reg_no || ':' || s.start_odometer_km || '-' || coalesce(s.end_odometer_km::text, '…'), ' ' order by s.seq)
           from public.task_vehicle_segments s join public.tasks t on t.id = s.task_id join public.vehicles v on v.id = s.vehicle_id
           where t.title = 'Team drop'), 'WP P72-0001:10000-10042 WP P72-0002:52000-…', 'the old one ends at 10042, the new one starts at 52000');
select is((select vehicle_id from public.tasks where title = 'Team drop'), '20000000-0000-0000-0000-0000000008a2'::uuid, 'the task moves to the new vehicle');
select is((select vehicle_id from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000008a1' and to_at is null),
  '20000000-0000-0000-0000-0000000008a2'::uuid, 'Kamal holds the new vehicle');
select is((select count(*) from public.odometer_logs where entry = 'office' and task_id = (select id from public.tasks where title = 'Team drop')), 2::bigint,
  'the typed readings are logged like the phone''s (entry office)');
select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-0000000008a1'), 10042, 'the old vehicle''s odometer follows');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select is((select count(*) from public.task_vehicle_segments), 2::bigint, 'the driver reads the segments of their own task');
select lives_ok($$ update public.task_stops set status = 'arrived', arrived_at = now(), arrival_flag = 'ok', arrival_distance_m = 20
  where task_id = (select id from public.tasks where title = 'Team drop') and seq = 2 $$, 'Kamal arrives at the drop');
select lives_ok($$ update public.tasks set status = 'completed', end_odometer_km = 52061, completed_at = now() where title = 'Team drop' $$,
  'Kamal completes with the new vehicle''s reading (lower than the first vehicle''s start: allowed after a swap)');
reset role;
select is((select km from public.tasks where title = 'Team drop'), 103, 'task km = 42 + 61, the sum of the segments');
select is((select s.end_odometer_km from public.task_vehicle_segments s join public.tasks t on t.id = s.task_id where t.title = 'Team drop' and s.seq = 2),
  52061, 'the last segment ends with the task''s end reading');

-- 5. A swap with the readings from the phone ----------------------------------------------------------------------------
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, start_odometer_km, created_by) values
  ('30000000-0000-0000-0000-0000000008a2', 'Goods run', '10000000-0000-0000-0000-0000000008a1', '20000000-0000-0000-0000-0000000008a1',
   now(), 'in_progress', now() - interval '1 hour', 10042, 'test');
select is((public.office_swap_vehicle('30000000-0000-0000-0000-0000000008a2', '20000000-0000-0000-0000-0000000008a2', 'Palitha Assigner')) ->> 'readings',
  'from_the_phone', 'a swap without readings asks the phone');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select lives_ok($$ insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, entry) values
  ('20000000-0000-0000-0000-0000000008a1', '10000000-0000-0000-0000-0000000008a1', '30000000-0000-0000-0000-0000000008a2', 10070, 'task_end', 'photo'),
  ('20000000-0000-0000-0000-0000000008a2', '10000000-0000-0000-0000-0000000008a1', '30000000-0000-0000-0000-0000000008a2', 52061, 'task_start', 'photo') $$,
  'the phone logs the old vehicle''s end and the new one''s start');
reset role;
select is((select string_agg(coalesce(s.start_odometer_km::text, '…') || '-' || coalesce(s.end_odometer_km::text, '…'), ' ' order by s.seq)
           from public.task_vehicle_segments s where s.task_id = '30000000-0000-0000-0000-0000000008a2'), '10042-10070 52061-…',
  'the segments take the phone''s readings');
select is((public.office_swap_vehicle('30000000-0000-0000-0000-0000000008a2', '20000000-0000-0000-0000-0000000008a2', 'Palitha')) ->> 'result',
  'same_vehicle', 'no swap to the vehicle it already has');

-- 6. "I need another vehicle" -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select lives_ok($$ insert into public.vehicle_reports (id, vehicle_id, employee_id, task_id, category, note, needs_vehicle) values
  ('60000000-0000-0000-0000-0000000008a1', '20000000-0000-0000-0000-0000000008a2', '10000000-0000-0000-0000-0000000008a1',
   '30000000-0000-0000-0000-0000000008a2', 'breakdown', 'Engine stopped', true) $$, 'the driver reports a breakdown and asks for another vehicle');
reset role;
select is((select count(*) from public.notifications where event = 'task.vehicle_needed'), 1::bigint,
  'the dispatcher hears it at once (the only one here with approve or assign_tasks and a browser)');
select matches((select payload ->> 'title' || ' | ' || (payload ->> 'body') from public.notifications where event = 'task.vehicle_needed'),
  '^Another vehicle needed · WP P72-0002 \| Kamal Perera · Breakdown · Goods run · Engine stopped$', 'naming the vehicle, the driver, the task and the note');

-- 7. Needs a driver: a decline tells the dispatchers, the assigner and the requester --------------------------------------
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, decided_at, decided_by) values
  ('70000000-0000-0000-0000-0000000008a1', 'Ruwani Requester', '10000000-0000-0000-0000-0000000008d1', now() + interval '3 hours', 'approved', now(), 'Palitha Assigner');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, sent_at, created_by, request_id, assigned_by_employee_id) values
  ('30000000-0000-0000-0000-0000000008a3', 'Site visit', '10000000-0000-0000-0000-0000000008a1', '20000000-0000-0000-0000-0000000008a1',
   now() + interval '3 hours', now() + interval '3 hours', now(), 'Palitha Assigner', '70000000-0000-0000-0000-0000000008a1',
   '10000000-0000-0000-0000-0000000008c1');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select is(public.decline_task('30000000-0000-0000-0000-0000000008a3', 'unwell', null), 'declined', 'Kamal declines');
reset role;
select is((select needs_driver_reason || '|' || (needs_driver_since is not null)::text from public.tasks where id = '30000000-0000-0000-0000-0000000008a3'),
  'declined|true', 'the task needs a driver: declined');
select is((select string_agg(e.name || '→' || (n.payload ->> 'url'), ' ' order by e.name) from public.notifications n
           join public.employees e on e.id = n.recipient_employee_id where n.event = 'task.declined'),
  'Dilini Dispatch→/tasks/30000000-0000-0000-0000-0000000008a3/edit?driver=1 Palitha Assigner→/ Ruwani Requester→/requests/70000000-0000-0000-0000-0000000008a1',
  'the dispatcher gets the change page, the assigner without assign_tasks the Overview, the requester their request');
select matches((select payload ->> 'title' || ' | ' || (payload ->> 'body') from public.notifications where event = 'task.declined' limit 1),
  '^Kamal declined ''Site visit'' \d\d:\d\d \| Unwell · needs a driver$', '"Kamal declined ''Site visit'' 09:00" · "Unwell · needs a driver"');
select lives_ok($$ update public.tasks set status = 'assigned', declined_at = null, declined_by = null, declined_reason = null, declined_note = null
  where id = '30000000-0000-0000-0000-0000000008a3' $$, 'the office gives it back (reassign)');
select ok((select needs_driver_since is null and needs_driver_reason is null from public.tasks where id = '30000000-0000-0000-0000-0000000008a3'),
  'and it no longer needs a driver');
select lives_ok($$ insert into public.issue_events (issue_id, action, actor, note)
  select i.id, 'notified', 'system', 'Told: Dilini Dispatch, Palitha Assigner' from public.issues i limit 1 $$, 'an issue''s history can say who was told');

-- 8. The new task kind is the dispatcher's ------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008b1","role":"authenticated"}';
select ok(public.issue_visible('vehicle_needed'), 'assign_tasks reads vehicle_needed');
reset role;

-- 9. App stops: a restart after an update is not one --------------------------------------------------------------------
insert into public.duty_sessions (id, employee_id, started_at, ended_at, end_reason) values
  ('80000000-0000-0000-0000-0000000008a1', '10000000-0000-0000-0000-0000000008b1', '2026-10-08 08:00+05:30', '2026-10-08 09:00+05:30', 'driver');
-- A heartbeat every minute but two 10-minute holes: 08:20–08:30 across the update (aaaa → bbbb), 08:40–08:50 not.
insert into public.driver_heartbeats (employee_id, at, session_id, sharing, app_version)
select '10000000-0000-0000-0000-0000000008b1', m, '80000000-0000-0000-0000-0000000008a1', true,
       case when m <= '2026-10-08 08:20+05:30' then '1.2.0+aaaa' else '1.2.0+bbbb' end
from generate_series('2026-10-08 08:00+05:30'::timestamptz, '2026-10-08 09:00+05:30'::timestamptz, interval '1 minute') m
where not (m > '2026-10-08 08:20+05:30' and m < '2026-10-08 08:30+05:30') and not (m > '2026-10-08 08:40+05:30' and m < '2026-10-08 08:50+05:30');
select is((select stops from public.app_stops('2026-10-08 00:00+05:30', '2026-10-09 00:00+05:30') where employee_id = '10000000-0000-0000-0000-0000000008b1'), 1,
  'two 10-minute gaps: the one across an update (aaaa → bbbb) is not counted');

-- 10. From the checkpoint review: a reading still owed, ownership, the accept window's bound, a re-send -------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000008e1', 'p72.sunil@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000008e1', 'P72E', 'Sunil Silva', 'p72.sunil', 'driver', '{}', true, '00000000-0000-0000-0000-0000000008e1');
insert into public.vehicles (id, reg_no, current_odometer_km) values ('20000000-0000-0000-0000-0000000008a3', 'WP P72-0003', 7000);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, start_odometer_km, created_by, plan_json) values
  ('30000000-0000-0000-0000-0000000008a4', 'Tow run', '10000000-0000-0000-0000-0000000008e1', '20000000-0000-0000-0000-0000000008a1',
   now() - interval '3 hours', 'in_progress', now() - interval '3 hours', 10070, 'test',
   '{"legs": [{"km": 100, "minutes": 120, "to_seq": 1}]}'::jsonb);
select is((public.office_swap_vehicle('30000000-0000-0000-0000-0000000008a4', '20000000-0000-0000-0000-0000000008a3', 'Palitha Assigner', 10120, null))
          ->> 'result', 'swapped', 'a swap with the old vehicle''s end typed, the new one''s start owed');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}';
select lives_ok($$ insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, entry) values
  ('20000000-0000-0000-0000-0000000008a3', '10000000-0000-0000-0000-0000000008a1', '30000000-0000-0000-0000-0000000008a4', 9999, 'task_start', 'photo') $$,
  'Kamal logs a reading naming Sunil''s task (his own row: the policy lets it in)');
select lives_ok($$ insert into public.vehicle_reports (vehicle_id, employee_id, task_id, category, needs_vehicle) values
  ('20000000-0000-0000-0000-0000000008a1', '10000000-0000-0000-0000-0000000008a1', '30000000-0000-0000-0000-0000000008a3', 'breakdown', true) $$,
  'Kamal asks for another vehicle on a task that is not running');
reset role;
select is((select s.start_odometer_km from public.task_vehicle_segments s where s.task_id = '30000000-0000-0000-0000-0000000008a4' and s.seq = 2), null::integer,
  'another driver''s reading does not fill the stretch');
select is((select count(*) from public.notifications where event = 'task.vehicle_needed'), 1::bigint,
  'and no push for a task that is not running (only the earlier one)');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000008e1","role":"authenticated"}';
select lives_ok($$ update public.tasks set status = 'completed', end_odometer_km = 7050, completed_at = now() where id = '30000000-0000-0000-0000-0000000008a4' $$,
  'Sunil completes in the new vehicle with its start reading still owed (not refused)');
reset role;
select is((select coalesce(km::text, 'none') || '|' || coalesce(finish_flag ->> 'kind', 'none') from public.tasks where id = '30000000-0000-0000-0000-0000000008a4'),
  'none|none', 'no km yet and no completed-early question while a reading is owed');
select is((public.office_swap_reading('30000000-0000-0000-0000-0000000008a4', '20000000-0000-0000-0000-0000000008a3', 'start', 7000, 'Palitha Assigner')) ->> 'result',
  'saved', 'the office types the owed start afterwards');
select is((select km from public.tasks where id = '30000000-0000-0000-0000-0000000008a4'), 100, 'task km = 50 + 50');
select is((public.office_swap_reading('30000000-0000-0000-0000-0000000008a4', '20000000-0000-0000-0000-0000000008a3', 'start', 7001, 'Palitha')) ->> 'result',
  'not_owed', 'a reading that is not owed is refused');

-- The accept window: today's and later tasks only; a re-send starts it again.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, sent_at, created_by) values
  ('30000000-0000-0000-0000-0000000008a5', 'Old unaccepted', '10000000-0000-0000-0000-0000000008e1', '20000000-0000-0000-0000-0000000008a3',
   now() - interval '2 days', now() - interval '2 days', now() - interval '3 days', 'test'),
  ('30000000-0000-0000-0000-0000000008a6', 'Late accept', '10000000-0000-0000-0000-0000000008e1', '20000000-0000-0000-0000-0000000008a3',
   now() + interval '5 hours', now() + interval '5 hours', now() - interval '20 minutes', 'test');
-- Hotfix 2 (E): the accept window runs only while the driver is at work: the drivers with tasks here started work 3 hours ago.
insert into public.duty_sessions (employee_id, started_at)
select distinct t.employee_id, now() - interval '3 hours' from public.tasks t join public.employees e on e.id = t.employee_id
where t.status = 'assigned' and e.role = 'driver'
  and not exists (select 1 from public.duty_sessions d where d.employee_id = t.employee_id and d.ended_at is null);
select ok(public.queue_accept_reminders() >= 1, 'the minute job runs');
select is((select string_agg(title || ':' || coalesce(needs_driver_reason, '-'), ' ' order by title) from public.tasks
           where id in ('30000000-0000-0000-0000-0000000008a5', '30000000-0000-0000-0000-0000000008a6')),
  'Late accept:not_accepted Old unaccepted:-', 'not accepted 20 minutes after sending: needs a driver; a task from 2 days ago is left alone');
select lives_ok($$ update public.tasks set sent_at = now(), accept_reminder_sent_at = null where id = '30000000-0000-0000-0000-0000000008a6' $$,
  'the office gives it back to the same driver (sent again)');
select is((select coalesce(needs_driver_reason, 'cleared') from public.tasks where id = '30000000-0000-0000-0000-0000000008a6'), 'cleared',
  'sending again clears it');

select * from finish();
rollback;
