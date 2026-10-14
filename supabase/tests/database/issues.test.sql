-- The issues centre (Phase 5, part 3a), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'd.issue@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'viewer.issue@fame.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'requester.issue@fame.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'dispatcher.issue@fame.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'issues.issue@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000c1', 'D-ISS', 'Issue Driver', 'd.issue', null, 'driver', '{}', '00000000-0000-0000-0000-0000000000c1'),
  ('10000000-0000-0000-0000-0000000000c2', 'V-ISS', 'Issue Viewer', null, 'viewer.issue@fame.test', 'viewer', '{view}', '00000000-0000-0000-0000-0000000000c2'),
  ('10000000-0000-0000-0000-0000000000c3', 'R-ISS', 'Issue Requester', null, 'requester.issue@fame.test', 'staff', '{request}', '00000000-0000-0000-0000-0000000000c3'),
  ('10000000-0000-0000-0000-0000000000c4', 'A-ISS', 'Issue Dispatcher', null, 'dispatcher.issue@fame.test', 'office', '{view,assign_tasks}', '00000000-0000-0000-0000-0000000000c4'),
  ('10000000-0000-0000-0000-0000000000c5', 'I-ISS', 'Issue Holder', null, 'issues.issue@fame.test', 'fleet_admin', '{issues}', '00000000-0000-0000-0000-0000000000c5');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000c1', 'WP ISS-0001');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by) values
  ('50000000-0000-0000-0000-0000000000c1', 'Issue task', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', now() + interval '2 hours', 'test');

-- The tables, the key rule, the publication, the minute job.
select has_table('public', 'issues', 'issues exists');
select has_table('public', 'issue_events', 'issue_events exists');
insert into public.issues (kind, severity, title, ref_key, vehicle_id) values ('document', 'warning', 'Revenue licence expires', 'doc:20000000-0000-0000-0000-0000000000c1:lic', '20000000-0000-0000-0000-0000000000c1');
select throws_ok($$
  insert into public.issues (kind, severity, title, ref_key) values ('document', 'critical', 'Revenue licence expires', 'doc:20000000-0000-0000-0000-0000000000c1:lic')
$$, '23505', null, 'a key cannot open twice while it is open');
update public.issues set status = 'resolved', resolved_at = now(), resolved_by = 'system' where ref_key = 'doc:20000000-0000-0000-0000-0000000000c1:lic';
select lives_ok($$
  insert into public.issues (kind, severity, title, ref_key) values ('document', 'critical', 'Revenue licence expires', 'doc:20000000-0000-0000-0000-0000000000c1:lic')
$$, 'a resolved key may open again as a new row');
select throws_ok($$ insert into public.issues (kind, severity, title, ref_key) values ('x', 'loud', 'x', 'x:1') $$, '23514', null, 'severity is info, warning or critical');
select throws_ok($$ insert into public.issue_events (issue_id, action) select id, 'poked' from public.issues limit 1 $$, '23514', null, 'an event action is one of five');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'issues'), 'issues is in the Realtime publication');
select is((select schedule || ' ' || command from cron.job where jobname = 'fleet-sync'), '*/5 * * * * select public.fleet_sync()', 'fleet-sync runs every 5 minutes');

-- Who reads what (Part 3b): the issues permission reads everything, assign_tasks the task
-- kinds only, nobody else anything; the events follow their issue. The view permission
-- alone reads nothing: the Issues page is hidden for them, and so is the table.
insert into public.issues (id, kind, severity, title, ref_key, task_id, employee_id) values
  ('80000000-0000-0000-0000-0000000000c1', 'declined', 'warning', 'Declined: Issue task', 'declined:50000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1');
insert into public.issue_events (issue_id, action, actor, to_status)
  select id, 'opened', 'system', 'open' from public.issues where status = 'open';
select is((select count(*) from public.issues where status = 'open'), 2::bigint, 'two open issues: a document and a declined task');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*) from public.issues), 0::bigint, 'a driver reads no issues');
select is((select count(*) from public.issue_events), 0::bigint, 'a driver reads no issue events');
select throws_like($$ insert into public.issues (kind, severity, title, ref_key) values ('x', 'info', 'x', 'x:2') $$, '%permission denied%', 'a driver cannot write an issue');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is((select count(*) from public.issues), 0::bigint, 'the view permission alone reads no issues');
select is((select count(*) from public.issue_events), 0::bigint, 'nor their events');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select is((select count(*) from public.issues), 0::bigint, 'a requester-only person reads no issues (a direct query or the Realtime channel gets no rows)');
select is((select count(*) from public.issue_events), 0::bigint, 'nor their events');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}';
select is((select string_agg(kind, ',' order by kind) from public.issues), 'declined', 'assign_tasks reads the task kinds only');
select is((select count(*) from public.issue_events), 1::bigint, 'and the events of those issues only');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c5","role":"authenticated"}';
select is((select count(*) from public.issues), 3::bigint, 'the issues permission reads every issue (open and resolved)');
select is((select count(*) from public.issue_events), 2::bigint, 'and every event');
select throws_like($$ update public.issues set status = 'dismissed' $$, '%permission denied%', 'but changes them only through the tools');
reset role;

-- The triggers ask fleet-jobs to sync (through pg_net, with the Vault secrets).
select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');
create temporary table sync_calls as
  select convert_from(body, 'utf8')::jsonb as body, headers from net.http_request_queue where url like '%/fleet-jobs';
select is((select count(*) from sync_calls), 0::bigint, 'nothing queued yet');

insert into public.vehicle_reports (id, vehicle_id, employee_id, category, note)
  values ('60000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'breakdown', 'Engine stalls');
select is(
  (select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb = '{"job":"sync","report_id":"60000000-0000-0000-0000-0000000000c1"}'::jsonb),
  1::bigint, 'a new vehicle report asks for a sync of that report');
select is((select headers ->> 'x-server-key' from net.http_request_queue where url like '%/fleet-jobs' limit 1), 'local-test-server-key-0123456789', 'with the server key');
update public.vehicle_reports set office_note = 'noted' where id = '60000000-0000-0000-0000-0000000000c1';
select is((select count(*) from net.http_request_queue where url like '%/fleet-jobs'), 1::bigint, 'a note on the report asks for nothing');
update public.vehicle_reports set status = 'in_garage' where id = '60000000-0000-0000-0000-0000000000c1';
select is((select count(*) from net.http_request_queue where url like '%/fleet-jobs'), 2::bigint, 'a status change on the report asks for a sync');

update public.tasks set seen_at = now() where id = '50000000-0000-0000-0000-0000000000c1';
select is((select count(*) from net.http_request_queue where url like '%/fleet-jobs'), 2::bigint, 'seen_at asks for nothing');
update public.tasks set accepted_at = now() where id = '50000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb ->> 'task_id' = '50000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'accepting a task asks for a sync of that task');
update public.tasks set status = 'cancelled', cancelled_reason = 'test' where id = '50000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb ->> 'task_id' = '50000000-0000-0000-0000-0000000000c1'),
  2::bigint, 'cancelling a task asks for a sync of that task');

insert into public.vehicle_requests (id, requested_by_name, needed_at, route_to) values ('70000000-0000-0000-0000-0000000000c1', 'Someone', now() + interval '1 day', 'Galle');
select is(
  (select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb ->> 'request_id' = '70000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'a new request asks for a sync of that request');
update public.vehicle_requests set status = 'declined', decline_reason = 'no', decided_at = now() where id = '70000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb ->> 'request_id' = '70000000-0000-0000-0000-0000000000c1'),
  2::bigint, 'a decision asks for a sync of that request');
select is((select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb ->> 'job' = 'sync'), 6::bigint, 'every call is a sync job');

select lives_ok($$ select public.fleet_sync() $$, 'the minute job call works with no scope');
select is((select count(*) from net.http_request_queue where url like '%/fleet-jobs' and convert_from(body, 'utf8')::jsonb = '{"job":"sync"}'::jsonb), 1::bigint, 'and sends just the job');

set local role anon;
select throws_ok($$ select public.fleet_sync() $$, '42501', null, 'anon cannot call fleet_sync');
select throws_ok($$ select public.call_edge_function('x', '{}'::jsonb) $$, '42501', null, 'anon cannot call call_edge_function');
reset role;

select * from finish();
rollback;
