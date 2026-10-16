-- Phase 7, Part 2b, checked with pgTAP (docs/phase7-plan.md §20–26 and the Part 2 go): app stops are 10 minutes or
-- more with neither a point nor a heartbeat, on duty and before the cut-off; Google's leg lines kept with a plan go
-- after 30 days, with no push to the driver.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009a1', 'p7m.nimal@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000009a1', 'P7MA', 'Nimal Perera', 'p7m.nimal', 'driver', '{}', true, '00000000-0000-0000-0000-0000000009a1');
insert into public.vehicles (id, reg_no, current_odometer_km) values ('20000000-0000-0000-0000-0000000009a1', 'WP P7M-0001', 5000);

-- 1. App stops on a past day: on duty 08:00–20:00 Colombo, the cut-off at 18:00 ----------------------------------------
update public.fleet_settings set value = '"18:00"'::jsonb where key = 'duty_cutoff';
insert into public.fleet_settings (key, value) select 'duty_cutoff', '"18:00"'::jsonb
  where not exists (select 1 from public.fleet_settings where key = 'duty_cutoff');
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at, ended_at, end_reason) values
  ('80000000-0000-0000-0000-0000000009a1', '10000000-0000-0000-0000-0000000009a1', '20000000-0000-0000-0000-0000000009a1',
   '2026-10-10 08:00+05:30', '2026-10-10 20:00+05:30', 'driver');
-- Heartbeats every minute 08:00–17:59 (app 1.2.0+aaaa until 12:00, then 1.2.0+bbbb), with holes:
--   09:00–09:12   nothing at all                                     → a stop (12 min)
--   10:00–10:20   no heartbeat, but location points every 2 minutes  → not a stop
--   11:00–11:08   nothing (8 min)                                    → under 10 minutes: not a stop
--   11:50–12:05   nothing, across the update (aaaa → bbbb)          → not a stop
-- and nothing after 17:30 until the end at 20:00: 17:30–18:00 counts (before the cut-off), the rest does not.
insert into public.driver_heartbeats (employee_id, at, session_id, sharing, app_version)
select '10000000-0000-0000-0000-0000000009a1', m, '80000000-0000-0000-0000-0000000009a1', true,
       case when m < '2026-10-10 12:00+05:30' then '1.2.0+aaaa' else '1.2.0+bbbb' end
from generate_series('2026-10-10 08:00+05:30'::timestamptz, '2026-10-10 17:29+05:30'::timestamptz, interval '1 minute') m
where not (m > '2026-10-10 09:00+05:30' and m < '2026-10-10 09:12+05:30')
  and not (m > '2026-10-10 10:00+05:30' and m < '2026-10-10 10:20+05:30')
  and not (m > '2026-10-10 11:00+05:30' and m < '2026-10-10 11:08+05:30')
  and not (m > '2026-10-10 11:50+05:30' and m < '2026-10-10 12:05+05:30');
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng)
select '10000000-0000-0000-0000-0000000009a1', '80000000-0000-0000-0000-0000000009a1', m, 7.0, 80.0
from generate_series('2026-10-10 10:02+05:30'::timestamptz, '2026-10-10 10:18+05:30'::timestamptz, interval '2 minutes') m;

select is((select stops from public.app_stops('2026-10-10 00:00+05:30', '2026-10-11 00:00+05:30')
           where employee_id = '10000000-0000-0000-0000-0000000009a1'), 2,
  'two stops: 09:00–09:12 and 17:30 to the 18:00 cut-off (points kept arriving 10:00–10:20; 8 minutes is short; the update is not one)');
select is((select to_char(last_stop_at at time zone 'Asia/Colombo', 'HH24:MI') from public.app_stops('2026-10-10 00:00+05:30', '2026-10-11 00:00+05:30')
           where employee_id = '10000000-0000-0000-0000-0000000009a1'), '18:00', 'the last one ends at the cut-off, not at Finish work');
update public.fleet_settings set value = '""'::jsonb where key = 'duty_cutoff';
select is((select stops from public.app_stops('2026-10-10 00:00+05:30', '2026-10-11 00:00+05:30')
           where employee_id = '10000000-0000-0000-0000-0000000009a1'), 2,
  'with no cut-off the last stop runs to Finish work: still two');
select is((select to_char(last_stop_at at time zone 'Asia/Colombo', 'HH24:MI') from public.app_stops('2026-10-10 00:00+05:30', '2026-10-11 00:00+05:30')
           where employee_id = '10000000-0000-0000-0000-0000000009a1'), '20:00', 'ending at Finish work');
select is((select count(*) from public.app_stops('2026-10-11 00:00+05:30', '2026-10-12 00:00+05:30')
           where employee_id = '10000000-0000-0000-0000-0000000009a1'), 0::bigint, 'another day: none');

-- 2. Google's leg lines go after 30 days, quietly ---------------------------------------------------------------------
select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, sent_at, created_by, plan_json) values
  ('30000000-0000-0000-0000-0000000009a1', 'Old line', '10000000-0000-0000-0000-0000000009a1', '20000000-0000-0000-0000-0000000009a1',
   now() + interval '40 days', 'assigned', now(), 'test',
   jsonb_build_object('legs', jsonb_build_array(
     jsonb_build_object('from_seq', 0, 'to_seq', 1, 'km', 12.5, 'minutes', 30, 'source', 'google', 'line', '_p~iF~ps|U_ulLnnqC'),
     jsonb_build_object('from_seq', 1, 'to_seq', 2, 'km', 4, 'minutes', 9, 'source', 'google', 'line', '_ulLnnqC_mqNvxq`@')),
     'line_fetched_at', now() - interval '31 days', 'total_km', 16.5)),
  ('30000000-0000-0000-0000-0000000009a2', 'New line', '10000000-0000-0000-0000-0000000009a1', '20000000-0000-0000-0000-0000000009a1',
   now() + interval '40 days', 'assigned', now(), 'test',
   jsonb_build_object('legs', jsonb_build_array(jsonb_build_object('from_seq', 0, 'to_seq', 1, 'km', 3, 'minutes', 8, 'source', 'google', 'line', '_p~iF~ps|U')),
     'line_fetched_at', now() - interval '2 days'));
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') in ('30000000-0000-0000-0000-0000000009a1', '30000000-0000-0000-0000-0000000009a2')), 2::bigint,
  'the two new tasks pushed "new" to the driver');
select is((public.prune_google_content() ->> 'lines'), '1', 'the nightly job removes one plan''s lines (fetched 31 days ago)');
select is((select jsonb_path_query_array(plan_json, '$.legs[*].line') from public.tasks where id = '30000000-0000-0000-0000-0000000009a1'), '[]'::jsonb,
  'its legs have no line any more');
select is((select jsonb_path_query_array(plan_json, '$.legs[*].km') from public.tasks where id = '30000000-0000-0000-0000-0000000009a1'), '[12.5, 4]'::jsonb,
  'the legs, their km and the plan stay');
select ok((select not (plan_json ? 'line_fetched_at') and (plan_json ->> 'total_km') = '16.5' from public.tasks where id = '30000000-0000-0000-0000-0000000009a1'),
  'and the fetch time goes with the lines');
select is((select jsonb_path_query_array(plan_json, '$.legs[*].line') from public.tasks where id = '30000000-0000-0000-0000-0000000009a2'),
  '["_p~iF~ps|U"]'::jsonb, 'a line fetched 2 days ago stays');
select is((select count(*) from net.http_request_queue where url like '%/push-task'
           and (convert_from(body, 'UTF8')::jsonb ->> 'task_id') = '30000000-0000-0000-0000-0000000009a1'), 1::bigint,
  'the removal sends the driver no "Task changed" push');

select * from finish();
rollback;
