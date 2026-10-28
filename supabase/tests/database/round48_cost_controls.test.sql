-- Round 48, item 6 (cost controls), checked with pgTAP: the Gemini odometer gate (odometer_take: counted before the
-- call, refused at the day's cap, one counter per driver and one for the server's job, Colombo days) and who may
-- call it.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- 1. A driver's reads with a cap of 60: 60 are allowed, the 61st is refused and only counted as refused.
select is(
  (select count(*) from generate_series(1, 61) g where (public.odometer_take('driver', 'driver-a', 60) ->> 'allowed')::boolean),
  60::bigint, 'of 61 reads in a day with a cap of 60, 60 are allowed');
select is((select calls || '|' || refused from public.odometer_calls where mode = 'driver' and scope = 'driver-a'), '60|1',
  'the counter holds 60 calls and 1 refused');
select is(public.odometer_take('driver', 'driver-a', 60), '{"allowed": false, "reason": "day", "day": 60, "day_cap": 60}'::jsonb,
  'the next one is refused too: the day''s cap');
select is((select day from public.odometer_calls where mode = 'driver' and scope = 'driver-a'), (now() at time zone 'Asia/Colombo')::date,
  'reads are counted on the Colombo day');

-- 2. Each driver counts on their own; the server's job has its own counter and cap.
select is(public.odometer_take('driver', 'driver-b', 60), '{"allowed": true, "day": 1, "day_cap": 60}'::jsonb, 'another driver starts at 1');
select is(public.odometer_take('server', 'server', 500) ->> 'day', '1', 'the server''s reads start at 1');
select is(public.odometer_take('server', 'server', 0) ->> 'allowed', 'false', 'a cap of 0 refuses');
select is((select count(*) from public.odometer_calls), 3::bigint, 'three counters: two drivers and the server');

-- 3. An unknown mode or an empty scope is an error (the caller refuses the call).
select throws_ok($$ select public.odometer_take('phone', 'x', 10) $$, 'P0001', 'odometer_take: unknown mode phone', 'an unknown mode is an error');
select throws_ok($$ select public.odometer_take('driver', '', 10) $$, 'P0001', 'odometer_take: a scope is needed', 'an empty scope is an error');

-- 4. Nobody but the server counts reads or sees the counter.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000c48', 'd.c48@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-000000000c48', 'D-C48', 'Round 48 Driver', 'd.c48', 'driver', '{}', '00000000-0000-0000-0000-000000000c48');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000c48","role":"authenticated"}';
select throws_ok($$ select public.odometer_take('driver', '10000000-0000-0000-0000-000000000c48', 60) $$, '42501', null, 'a signed-in driver cannot count a read');
select throws_ok($$ select * from public.odometer_calls $$, '42501', null, 'nor read the counter');
reset role;

select * from finish();
rollback;
