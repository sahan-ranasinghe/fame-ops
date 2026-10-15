-- Phase 7, Part 1, checked with pgTAP (docs/phase7-plan.md §1, §2, §7, §18): who holds which vehicle
-- (vehicle_assignments, one vehicle one driver), what the phones write translated into it, the
-- duty cut-off, the office's clock-out / move / reopen, the arrival and finish rules, app stops.
-- The driver's writes are made as the driver role (set local role authenticated).
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'p7.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000007b1', 'p7.nuwan@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000007c1', 'p7.saman@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000007d1', 'p7.ruwan@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000007e1', 'p7.dispatch@fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000007a1', 'P7A', 'Kamal Perera', 'p7.kamal', 'driver', '{}', '00000000-0000-0000-0000-0000000007a1'),
  ('10000000-0000-0000-0000-0000000007b1', 'P7B', 'Nuwan Silva', 'p7.nuwan', 'driver', '{}', '00000000-0000-0000-0000-0000000007b1'),
  ('10000000-0000-0000-0000-0000000007c1', 'P7C', 'Saman Kumara', 'p7.saman', 'driver', '{}', '00000000-0000-0000-0000-0000000007c1'),
  ('10000000-0000-0000-0000-0000000007d1', 'P7D', 'Ruwan Jaya', 'p7.ruwan', 'driver', '{}', '00000000-0000-0000-0000-0000000007d1');
insert into public.employees (id, code, name, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000007e1', 'P7E', 'Dispatch Only', 'p7.dispatch@fame.invalid', 'office', '{view,assign_tasks}',
   '00000000-0000-0000-0000-0000000007e1');
insert into public.vehicles (id, reg_no, make_model, seats, regular_driver_id) values
  ('20000000-0000-0000-0000-0000000007a1', 'WP P7-0001', 'Toyota HiAce', 14, '10000000-0000-0000-0000-0000000007a1'),
  ('20000000-0000-0000-0000-0000000007a2', 'WP P7-0002', 'Toyota Axio', 4, null),
  ('20000000-0000-0000-0000-0000000007a3', 'WP P7-0003', 'Nissan Caravan', 10, null),
  ('20000000-0000-0000-0000-0000000007a4', 'WP P7-0004', 'Isuzu Elf', 3, null);

-- The cut-off is off until section 16 tests it (so the time of day the test runs cannot matter).
insert into public.fleet_settings (key, value) values ('duty_cutoff', '""')
  on conflict (key) do update set value = excluded.value;

-- 1. The table and who may touch it -----------------------------------------------------------
select has_table('public', 'vehicle_assignments', 'vehicle_assignments exists');
select ok((select relrowsecurity from pg_class where oid = 'public.vehicle_assignments'::regclass), 'RLS is on');
select ok(has_table_privilege('authenticated', 'public.vehicle_assignments', 'SELECT'), 'drivers read (their own rows, by policy)');
select ok(not has_table_privilege('authenticated', 'public.vehicle_assignments', 'INSERT')
          and not has_table_privilege('authenticated', 'public.vehicle_assignments', 'UPDATE'), 'drivers write nothing there');
select ok(not has_function_privilege('authenticated', 'public.take_vehicle(uuid, uuid, text, timestamptz, text, uuid, uuid)', 'EXECUTE'),
  'drivers cannot call take_vehicle()');
select ok(has_function_privilege('authenticated', 'public.change_vehicle(uuid, timestamptz, uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.my_vehicle_choices()', 'EXECUTE'), 'drivers call change_vehicle() and my_vehicle_choices()');
select ok(has_column_privilege('authenticated', 'public.task_stops', 'arrival_flag', 'UPDATE')
          and has_column_privilege('authenticated', 'public.task_stops', 'arrival_distance_m', 'UPDATE'), 'drivers set the arrival flag and distance');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'finish_flag', 'UPDATE'), 'the finish flag is the server''s');

-- 2. Clock in with a vehicle (Kamal's phone writes a duty session) --------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}';
select lives_ok($$ insert into public.duty_sessions (id, employee_id, vehicle_id, started_at, device_info) values
  ('60000000-0000-0000-0000-0000000007a1', '10000000-0000-0000-0000-0000000007a1', '20000000-0000-0000-0000-0000000007a1',
   now() - interval '2 hours', '{"brand": "OPPO", "model": "CPH2119"}') $$, 'Kamal starts work on WP P7-0001');
reset role;
select is((select how || '|' || (to_at is null) from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007a1'),
  'clock_in|true', 'an open clock_in row');
select is((select current_vehicle_id from public.employees where id = '10000000-0000-0000-0000-0000000007a1'),
  '20000000-0000-0000-0000-0000000007a1'::uuid, 'current_vehicle_id follows it');

-- 3. Nuwan clocks in on the same vehicle: Kamal's row ends taken_over, Kamal holds none ----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007b1","role":"authenticated"}';
select lives_ok($$ insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('60000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007a1',
   now() - interval '1 hour') $$, 'Nuwan starts work on the same vehicle');
reset role;
select is((select ended_how || '|' || ended_by_name from public.vehicle_assignments
           where employee_id = '10000000-0000-0000-0000-0000000007a1' and vehicle_id = '20000000-0000-0000-0000-0000000007a1'),
  'taken_over|Nuwan Silva', 'Kamal''s row: taken over by Nuwan');
select is((select current_vehicle_id from public.employees where id = '10000000-0000-0000-0000-0000000007a1'), null::uuid,
  'Kamal holds no vehicle, and stays on duty');
select ok(exists (select 1 from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000007a1' and ended_at is null),
  'Kamal''s duty session stays open');
select is((select count(*) from public.vehicle_assignments where vehicle_id = '20000000-0000-0000-0000-0000000007a1' and to_at is null),
  1::bigint, 'one vehicle, one driver');

-- 4. A driver reads only their own rows -----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}';
select is((select count(*) from public.vehicle_assignments), 1::bigint, 'Kamal sees his one row, not Nuwan''s');
select is((select ended_by_name from public.vehicle_assignments), 'Nuwan Silva', 'the banner can name who took it');
select throws_ok($$ insert into public.vehicle_assignments (employee_id, vehicle_id, from_at, how, by_name)
  values ('10000000-0000-0000-0000-0000000007a1', '20000000-0000-0000-0000-0000000007a2', now(), 'change', 'me') $$,
  '42501', null, 'a driver cannot write an assignment directly');

-- 5. Change vehicle through the RPC, twice with the same id: one change ----------------------------
select is((public.change_vehicle('20000000-0000-0000-0000-0000000007a2', now() - interval '30 minutes',
                                 '70000000-0000-0000-0000-0000000007c1') ->> 'vehicle_id'),
  '20000000-0000-0000-0000-0000000007a2', 'Kamal changes to WP P7-0002');
select is((public.change_vehicle('20000000-0000-0000-0000-0000000007a2', now() - interval '30 minutes',
                                 '70000000-0000-0000-0000-0000000007c1') ->> 'vehicle_id'),
  '20000000-0000-0000-0000-0000000007a2', 'the queue sends it again');
select is((select count(*) from public.vehicle_assignments where vehicle_id = '20000000-0000-0000-0000-0000000007a2'), 1::bigint,
  'still one row');
select throws_ok($$ select public.change_vehicle('20000000-0000-0000-0000-000000000000', now(), null) $$,
  'P0001', 'That vehicle is not in use', 'an unknown vehicle is refused');

-- 6. Late writes (offline) -------------------------------------------------------------------------
select is((public.change_vehicle('20000000-0000-0000-0000-0000000007a3', now() - interval '40 minutes',
                                 '70000000-0000-0000-0000-0000000007c3') ->> 'vehicle_id'),
  '20000000-0000-0000-0000-0000000007a2', 'a change older than his current row does not undo it');
select is((public.change_vehicle(null, now() - interval '25 minutes', '70000000-0000-0000-0000-0000000007c4') ->> 'vehicle_id'),
  null, '"No vehicle"');
select is((public.change_vehicle('20000000-0000-0000-0000-0000000007a1', now() - interval '90 minutes',
                                 '70000000-0000-0000-0000-0000000007c2') ->> 'vehicle_id'),
  null, 'the later take wins: Kamal does not get P7-0001 back');
reset role;
select is((select employee_id from public.vehicle_assignments where vehicle_id = '20000000-0000-0000-0000-0000000007a1' and to_at is null),
  '10000000-0000-0000-0000-0000000007b1'::uuid, 'Nuwan still holds it');
select is((select ended_how from public.vehicle_assignments where client_id = '70000000-0000-0000-0000-0000000007c2'), 'taken_over',
  'the stretch Kamal had it is recorded, ended by Nuwan''s take');

-- 7. An old app's Change (a bare current_vehicle_id update) ----------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}';
select lives_ok($$ update public.employees set current_vehicle_id = '20000000-0000-0000-0000-0000000007a2'
  where id = '10000000-0000-0000-0000-0000000007a1' $$, 'the old app picks WP P7-0002');
reset role;
select is((select how || '|' || by_name from public.vehicle_assignments
           where employee_id = '10000000-0000-0000-0000-0000000007a1' and to_at is null), 'change|Kamal Perera', 'it became a change');

-- 8. The picker ------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}';
select is((select x ->> 'held_by' from jsonb_array_elements(public.my_vehicle_choices()) x where x ->> 'reg_no' = 'WP P7-0001'),
  'Nuwan', '"With Nuwan now" (first name only)');
select is((select (x ->> 'my_regular')::boolean from jsonb_array_elements(public.my_vehicle_choices()) x where x ->> 'reg_no' = 'WP P7-0001'),
  true, 'P7-0001 is Kamal''s regular vehicle');
select is((select (x ->> 'mine_now')::boolean and (x ->> 'my_last')::boolean
           from jsonb_array_elements(public.my_vehicle_choices()) x where x ->> 'reg_no' = 'WP P7-0002'), true, 'P7-0002 is his now and his last');
select is((select x ->> 'held_by' from jsonb_array_elements(public.my_vehicle_choices()) x where x ->> 'reg_no' = 'WP P7-0003'), null,
  'a free vehicle has no holder');
select throws_ok($$ select public.take_vehicle('10000000-0000-0000-0000-0000000007a1', null, 'change', now(), 'me') $$,
  '42501', null, 'take_vehicle() stays the server''s');
reset role;

-- 9. Finish work (the session ends): the vehicle is given up -----------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007b1","role":"authenticated"}';
select lives_ok($$ update public.duty_sessions set ended_at = now(), end_reason = 'driver' where id = '60000000-0000-0000-0000-0000000007b1' $$,
  'Nuwan finishes work');
select is((public.send_heartbeat(now(), false, true, 'always') ->> 'on_duty')::boolean, false, 'the heartbeat answers on_duty false');
select is((public.send_heartbeat(now(), false, true, 'always') -> 'duty_end' ->> 'reason'), 'driver', '… and how the duty ended');
reset role;
select is((select ended_how || '|' || ended_by_name from public.vehicle_assignments
           where employee_id = '10000000-0000-0000-0000-0000000007b1' and vehicle_id = '20000000-0000-0000-0000-0000000007a1'),
  'clock_out|Nuwan Silva', 'his row ends clock_out');
select is((select current_vehicle_id from public.employees where id = '10000000-0000-0000-0000-0000000007b1'), null::uuid, 'and he holds none');

-- 10. A task start takes the task's vehicle (Saman, off duty, starts on Kamal's P7-0002) -----------
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, created_by, plan_json) values
  ('30000000-0000-0000-0000-0000000007c1', 'Team drop', '10000000-0000-0000-0000-0000000007c1', '20000000-0000-0000-0000-0000000007a2',
   now(), 'assigned', 'test', '{"total_km": 50, "total_drive_min": 60}');
-- Two finished tasks (inserted finished: no start trigger runs for them).
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, created_by, plan_json,
                          started_at, start_odometer_km, end_odometer_km, completed_at) values
  ('30000000-0000-0000-0000-0000000007c2', 'Goods run', '10000000-0000-0000-0000-0000000007c1', '20000000-0000-0000-0000-0000000007a2',
   now() - interval '3 hours', 'completed', 'test', '{"total_km": 50, "total_drive_min": 60}',
   now() - interval '3 hours', 900, 950, now() - interval '2 hours'),
  ('30000000-0000-0000-0000-0000000007c3', 'Yesterday''s run', '10000000-0000-0000-0000-0000000007c1', '20000000-0000-0000-0000-0000000007a2',
   now() - interval '1 day', 'completed', 'test', null,
   now() - interval '1 day' - interval '1 hour', 800, 820, now() - interval '1 day');
insert into public.task_stops (id, task_id, seq, type, place_name, lat, lng) values
  ('50000000-0000-0000-0000-0000000007c1', '30000000-0000-0000-0000-0000000007c1', 1, 'pickup', 'Head office', 6.90, 79.85),
  ('50000000-0000-0000-0000-0000000007c2', '30000000-0000-0000-0000-0000000007c1', 2, 'drop', 'Kurunegala site', 7.48, 80.36),
  ('50000000-0000-0000-0000-0000000007c3', '30000000-0000-0000-0000-0000000007c1', 3, 'drop', 'Kurunegala store', 7.49, 80.37);
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}';
select lives_ok($$ update public.tasks set status = 'in_progress', start_odometer_km = 1000
  where id = '30000000-0000-0000-0000-0000000007c1' $$, 'Saman starts the task');
reset role;
-- (Ten minutes ago, for the server's 5-minute wait below.)
update public.tasks set started_at = now() - interval '10 minutes' where id = '30000000-0000-0000-0000-0000000007c1';
select is((select how || '|' || task_id from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007c1' and to_at is null),
  'task_start|30000000-0000-0000-0000-0000000007c1', 'Saman holds P7-0002 through the task start');
select is((select ended_how from public.vehicle_assignments
           where employee_id = '10000000-0000-0000-0000-0000000007a1' and vehicle_id = '20000000-0000-0000-0000-0000000007a2'
           order by from_at desc limit 1),
  'taken_over', 'Kamal''s P7-0002 row ended taken_over');

-- 11. The server opens a duty session for a running task whose phone sent none; the phone's own replaces it
select is((public.duty_jobs() ->> 'sessions_opened')::integer, 1, 'one server session for Saman''s running task');
select is((select device_info ->> 'opened_by' from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000007c1' and ended_at is null),
  'server', 'marked as opened by the server');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}';
-- The app's own start: it closes any older open session first (api.startSession), then inserts its own.
select lives_ok($$ update public.duty_sessions set ended_at = now() - interval '9 minutes', end_reason = 'auto'
  where employee_id = '10000000-0000-0000-0000-0000000007c1' and ended_at is null $$, 'the phone closes the open session first');
select lives_ok($$ insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('60000000-0000-0000-0000-0000000007c1', '10000000-0000-0000-0000-0000000007c1', '20000000-0000-0000-0000-0000000007a2', now() - interval '9 minutes') $$,
  'the phone''s session arrives late');
select is((public.send_heartbeat(now(), true, true, 'always') ->> 'on_duty')::boolean, true, 'the heartbeat answers on_duty true');
reset role;
select is((select id from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000007c1' and ended_at is null),
  '60000000-0000-0000-0000-0000000007c1'::uuid, 'the phone''s session is the open one');
select is((select count(*) from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007c1'), 1::bigint,
  'the swap did not split Saman''s vehicle row');

-- 12. Arrived and Done (the driver's writes) --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}';
select lives_ok($$ update public.task_stops set status = 'arrived', arrived_at = now(), arrival_flag = 'ok', arrival_distance_m = 40
  where id = '50000000-0000-0000-0000-0000000007c1' $$, 'Arrived within 300 m');
select lives_ok($$ update public.task_stops set status = 'done', done_at = now() where id = '50000000-0000-0000-0000-0000000007c1' $$,
  'then Done');
select throws_ok($$ update public.task_stops set status = 'done', done_at = now() where id = '50000000-0000-0000-0000-0000000007c2' $$,
  'P0001', 'Mark Arrived first: a stop is Done only after Arrived', 'the new app''s Done without Arrived is refused');
select lives_ok($$ update public.task_stops set status = 'done', done_at = now(), arrived_at = now() where id = '50000000-0000-0000-0000-0000000007c2' $$,
  'an older app''s combined write passes');
select is((select arrival_flag from public.task_stops where id = '50000000-0000-0000-0000-0000000007c2'), 'not_arrived', '… flagged not_arrived');
select throws_ok($$ update public.task_stops set arrival_flag = 'maybe' where id = '50000000-0000-0000-0000-0000000007c3' $$,
  '23514', null, 'an unknown flag is refused');
select lives_ok($$ update public.task_stops set status = 'arrived', arrived_at = now(), arrival_flag = 'override', arrival_distance_m = 42000
  where id = '50000000-0000-0000-0000-0000000007c3' $$, '"I''m here, the pin is wrong" 42 km away');

-- 13. Completed early: 3 km on the odometer for a 50 km plan -----------------------------------------
select lives_ok($$ update public.tasks set status = 'completed', end_odometer_km = 1003, completed_at = now()
  where id = '30000000-0000-0000-0000-0000000007c1' $$, 'Saman completes the task');
reset role;
select is((select finish_flag ->> 'kind' || '|' || (finish_flag ->> 'odometer_km') || '|' || (finish_flag ->> 'planned_km')
           from public.tasks where id = '30000000-0000-0000-0000-0000000007c1'), 'completed_early|3|50.0', 'flagged completed_early with the numbers');
select is((select finish_flag from public.tasks where id = '30000000-0000-0000-0000-0000000007c2'), null::jsonb,
  'a task driven as planned has no flag');

-- 14. Reopen (the office, the same day) ----------------------------------------------------------------
update public.task_stops set status = 'skipped', skip_reason = 'not_visited', done_at = (select completed_at from public.tasks where id = '30000000-0000-0000-0000-0000000007c1')
  where id = '50000000-0000-0000-0000-0000000007c3';
select is((public.office_reopen_task('30000000-0000-0000-0000-0000000007c3', 'Palitha', 'check')) ->> 'result', 'not_today',
  'a task completed yesterday is not reopened');
select is((public.office_reopen_task('30000000-0000-0000-0000-0000000007c1', 'Palitha', 'wrong reading')) ->> 'result', 'reopened',
  'today''s task is reopened');
select is((select status || '|' || coalesce(completed_at::text, 'none') || '|' || coalesce(end_odometer_km::text, 'none') || '|' || coalesce(finish_flag::text, 'none')
           from public.tasks where id = '30000000-0000-0000-0000-0000000007c1'), 'in_progress|none|none|none', 'in progress again, end and flag cleared');
select is((select status from public.task_stops where id = '50000000-0000-0000-0000-0000000007c3'), 'pending', 'the stop skipped at the finish is open again');
select is((select action || '|' || actor from public.task_assignment_events where task_id = '30000000-0000-0000-0000-0000000007c1' and action = 'reopened'),
  'reopened|Palitha', 'the history records it');
select matches((select note from public.task_assignment_events where task_id = '30000000-0000-0000-0000-0000000007c1' and action = 'reopened'),
  '^wrong reading · was completed \d\d:\d\d · end odometer 1003 km$', 'with the reason and what was cleared');
select is((public.office_reopen_task('30000000-0000-0000-0000-0000000007c2', 'Palitha', 'check')) ->> 'result', 'driver_busy',
  'not while the driver has another task running');

-- 15. The office clocks out and moves ------------------------------------------------------------------
select is((public.office_clock_out('10000000-0000-0000-0000-0000000007c1', 'Palitha')) ->> 'result', 'task_in_progress',
  'not while a task is running');
select is((public.office_clock_out('10000000-0000-0000-0000-0000000007a1', 'Palitha', 'left early')) ->> 'result', 'clocked_out',
  'Kamal is clocked out by the office');
select is((select end_reason from public.duty_sessions where id = '60000000-0000-0000-0000-0000000007a1'), 'admin', 'end reason admin');
select is((select ended_how || '|' || ended_by_name from public.vehicle_assignments
           where employee_id = '10000000-0000-0000-0000-0000000007a1' and ended_how = 'office'), null,
  'Kamal held nothing then (P7-0002 had gone to Saman)');
select is((public.office_move_vehicle('10000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007a3', 'Palitha')) ->> 'result',
  'off_duty', 'an off-duty driver is not moved');
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('60000000-0000-0000-0000-0000000007b2', '10000000-0000-0000-0000-0000000007b1', null, now() - interval '5 minutes');
select is((public.office_move_vehicle('10000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007a3', 'Palitha')) ->> 'result',
  'moved', 'Nuwan, on duty with no vehicle, is moved to P7-0003');
select is((select how || '|' || by_name from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007b1' and to_at is null),
  'office|Palitha', 'how office, by the office person');
select is((public.office_move_vehicle('10000000-0000-0000-0000-0000000007c1', '20000000-0000-0000-0000-0000000007a3', 'Palitha')) ->> 'result',
  'task_in_progress', 'a driver on a task is not moved to another vehicle');
select is((public.office_move_vehicle('10000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007a2', 'Palitha')) ->> 'result',
  'vehicle_on_task', 'nor is anyone moved onto a vehicle on someone''s running task');
select is((public.office_clock_out('10000000-0000-0000-0000-0000000007b1', 'Palitha')) ->> 'result', 'clocked_out', 'Nuwan clocked out');
select is((select ended_how || '|' || ended_by_name from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007b1'
           and vehicle_id = '20000000-0000-0000-0000-0000000007a3'), 'office|Palitha', 'his row ends office, by Palitha');

-- 16. The cut-off -------------------------------------------------------------------------------------
-- Ruwan started yesterday at 08:00 and never finished: clocked out at yesterday's 21:00.
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at) values
  ('60000000-0000-0000-0000-0000000007d1', '10000000-0000-0000-0000-0000000007d1', '20000000-0000-0000-0000-0000000007a4',
   ((now() at time zone 'Asia/Colombo')::date - 1 + time '08:00') at time zone 'Asia/Colombo');
select is((select current_vehicle_id from public.employees where id = '10000000-0000-0000-0000-0000000007d1'),
  '20000000-0000-0000-0000-0000000007a4'::uuid, 'Ruwan holds P7-0004');
select is(public.duty_cutoff_after(((now() at time zone 'Asia/Colombo')::date + time '08:00') at time zone 'Asia/Colombo', '21:00'),
  ((now() at time zone 'Asia/Colombo')::date + time '21:00') at time zone 'Asia/Colombo', 'the cut-off after 08:00 is 21:00 that day');
select is(public.duty_cutoff_after(now(), ''), null, 'an empty cut-off is off');
select is((public.duty_jobs() ->> 'clocked_out')::integer, 0, 'with the cut-off off, nobody is clocked out');
update public.fleet_settings set value = '"21:00"' where key = 'duty_cutoff';
select is((public.duty_jobs() ->> 'clocked_out')::integer, 1, 'Ruwan is clocked out; Saman (a task running) is not');
select is((select end_reason || '|' || to_char(ended_at at time zone 'Asia/Colombo', 'HH24:MI') from public.duty_sessions
           where id = '60000000-0000-0000-0000-0000000007d1'), 'auto|21:00', 'at the cut-off, end reason auto');
select is((select ended_how || '|' || ended_by_name from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000007d1'),
  'auto|system', 'his vehicle row ends auto');
select ok(exists (select 1 from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000007c1' and ended_at is null),
  'Saman stays on duty while his task runs');

-- 17. App stops: heartbeat gaps of over 3 minutes inside one duty period --------------------------------
insert into public.driver_heartbeats (employee_id, at, session_id, sharing) values
  ('10000000-0000-0000-0000-0000000007c1', now() - interval '20 minutes', '60000000-0000-0000-0000-0000000007c1', true),
  ('10000000-0000-0000-0000-0000000007c1', now() - interval '19 minutes', '60000000-0000-0000-0000-0000000007c1', true),
  ('10000000-0000-0000-0000-0000000007c1', now() - interval '12 minutes', '60000000-0000-0000-0000-0000000007c1', true),
  ('10000000-0000-0000-0000-0000000007c1', now() - interval '11 minutes', '60000000-0000-0000-0000-0000000007c1', true),
  ('10000000-0000-0000-0000-0000000007c1', now() - interval '2 minutes', '60000000-0000-0000-0000-0000000007c1', true);
select is((select stops from public.app_stops(now() - interval '1 day', now()) where employee_id = '10000000-0000-0000-0000-0000000007c1'),
  2, 'two gaps of over 3 minutes: the app was stopped twice');

-- 18. The new task issue kinds are the dispatcher's ----------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000007e1","role":"authenticated"}';
select ok(public.issue_visible('completed_early') and public.issue_visible('arrival_override') and public.issue_visible('vehicle_conflict'),
  'assign_tasks reads completed_early, arrival_override and vehicle_conflict');
select ok(not public.issue_visible('app_stopped'), 'app_stopped is the issues permission''s');
reset role;

-- 19. current_vehicle_id = the open row, for everyone, at the end ---------------------------------------
select is((select count(*) from public.employees e
           where e.current_vehicle_id is distinct from
                 (select a.vehicle_id from public.vehicle_assignments a where a.employee_id = e.id and a.to_at is null)), 0::bigint,
  'no employee''s current_vehicle_id differs from their open row');
select lives_ok($$ set constraints all immediate $$, 'the deferred check passes');
select throws_ok($$ update public.vehicle_assignments set to_at = now(), ended_how = 'change'
  where employee_id = '10000000-0000-0000-0000-0000000007c1' and to_at is null $$,
  'P0001', null, 'closing a row behind take_vehicle()''s back is refused');

select * from finish();
rollback;
