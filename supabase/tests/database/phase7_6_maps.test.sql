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

select * from finish();
rollback;
