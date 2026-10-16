-- Accept and decline (Phase 5, part 5), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'd.one@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000b5', 'd.two@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000a5', 'D-ONE', 'Driver One', 'd.one', 'driver', '{}', '00000000-0000-0000-0000-0000000000a5'),
  ('10000000-0000-0000-0000-0000000000b5', 'D-TWO', 'Driver Two', 'd.two', 'driver', '{}', '00000000-0000-0000-0000-0000000000b5');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000a5', 'WP ACC-0001');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, sent_at, created_by) values
  ('50000000-0000-0000-0000-0000000000a1', 'Accept me', '10000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', now() + interval '3 hours', now() - interval '2 minutes', 'Office Test'),
  ('50000000-0000-0000-0000-0000000000a2', 'Decline me', '10000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', now() + interval '5 hours', now(), 'Office Test'),
  ('50000000-0000-0000-0000-0000000000a3', 'Start me', '10000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', now() + interval '1 hour', now(), 'Office Test'),
  ('50000000-0000-0000-0000-0000000000a4', 'Other driver', '10000000-0000-0000-0000-0000000000b5', '20000000-0000-0000-0000-0000000000a5', now() + interval '2 hours', now(), 'Office Test'),
  ('50000000-0000-0000-0000-0000000000a5', 'Sent long ago', '10000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', now() + interval '4 hours', now() - interval '31 minutes', 'Office Test'),
  ('50000000-0000-0000-0000-0000000000a6', 'Leaving soon', '10000000-0000-0000-0000-0000000000b5', '20000000-0000-0000-0000-0000000000a5', now() + interval '50 minutes', now(), 'Office Test');
update public.tasks set leave_by = start_at, leave_by_source = 'manual' where id = '50000000-0000-0000-0000-0000000000a6';

select is((select count(*) from public.task_assignment_events where action = 'assigned'), 6::bigint, 'every new task is an assigned event');
select is((select actor from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a1'), 'Office Test', 'the event names who assigned it');

-- The driver's side.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select is(public.accept_task('50000000-0000-0000-0000-0000000000a1', now() - interval '5 minutes'), 'accepted', 'the driver accepts a task');
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a1'), now() - interval '5 minutes', 'accepted_at is the phone''s time');
select is(public.accept_task('50000000-0000-0000-0000-0000000000a1', now() - interval '10 minutes'), 'accepted', 'an offline replay with an earlier time is accepted too');
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a1'), now() - interval '10 minutes', 'the earliest acceptance wins');
select is(public.accept_task('50000000-0000-0000-0000-0000000000a1', now()), 'accepted', 'a later tap is fine');
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a1'), now() - interval '10 minutes', 'and keeps the earliest time');
select is(public.accept_task('50000000-0000-0000-0000-0000000000a1', now() + interval '1 hour'), 'accepted', 'a phone clock in the future is accepted');
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a1'), now() - interval '10 minutes', 'and never moves accepted_at after now');
select is((select count(*) from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a1' and action = 'accepted'), 1::bigint, 'one accepted event, however many taps');
select is((select actor from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a1' and action = 'accepted'), 'Driver One', 'the event names the driver');

select is(public.accept_task('50000000-0000-0000-0000-0000000000a4', now()), 'already_reassigned', 'another driver''s task answers already_reassigned');
select is(public.decline_task('50000000-0000-0000-0000-0000000000a4', 'other'), 'already_reassigned', 'and cannot be declined either');
select is(public.accept_task('50000000-0000-0000-0000-00000000ffff', now()), 'already_reassigned', 'an unknown task answers already_reassigned');
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a4'), null, 'the other driver''s task is untouched');

select throws_ok($$ select public.decline_task('50000000-0000-0000-0000-0000000000a2', 'tired') $$, '22023', null, 'an unknown reason is refused');
select is(public.decline_task('50000000-0000-0000-0000-0000000000a2', 'vehicle_problem', '  Flat tyre  '), 'declined', 'the driver declines a task');
select is((select status || '|' || declined_reason || '|' || declined_note || '|' || declined_after_accept::text || '|' || (declined_by = '10000000-0000-0000-0000-0000000000a5')::text
           from public.tasks where id = '50000000-0000-0000-0000-0000000000a2'),
  'declined|vehicle_problem|Flat tyre|false|true', 'declined: status, reason, trimmed note, not after accepting, by whom');
select is(public.decline_task('50000000-0000-0000-0000-0000000000a2', 'other'), 'already_declined', 'declining twice answers already_declined');
select is(public.accept_task('50000000-0000-0000-0000-0000000000a2', now()), 'already_declined', 'accepting a declined task answers already_declined');
select is((select note from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a2' and action = 'declined'), 'vehicle_problem: Flat tyre', 'the declined event carries the reason and note');

select is(public.decline_task('50000000-0000-0000-0000-0000000000a1', 'unwell'), 'declined', 'a task can be declined after accepting it');
select is((select declined_after_accept from public.tasks where id = '50000000-0000-0000-0000-0000000000a1'), true, 'declined_after_accept is recorded');

-- Starting a task counts as accepting it.
update public.tasks set status = 'in_progress', started_at = now() - interval '1 minute', start_odometer_km = 1000 where id = '50000000-0000-0000-0000-0000000000a3';
select is((select accepted_at from public.tasks where id = '50000000-0000-0000-0000-0000000000a3'), now() - interval '1 minute', 'starting a task sets accepted_at to the start time');
select is((select note from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a3' and action = 'accepted'), 'by starting the task', 'and writes an accepted event');
select is(public.decline_task('50000000-0000-0000-0000-0000000000a3', 'other'), 'already_started', 'a started task cannot be declined');
select is(public.accept_task('50000000-0000-0000-0000-0000000000a3', now()), 'already_started', 'nor accepted again');

select throws_like($$ update public.tasks set status = 'declined' where id = '50000000-0000-0000-0000-0000000000a5' $$,
  '%Drivers cannot change a task from assigned to declined%', 'a plain update to declined is refused: only decline_task');
select throws_like($$ update public.tasks set accepted_at = now() where id = '50000000-0000-0000-0000-0000000000a5' $$,
  '%permission denied%', 'the driver cannot write accepted_at by hand');
select is((select count(*) from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a4'), 0::bigint, 'another driver''s history is invisible');
select is((select count(*) from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000a1'), 3::bigint, 'the driver reads the history of their own task (assigned, accepted, declined)');

reset role;

select is((select count(*) from public.office_audit where tool = 'driver_task_declined'), 2::bigint, 'each decline is audited as driver_task_declined');

-- The office gives a declined task to another driver (reassign_task clears the decline).
select lives_ok($$
  update public.tasks set status = 'assigned', employee_id = '10000000-0000-0000-0000-0000000000b5', accepted_at = null,
    declined_at = null, declined_by = null, declined_reason = null, declined_note = null, declined_after_accept = false, sent_at = now(), seen_at = null
  where id = '50000000-0000-0000-0000-0000000000a2'
$$, 'a declined task goes back to assigned with a new driver');
select lives_ok($$ update public.tasks set status = 'cancelled', cancelled_reason = 'nobody free' where id = '50000000-0000-0000-0000-0000000000a1' $$,
  'a declined task can be cancelled');

-- The accept window (Phase 7): the reminder 5 minutes after sending; "needs a driver" 15 minutes after sending or
-- 30 minutes before leaving, whichever comes first.
select is(public.queue_accept_reminders(), 2, 'the task sent 31 minutes ago: its reminder and, past its window, needs a driver');
select is((select count(*) from public.tasks where accept_reminder_sent_at is not null), 1::bigint, 'one reminder (the others were sent just now)');
select is((select needs_driver_reason from public.tasks where id = '50000000-0000-0000-0000-0000000000a5'), 'not_accepted', 'it needs a driver: not accepted');
select ok((select needs_driver_since is null from public.tasks where id = '50000000-0000-0000-0000-0000000000a6'),
  'the one leaving in 50 minutes is still inside its window (30 minutes before)');
select ok((select accept_reminder_sent_at is null from public.tasks where id = '50000000-0000-0000-0000-0000000000a2'), 'the task just reassigned (sent now) is not reminded yet');
select is(public.queue_accept_reminders(), 0, 'the next minute sends nothing again');
update public.tasks set leave_by = now() + interval '25 minutes' where id = '50000000-0000-0000-0000-0000000000a6';
select is(public.queue_accept_reminders(), 1, '25 minutes before leaving: it needs a driver too');
select lives_ok($$ update public.tasks set accepted_at = now() where id = '50000000-0000-0000-0000-0000000000a6' $$, 'the driver accepts late …');
select ok((select needs_driver_since is null and needs_driver_reason is null from public.tasks where id = '50000000-0000-0000-0000-0000000000a6'),
  '… and it no longer needs a driver');
select is((select command from cron.job where jobname = 'task-reminders'), 'select public.queue_task_reminders(), public.queue_accept_reminders()', 'the minute job runs both reminder functions');

-- Service role only for the rest.
set local role anon;
select throws_ok($$ select public.accept_task('50000000-0000-0000-0000-0000000000a5', now()) $$, '42501', null, 'anon cannot call accept_task');
reset role;

select * from finish();
rollback;
