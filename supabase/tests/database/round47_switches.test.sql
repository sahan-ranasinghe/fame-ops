-- Round 4–7 (22 October 2026): the five feature switches. No row = on; a stored false = off; the phone reads all five.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select ok(public.fleet_switch('vehicle_check'), 'no row: the vehicle check is on');
select ok(public.fleet_switch('holder_contact'), 'no row: who holds it is shown');
select is((public.get_driver_settings() ->> 'vehicle_check')::boolean, true, 'the phone reads vehicle_check, on');
select is((public.get_driver_settings() ->> 'fuel_card')::boolean, true, 'the phone reads fuel_card, on');
select ok(public.get_driver_settings() ? 'trip_close_prompt' and public.get_driver_settings() ? 'passengers'
          and public.get_driver_settings() ? 'holder_contact', 'the phone reads all five');

insert into public.fleet_settings (key, value) values ('fuel_card', 'false'::jsonb)
  on conflict (key) do update set value = excluded.value;
select is(public.fleet_switch('fuel_card'), false, 'a stored false switches it off');
select is((public.get_driver_settings() ->> 'fuel_card')::boolean, false, 'and the phone reads it off');
select is(public.fleet_switch('passengers'), true, 'the others stay on');

select * from finish();
rollback;
