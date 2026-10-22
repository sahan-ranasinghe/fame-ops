-- Round 4–7, feature 7 (22 October 2026): Ask for it. An ask names a busy trip, a driver or vehicle, and its answer; a
-- notification's buttons reach the person's notification centre item; never more than three.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c7a01', 'R7K', 'Kamal Driver', 'r7.kamal', 'driver', '{}', true);
insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c7a02', 'R7D', 'Dilini Holder', 'r7.dilini@fame.test', 'staff', '{view,request}', true),
  ('10000000-0000-0000-0000-0000000c7a03', 'R7S', 'Sunil Asker', 'r7.sunil@fame.test', 'office', '{view,request,assign_tasks}', true);
insert into public.vehicles (id, reg_no, active) values ('20000000-0000-0000-0000-0000000c7a01', 'WP R7-0001', true);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at) values
  ('30000000-0000-0000-0000-0000000c7a01', 'Dilini · site visit', '10000000-0000-0000-0000-0000000c7a01', '20000000-0000-0000-0000-0000000c7a01',
   now() + interval '1 day');

select throws_ok($$ insert into public.holder_asks (task_id, resource, resource_id, asked_by, wanted_from)
  values ('30000000-0000-0000-0000-0000000c7a01', 'room', '20000000-0000-0000-0000-0000000c7a01', '10000000-0000-0000-0000-0000000c7a03', now()) $$,
  '23514', NULL, 'a driver or a vehicle');
select lives_ok($$ insert into public.holder_asks (id, task_id, resource, resource_id, asked_by, holder_id, wanted_from)
  values ('40000000-0000-0000-0000-0000000c7a01', '30000000-0000-0000-0000-0000000c7a01', 'vehicle', '20000000-0000-0000-0000-0000000c7a01',
          '10000000-0000-0000-0000-0000000c7a03', '10000000-0000-0000-0000-0000000c7a02', now() + interval '1 day') $$, 'an ask');
select throws_ok($$ update public.holder_asks set answer = 'yes' where id = '40000000-0000-0000-0000-0000000c7a01' $$,
  '23514', NULL, 'an answer has its time');
select lives_ok($$ update public.holder_asks set answer = 'yes', answered_at = now(), answered_by = '10000000-0000-0000-0000-0000000c7a02'
  where id = '40000000-0000-0000-0000-0000000c7a01' $$, 'the holder says yes');

select public.queue_notification('holder.asked', jsonb_build_object('title', 'Sunil asks for WP R7-0001', 'body', 'tomorrow',
  'url', '/tasks/30000000-0000-0000-0000-0000000c7a01',
  'actions', jsonb_build_array(
    jsonb_build_object('label', 'Yes', 'tool', 'answer_holder_ask', 'args', jsonb_build_object('ask_id', '40000000-0000-0000-0000-0000000c7a01', 'answer', 'yes')),
    jsonb_build_object('label', 'No', 'tool', 'answer_holder_ask', 'args', jsonb_build_object('ask_id', '40000000-0000-0000-0000-0000000c7a01', 'answer', 'no')))),
  array['10000000-0000-0000-0000-0000000c7a02'::uuid]);
select results_eq($$ select jsonb_array_length(actions), actions -> 0 ->> 'label' from public.office_inbox where event = 'holder.asked' $$,
  $$ values (2, 'Yes'::text) $$, 'the item carries its Yes / No buttons');
select throws_ok($$ insert into public.office_inbox (employee_id, event, title, actions)
  values ('10000000-0000-0000-0000-0000000c7a02', 'x', 'x', '[1,2,3,4]'::jsonb) $$, '23514', NULL, 'never more than three buttons');

select * from finish();
rollback;
