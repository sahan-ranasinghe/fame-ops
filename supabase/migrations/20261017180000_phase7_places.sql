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
grant execute on function public.save_fleet_setting(text, jsonb, text) to service_role;


-- The site import (Phase 6 Part 4b's import_place_rows, unchanged otherwise) never brings a removed place back: a row
-- for one is skipped with the reason, so the office restores it on purpose (an import switching it on would also break
-- places_removed_inactive and refuse the whole batch).
create or replace function public.import_place_rows(p_rows jsonb, p_preset text, p_import_id uuid default null, p_attach_m integer default null)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  r          jsonb;
  v_i        integer := 0;
  v_op       text;
  v_id       text;
  v_name     text;
  v_lat      double precision;
  v_lng      double precision;
  v_others   text[];
  v_region   text;
  v_district text;
  v_depot    text;
  v_address  text;
  v_kind     text;
  v_place    public.places%rowtype;
  v_owner    public.places%rowtype;
  v_new_id   uuid;
  v_metres   double precision;
  v_attach   integer := coalesce(p_attach_m, case when p_preset = 'mobitel_ep' then 100 end);
  v_added    integer := 0;
  v_updated  integer := 0;
  v_attached integer := 0;
  v_same     integer := 0;
  v_no_pin   integer := 0;
  v_skipped  jsonb := '[]'::jsonb;
begin
  if p_preset is null or length(trim(p_preset)) = 0 or length(p_preset) > 80 then
    raise exception 'A preset key of 1 to 80 characters is needed';
  end if;
  if p_attach_m is not null and (p_attach_m < 1 or p_attach_m > 1000) then
    raise exception 'attach_m: 1 to 1000 metres';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_op := coalesce(nullif(r ->> 'operator', ''), 'other');
    v_id := nullif(upper(trim(coalesce(r ->> 'site_id', ''))), '');
    v_name := nullif(regexp_replace(trim(coalesce(r ->> 'name', '')), '\s+', ' ', 'g'), '');
    v_lat := nullif(r ->> 'lat', '')::double precision;
    v_lng := nullif(r ->> 'lng', '')::double precision;
    if v_lat is null or v_lng is null then
      v_lat := null;
      v_lng := null;
    end if;
    v_others := coalesce(array(
      select distinct upper(trim(x)) from jsonb_array_elements_text(coalesce(r -> 'other_ids', '[]'::jsonb)) as t(x)
      where trim(x) <> '' and upper(trim(x)) is distinct from v_id), '{}');
    v_region := nullif(trim(coalesce(r ->> 'region', '')), '');
    v_district := nullif(trim(coalesce(r ->> 'district', '')), '');
    v_depot := nullif(trim(coalesce(r ->> 'depot', '')), '');
    v_address := nullif(trim(coalesce(r ->> 'address', '')), '');
    v_kind := nullif(trim(coalesce(r ->> 'kind', '')), '');

    if v_op not in ('dialog', 'mobitel', 'other') then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('unknown operator %s', v_op));
      continue;
    end if;
    if v_kind is not null and v_kind not in ('office', 'store', 'site', 'other') then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('unknown kind %s', v_kind));
      continue;
    end if;
    if v_id is null and v_lat is null and v_name is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'no id, no coordinates and no name');
      continue;
    end if;

    -- Attach (Mobitel EP, or a mapping that asks for it): the id joins the same operator's place within N metres,
    -- else it is a place of its own.
    if v_attach is not null then
      if v_id is null or v_lat is null then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'attaching needs an id and coordinates');
        continue;
      end if;
      select * into v_place from public.places p where p.operator = v_op and (p.site_id = v_id or v_id = any(p.other_ids)) limit 1;
      if found and v_place.removed_at is not null then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('%s was removed by the office: restore it first (Removed places)', v_place.name));
        continue;
      end if;
      if found then
        if v_place.lat is null or not v_place.active then
          if p_import_id is not null then
            insert into public.place_import_changes (import_id, place_id, action, before, after_at)
            values (p_import_id, v_place.id, 'updated', jsonb_build_object('lat', v_place.lat, 'lng', v_place.lng, 'pin_source', v_place.pin_source, 'active', v_place.active), now());
          end if;
          update public.places set lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng),
            pin_source = case when lat is null then p_preset else pin_source end, active = true, imported_at = now()
          where id = v_place.id;
          v_updated := v_updated + 1;
        else
          v_same := v_same + 1; -- already a site id or an other id of a place of this operator
        end if;
        continue;
      end if;
      select p.* into v_place from public.places p
      where p.operator = v_op and p.active
        and p.lat between v_lat - (v_attach / 111320.0) * 1.5 and v_lat + (v_attach / 111320.0) * 1.5
        and p.lng between v_lng - (v_attach / 111320.0) * 1.5 and v_lng + (v_attach / 111320.0) * 1.5
      order by power(p.lat - v_lat, 2) + power((p.lng - v_lng) * cos(radians(v_lat)), 2)
      limit 1;
      v_metres := case when found then 111320 * sqrt(power(v_place.lat - v_lat, 2) + power((v_place.lng - v_lng) * cos(radians(v_lat)), 2)) end;
      if v_metres is not null and v_metres <= v_attach then
        if p_import_id is not null then
          insert into public.place_import_changes (import_id, place_id, action, before, after_at)
          values (p_import_id, v_place.id, 'attached', jsonb_build_object('other_ids', to_jsonb(v_place.other_ids)), now());
        end if;
        update public.places set other_ids = array(select distinct x from unnest(other_ids || v_id) as t(x) order by x), imported_at = now()
        where id = v_place.id;
        v_attached := v_attached + 1;
      else
        insert into public.places (name, kind, operator, site_id, lat, lng, source, pin_source, imported_at, address)
        values (coalesce(v_name, v_id), coalesce(v_kind, 'site'), v_op, v_id, v_lat, v_lng, p_preset, p_preset, now(), v_address)
        returning id into v_new_id;
        if p_import_id is not null then
          insert into public.place_import_changes (import_id, place_id, action, after_at) values (p_import_id, v_new_id, 'added', now());
        end if;
        v_added := v_added + 1;
      end if;
      continue;
    end if;

    -- The key: the id, else the coordinates (to 4 decimals), else the name (a place with neither).
    if v_id is not null then
      select * into v_owner from public.places p where p.operator = v_op and v_id = any(p.other_ids) and p.site_id is distinct from v_id limit 1;
      if found then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('%s is already an other id of %s', v_id, coalesce(v_owner.site_id, v_owner.name)));
        continue;
      end if;
      select * into v_place from public.places p where p.operator = v_op and p.site_id = v_id;
    elsif v_lat is not null then
      select * into v_place from public.places p
      where p.operator = v_op and p.site_id is null and p.lat is not null
        and round(p.lat::numeric, 4) = round(v_lat::numeric, 4) and round(p.lng::numeric, 4) = round(v_lng::numeric, 4)
      limit 1;
    else
      select * into v_place from public.places p where p.operator = v_op and p.site_id is null and p.lat is null and lower(p.name) = lower(v_name) limit 1;
    end if;

    if found and v_place.removed_at is not null then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('%s was removed by the office: restore it first (Removed places)', v_place.name));
      continue;
    end if;
    if found then
      if p_import_id is not null then
        insert into public.place_import_changes (import_id, place_id, action, before, after_at)
        values (p_import_id, v_place.id, 'updated', jsonb_build_object(
          'name', v_place.name, 'region', v_place.region, 'district', v_place.district, 'depot', v_place.depot,
          'address', v_place.address, 'kind', v_place.kind, 'other_ids', to_jsonb(v_place.other_ids),
          'lat', v_place.lat, 'lng', v_place.lng, 'pin_source', v_place.pin_source, 'active', v_place.active), now());
      end if;
      update public.places set
        name        = coalesce(v_name, name),
        region      = coalesce(v_region, region),
        district    = coalesce(v_district, district),
        depot       = coalesce(v_depot, depot),
        address     = coalesce(v_address, address),
        kind        = coalesce(v_kind, kind),
        other_ids   = array(select distinct x from unnest(other_ids || v_others) as t(x) order by x),
        lat         = case when v_lat is not null and (lat is null or pin_source = p_preset) then v_lat else lat end,
        lng         = case when v_lat is not null and (lat is null or pin_source = p_preset) then v_lng else lng end,
        pin_source  = case when v_lat is not null and (lat is null or pin_source = p_preset) then p_preset else pin_source end,
        active      = true,
        imported_at = now()
      where id = v_place.id;
      v_updated := v_updated + 1;
    else
      insert into public.places (name, kind, operator, site_id, other_ids, region, district, depot, address, lat, lng, source, pin_source, imported_at)
      values (coalesce(v_name, v_id), coalesce(v_kind, 'site'), v_op, v_id, v_others, v_region, v_district, v_depot, v_address, v_lat, v_lng, p_preset,
              case when v_lat is not null then p_preset end, now())
      returning id into v_new_id;
      if p_import_id is not null then
        insert into public.place_import_changes (import_id, place_id, action, after_at) values (p_import_id, v_new_id, 'added', now());
      end if;
      v_added := v_added + 1;
      if v_lat is null then
        v_no_pin := v_no_pin + 1;
      end if;
    end if;
  end loop;
  if p_import_id is not null then
    update public.place_imports set
      rows = rows + v_i, added = added + v_added, updated = updated + v_updated, attached = attached + v_attached,
      unchanged = unchanged + v_same, no_pin = no_pin + v_no_pin, skipped = skipped + jsonb_array_length(v_skipped)
    where id = p_import_id;
  end if;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'attached', v_attached, 'unchanged', v_same, 'no_pin', v_no_pin, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_place_rows(jsonb, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.import_place_rows(jsonb, text, uuid, integer) to service_role;
