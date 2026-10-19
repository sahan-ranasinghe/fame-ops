-- Phase 7, Part 6 after the checkpoint (Sahan, 19 October 2026), checked with pgTAP: both maps on every phone. The phone
-- reads the office's map package and its wait through get_driver_settings, and reports whether Google's map loaded
-- (report_map_state: its own row only, an older report ignored, a failure with its reason); the table is the server's.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006e1', 'p6m.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000006e2', 'p6m.nuwan@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000006e3', 'p6m.nobody@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000006e1', 'P6MK', 'Kamal Perera', 'p6m.kamal', 'driver', '{}', true, '00000000-0000-0000-0000-0000000006e1'),
  ('10000000-0000-0000-0000-0000000006e2', 'P6MN', 'Nuwan Silva', 'p6m.nuwan', 'driver', '{}', true, '00000000-0000-0000-0000-0000000006e2');

-- 1. The table is the server's ------------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.driver_map_state'::regclass), 'driver_map_state has row level security');
select ok(not has_table_privilege('authenticated', 'public.driver_map_state', 'select')
  and not has_table_privilege('authenticated', 'public.driver_map_state', 'insert')
  and not has_table_privilege('anon', 'public.driver_map_state', 'select'), 'nobody reads or writes it but through report_map_state');
select ok(not has_function_privilege('anon', 'public.report_map_state(boolean, text, timestamptz, text)', 'execute'), 'anon cannot report');

-- 2. The settings the phones read --------------------------------------------------------------------------------------
delete from public.fleet_settings where key in ('map_package', 'phone_map_wait_s');
select is(public.get_driver_settings() ->> 'map_package', 'google', 'the phones use Google''s map by default');
select is((public.get_driver_settings() ->> 'phone_map_wait_s')::int, 30, 'and wait 30 s for it by default');
insert into public.fleet_settings (key, value, updated_by) values ('map_package', '"open"', 'test'), ('phone_map_wait_s', '1', 'test');
select is(public.get_driver_settings() ->> 'map_package', 'open', 'the office''s map package reaches the phones');
select is((public.get_driver_settings() ->> 'phone_map_wait_s')::int, 1, 'and the wait (1 s forces the free map for a test)');
select ok(public.get_driver_settings() ? 'shift_start' and public.get_driver_settings() ? 'half_day_split', 'the settings before are still there');

-- 3. A driver's report ---------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e1","role":"authenticated"}';
select is(public.report_map_state(false, 'timeout', now() - interval '2 minutes', '1.3.0+abcd1234'), 'ok', 'Google''s map failed on Kamal''s phone: reported');
select throws_ok($$ select public.report_map_state(false, null, now(), '1.3.0') $$, '22023', null, 'a failure needs its reason');
select throws_ok($$ select public.report_map_state(false, 'grey', now(), '1.3.0') $$, '22023', null, 'timeout or error only');
select is(public.report_map_state(true, '', now() - interval '5 minutes', '1.3.0'), 'older', 'a report older than the one stored is ignored');
reset role;
select results_eq($$ select google_ok, reason, google_failed_at is not null, google_ok_at is null, app_version from public.driver_map_state
                     where employee_id = '10000000-0000-0000-0000-0000000006e1' $$,
  $$ values (false, 'timeout'::text, true, true, '1.3.0+abcd1234'::text) $$, 'the failure is stored with its reason and the app version');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e1","role":"authenticated"}';
select is(public.report_map_state(true, '', now() + interval '1 hour', '1.3.0+abcd1234'), 'ok', 'Google''s map loaded again: reported');
reset role;
select results_eq($$ select google_ok, reason, google_failed_at is not null, google_ok_at <= now() from public.driver_map_state
                     where employee_id = '10000000-0000-0000-0000-0000000006e1' $$,
  $$ values (true, null::text, true, true) $$, 'OK, the reason cleared, the failure''s time kept; a phone time after now is stored as now');
select is((select count(*) from public.driver_map_state where employee_id = '10000000-0000-0000-0000-0000000006e2'), 0::bigint,
  'another driver''s row is untouched');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e3","role":"authenticated"}';
select throws_ok($$ select public.report_map_state(false, 'error', now(), '1.3.0') $$, '42501', null, 'a sign-in that is no employee cannot report');
reset role;

-- 4. Tries in a row (the office hears of a failure on the second, issues.ts mapAlarms) -----------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e2","role":"authenticated"}';
select is(public.report_map_state(false, 'timeout', now() - interval '3 hours', '1.3.0'), 'ok', 'Nuwan''s first try fails');
reset role;
select is((select failures from public.driver_map_state where employee_id = '10000000-0000-0000-0000-0000000006e2'), 1, 'one failure');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e2","role":"authenticated"}';
select is(public.report_map_state(false, 'error', now() - interval '1 hour', '1.3.0'), 'ok', 'the next try fails too');
reset role;
select results_eq($$ select failures, reason, google_failed_at < last_failed_at from public.driver_map_state
                     where employee_id = '10000000-0000-0000-0000-0000000006e2' $$,
  $$ values (2, 'error'::text, true) $$, 'two in a row: the first failure''s time kept, the last one''s beside it');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006e2","role":"authenticated"}';
select is(public.report_map_state(true, '', now(), '1.3.0'), 'ok', 'Google loads again');
reset role;
select is((select failures from public.driver_map_state where employee_id = '10000000-0000-0000-0000-0000000006e2'), 0, 'a good load ends the run');

-- 5. The 30-day clean-up strips Google's leg lines only; openrouteservice's stay -------------------------------------------
insert into public.vehicles (id, reg_no, vehicle_type, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000006e1', 'WP P6M-0001', 'van', 1000, true);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, created_by, plan_json) values
  ('30000000-0000-0000-0000-0000000006e1', 'P6M lines', '10000000-0000-0000-0000-0000000006e1', '20000000-0000-0000-0000-0000000006e1',
   now() + interval '1 day', now() + interval '1 day', 'assigned', 'test',
   jsonb_build_object('line_fetched_at', (now() - interval '40 days')::text,
     'legs', jsonb_build_array(jsonb_build_object('from_seq', 0, 'to_seq', 1, 'source', 'google', 'line', 'gline'),
                               jsonb_build_object('from_seq', 1, 'to_seq', 2, 'source', 'ors', 'line', 'oline'))));
select lives_ok($$ select public.prune_google_content(30) $$, 'the clean-up runs');
select results_eq($$ select l ->> 'source', l ->> 'line' from public.tasks t, jsonb_array_elements(t.plan_json -> 'legs') l
                     where t.id = '30000000-0000-0000-0000-0000000006e1' order by l ->> 'source' $$,
  $$ values ('google'::text, null::text), ('ors'::text, 'oline'::text) $$, 'Google''s line gone after 30 days, openrouteservice''s kept');
select ok(not (select plan_json ? 'line_fetched_at' from public.tasks where id = '30000000-0000-0000-0000-0000000006e1'), 'the mark goes with Google''s lines');
select ok(exists (select 1 from information_schema.columns where table_name = 'route_legs' and column_name = 'line'), 'the leg cache keeps a line');

select * from finish();
rollback;
