-- Phase 7, Hotfix 3, checked with pgTAP (docs/phase7-plan.md "Hotfix 3"): a task never started whose leave-by passed over
-- a day ago is marked missed (assigned or declined; no push), a driver's late start un-misses it, a driver cannot mark one
-- missed; the missed-task issue is the dispatcher's too; snooze; the page preferences are the service role's.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000ce1', 'hf3.nimal@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000ce1', 'HF3N', 'Nimal Perera', 'hf3.nimal', 'driver', '{}', true, '00000000-0000-0000-0000-000000000ce1');
insert into public.vehicles (id, reg_no, vehicle_type, current_odometer_km, active) values
  ('20000000-0000-0000-0000-000000000ce1', 'WP HF3-0001', 'van', 1000, true);

insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, sent_at, created_by) values
  ('30000000-0000-0000-0000-000000000ce1', 'HF3 two days ago', '10000000-0000-0000-0000-000000000ce1', '20000000-0000-0000-0000-000000000ce1',
   now() - interval '2 days', now() - interval '2 days', 'assigned', now() - interval '3 days', 'test'),
  ('30000000-0000-0000-0000-000000000ce2', 'HF3 declined long ago', '10000000-0000-0000-0000-000000000ce1', '20000000-0000-0000-0000-000000000ce1',
   now() - interval '3 days', now() - interval '3 days', 'declined', now() - interval '4 days', 'test'),
  ('30000000-0000-0000-0000-000000000ce3', 'HF3 two hours ago', '10000000-0000-0000-0000-000000000ce1', '20000000-0000-0000-0000-000000000ce1',
   now() - interval '2 hours', now() - interval '2 hours', 'assigned', now() - interval '1 day', 'test'),
  ('30000000-0000-0000-0000-000000000ce4', 'HF3 tomorrow', '10000000-0000-0000-0000-000000000ce1', '20000000-0000-0000-0000-000000000ce1',
   now() + interval '1 day', now() + interval '1 day', 'assigned', now(), 'test');
update public.tasks set needs_driver_since = now(), needs_driver_reason = 'declined' where id = '30000000-0000-0000-0000-000000000ce2';
-- The pushes of the inserts above are not this test's business.
delete from net.http_request_queue;

-- 1. Missed ------------------------------------------------------------------------------------------------------------------
select is((select count(*) from public.mark_missed_tasks() as id
           where id in ('30000000-0000-0000-0000-000000000ce1', '30000000-0000-0000-0000-000000000ce2')), 2::bigint,
  'an assigned and a declined task, their leave-by over a day ago, are marked missed');
select is((select string_agg(title || ':' || status, ', ' order by title) from public.tasks where id::text like '30000000-0000-0000-0000-000000000ce%'),
  'HF3 declined long ago:missed, HF3 tomorrow:assigned, HF3 two days ago:missed, HF3 two hours ago:assigned',
  'a task two hours late or tomorrow stays as it is');
select ok((select missed_at is not null and needs_driver_since is null and needs_driver_reason is null from public.tasks
           where id = '30000000-0000-0000-0000-000000000ce2'),
  'a missed task leaves needs-a-driver');
select is((select count(*) from net.http_request_queue where url like '%/push-task'), 0::bigint, 'and nobody is pushed');
select is((select count(*) from public.mark_missed_tasks()), 0::bigint, 'the next run finds nothing more');

-- 2. The driver: cannot mark one missed; a late start (queued offline) un-misses it -----------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ce1","role":"authenticated"}';
select throws_like($$ update public.tasks set status = 'missed' where id = '30000000-0000-0000-0000-000000000ce3' $$,
  '%Drivers cannot change a task from assigned to missed%', 'a driver cannot mark a task missed');
select lives_ok($$ update public.tasks set status = 'in_progress', start_odometer_km = 1000, started_at = now() - interval '47 hours'
                   where id = '30000000-0000-0000-0000-000000000ce1' $$,
  'a start the phone sends late is taken');
-- The driver's other calls on a missed task: accept and decline answer "cancelled" and change nothing; a vehicle
-- confirmed offline still counts.
select is(public.accept_task('30000000-0000-0000-0000-000000000ce2', now()), 'cancelled', 'accepting a missed task: cancelled (the app drops it)');
select is(public.decline_task('30000000-0000-0000-0000-000000000ce2', 'other', null), 'cancelled', 'declining it: the same, nothing changes');
select is(public.confirm_task_vehicle('30000000-0000-0000-0000-000000000ce2', '20000000-0000-0000-0000-000000000ce1', true), 'ok',
  'a vehicle confirmed offline for a missed task still counts');
reset role;
set local request.jwt.claims to '{}';
select is((select status || '|' || coalesce(missed_at::text, '-') from public.tasks where id = '30000000-0000-0000-0000-000000000ce1'),
  'in_progress|-', 'the task is under way again, no longer missed');
select is((select status || '|' || coalesce(needs_driver_reason, '-') from public.tasks where id = '30000000-0000-0000-0000-000000000ce2'),
  'missed|-', 'the declined call left the missed task as it was (no needs-a-driver for an old task)');

-- 3. Who sees a missed-task issue; snooze; the preferences --------------------------------------------------------------------
select ok(position('missed_task' in pg_get_functiondef('public.issue_visible(text)'::regprocedure)) > 0,
  'the missed-task issue is among the task kinds a dispatcher sees');
select has_column('public', 'issues', 'snoozed_until', 'an issue can be snoozed');
select has_column('public', 'issues', 'snoozed_by', 'by someone');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ce1","role":"authenticated"}';
select throws_ok($$ select * from public.office_prefs $$, '42501', null, 'the page preferences are the service role''s');
select throws_ok($$ select public.mark_missed_tasks() $$, '42501', null, 'and marking tasks missed is the server''s');
reset role;

select * from finish();
rollback;
