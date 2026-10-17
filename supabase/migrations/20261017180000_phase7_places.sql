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

-- A setting cleared to null (removing the base place clears base_place_id; update_settings takes null for it) is
-- stored as JSON null: the column holds a value, and loading it gives null back.
create function public.save_fleet_setting(p_key text, p_value jsonb, p_by text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fleet_settings (key, value, updated_at, updated_by)
  values (p_key, coalesce(p_value, 'null'::jsonb), now(), p_by)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
$$;
revoke all on function public.save_fleet_setting(text, jsonb, text) from public, anon, authenticated;
