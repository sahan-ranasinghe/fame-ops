-- Phase 7, Part 3 (item 15, docs/phase7-plan.md §15): a removed place is switched off and says who removed it when.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_column('public', 'places', 'removed_at', 'places have removed_at');
select has_column('public', 'places', 'removed_by', 'and removed_by');
insert into public.places (id, name, kind, lat, lng) values ('70000000-0000-0000-0000-0000000000c1', 'P7 removable yard', 'other', 7.0, 80.0);
select throws_ok($$ update public.places set removed_at = now(), removed_by = 'Office' where id = '70000000-0000-0000-0000-0000000000c1' $$,
  '23514', null, 'a removed place cannot stay active (every search leaves inactive places out)');
select lives_ok($$ update public.places set active = false, removed_at = now(), removed_by = 'Office' where id = '70000000-0000-0000-0000-0000000000c1' $$,
  'removed = switched off, with who and when');
select is((select count(*) from public.search_places_ranked('P7 removable yard', 8)), 0::bigint, 'the search no longer finds it');
select lives_ok($$ update public.places set active = true, removed_at = null, removed_by = null where id = '70000000-0000-0000-0000-0000000000c1' $$,
  'restored');
select is((select count(*) from public.search_places_ranked('P7 removable yard', 8)), 1::bigint, 'and found again');

select * from finish();
rollback;
