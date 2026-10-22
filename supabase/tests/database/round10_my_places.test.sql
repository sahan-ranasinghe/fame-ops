-- Round 4–7, item 10 (22 October 2026): a person's Recent places are their own. A's destinations never reach B; a driver's
-- personal trip is theirs alone; a passenger's ride counts for them; the company's saved places are not in Recent.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into public.employees (id, code, name, username, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000caa01', 'R10K', 'Kamal Driver', 'r10.kamal', 'driver', '{}', true);
insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000caa02', 'R10A', 'Asha A', 'r10.asha@fame.test', 'staff', '{view,request}', true),
  ('10000000-0000-0000-0000-0000000caa03', 'R10B', 'Bimal B', 'r10.bimal@fame.test', 'staff', '{view,request}', true),
  ('10000000-0000-0000-0000-0000000caa04', 'R10C', 'Chamari C', 'r10.chamari@fame.test', 'viewer', '{view}', true);
insert into public.vehicles (id, reg_no, active) values ('20000000-0000-0000-0000-0000000caa01', 'WP R10-0001', true);
insert into public.places (name, kind) values ('R10 Head office', 'office');

-- Asha's request and its trip to "Asha's secret clinic", Chamari riding; Kamal's personal trip; one stop at a saved place.
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, route_to, created_at) values
  ('30000000-0000-0000-0000-0000000caa01', 'Asha A', '10000000-0000-0000-0000-0000000caa02', now() - interval '2 days', 'Asha''s secret clinic', now() - interval '3 days');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, request_id) values
  ('40000000-0000-0000-0000-0000000caa01', 'Asha''s trip', '10000000-0000-0000-0000-0000000caa01', '20000000-0000-0000-0000-0000000caa01',
   now() - interval '2 days', '30000000-0000-0000-0000-0000000caa01');
insert into public.task_stops (task_id, seq, type, place_name) values
  ('40000000-0000-0000-0000-0000000caa01', 1, 'drop', 'Asha''s secret clinic'),
  ('40000000-0000-0000-0000-0000000caa01', 2, 'drop', 'R10 Head office');
insert into public.task_passengers (task_id, employee_id, name) values
  ('40000000-0000-0000-0000-0000000caa01', '10000000-0000-0000-0000-0000000caa04', 'Chamari C');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, kind, purpose) values
  ('40000000-0000-0000-0000-0000000caa02', 'Personal', '10000000-0000-0000-0000-0000000caa01', '20000000-0000-0000-0000-0000000caa01',
   now() - interval '1 day', 'self', 'personal');
insert into public.task_stops (task_id, seq, type, place_name) values
  ('40000000-0000-0000-0000-0000000caa02', 1, 'visit', 'Kamal''s home town');

select ok((select count(*) from public.my_recent_places('10000000-0000-0000-0000-0000000caa02', '', now() - interval '90 days', 10)
           where name = 'Asha''s secret clinic') = 1, 'Asha sees her own destination');
select is((select count(*)::int from public.my_recent_places('10000000-0000-0000-0000-0000000caa03', '', now() - interval '90 days', 10)), 0,
  'Bimal sees none of Asha''s places');
select ok((select count(*) from public.my_recent_places('10000000-0000-0000-0000-0000000caa04', '', now() - interval '90 days', 10)
           where name = 'Asha''s secret clinic') = 1, 'Chamari, a passenger, has the ride''s place');
select ok((select count(*) from public.my_recent_places('10000000-0000-0000-0000-0000000caa01', '', now() - interval '90 days', 10)
           where name = 'Kamal''s home town') = 1, 'the driver has his personal trip''s place');
select is((select count(*)::int from public.my_recent_places('10000000-0000-0000-0000-0000000caa02', 'home town', now() - interval '90 days', 10)), 0,
  'nobody else sees the driver''s personal trip, typed or not');
select is((select count(*)::int from public.my_recent_places('10000000-0000-0000-0000-0000000caa02', 'R10 Head', now() - interval '90 days', 10)), 0,
  'a saved place is in Saved, not Recent');

select is((select count(*)::int from public.my_recent_places('10000000-0000-0000-0000-0000000caa01', 'home town', now() - interval '90 days', 10, false)), 0,
  'shown to someone editing their trip, a driver''s recent places never hold their personal trips');

-- Never called by a signed-in person directly.
set local role authenticated;
select throws_ok($$ select * from public.my_recent_places('10000000-0000-0000-0000-0000000caa02', '', now(), 5, true) $$,
  '42501', NULL, 'only the server reads recent places');
reset role;

select * from finish();
rollback;
