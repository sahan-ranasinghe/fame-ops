-- Round 1 (21 October 2026): the driver's Me lists only the office people chosen as contacts for drivers, each once;
-- "fleet admin" only for a chosen contact with the approve permission; nobody chosen = the office's number only.
begin;
select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0e01', 'r1c.amal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c0e02', 'r1c.palitha@fame.test'),
  ('00000000-0000-0000-0000-0000000c0e03', 'r1c.admin@fame.test'),
  ('00000000-0000-0000-0000-0000000c0e04', 'r1c.kumari@fame.test');
insert into public.employees (id, code, name, username, email, phone, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c0e01', 'R1CA', 'Amal Silva', 'r1c.amal', null, '+94771110001', 'driver', '{}', true,
   '00000000-0000-0000-0000-0000000c0e01'),
  ('10000000-0000-0000-0000-0000000c0e02', 'R1CP', 'Palitha Fleet', null, 'r1c.palitha@fame.test', '+94712345678', 'fleet_admin',
   '{view,request,approve,assign_tasks,vehicles,issues}', true, '00000000-0000-0000-0000-0000000c0e02'),
  ('10000000-0000-0000-0000-0000000c0e03', 'R1CS', 'Sahan Admin', null, 'r1c.admin@fame.test', '+94719999999', 'admin',
   '{view,request,approve,assign_tasks,vehicles,issues,users}', true, '00000000-0000-0000-0000-0000000c0e03'),
  ('10000000-0000-0000-0000-0000000c0e04', 'R1CK', 'Kumari Office', null, 'r1c.kumari@fame.test', '+94713333333', 'office',
   '{view,request,assign_tasks}', true, '00000000-0000-0000-0000-0000000c0e04');
update public.employees set driver_contact = false where role <> 'driver';
insert into public.fleet_settings (key, value, updated_by) values ('office_phone', '"+94112345678"'::jsonb, 'test')
  on conflict (key) do update set value = excluded.value;

select has_column('public', 'employees', 'driver_contact', 'employees.driver_contact');
select col_default_is('public', 'employees', 'driver_contact', 'false', 'off by default');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c0e01","role":"authenticated"}';
select is(public.my_office_contacts() -> 'contacts', null, 'nobody chosen: no people');
select is(public.my_office_contacts() -> 'approvers', null, 'and nobody for the older app either');
select is(public.my_office_contacts() ->> 'office_phone', '+94112345678', 'only the office''s number');

reset role;
set local request.jwt.claims to '{}';
update public.employees set driver_contact = true where id in ('10000000-0000-0000-0000-0000000c0e02', '10000000-0000-0000-0000-0000000c0e04');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c0e01","role":"authenticated"}';
select is(jsonb_array_length(public.my_office_contacts() -> 'contacts'), 2, 'the two chosen people, each once');
select is(public.my_office_contacts() -> 'contacts' -> 0, '{"name": "Palitha Fleet", "phone": "+94712345678", "fleet_admin": true}'::jsonb,
  'a chosen contact who approves: fleet admin, first');
select is(public.my_office_contacts() -> 'contacts' -> 1, '{"name": "Kumari Office", "phone": "+94713333333", "fleet_admin": false}'::jsonb,
  'a chosen contact without approve: office');
select ok(not (public.my_office_contacts()::text like '%Sahan Admin%'), 'an admin who approves but is not chosen is not shown');
select is(public.my_office_contacts() -> 'approvers', '[{"name": "Palitha Fleet", "phone": "+94712345678"}]'::jsonb,
  'the older app''s "fleet admin" list: only the chosen contacts who approve');

reset role;
select * from finish();
rollback;
