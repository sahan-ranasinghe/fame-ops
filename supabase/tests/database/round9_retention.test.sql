-- Round 4–7, item 9 (22 October 2026): data retention. Each rule removes only what is older than its period, in batches;
-- location points go only when their day has its summary; the business records are never touched, even when every rule
-- runs with a cut-off in the future.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table('public', 'driver_day_summaries', 'the daily summaries');

insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c9a01', 'R9K', 'Kamal Driver', 'r9.kamal', 'driver', '{}', true);
insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c9a02', 'R9O', 'Ops Person', 'r9.ops@fame.test', 'office', '{view}', true);
insert into public.vehicles (id, reg_no, current_odometer_km, active) values ('20000000-0000-0000-0000-0000000c9a01', 'WP R9-0001', 1000, true);
insert into public.places (id, name, kind) values ('50000000-0000-0000-0000-0000000c9a01', 'R9 Head office', 'office');

-- Business records, old.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, start_odometer_km, completed_at, end_odometer_km)
  values ('30000000-0000-0000-0000-0000000c9a01', 'Old trip', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
          now() - interval '3 years', 'completed', now() - interval '3 years', 1000, now() - interval '3 years', 1010);
insert into public.task_stops (task_id, seq, type, place_name) values ('30000000-0000-0000-0000-0000000c9a01', 1, 'drop', 'Galle');
insert into public.vehicle_requests (requested_by_name, needed_at, created_at) values ('Old ask', now() - interval '3 years', now() - interval '3 years');
insert into public.odometer_logs (vehicle_id, employee_id, task_id, reading_km, kind, logged_at)
  values ('20000000-0000-0000-0000-0000000c9a01', '10000000-0000-0000-0000-0000000c9a01', '30000000-0000-0000-0000-0000000c9a01', 1010, 'task_end', now() - interval '3 years');
insert into public.fuel_logs (vehicle_id, employee_id, litres, logged_at) values
  ('20000000-0000-0000-0000-0000000c9a01', '10000000-0000-0000-0000-0000000c9a01', 20, now() - interval '3 years');
insert into public.vehicle_reports (vehicle_id, employee_id, category, created_at) values
  ('20000000-0000-0000-0000-0000000c9a01', '10000000-0000-0000-0000-0000000c9a01', 'tyre', now() - interval '3 years');
insert into public.photos (employee_id, kind, storage_path, taken_at) values
  ('10000000-0000-0000-0000-0000000c9a01', 'vehicle_report', '10000000-0000-0000-0000-0000000c9a01/2023-01-01/r9.jpg', now() - interval '3 years');
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at, ended_at, end_reason) values
  ('60000000-0000-0000-0000-0000000c9a01', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
   now() - interval '3 years', now() - interval '3 years' + interval '8 hours', 'driver');

-- Data with a period: one old and one new of each.
insert into public.office_inbox (employee_id, event, title, created_at, read_at) values
  ('10000000-0000-0000-0000-0000000c9a02', 'x', 'old read', now() - interval '40 days', now() - interval '39 days'),
  ('10000000-0000-0000-0000-0000000c9a02', 'x', 'new read', now() - interval '2 days', now() - interval '1 day'),
  ('10000000-0000-0000-0000-0000000c9a02', 'x', 'old unread', now() - interval '100 days', null);
insert into public.office_audit (tool, actor_name, channel, at) values
  ('list_vehicles', 'Ops', 'web', now() - interval '40 days'),
  ('update_vehicle', 'Ops', 'web', now() - interval '40 days'),
  ('update_vehicle', 'Ops', 'web', now() - interval '800 days');
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng) values
  ('10000000-0000-0000-0000-0000000c9a01', '60000000-0000-0000-0000-0000000c9a01', now() - interval '200 days', 6.9, 79.9),
  ('10000000-0000-0000-0000-0000000c9a01', '60000000-0000-0000-0000-0000000c9a01', now() - interval '201 days', 6.9, 79.9),
  ('10000000-0000-0000-0000-0000000c9a01', '60000000-0000-0000-0000-0000000c9a01', now() - interval '1 day', 6.9, 79.9);
insert into public.driver_day_summaries (employee_id, day, km) values
  ('10000000-0000-0000-0000-0000000c9a01', ((now() - interval '200 days') at time zone 'Asia/Colombo')::date, 12.5);

select is(public.retention_batch('inbox_read', now() - interval '30 days', 100, true), 1, 'a preview counts one old read notification');
select is(public.retention_batch('inbox_read', now() - interval '30 days', 100, false), 1, 'and removes it');
select results_eq($$ select title from public.office_inbox where read_at is not null $$, $$ values ('new read'::text) $$,
  'the newer one stays');
select is(public.retention_batch('inbox_unread', now() - interval '90 days', 100, false), 1, 'an unread one after 90 days');
select is(public.retention_batch('audit_routine', now() - interval '30 days', 100, false, array['list_vehicles']), 1,
  'a routine entry after 30 days');
select is(public.retention_batch('audit_changes', now() - interval '730 days', 100, false, array['list_vehicles']), 1,
  'a change after 2 years, not before');
select is(public.retention_batch('location_points', now() - interval '183 days', 100, false), 1,
  'a point goes only when its day has its summary');
select results_eq($$ select count(*)::int from public.location_points where employee_id = '10000000-0000-0000-0000-0000000c9a01' $$,
  $$ values (2) $$, 'the day with no summary keeps its point, and today''s stays');
select is(public.retention_batch('inbox_read', now(), 1, false), 1, 'a batch takes at most its limit');
select throws_ok($$ select public.retention_batch('tasks', now(), 100, false) $$, 'P0001', NULL, 'there is no rule for a business record');

-- The days to summarise come from the duty sessions (never a scan of the points): yesterday first, then the oldest without
-- a summary; a day with its summary is not asked again (after 03:00 the morning after); never today.
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at, ended_at, end_reason) values
  ('60000000-0000-0000-0000-0000000c9a02', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
   '2026-09-01 02:00+00', '2026-09-01 12:00+00', 'driver'),
  ('60000000-0000-0000-0000-0000000c9a03', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
   '2026-09-05 02:00+00', '2026-09-05 12:00+00', 'driver'),
  ('60000000-0000-0000-0000-0000000c9a04', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
   '2026-09-09 02:00+00', '2026-09-09 12:00+00', 'driver'),
  ('60000000-0000-0000-0000-0000000c9a05', '10000000-0000-0000-0000-0000000c9a01', '20000000-0000-0000-0000-0000000c9a01',
   '2026-09-10 02:00+00', null, null);
insert into public.driver_day_summaries (employee_id, day, km, computed_at) values
  ('10000000-0000-0000-0000-0000000c9a01', '2026-09-05', 3, '2026-09-06 00:00+00');
select results_eq(
  $$ select day from public.days_without_summary('2026-09-10 06:00+00', 10)
     where employee_id = '10000000-0000-0000-0000-0000000c9a01' and day >= '2026-09-01' $$,
  $$ values ('2026-09-09'::date), ('2026-09-01'::date) $$,
  'yesterday first, then the oldest day without a summary; a summarised day and today are left out');
select results_eq($$ select count(*)::int from public.days_without_summary('2026-09-10 06:00+00', 1) $$, $$ values (1) $$,
  'a few at a time');
-- A recent day summarised before 03:00 the morning after is asked once more after 03:00 (late uploads).
insert into public.driver_day_summaries (employee_id, day, km, computed_at) values
  ('10000000-0000-0000-0000-0000000c9a01', '2026-09-09', 1, '2026-09-09 19:00+00');
select ok(exists(select 1 from public.days_without_summary('2026-09-10 06:00+00', 10) where day = '2026-09-09'),
  'yesterday summarised in the night is done once more in the morning');
select ok(not exists(select 1 from public.days_without_summary('2026-09-09 20:00+00', 10) where day = '2026-09-09'),
  'and not before 03:00');

-- Every rule with a cut-off in the future: the business records are untouched.
select public.retention_batch(r, now() + interval '1 day', 20000, false, array['list_vehicles'])
from unnest(array['inbox_read','inbox_unread','delivery','push_log','audit_routine','audit_changes','issue_events','issues_resolved',
                  'location_points','route_matched','heartbeats','google_calls','routing_calls','api_minute_calls','app_errors']) r;
select results_eq($$ select (select count(*) from public.tasks where id = '30000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.task_stops where task_id = '30000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.vehicle_requests where requested_by_name = 'Old ask')::int,
                            (select count(*) from public.odometer_logs where task_id = '30000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.fuel_logs where employee_id = '10000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.vehicle_reports where employee_id = '10000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.photos where employee_id = '10000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.duty_sessions where employee_id = '10000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.employees where id in ('10000000-0000-0000-0000-0000000c9a01', '10000000-0000-0000-0000-0000000c9a02'))::int,
                            (select count(*) from public.vehicles where id = '20000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.places where id = '50000000-0000-0000-0000-0000000c9a01')::int,
                            (select count(*) from public.driver_day_summaries where employee_id = '10000000-0000-0000-0000-0000000c9a01')::int $$,
  $$ values (1, 1, 1, 1, 1, 1, 1, 5, 2, 1, 1, 3) $$,
  'business records untouched: tasks, stops, requests, odometer and fuel logs, reports, photos, duty, people, vehicles, places, summaries');

select * from finish();
rollback;
