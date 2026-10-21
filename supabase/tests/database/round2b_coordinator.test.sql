-- Round 2b (21 October 2026): the Coordinator. The role and the permission are allowed, the role is an office role for
-- the database (current_office_role, office_can, the live data's policies), and nobody else's account changed.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0b01', 'r2b.coord@fame.test');
select lives_ok($$
  insert into public.employees (id, code, name, email, role, permissions, active, auth_user_id) values
    ('10000000-0000-0000-0000-0000000c0b01', 'R2BC', 'Achini Coordinator', 'r2b.coord@fame.test', 'coordinator',
     '{view,request,assign_tasks,vehicles,issues,office_users}', true, '00000000-0000-0000-0000-0000000c0b01') $$,
  'a coordinator with office_users is allowed by both checks');
select throws_ok($$ update public.employees set permissions = '{view,boss}' where id = '10000000-0000-0000-0000-0000000c0b01' $$,
  '23514', NULL, 'an unknown permission is still refused');
select throws_ok($$ update public.employees set role = 'not_a_real_role' where id = '10000000-0000-0000-0000-0000000c0b01' $$,
  '23514', NULL, 'an unknown role is still refused');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c0b01","role":"authenticated"}';
select is(public.current_office_role(), 'coordinator', 'the coordinator is an office role for the database');
select ok(public.office_can('vehicles'), 'office_can: a permission they hold');
select ok(not public.office_can('approve'), 'office_can: never approve');
select lives_ok($$ select count(*) from public.location_points $$, 'the live positions read through RLS');
select lives_ok($$ select count(*) from public.driver_heartbeats $$, 'and the heartbeats');
reset role;

select * from finish();
rollback;
