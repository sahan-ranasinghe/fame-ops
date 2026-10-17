-- Phase 6, Part 5, checked with pgTAP: the Google call counter (google_take: recorded before the
-- call, refused at the daily cap and at the month's ceiling, caps clamped to 95 % of the free usage,
-- Colombo days), the Google pins and the stops they mark, the 30-day clean-up, "Used before"
-- without Google stops, and who may do what.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- 1. Place Details with a daily cap of 400: 400 calls are allowed, call 401 is refused and only counted as refused.
select is(
  (select count(*) from generate_series(1, 401) g where (public.google_take('places_details', 400, 9500) ->> 'allowed')::boolean),
  400::bigint, 'of 401 Place Details calls in a day with a cap of 400, 400 are allowed');
select is((select calls || '|' || refused from public.google_calls where feature = 'places_details'), '400|1',
  'the counter holds 400 calls and 1 refused');
select is(public.google_take('places_details', 400, 9500) - 'day_cap' - 'month_cap',
  '{"allowed": false, "reason": "day", "day": 400, "month": 400}'::jsonb, 'the next one is refused too: the day''s cap');
select is((select day from public.google_calls where feature = 'places_details'), (now() at time zone 'Asia/Colombo')::date,
  'calls are counted on the Colombo day');
select is((public.google_take('places_autocomplete', 400, 9500) ->> 'allowed')::boolean, true, 'each feature counts on its own');

-- 2. The month's ceiling: earlier days this month count; at the ceiling the reason is the month.
insert into public.google_calls (feature, day, calls)
  values ('routes', date_trunc('month', now() at time zone 'Asia/Colombo')::date, 4750)
  on conflict (feature, day) do update set calls = 4750;
select is(public.google_take('routes', 200, 4750) ->> 'reason', 'month', 'Routes at 4,750 this month: refused for the month');
select is((select coalesce(sum(calls), 0) from public.google_calls where feature = 'routes'), 4750::bigint, 'a refused call is never counted as a call');

-- 3. A cap above the hard ceiling is clamped (95 % of the free usage); a cap of 0 refuses everything.
select is(public.google_take('map_loads', 100000, 100000) ->> 'month_cap', '9500', 'a month cap above 9,500 map loads is clamped to 9,500');
select is(public.google_take('roads', 200, 99999) ->> 'month_cap', '4750', 'roads: clamped to 4,750');
select is(public.google_take('roads', 0, 0) ->> 'allowed', 'false', 'a cap of 0: refused');
select throws_ok($$ select public.google_take('street_view', 1, 1) $$, 'P0001', 'google_take: unknown feature street_view', 'an unknown feature is an error (the caller refuses the call)');
select is(public.google_hard_ceiling('places_autocomplete'), 9500, 'autocomplete: 9,500 a month at most');

-- 4. A stop whose coordinates are a Google pin's is marked with the pin's id and fetch time; any other pin is not.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c5', 'd.p5@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000c5', 'D-P5', 'Part 5 Driver', 'd.p5', 'driver', '{}', '00000000-0000-0000-0000-0000000000c5');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000c5', 'WP P5-0001');
insert into public.google_pins (google_place_id, lat, lng, address, fetched_at) values
  ('g-fresh', 7.2931, 80.6350, 'Kandy City Centre, Kandy', now() - interval '2 days'),
  ('g-old', 6.0535, 80.2210, 'Galle Fort, Galle', now() - interval '31 days');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by, start_name, start_lat, start_lng) values
  ('30000000-0000-0000-0000-0000000000c5', 'Google stops', '10000000-0000-0000-0000-0000000000c5', '20000000-0000-0000-0000-0000000000c5',
   now() - interval '35 days', 'test', 'Galle Fort', 6.0535, 80.2210);
insert into public.task_stops (id, task_id, seq, type, place_name, address, lat, lng) values
  ('50000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c5', 1, 'pickup', 'Kandy City Centre', 'Kandy City Centre, Kandy', 7.2931, 80.6350),
  ('50000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-0000000000c5', 2, 'drop', 'Galle Fort', 'Galle Fort, Galle', 6.0535, 80.2210),
  ('50000000-0000-0000-0000-0000000000c3', '30000000-0000-0000-0000-0000000000c5', 3, 'drop', 'Our office', null, 6.9000, 79.8600);
select is((select google_place_id || '|' || (google_fetched_at = now() - interval '2 days') from public.task_stops where id = '50000000-0000-0000-0000-0000000000c1'),
  'g-fresh|true', 'a stop on a Google pin carries the pin''s id and fetch time');
select is((select google_place_id from public.task_stops where id = '50000000-0000-0000-0000-0000000000c3'), null, 'a stop on our own pin is not marked');
select is((select start_google_place_id from public.tasks where id = '30000000-0000-0000-0000-0000000000c5'), 'g-old', 'a start on a Google pin is marked');
update public.task_stops set lat = 6.91, lng = 79.87 where id = '50000000-0000-0000-0000-0000000000c1';
select is((select coalesce(google_place_id, 'none') from public.task_stops where id = '50000000-0000-0000-0000-0000000000c1'), 'none',
  'moving the pin by hand unmarks the stop (the coordinates are no longer Google''s)');
update public.task_stops set lat = 7.2931, lng = 80.6350 where id = '50000000-0000-0000-0000-0000000000c1';

-- 5. "Used before" never offers a Google stop.
select is((select count(*) from public.recent_places('Galle Fort', now() - interval '90 days', 5)), 0::bigint, 'a Google stop is not "used before"');
select is((select count(*) from public.recent_places('Our office', now() - interval '90 days', 5)), 1::bigint, 'our own typed stop still is');

-- 6. The 30-day clean-up: the old pin, the stop and the start that copied it lose Google's details; the id stays;
--    the fresh one is kept; Google-snapped lines over 30 days old go, others stay.
insert into public.route_matched (employee_id, date, provider, leg_from, leg_to, geometry, matched_at, status) values
  ('10000000-0000-0000-0000-0000000000c5', current_date - 40, 'google_roads', now() - interval '40 days', now() - interval '40 days' + interval '10 minutes', '[]', now() - interval '40 days', 'ok'),
  ('10000000-0000-0000-0000-0000000000c5', current_date - 40, 'osrm', now() - interval '40 days', now() - interval '40 days' + interval '10 minutes', '[]', now() - interval '40 days', 'ok');
select is(public.prune_google_content(), '{"pins": 1, "stops": 1, "starts": 1, "matched": 1, "lines": 0, "request_stops": 0, "request_starts": 0}'::jsonb, 'one pin, one stop, one start and one snapped leg over 30 days old (no request''s)');
select is((select coalesce(lat::text, 'none') || '|' || coalesce(address, 'none') || '|' || place_name || '|' || google_place_id
  from public.task_stops where id = '50000000-0000-0000-0000-0000000000c2'),
  'none|none|Google place (details removed after 30 days)|g-old', 'the old stop keeps only the Google place id');
select is((select coalesce(start_lat::text, 'none') || '|' || start_name from public.tasks where id = '30000000-0000-0000-0000-0000000000c5'),
  'none|Google place (details removed after 30 days)', 'the start too');
select is((select lat from public.task_stops where id = '50000000-0000-0000-0000-0000000000c1'), 7.2931::double precision, 'the fresh one is kept');
select is((select count(*) from public.google_pins), 1::bigint, 'the old pin is gone, the fresh one kept');
select is((select count(*) from public.route_matched where employee_id = '10000000-0000-0000-0000-0000000000c5'), 1::bigint, 'the old OSRM line stays (90 days)');

-- 7. Nobody but the server counts calls or reads the counter and the pins.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c5","role":"authenticated"}';
select throws_ok($$ select public.google_take('map_loads', 400, 9500) $$, '42501', null, 'a signed-in person cannot count a call');
select throws_ok($$ select * from public.google_calls $$, '42501', null, 'nor read the counter');
select throws_ok($$ select * from public.google_pins $$, '42501', null, 'nor read the Google pins');
select throws_ok($$ select public.prune_google_content() $$, '42501', null, 'nor run the clean-up');
reset role;

select * from finish();
rollback;
