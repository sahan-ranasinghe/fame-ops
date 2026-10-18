-- Office notifications (Phase 5, part 3b), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd.notify@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000d2', 'approver.notify@fame.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'nodevice.notify@fame.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'off.notify@fame.test'),
  ('00000000-0000-0000-0000-0000000000d5', 'gone.notify@fame.test'),
  ('00000000-0000-0000-0000-0000000000d6', 'viewer.notify@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000d1', 'D-NOT', 'Notify Driver', 'd.notify', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000000d1'),
  ('10000000-0000-0000-0000-0000000000d2', 'A-NOT', 'Notify Approver', null, 'approver.notify@fame.test', 'fleet_admin', '{view,approve}', true, '00000000-0000-0000-0000-0000000000d2'),
  ('10000000-0000-0000-0000-0000000000d3', 'N-NOT', 'Notify No Device', null, 'nodevice.notify@fame.test', 'office', '{view,assign_tasks}', true, '00000000-0000-0000-0000-0000000000d3'),
  ('10000000-0000-0000-0000-0000000000d4', 'O-NOT', 'Notify Switched Off', null, 'off.notify@fame.test', 'office', '{view,assign_tasks}', false, '00000000-0000-0000-0000-0000000000d4'),
  ('10000000-0000-0000-0000-0000000000d5', 'G-NOT', 'Notify Gone Device', null, 'gone.notify@fame.test', 'office', '{view,assign_tasks}', true, '00000000-0000-0000-0000-0000000000d5'),
  ('10000000-0000-0000-0000-0000000000d6', 'V-NOT', 'Notify Viewer', null, 'viewer.notify@fame.test', 'viewer', '{view}', true, '00000000-0000-0000-0000-0000000000d6');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000d1', 'WP NOT-0001');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, sent_at, created_by) values
  ('50000000-0000-0000-0000-0000000000d1', 'Team drop · Galle', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1',
   now() + interval '3 hours', now() + interval '3 hours', now() - interval '2 hours', 'test');
-- Devices: the approver has one, the "gone" person's only device was removed, the no-device person none.
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-0000000000d2', 'https://push.example/one', 'p', 'a'),
  ('10000000-0000-0000-0000-0000000000d4', 'https://push.example/off', 'p', 'a');
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth, removed_at, removed_reason) values
  ('10000000-0000-0000-0000-0000000000d5', 'https://push.example/gone', 'p', 'a', now(), 'gone');

-- The tables and the job.
select has_table('public', 'web_push_subscriptions', 'web_push_subscriptions exists');
select has_table('public', 'notification_settings', 'notification_settings exists');
select has_table('public', 'notifications', 'notifications exists');
select has_table('public', 'job_runs', 'job_runs exists');
select is((select schedule || ' ' || command from cron.job where jobname = 'notify-retry'), '*/5 * * * * select public.notify_retry()', 'notify-retry runs every 5 minutes');
select throws_ok($$ insert into public.notifications (event, payload, recipient_employee_id, status) values ('x', '{}', '10000000-0000-0000-0000-0000000000d2', 'lost') $$,
  '23514', null, 'a notification is queued, sent, failed or dead');
select throws_ok($$ insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth, removed_reason) values ('10000000-0000-0000-0000-0000000000d2', 'https://push.example/two', 'p', 'a', 'lost') $$,
  '23514', null, 'a device is removed by the user or because it is gone');

-- Nobody but the server reads or writes them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_like($$ select * from public.notifications $$, '%permission denied%', 'a driver cannot read the outbox');
select throws_like($$ select * from public.web_push_subscriptions $$, '%permission denied%', 'nor the devices');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_like($$ select * from public.notifications $$, '%permission denied%', 'an office person cannot read the outbox directly (the tools answer their own rows)');
select throws_like($$ select * from public.notification_settings $$, '%permission denied%', 'nor the settings table');
select throws_like($$ select * from public.job_runs $$, '%permission denied%', 'nor the job runs');
select throws_ok($$ select public.queue_notification('x', '{}'::jsonb, '{}'::uuid[]) $$, '42501', null, 'a signed-in person cannot queue a notification');
reset role;
set local role anon;
select throws_ok($$ select public.queue_notification('x', '{}'::jsonb, '{}'::uuid[]) $$, '42501', null, 'anon cannot queue a notification');
select throws_ok($$ select public.notify_retry() $$, '42501', null, 'anon cannot call notify_retry');
reset role;

-- The outbox writer: who gets a row.
insert into public.notification_settings (employee_id, event, enabled) values ('10000000-0000-0000-0000-0000000000d2', 'request.created', false);
select is(
  public.queue_notification('request.decided', '{"title":"Request approved","body":"WP NOT-0001","url":"/requests"}'::jsonb,
    array['10000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d3',
          '10000000-0000-0000-0000-0000000000d4', '10000000-0000-0000-0000-0000000000d5', '10000000-0000-0000-0000-0000000000d1']::uuid[]),
  1, 'one row: the approver with a device; not twice for the same person, not the person with no device, not the switched-off one, not the one whose device is gone, not the driver');
select is((select count(*) from public.notifications where event = 'request.decided' and recipient_employee_id = '10000000-0000-0000-0000-0000000000d2' and status = 'queued' and attempts = 0),
  1::bigint, 'the row is queued with no attempts');
select is(public.queue_notification('request.created', '{"title":"x"}'::jsonb, array['10000000-0000-0000-0000-0000000000d2']::uuid[]),
  0, 'an event the person switched off writes no row');
select is(public.queue_notification('request.created', '{"title":"x"}'::jsonb, null), 0, 'no recipients, no rows');
select is(public.queue_notification('request.created', '{"title":"x"}'::jsonb, '{}'::uuid[]), 0, 'an empty list, no rows');

-- Delivery: the insert asks notify-office (through pg_net, with the Vault secrets); the retry job only when something is due.
select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');
select is((select count(*) from net.http_request_queue where url like '%/notify-office'), 0::bigint, 'nothing asked of notify-office yet');
select public.queue_notification('issue.assigned', '{"title":"Issue for you","body":"Engine stalls","url":"/issues/1"}'::jsonb, array['10000000-0000-0000-0000-0000000000d2']::uuid[]);
select is(
  (select count(*) from net.http_request_queue q, public.notifications n
   where q.url like '%/notify-office' and convert_from(q.body, 'utf8')::jsonb = jsonb_build_object('id', n.id) and n.event = 'issue.assigned'),
  1::bigint, 'a new outbox row asks notify-office to deliver that row');
select is((select headers ->> 'x-server-key' from net.http_request_queue where url like '%/notify-office' limit 1), 'local-test-server-key-0123456789', 'with the server key');
select public.notify_retry();
select is((select count(*) from net.http_request_queue where url like '%/notify-office' and convert_from(body, 'utf8')::jsonb = '{"retry":true}'::jsonb),
  1::bigint, 'the retry job finds the queued rows that were never picked up and asks for a retry');
update public.notifications set status = 'sent', sent_at = now(), attempts = 1;
select public.notify_retry();
select is((select count(*) from net.http_request_queue where url like '%/notify-office' and convert_from(body, 'utf8')::jsonb = '{"retry":true}'::jsonb),
  1::bigint, 'nothing due: no retry asked');
update public.notifications set status = 'failed', next_try_at = now() + interval '5 minutes', attempts = 1 where event = 'issue.assigned';
select public.notify_retry();
select is((select count(*) from net.http_request_queue where url like '%/notify-office' and convert_from(body, 'utf8')::jsonb = '{"retry":true}'::jsonb),
  1::bigint, 'a failed row whose time has not come: no retry yet');
update public.notifications set next_try_at = now() - interval '1 minute' where event = 'issue.assigned';
select public.notify_retry();
select is((select count(*) from net.http_request_queue where url like '%/notify-office' and convert_from(body, 'utf8')::jsonb = '{"retry":true}'::jsonb),
  2::bigint, 'a failed row whose time has come: one retry asked');
update public.notifications set attempts = 5 where event = 'issue.assigned';
select public.notify_retry();
select is((select count(*) from net.http_request_queue where url like '%/notify-office' and convert_from(body, 'utf8')::jsonb = '{"retry":true}'::jsonb),
  2::bigint, 'after five attempts a row is left alone');

-- task.declined: the driver's decline tells everyone who approves or assigns (with a device).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is(public.decline_task('50000000-0000-0000-0000-0000000000d1', 'vehicle_problem', 'Flat tyre'), 'declined', 'the driver declines the task');
reset role;
select is((select count(*) from public.notifications where event = 'task.declined'), 1::bigint, 'one task.declined row: the approver (the dispatcher has no device, one is switched off, one device is gone)');
select is(
  (select payload ->> 'title' || ' | ' || (payload ->> 'body') || ' | ' || (payload ->> 'url') from public.notifications where event = 'task.declined'),
  'Notify declined ''Team drop · Galle'' ' || to_char((now() + interval '3 hours') at time zone 'Asia/Colombo', 'HH24:MI')
    || ' | Vehicle problem: Flat tyre · needs a driver | /',
  'Phase 7: "Kamal declined ''<task>'' 09:00" / the reason · needs a driver; an approver without assign_tasks opens the Overview''s block');
select is((select payload ->> 'tag' from public.notifications where event = 'task.declined'), 'needs-driver:50000000-0000-0000-0000-0000000000d1', 'tagged by task');

-- task.not_accepted: the accept reminder (sent 2 hours after the task) tells the office too.
update public.tasks set status = 'assigned', declined_at = null, declined_by = null, declined_reason = null, declined_note = null where id = '50000000-0000-0000-0000-0000000000d1';
-- Hotfix 2 (E): the accept window runs only while the driver is at work: the drivers with tasks here started work 3 hours ago.
insert into public.duty_sessions (employee_id, started_at)
select distinct t.employee_id, now() - interval '3 hours' from public.tasks t join public.employees e on e.id = t.employee_id
where t.status = 'assigned' and e.role = 'driver'
  and not exists (select 1 from public.duty_sessions d where d.employee_id = t.employee_id and d.ended_at is null);
select is(public.queue_accept_reminders(), 2, 'the accept reminder goes out and the window has passed (sent two hours ago, not accepted)');
select is((select count(*) from public.notifications where event = 'task.not_accepted'), 1::bigint, 'and one task.not_accepted row for the approver');
select is((select payload ->> 'title' || ' | ' || (payload ->> 'body') from public.notifications where event = 'task.not_accepted'),
  'Notify hasn''t accepted ''Team drop · Galle'' ' || to_char((now() + interval '3 hours') at time zone 'Asia/Colombo', 'HH24:MI') || ' | needs a driver',
  'with the driver, the title and the leave-by time');
select is(public.queue_accept_reminders(), 0, 'a reminder is sent once');

-- colombo_when: the time alone today, the day with it otherwise.
select is(public.colombo_when(now()), to_char(now() at time zone 'Asia/Colombo', 'HH24:MI'), 'colombo_when today = HH:MM');
select is(public.colombo_when(now() + interval '3 days'), to_char((now() + interval '3 days') at time zone 'Asia/Colombo', 'Dy FMDD Mon HH24:MI'), 'colombo_when on another day = Day D Mon HH:MM');

select * from finish();
rollback;
