-- Round 4–7, feature 5 (22 October 2026): the fuel card. A grade fits its fuel type; drivers read both; the estimate is the
-- plan's km over the vehicle's km per litre (its last fills, else the default by type), a range of ±10 %; electric gives
-- the km only; only the task's own driver reads it or answers it.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c5a01', 'r5.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c5a02', 'r5.nuwan@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c5a01', 'R5K', 'Kamal Driver', 'r5.kamal', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c5a01'),
  ('10000000-0000-0000-0000-0000000c5a02', 'R5N', 'Nuwan Driver', 'r5.nuwan', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c5a02');

select throws_ok($$ insert into public.vehicles (reg_no, fuel_type, fuel_grade) values ('WP R5-BAD', 'diesel', 'petrol_95') $$,
  '23514', NULL, 'a grade fits its fuel type');
select throws_ok($$ insert into public.vehicles (reg_no, fuel_type) values ('WP R5-BAD2', 'kerosene') $$,
  '23514', NULL, 'petrol, diesel, hybrid or electric');
insert into public.vehicles (id, reg_no, vehicle_type, fuel_type, fuel_grade, active) values
  ('20000000-0000-0000-0000-0000000c5a01', 'WP R5-0001', 'van', 'diesel', 'auto_diesel', true),
  ('20000000-0000-0000-0000-0000000c5a02', 'WP R5-0002', 'car', 'electric', null, true);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, plan_json) values
  ('30000000-0000-0000-0000-0000000c5a01', 'Kamal · Kandy', '10000000-0000-0000-0000-0000000c5a01', '20000000-0000-0000-0000-0000000c5a01',
   now() + interval '1 hour', '{"total_km": 180, "legs": []}'),
  ('30000000-0000-0000-0000-0000000c5a02', 'Kamal · EV', '10000000-0000-0000-0000-0000000c5a01', '20000000-0000-0000-0000-0000000c5a02',
   now() + interval '2 hours', '{"total_km": 40, "legs": []}');

select results_eq($$ select (fuel_estimate ->> 'km')::int, (fuel_estimate ->> 'litres_low')::int, (fuel_estimate ->> 'litres_high')::int,
                            fuel_estimate ->> 'source'
                     from (select public.fuel_estimate('30000000-0000-0000-0000-0000000c5a01') as fuel_estimate) e $$,
  $$ values (180, 16, 20, 'default'::text) $$, 'no fills: a diesel van''s default 10 km/L, 180 km = 16–20 L');
insert into public.fuel_logs (vehicle_id, employee_id, litres, odometer_km, logged_at) values
  ('20000000-0000-0000-0000-0000000c5a01', '10000000-0000-0000-0000-0000000c5a01', 40, 10000, now() - interval '10 days'),
  ('20000000-0000-0000-0000-0000000c5a01', '10000000-0000-0000-0000-0000000c5a01', 30, 10360, now() - interval '5 days'),
  ('20000000-0000-0000-0000-0000000c5a01', '10000000-0000-0000-0000-0000000c5a01', 30, 10720, now() - interval '1 day');
select results_eq($$ select (e ->> 'km_per_l')::numeric, e ->> 'source' from (select public.fuel_estimate('30000000-0000-0000-0000-0000000c5a01') e) x $$,
  $$ values (12.0::numeric, 'history'::text) $$, 'three fills: 720 km on 60 L after the first = 12 km/L');
select results_eq($$ select (e ->> 'electric')::boolean, e ? 'litres_low' from (select public.fuel_estimate('30000000-0000-0000-0000-0000000c5a02') e) x $$,
  $$ values (true, false) $$, 'electric: the km, no litres');

-- As the drivers.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c5a01","role":"authenticated"}';
select results_eq($$ select fuel_type, fuel_grade from public.vehicles where id = '20000000-0000-0000-0000-0000000c5a01' $$,
  $$ values ('diesel'::text, 'auto_diesel'::text) $$, 'the driver reads the fuel type and grade');
select isnt(public.fuel_estimate('30000000-0000-0000-0000-0000000c5a01'), null, 'the driver reads their own task''s estimate');
select is(public.answer_fuel_card('30000000-0000-0000-0000-0000000c5a01', 'fill_on_way', now()), 'ok', 'and answers it');
select is(public.answer_fuel_card('30000000-0000-0000-0000-0000000c5a01', 'maybe', now()), 'bad', 'enough or fill_on_way only');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c5a02","role":"authenticated"}';
select is(public.fuel_estimate('30000000-0000-0000-0000-0000000c5a01'), null, 'another driver reads nothing');
select is(public.answer_fuel_card('30000000-0000-0000-0000-0000000c5a01', 'enough', now()), 'not_yours', 'nor answers it');
reset role;
select results_eq($$ select fuel_answer from public.tasks where id = '30000000-0000-0000-0000-0000000c5a01' $$,
  $$ values ('fill_on_way'::text) $$, 'the office sees the driver''s answer');
select throws_ok($$ insert into public.fuel_logs (vehicle_id, employee_id, litres, fuel_type, fuel_grade)
  values ('20000000-0000-0000-0000-0000000c5a01', '10000000-0000-0000-0000-0000000c5a01', 10, 'diesel', 'petrol_92') $$,
  '23514', NULL, 'a fill''s grade fits its fuel too');

select * from finish();
rollback;
