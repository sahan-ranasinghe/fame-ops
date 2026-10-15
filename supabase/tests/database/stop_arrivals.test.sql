-- Phase 6, Part 5b, checked with pgTAP: a reached stop gets the driver's own position (the location
-- point nearest the Arrived tap, the nudge or Done, within 5 minutes and 100 m), kept for good; a
-- Google stop over 30 days old then reads "Google place · arrived near <town> HH:MM"; the gaps'
-- estimated lines are the server's only.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d5', 'd.p5b@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000d5', 'D-P5B', 'Part 5b Driver', 'd.p5b', 'driver', '{}', '00000000-0000-0000-0000-0000000000d5');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000d5', 'WP P5B-0001');
insert into public.google_pins (google_place_id, lat, lng, address, fetched_at) values ('g-kandy', 7.2931, 80.6350, 'Kandy City Centre, Kandy', now() - interval '31 days');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, start_odometer_km, created_by) values
  ('30000000-0000-0000-0000-0000000000d5', 'Kandy run', '10000000-0000-0000-0000-0000000000d5', '20000000-0000-0000-0000-0000000000d5',
   now() - interval '32 days', 'in_progress', now() - interval '32 days', 1000, 'test');
insert into public.task_stops (id, task_id, seq, type, place_name, address, lat, lng) values
  ('50000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d5', 1, 'drop', 'Kandy City Centre', 'Kandy City Centre, Kandy', 7.2931, 80.6350),
  ('50000000-0000-0000-0000-0000000000d2', '30000000-0000-0000-0000-0000000000d5', 2, 'drop', 'Peradeniya', null, 7.2690, 80.5942),
  ('50000000-0000-0000-0000-0000000000d3', '30000000-0000-0000-0000-0000000000d5', 3, 'visit', 'Not reached', null, 7.20, 80.60);
-- The driver's points around the taps: the nearest in time wins, a poor fix (over 100 m) never does.
insert into public.duty_sessions (id, employee_id, vehicle_id, started_at, ended_at, end_reason) values
  ('60000000-0000-0000-0000-0000000000d5', '10000000-0000-0000-0000-0000000000d5', '20000000-0000-0000-0000-0000000000d5',
   now() - interval '1 day' - interval '1 hour', now() - interval '1 day' + interval '1 hour', 'driver');
insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m, source) values
  ('10000000-0000-0000-0000-0000000000d5', '60000000-0000-0000-0000-0000000000d5', now() - interval '1 day' - interval '4 minutes', 7.2900, 80.6300, 10, 'app'),
  ('10000000-0000-0000-0000-0000000000d5', '60000000-0000-0000-0000-0000000000d5', now() - interval '1 day' - interval '30 seconds', 7.2932, 80.6352, 8, 'app'),
  ('10000000-0000-0000-0000-0000000000d5', '60000000-0000-0000-0000-0000000000d5', now() - interval '1 day' + interval '10 seconds', 7.2950, 80.6400, 140, 'app'),
  ('10000000-0000-0000-0000-0000000000d5', '60000000-0000-0000-0000-0000000000d5', now() - interval '1 day' + interval '20 minutes', 7.2691, 80.5943, 12, 'app');
update public.task_stops set status = 'arrived', arrived_at = now() - interval '1 day' where id = '50000000-0000-0000-0000-0000000000d1';
update public.task_stops set status = 'done', auto_detected_at = now() - interval '1 day' + interval '19 minutes', done_at = now() - interval '1 day' + interval '25 minutes'
  where id = '50000000-0000-0000-0000-0000000000d2';

-- 1. The arrival point: the nearest good point in time; the nudge counts as reached; a stop not reached gets none.
select is(public.fill_stop_arrivals(), 2, 'two reached stops get their arrival point');
select is((select arrival_lat || ',' || arrival_lng || '|' || arrival_accuracy_m from public.task_stops where id = '50000000-0000-0000-0000-0000000000d1'),
  '7.2932,80.6352|8', 'the Arrived tap: the point 30 s before it (the 140 m fix 10 s after is not used)');
select is((select arrival_lat::text from public.task_stops where id = '50000000-0000-0000-0000-0000000000d2'), '7.2691', 'the nudge time counts when there is no tap');
select is((select arrival_lat from public.task_stops where id = '50000000-0000-0000-0000-0000000000d3'), null, 'a stop not reached gets no arrival point');
select is(public.fill_stop_arrivals(), 0, 'filled once');

-- 2. After 30 days: the Google stop keeps where the driver arrived and the town near it; the arrival point stays.
select ok(public.nearest_town_name(7.2932, 80.6352) is not null, 'a town is found near Kandy');
select is((public.prune_google_content() ->> 'stops')::integer, 1, 'one Google stop over 30 days old is cleared');
select matches((select place_name from public.task_stops where id = '50000000-0000-0000-0000-0000000000d1'),
  '^Google place · arrived near .+ \d\d:\d\d$', 'it reads "Google place · arrived near <town> HH:MM"');
select is((select place_name from public.task_stops where id = '50000000-0000-0000-0000-0000000000d1'),
  'Google place · arrived near ' || public.nearest_town_name(7.2932, 80.6352) || ' ' || to_char((now() - interval '1 day') at time zone 'Asia/Colombo', 'HH24:MI'),
  'the town nearest the arrival point and the time of the tap (Colombo)');
select is((select coalesce(lat::text, 'none') || '|' || coalesce(address, 'none') || '|' || arrival_lat || '|' || google_place_id
  from public.task_stops where id = '50000000-0000-0000-0000-0000000000d1'), 'none|none|7.2932|g-kandy', 'Google''s pin and address gone; the arrival point and the place id stay');
select is((select place_name from public.task_stops where id = '50000000-0000-0000-0000-0000000000d2'), 'Peradeniya', 'our own stop is never touched');

-- 3. The estimated lines are the server's only.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d5","role":"authenticated"}';
select throws_ok($$ select * from public.route_gap_lines $$, '42501', null, 'a driver cannot read the estimated lines');
select throws_ok($$ select public.fill_stop_arrivals() $$, '42501', null, 'nor fill arrival points');
select is((select arrival_lat from public.task_stops where id = '50000000-0000-0000-0000-0000000000d1'), 7.2932::double precision, 'the driver sees their own arrival point on their stop');
reset role;

select * from finish();
rollback;
