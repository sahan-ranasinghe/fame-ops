-- Round 48 snap hotfix (28 October 2026), checked with pgTAP: google_take counts each call by source beside the feature
-- (the 3-argument form still counts without one); roads_trip_take is a driver's own Roads budget for the day, refused at
-- the cap, taken before the fleet counter; both tables are the service role's alone.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-000000000c49', 'R48S', 'Thilina Teshan', 'r48.thilina', 'driver', '{}', true);

-- 1. The source beside the feature.
select is((public.google_take('roads', 5, 100, 'site_live'))->>'allowed', 'true', 'a call with a source is allowed under the cap');
select is((public.google_take('roads', 5, 100, 'site_live'))->>'allowed', 'true', 'and another');
select is((public.google_take('roads', 5, 100, 'app_route'))->>'allowed', 'true', 'and one from another screen');
select is((public.google_take('roads', 5, 100))->>'allowed', 'true', 'the 3-argument form still counts (no source)');
select is((select calls from public.google_calls where feature = 'roads' and day = (now() at time zone 'Asia/Colombo')::date), 4,
  'the feature counter has all four');
select is((select calls from public.google_call_sources where feature = 'roads' and source = 'site_live'
            and day = (now() at time zone 'Asia/Colombo')::date), 2, 'site_live counted 2');
select is((select calls from public.google_call_sources where feature = 'roads' and source = 'app_route'
            and day = (now() at time zone 'Asia/Colombo')::date), 1, 'app_route counted 1');
select is((select count(*)::int from public.google_call_sources where feature = 'roads' and day = (now() at time zone 'Asia/Colombo')::date), 2,
  'the call without a source adds no source row');
select is((public.google_take('roads', 5, 100, 'site_live'))->>'allowed', 'true', 'the fifth call is the last under a day cap of 5');
select is((public.google_take('roads', 5, 100, 'site_live'))->>'allowed', 'false', 'the sixth is refused');
select is((select refused from public.google_call_sources where feature = 'roads' and source = 'site_live'
            and day = (now() at time zone 'Asia/Colombo')::date), 1, 'and the refusal is counted on its source');
select is((public.google_take('roads', 5, 100, 'Weird Source!'))->>'allowed', 'false', 'an odd source word is cleaned, never refused for it');
select is((select count(*)::int from public.google_call_sources where source = 'weirdsource'), 1, 'cleaned to letters and underscores');

-- 2. The driver's own budget.
select is((public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 2))->>'allowed', 'true', 'the first call of the day is allowed');
select is((public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 2))->>'used', '2', 'the second too (used 2 of 2)');
select is((public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 2))->>'allowed', 'false', 'the third is refused at the cap');
select is((public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 2))->>'reason', 'trip', 'with the reason trip');
select is((select refused from public.roads_day_calls where employee_id = '10000000-0000-0000-0000-000000000c49'
            and day = (now() at time zone 'Asia/Colombo')::date), 2, 'the refusals are counted');
select is((public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 0))->>'allowed', 'false', 'a cap of 0 refuses every call');
select throws_ok($$ select public.roads_trip_take(null, 2) $$, 'P0001', 'roads_trip_take: no driver', 'no driver, no count');

-- 3. The service role's alone.
set role authenticated;
select throws_ok($$ select * from public.google_call_sources $$, '42501', null, 'a signed-in user cannot read the sources');
select throws_ok($$ select * from public.roads_day_calls $$, '42501', null, 'nor the drivers'' budgets');
select throws_ok($$ select public.roads_trip_take('10000000-0000-0000-0000-000000000c49', 2) $$, '42501', null, 'nor take a budget call');
reset role;

select * from finish();
rollback;
