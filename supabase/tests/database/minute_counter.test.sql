-- The map search's minute counter as the Edge Functions call it (service_role), checked with pgTAP (30 October 2026: it
-- failed on its own "keep an hour" delete, so every uncached place search was paused). Run with: npx supabase test db.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- An hour-old minute, as an earlier search left it.
insert into public.api_minute_calls (provider, minute, calls) values ('t_counter', date_trunc('minute', now()) - interval '2 hours', 5);

set local role service_role;

select lives_ok($$ select public.bump_minute_calls('t_counter') $$, 'service_role may count a search (the function keeps its own last hour)');
select is(public.bump_minute_calls('t_counter'), 2, 'the second search this minute is number 2');
select throws_ok($$ delete from public.api_minute_calls $$, '42501', null, 'service_role still deletes nothing itself');

reset role;

select is((select count(*)::int from public.api_minute_calls where provider = 't_counter' and minute < now() - interval '1 hour'), 0,
  'the hour-old minute is gone');
select is((select calls from public.api_minute_calls where provider = 't_counter' and minute = date_trunc('minute', now())), 2,
  'this minute holds both searches');
select ok((select prosecdef from pg_proc where oid = 'public.bump_minute_calls(text)'::regprocedure), 'the counter runs as its owner');
select ok(not has_function_privilege('authenticated', 'public.bump_minute_calls(text)', 'execute'), 'a signed-in person cannot call it');

select * from finish();
rollback;
