-- Round 48 item 5 (28 October 2026, Sahan's decision): Google's road-snapped lines are display only and never stored.
-- route_matched refuses provider google_roads (the server keeps Google's answers 30 minutes in memory instead); an
-- OSRM leg is stored as before; the migration removed every Google row that was there.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-000000000048', 'D-R48', 'Round 48 Driver', 'd.r48', 'driver', '{}', '00000000-0000-0000-0000-000000000048');

-- 1. A Google-snapped leg is refused by the table itself, whatever path writes it (an insert, and the upsert's update).
select throws_ok($$
  insert into public.route_matched (employee_id, date, provider, leg_from, leg_to, geometry, matched_at, status)
  values ('10000000-0000-0000-0000-000000000048', current_date, 'google_roads', now() - interval '1 hour', now() - interval '50 minutes',
          '[[1761627600000, 6.9, 79.85]]', now(), 'ok') $$,
  '23514', null, 'a google_roads row is refused: Google''s road-snapped lines are never stored');

-- 2. An OSRM leg is stored as before, and cannot be turned into a Google one.
select lives_ok($$
  insert into public.route_matched (employee_id, date, provider, leg_from, leg_to, geometry, matched_at, status)
  values ('10000000-0000-0000-0000-000000000048', current_date, 'osrm', now() - interval '1 hour', now() - interval '50 minutes',
          '[[1761627600000, 6.9, 79.85]]', now(), 'ok') $$,
  'an OSRM leg (our own server''s answer) is stored as before');
select is((select count(*) from public.route_matched where employee_id = '10000000-0000-0000-0000-000000000048' and provider = 'osrm'), 1::bigint,
  'the OSRM leg is there');
select throws_ok($$ update public.route_matched set provider = 'google_roads' where employee_id = '10000000-0000-0000-0000-000000000048' $$,
  '23514', null, 'nor can a stored leg be relabelled as Google''s');

-- 3. Nothing of Google's is left in the table (the migration deleted the rows kept before Round 48).
select is((select count(*) from public.route_matched where provider = 'google_roads'), 0::bigint, 'no google_roads row exists');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'route_matched_provider_check' and conrelid = 'public.route_matched'::regclass) like '%osrm%'
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'route_matched_provider_check' and conrelid = 'public.route_matched'::regclass) not like '%google_roads%',
  'the provider check names osrm and not google_roads');

-- 4. The 30-day Google clean-up still runs and finds no snapped leg to remove; the OSRM leg stays.
select is(public.prune_google_content() ->> 'matched', '0', 'prune_google_content removes no snapped leg (there is none of Google''s)');
select is((select count(*) from public.route_matched where employee_id = '10000000-0000-0000-0000-000000000048'), 1::bigint, 'the OSRM leg stays');

-- 5. Nobody but the server writes or reads the table.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000048","role":"authenticated"}';
select throws_ok($$ select * from public.route_matched $$, '42501', null, 'a signed-in person cannot read the snapped legs');
select throws_ok($$ insert into public.route_matched (employee_id, date, provider, leg_from, leg_to) values ('10000000-0000-0000-0000-000000000048', current_date, 'osrm', now(), now()) $$,
  '42501', null, 'nor write one');
reset role;

select * from finish();
rollback;
