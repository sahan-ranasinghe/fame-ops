-- Phase 7, Part 3 (item 15, docs/phase7-plan.md §15): a place the office removes, and restores. A removed place is
-- switched off (`active` false: every search, list and picker already leaves it out) and says who removed it when;
-- past tasks keep its name on their stops. Nothing is deleted.

alter table public.places
  add column removed_at timestamptz,
  add column removed_by text;

alter table public.places
  add constraint places_removed_inactive check (removed_at is null or not active);

comment on column public.places.removed_at is
  'Removed by the office (remove_place): switched off and listed under Removed places until restore_place.';
