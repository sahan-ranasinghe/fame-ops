-- Round 53 (a), checked with pgTAP: the push functions (service_role) remove the phone tokens Expo reported dead through
-- remove_dead_device_tokens, and only those; nobody else may call it; service_role still deletes nothing itself.
-- Run with: npx supabase test db   (local database only; everything is rolled back)
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000053a1', 'r53.driver@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000053a1', 'R53A', 'Dead Token Driver', 'r53.driver', 'driver', '{}', true, '00000000-0000-0000-0000-0000000053a1');
insert into public.device_tokens (id, employee_id, token, platform) values
  ('53000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000053a1', 'ExponentPushToken[r53-old-phone]', 'android'),
  ('53000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000053a1', 'ExponentPushToken[r53-new-phone]', 'android');

set local role service_role;

select throws_ok($$ delete from public.device_tokens where id = '53000000-0000-0000-0000-000000000001' $$, '42501', null,
  'service_role still deletes nothing itself (the bug: the functions'' own delete failed)');
select is(public.remove_dead_device_tokens(array['53000000-0000-0000-0000-000000000001']::uuid[]), 1,
  'the push functions remove the dead token: 1 removed');
select is(public.remove_dead_device_tokens(array['53000000-0000-0000-0000-000000000001']::uuid[]), 0,
  'asked again (two pushes at once): nothing more, no error');
select is(public.remove_dead_device_tokens('{}'::uuid[]), 0, 'nothing named: nothing removed');
select throws_ok($$ select public.remove_dead_device_tokens(array_fill('53000000-0000-0000-0000-000000000009'::uuid, array[101])) $$,
  '22023', 'too_many_tokens', 'at most 100 at a time (one Expo answer is at most 100 tickets)');

reset role;

select is((select array_agg(token) from public.device_tokens where employee_id = '10000000-0000-0000-0000-0000000053a1'),
  array['ExponentPushToken[r53-new-phone]'], 'the driver''s live phone keeps its token');
select ok((select prosecdef from pg_proc where oid = 'public.remove_dead_device_tokens(uuid[])'::regprocedure), 'it runs as its owner');
select ok(not has_function_privilege('authenticated', 'public.remove_dead_device_tokens(uuid[])', 'execute'),
  'a signed-in person (a driver, the office) cannot call it');
select ok(not has_function_privilege('anon', 'public.remove_dead_device_tokens(uuid[])', 'execute'), 'anon cannot call it');

select * from finish();
rollback;
