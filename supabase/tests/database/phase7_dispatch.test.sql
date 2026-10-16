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
  'Dilini Dispatch→/tasks/30000000-0000-0000-0000-0000000008a3/edit?driver=1 Palitha Assigner→/tasks/30000000-0000-0000-0000-0000000008a3/edit?driver=1 Ruwani Requester→/requests/70000000-0000-0000-0000-0000000008a1',
  'the dispatcher and the assigner get the change page, the requester their request');
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
insert into public.duty_sessions (id, employee_id, started_at) values
  ('80000000-0000-0000-0000-0000000008a1', '10000000-0000-0000-0000-0000000008b1', now() - interval '1 hour');
insert into public.driver_heartbeats (employee_id, at, session_id, sharing, app_version) values
  ('10000000-0000-0000-0000-0000000008b1', now() - interval '40 minutes', '80000000-0000-0000-0000-0000000008a1', true, '1.2.0+aaaa'),
  ('10000000-0000-0000-0000-0000000008b1', now() - interval '30 minutes', '80000000-0000-0000-0000-0000000008a1', true, '1.2.0+bbbb'),
  ('10000000-0000-0000-0000-0000000008b1', now() - interval '20 minutes', '80000000-0000-0000-0000-0000000008a1', true, '1.2.0+bbbb');
select is((select stops from public.app_stops(now() - interval '1 day', now()) where employee_id = '10000000-0000-0000-0000-0000000008b1'), 1,
  'two 10-minute gaps: the one across an update (aaaa → bbbb) is not counted');

select * from finish();
rollback;
