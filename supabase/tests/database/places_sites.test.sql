-- Places and sites (Phase 6, Part 4), checked with pgTAP: the site columns and
-- keys, the generated pin flag and the ids text, the saved-name rule, the
-- import rules of docs/phase6-plan.md 8.3, the ranked search and its indexes,
-- the places used before, and who may call what.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'd.sites@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000c1', 'D-SITES', 'Sites Driver', 'd.sites', 'driver', '{}', '00000000-0000-0000-0000-0000000000c1');

-- 1. The columns and the extension.
select has_extension('extensions', 'pg_trgm', 'pg_trgm is installed');
select has_column('public', 'places', 'operator', 'places.operator');
select has_column('public', 'places', 'site_id', 'places.site_id');
select has_column('public', 'places', 'other_ids', 'places.other_ids');
select has_column('public', 'places', 'pin_source', 'places.pin_source');
select has_column('public', 'places', 'pinned', 'places.pinned (generated)');
select is((select value from public.fleet_settings where key = 'ors_autocomplete_daily_cap'), '1000'::jsonb, 'the map search''s daily cap is seeded: 1000');

-- 2. Keys: one place per operator and site id; one Mobitel place without an id per coordinate; saved names unique.
insert into public.places (name, kind, operator, site_id, other_ids, lat, lng, source, pin_source)
values ('Inamaluwa Town_Hutch', 'site', 'dialog', 'mt0184 ', '{CM0164}', 7.927222, 80.684722, 'dialog', 'dialog');
select is((select site_id || '|' || ids_text || '|' || pinned from public.places where site_id = 'MT0184'), 'MT0184|mt0184 cm0164|true',
  'the site id is kept in capitals; ids_text holds it and the other ids in lower case; pinned follows the pin');
select throws_ok($$ insert into public.places (name, kind, operator, site_id) values ('Copy', 'site', 'dialog', 'MT0184') $$, '23505', null,
  'a second Dialog place with the same site id is refused');
select lives_ok($$ insert into public.places (name, kind, operator, site_id) values ('Same id, other operator', 'site', 'mobitel', 'MT0184') $$,
  'the same id under another operator is allowed');
insert into public.places (name, kind, operator, lat, lng, source) values ('Rideela', 'site', 'mobitel', 7.20001, 80.50002, 'mobitel_4g');
select throws_ok($$ insert into public.places (name, kind, operator, lat, lng) values ('Rideela 2', 'site', 'mobitel', 7.20004, 80.49998) $$, '23505', null,
  'a second Mobitel place without an id at the same coordinate (4 decimals) is refused');
select lives_ok($$ insert into public.places (name, kind, operator, site_id) values ('Inamaluwa Town_Hutch', 'site', 'dialog', 'MT9999') $$,
  'two sites may share a name');
insert into public.places (name, kind, source) values ('Head office test', 'office', 'manual');
select throws_ok($$ insert into public.places (name, kind, source) values ('head office TEST', 'other', 'claude') $$, '23505', null,
  'two of the office''s own saved places may not share a name (case does not matter)');
select lives_ok($$ insert into public.places (name, kind, source, lat, lng) values ('Head office test', 'other', 'ors', 6.9, 79.9) $$,
  'a place saved from the map search may share a name');
select is((select pinned from public.places where name = 'Same id, other operator'), false, 'a place without a pin is not pinned');

-- 3. The import rules.
select is(
  (select public.import_place_rows('[
     {"operator": "dialog", "site_id": "KA0205", "name": "Hanthana Etisalat", "district": "Kandy", "lat": 7.258611, "lng": 80.629722},
     {"operator": "dialog", "site_id": "KA0197", "name": "Hanthana Hutch", "other_ids": ["KA0300"]},
     {"operator": "dialog", "site_id": "CM0164", "name": "An other id of MT0184"},
     {"operator": "dialog", "name": ""}
   ]'::jsonb, 'dialog') - 'skipped'),
  '{"added": 2, "updated": 0, "attached": 0, "unchanged": 0, "no_pin": 1}'::jsonb,
  'import: two added (one without a pin), the rest skipped');
select is((select jsonb_array_length(public.import_place_rows('[{"operator": "dialog", "site_id": "CM0164", "name": "x"}, {"operator": "dialog"}]'::jsonb, 'dialog') -> 'skipped')), 2,
  'skipped with their reasons: an id that is another site''s other id, a row with nothing to key it by');
update public.places set lat = 7.3, lng = 80.6, pin_source = 'manual' where site_id = 'KA0205';
select is((select public.import_place_rows('[{"operator": "dialog", "site_id": "KA0205", "name": "Hanthana Etisalat (renamed)", "lat": 7.258611, "lng": 80.629722},
                                              {"operator": "dialog", "site_id": "KA0197", "name": "Hanthana Hutch", "lat": 7.26, "lng": 80.63, "other_ids": ["KA0301"]}]'::jsonb, 'dialog') ->> 'updated'), '2',
  'a second import updates both');
select is((select name || '|' || lat || '|' || pin_source from public.places where site_id = 'KA0205'), 'Hanthana Etisalat (renamed)|7.3|manual',
  'the name follows the import; a pin set by hand is never replaced');
select is((select lat || '|' || pin_source || '|' || array_to_string(other_ids, ',') from public.places where site_id = 'KA0197'), '7.26|dialog|KA0300,KA0301',
  'a place without a pin gets the import''s; other ids are joined');
-- Mobitel EP: attached within 100 m, else a place of its own; an id already known is left alone.
insert into public.places (name, kind, operator, site_id, lat, lng, source, pin_source) values ('Bambalapitiya', 'site', 'mobitel', 'COBAM1', 6.8833, 79.8814, 'mobitel_4g', 'mobitel_4g');
select is((select public.import_place_rows('[
    {"operator": "mobitel", "site_id": "COL018", "name": "COL018", "lat": 6.88335, "lng": 79.88145},
    {"operator": "mobitel", "site_id": "COL999", "name": "COL999", "lat": 6.95, "lng": 79.95},
    {"operator": "mobitel", "site_id": "COBAM1", "name": "COBAM1", "lat": 6.8833, "lng": 79.8814}
  ]'::jsonb, 'mobitel_ep') - 'skipped'),
  '{"added": 1, "updated": 0, "attached": 1, "unchanged": 1, "no_pin": 0}'::jsonb,
  'EP: one id attached to the place 7 m away, one far away added, one already known');
select is((select array_to_string(other_ids, ',') from public.places where site_id = 'COBAM1'), 'COL018', 'the attached id is an other id of the nearby place');
select throws_ok($$ select public.import_place_rows('[]'::jsonb, 'nonsense') $$, 'P0001', 'Unknown preset nonsense', 'an unknown preset is refused');

-- 4. The ranked search and its indexes.
select is((select site_id from public.search_places_ranked('mt0184', 5) limit 1), 'MT0184', 'an exact id comes first, whatever the case');
select is((select site_id from public.search_places_ranked('CM0164', 5) limit 1), 'MT0184', 'an other id finds its site');
select ok((select count(*) from public.search_places_ranked('Hanth', 5) where name like 'Hanthana%') = 2, 'a name prefix finds both Hanthana sites');
select is((select name from public.search_places_ranked('Head office', 5) limit 1), 'Head office test', 'at the same rank the office comes before other places');
select ok((select count(*) from public.search_places_ranked('Inamalua', 5)) >= 1, 'a misspelt name is found by similarity');
select is((select count(*) from public.search_places_ranked('x', 5)), 0::bigint, 'one character finds nothing');
create temporary table plan_lines (line text) on commit drop;
set local enable_seqscan = off; -- a handful of rows: the planner would scan them all
do $$ declare r record; begin
  for r in execute 'explain (costs off) select * from public.places where name ilike ''hanth%'' or ids_text like ''hanth%''' loop
    insert into plan_lines values (r."QUERY PLAN");
  end loop;
end $$;
select ok((select count(*) from plan_lines where line like '%Bitmap Index Scan on places_name_trgm%') = 1, 'the name prefix uses the trigram index');
reset enable_seqscan;

-- 5. The places used before: names typed in tasks and requests, not our saved places.
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000c1', 'WP SITE-0001');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, created_by)
values ('30000000-0000-0000-0000-0000000000c1', 'Sites task', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', now() - interval '2 days', 'assigned', 'test');
insert into public.task_stops (task_id, seq, type, place_name, lat, lng) values
  ('30000000-0000-0000-0000-0000000000c1', 1, 'pickup', 'Kelaniya temple gate', 6.95, 79.92),
  ('30000000-0000-0000-0000-0000000000c1', 2, 'drop', 'Head office test', null, null);
select is((select name || '|' || lat from public.recent_places('kelaniya', now() - interval '90 days', 5)), 'Kelaniya temple gate|6.95',
  'a stop typed by hand is "used before", with its pin');
select is((select count(*) from public.recent_places('head office', now() - interval '90 days', 5)), 0::bigint,
  'the name of one of our places is not repeated as "used before"');
select is((select count(*) from public.recent_places('kelaniya', now() + interval '1 day', 5)), 0::bigint, 'nothing older than the window');

-- 6. Who may do what.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select ok((select count(*) from public.places where site_id = 'MT0184' and operator = 'dialog') = 1, 'a driver still reads places (a stop''s name)');
select throws_ok($$ insert into public.places (name) values ('From the phone') $$, '42501', null, 'a driver cannot add a place');
select throws_ok($$ select public.import_place_rows('[]'::jsonb, 'dialog') $$, '42501', null, 'a driver cannot import');
select throws_ok($$ select * from public.search_places_ranked('MT', 5) $$, '42501', null, 'the search function is the server''s (through the tools)');
select throws_ok($$ select * from public.geocode_cache $$, '42501', null, 'nobody but the server reads the map search''s cache');
reset role;

select * from finish();
rollback;
