-- Round 48, item 1 (28 October 2026), checked with pgTAP: a change to a task proposed by someone without the approve
-- permission waits as a vehicle request of kind change that names its task (change_task_id); the kinds are request, task
-- and change; the waiting changes are found by task.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-000000000c48', 'R48D', 'Nimal Driver', 'r48.nimal', 'driver', '{}', true);
insert into public.vehicles (id, reg_no, current_odometer_km) values ('20000000-0000-0000-0000-000000000c48', 'WP R48-0001', 5000);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, created_by) values
  ('30000000-0000-0000-0000-000000000c48', 'Team drop · Galle', '10000000-0000-0000-0000-000000000c48',
   '20000000-0000-0000-0000-000000000c48', now() + interval '1 day', 'assigned', 'test');

select has_column('public', 'vehicle_requests', 'change_task_id', 'a request may name the task it changes');
select col_is_fk('public', 'vehicle_requests', 'change_task_id', 'change_task_id points at tasks');
select has_index('public', 'vehicle_requests', 'vehicle_requests_change_waiting', 'the waiting changes are indexed by task');
select index_is_unique('public', 'vehicle_requests', 'vehicle_requests_change_waiting', 'and one waiting change per task is the database''s rule');

-- The proposed driver is always set on a change (the one proposed, else the task's): vehicle_requests_proposed_check holds.
select lives_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind, change_task_id, title, proposed_employee_id, proposal_json)
  values ('Sashen', now() + interval '1 day', 'change', '30000000-0000-0000-0000-000000000c48', 'Team drop · Galle', '10000000-0000-0000-0000-000000000c48',
          '{"tool": "reassign_task", "args": {"driver": "kamal"}, "changes": {"driver": {"from": "Nimal", "to": "Kamal"}}, "summary": "driver Kamal instead of Nimal", "plan_version": 0, "task_status": "assigned"}') $$,
  'a change to a task is a request of kind change with its task');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind) values ('X', now(), 'edit') $$,
  '23514', null, 'kind is request, task or change');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind, change_task_id, proposed_employee_id)
  values ('X', now(), 'change', '30000000-0000-0000-0000-00000000dead', '10000000-0000-0000-0000-000000000c48') $$,
  '23503', null, 'a change names a real task');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind, change_task_id)
  values ('X', now(), 'change', '30000000-0000-0000-0000-000000000c48') $$,
  '23514', null, 'a change without its proposed driver is refused (vehicle_requests_proposed_check)');
select is(
  (select count(*)::int from public.vehicle_requests where kind = 'change' and status = 'waiting'
     and change_task_id = '30000000-0000-0000-0000-000000000c48'),
  1, 'the waiting change is found by its task');
select throws_ok($$ insert into public.vehicle_requests (requested_by_name, needed_at, kind, change_task_id, proposed_employee_id)
  values ('Someone else', now() + interval '1 day', 'change', '30000000-0000-0000-0000-000000000c48', '10000000-0000-0000-0000-000000000c48') $$,
  '23505', null, 'a second waiting change on the same task is refused by the index');
-- The task itself is untouched by the proposal (the tool applies it only when an approver decides).
select is((select employee_id from public.tasks where id = '30000000-0000-0000-0000-000000000c48'),
  '10000000-0000-0000-0000-000000000c48'::uuid, 'the task keeps its driver while the change waits');

select * from finish();
rollback;
