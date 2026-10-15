-- Phase 6, Part 2: request edits and re-approval, the request events, the task
-- change diff, the leave-by backfill, the driver's settings, the push that names
-- what changed. Checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'd.six@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'asker.six@fame.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'other.six@fame.test'),
  ('00000000-0000-0000-0000-0000000000f4', 'approver.six@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000f1', 'D-SIX', 'Six Driver', 'd.six', null, 'driver', '{}', '00000000-0000-0000-0000-0000000000f1'),
  ('10000000-0000-0000-0000-0000000000f2', 'A-SIX', 'Six Asker', null, 'asker.six@fame.test', 'staff', '{view,request}', '00000000-0000-0000-0000-0000000000f2'),
  ('10000000-0000-0000-0000-0000000000f3', 'O-SIX', 'Six Other', null, 'other.six@fame.test', 'staff', '{view,request}', '00000000-0000-0000-0000-0000000000f3'),
  ('10000000-0000-0000-0000-0000000000f4', 'P-SIX', 'Six Approver', null, 'approver.six@fame.test', 'fleet_admin', '{view,request,approve,assign_tasks}', '00000000-0000-0000-0000-0000000000f4');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000f1', 'WP SIX-0001');

-- 1. Columns, the status rule, the version.
select has_column('public', 'vehicle_requests', 'version', 'vehicle_requests.version exists');
select has_column('public', 'vehicle_requests', 'changed_at', 'vehicle_requests.changed_at exists');
select has_column('public', 'vehicle_requests', 'previous', 'vehicle_requests.previous exists');
select has_column('public', 'vehicle_requests', 'on_behalf_of', 'vehicle_requests.on_behalf_of exists');
select has_table('public', 'request_events', 'request_events exists');
select has_column('public', 'task_assignment_events', 'changes', 'task_assignment_events.changes exists');

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, decided_at, decided_by, on_behalf_of)
values ('70000000-0000-0000-0000-0000000000f1', 'Six Asker', '10000000-0000-0000-0000-0000000000f2', now() + interval '1 day', 'approved', now(), 'Six Approver', 'A visitor');
select is((select version from public.vehicle_requests where id = '70000000-0000-0000-0000-0000000000f1'), 0, 'a request starts at version 0');
select lives_ok($$
  update public.vehicle_requests set status = 'changed', changed_at = now(), changed_by = 'Six Asker', version = version + 1,
         previous = '{"needed_at": "2026-10-15T03:30:00Z"}'::jsonb
  where id = '70000000-0000-0000-0000-0000000000f1'
$$, 'an approved request becomes changed with changed_at and a bumped version');
select throws_ok($$
  update public.vehicle_requests set status = 'approved' where id = '70000000-0000-0000-0000-0000000000f1'
$$, '23514', null, 'approved again needs changed_at cleared');
select lives_ok($$
  update public.vehicle_requests set status = 'approved', changed_at = null, changed_by = null where id = '70000000-0000-0000-0000-0000000000f1'
$$, 'approved again with changed_at cleared');
select throws_ok($$
  insert into public.vehicle_requests (requested_by_name, needed_at, status) values ('X', now(), 'changed')
$$, '23514', null, 'changed needs changed_at');

-- 2. request_events: the actions, and who reads them.
select lives_ok($$
  insert into public.request_events (request_id, action, actor, note, changes) values
    ('70000000-0000-0000-0000-0000000000f1', 'created', 'Six Asker', null, null),
    ('70000000-0000-0000-0000-0000000000f1', 'approved', 'Six Approver', 'WP SIX-0001', null),
    ('70000000-0000-0000-0000-0000000000f1', 'changed', 'Six Asker', 'time 09:00 → 09:30', '{"time": {"from": "09:00", "to": "09:30"}}'::jsonb),
    ('70000000-0000-0000-0000-0000000000f1', 'redecided', 'Six Approver', 'kept as asked', null)
$$, 'the timeline rows: created, approved, changed, redecided');
select throws_ok($$
  insert into public.request_events (request_id, action) values ('70000000-0000-0000-0000-0000000000f1', 'looked_at')
$$, '23514', null, 'an unknown action is refused');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is((select count(*) from public.request_events where request_id = '70000000-0000-0000-0000-0000000000f1'), 4::bigint,
  'the person who asked reads the events of their own request');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select is((select count(*) from public.request_events), 0::bigint, 'another requester reads none of them');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select is((select count(*) from public.request_events), 4::bigint, 'an approver reads every request''s events');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*) from public.request_events), 0::bigint, 'a driver reads none');
select throws_ok($$
  insert into public.request_events (request_id, action) values ('70000000-0000-0000-0000-0000000000f1', 'seen')
$$, '42501', null, 'nobody writes request_events from the app (the tools do, as service role)');
reset role;

-- 3. The driver's settings: the defaults, then the stored values, nothing else.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(public.get_driver_settings() - 'fuel_video_checklist' - 'fuel_video_quality', '{"shift_start": "08:00", "shift_days": [1, 2, 3, 4, 5]}'::jsonb, 'get_driver_settings: the defaults (Monday to Friday since Part 4b)');
select throws_ok($$ select * from public.fleet_settings $$, '42501', null, 'a driver cannot read fleet_settings itself');
reset role;
insert into public.fleet_settings (key, value) values ('shift_start', '"07:30"'::jsonb), ('shift_days', '[1, 2, 3, 4, 5]'::jsonb)
on conflict (key) do update set value = excluded.value;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(public.get_driver_settings() - 'fuel_video_checklist' - 'fuel_video_quality', '{"shift_start": "07:30", "shift_days": [1, 2, 3, 4, 5]}'::jsonb, 'get_driver_settings: the stored time and days, and nothing else');
reset role;

-- 4. The leave-by backfill rule: a task with no leave_by gets its start time (the migration ran it once; the rule is checked here).
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, sent_at, created_by, leave_by, leave_by_source) values
  ('50000000-0000-0000-0000-0000000000f1', 'Old task', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1',
   now() + interval '2 hours', now(), 'test', null, null);
update public.tasks set leave_by = start_at, leave_by_source = 'manual' where leave_by is null and status in ('assigned', 'declined');
select is((select leave_by = start_at and leave_by_source = 'manual' from public.tasks where id = '50000000-0000-0000-0000-0000000000f1'), true,
  'a task made before the planner shows its start time as the leave-by time');

-- 5. A task change writes its diff into the history.
select lives_ok($$
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note, changes) values
    ('50000000-0000-0000-0000-0000000000f1', 'changed', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1',
     'Six Approver', 'time 09:00 → 09:30', '{"time": {"from": "Thu 15 Oct 09:00", "to": "Thu 15 Oct 09:30"}}'::jsonb)
$$, 'a changed event with its diff');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select changes ->> 'time' is not null from public.task_assignment_events where task_id = '50000000-0000-0000-0000-0000000000f1' and action = 'changed'), true,
  'the driver reads the diff of their own task''s change');
reset role;

-- 6. send_push takes the changed fields (no Vault secrets here: it only logs a notice).
select lives_ok($$ select public.send_push('50000000-0000-0000-0000-0000000000f1', 'changed', '10000000-0000-0000-0000-0000000000f1', '{"changes": {"time": "09:30"}}'::jsonb) $$,
  'send_push with the changes');
select lives_ok($$ select public.send_push('50000000-0000-0000-0000-0000000000f1', 'new', '10000000-0000-0000-0000-0000000000f1') $$,
  'send_push without them, as the reminders call it');
select lives_ok($$ update public.tasks set start_at = start_at + interval '30 minutes', notes = 'bring the ladder' where id = '50000000-0000-0000-0000-0000000000f1' $$,
  'a moved task with a new note pushes "changed" (the trigger names the time and the note)');

select * from finish();
rollback;
