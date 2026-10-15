-- =============================================================================
-- Phase 6, Part 4b (docs/phase6-plan.md 8.6)
--
--   places.active          a place can be switched off (an undone import's added
--                          places); off places are left out of every search and list,
--                          kept for the stops that used them; an import that matches
--                          one switches it on again.
--   site_import_presets    a custom column mapping saved under a name (the built-in
--                          presets live in code: _shared/fleet/sites.ts).
--   place_imports          every import: who, when, the file, the preset, the counts,
--                          and when it was undone and by whom.
--   place_import_changes   what each import did to each place (added, updated,
--                          attached) with the place as it was before: the undo.
--   import_place_rows(rows, preset, import_id?, attach_m?)   the upsert of 8.3 for any
--                          preset key (Mobitel EP attaches within 100 m, any mapping may
--                          ask for it), rows may carry address and kind, each change
--                          recorded when import_id is given, the counts added to it.
--   undo_place_import(id, by)   added places switched off, updated ones put back; a
--                          place changed since the import is left as it is and counted.
--   task_stops.auto_detected_at   the phone saw the driver within 150 m of the stop
--                          (the arrival nudge); shown to the office beside the tap.
--   api_minute_calls / bump_minute_calls()   calls a minute per provider: the map
--                          search's throttle (90 a minute, the setting).
--   Settings: ors_autocomplete_daily_cap 2,500 (the dashboard's Geocoding quota of
--   3,000 a day is shared by autocomplete, search and reverse), replacing the seeded
--   1,000 only where nobody changed it; ors_autocomplete_per_minute 90. The shift
--   nudge's default days are Monday to Friday (an edited setting is kept).
-- =============================================================================

-- 1. Places that can be switched off -------------------------------------------------
alter table public.places add column active boolean not null default true;
comment on column public.places.active is
  'Off = left out of every search and list (an undone import''s added place); kept for the stops that used it.';

-- 2. Saved mappings, the import record, the changes for the undo ------------------------
create table public.site_import_presets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  mapping     jsonb not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create unique index site_import_presets_name_key on public.site_import_presets (lower(name));
alter table public.site_import_presets enable row level security;

create table public.place_imports (
  id              uuid primary key default gen_random_uuid(),
  at              timestamptz not null default now(),
  by_employee_id  uuid references public.employees (id),
  by_name         text not null,
  file_name       text,
  preset_key      text not null,
  preset_label    text,
  rows            integer not null default 0,
  added           integer not null default 0,
  updated         integer not null default 0,
  attached        integer not null default 0,
  unchanged       integer not null default 0,
  no_pin          integer not null default 0,
  skipped         integer not null default 0,
  undone_at       timestamptz,
  undone_by       text,
  undo_result     jsonb
);
create index place_imports_at on public.place_imports (at desc);
alter table public.place_imports enable row level security;

create table public.place_import_changes (
  id         bigint generated always as identity primary key,
  import_id  uuid not null references public.place_imports (id),
  place_id   uuid not null references public.places (id),
  action     text not null constraint place_import_changes_action_check check (action in ('added', 'updated', 'attached')),
  before     jsonb,
  after_at   timestamptz not null
);
create index place_import_changes_import on public.place_import_changes (import_id);
alter table public.place_import_changes enable row level security;

-- 3. Search and "used before" leave switched-off places out --------------------------------
create or replace function public.search_places_ranked(p_text text, p_limit integer default 8)
returns table (
  id uuid, name text, address text, kind text, operator text, site_id text, other_ids text[], district text, depot text,
  lat double precision, lng double precision, source text, attribution text, rank real
)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select lower(trim(p_text)) as t,
           upper(trim(p_text)) as u,
           replace(replace(replace(lower(trim(p_text)), '\', '\\'), '%', '\%'), '_', '\_') as e
  ),
  hits as (
    select p.*,
           case
             when p.site_id = q.u or q.u = any(p.other_ids) then 4
             when p.name ilike q.e || '%' or p.ids_text like q.e || '%' or p.ids_text like '% ' || q.e || '%' then 3
             when p.name ilike '% ' || q.e || '%' then 2
             else 1 + greatest(similarity(p.name, q.t), similarity(p.ids_text, q.t), word_similarity(q.t, p.name))
           end::real as rank
    from public.places p, q
    where length(q.t) >= 2
      and p.active
      and (p.site_id = q.u or q.u = any(p.other_ids)
           or p.name ilike q.e || '%' or p.ids_text like q.e || '%' or p.ids_text like '% ' || q.e || '%'
           or p.name ilike '% ' || q.e || '%'
           or p.name % q.t or p.ids_text % q.t or q.t <% p.name)
  )
  select h.id, h.name, h.address, h.kind, h.operator, h.site_id, h.other_ids, h.district, h.depot, h.lat, h.lng, h.source, h.attribution, h.rank
  from hits h
  order by h.rank desc,
           case h.kind when 'office' then 0 when 'store' then 1 when 'other' then 2 else 3 end,
           h.name
  limit greatest(1, least(p_limit, 50))
$$;

-- 4. The import, for any preset key, recorded for the undo --------------------------------
drop function public.import_place_rows(jsonb, text);
create function public.import_place_rows(p_rows jsonb, p_preset text, p_import_id uuid default null, p_attach_m integer default null)
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

-- 5. Undo: added places switched off, updated and attached ones put back, nothing deleted ---------
create function public.undo_place_import(p_import_id uuid, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c          record;
  v_import   public.place_imports%rowtype;
  v_off      integer := 0;
  v_restored integer := 0;
  v_left     integer := 0;
  v_left_names text[] := '{}';
  v_done     uuid[] := '{}'; -- places this undo already put back (its own change moves their updated_at)
  v_result   jsonb;
begin
  select * into v_import from public.place_imports where id = p_import_id for update;
  if not found then
    raise exception 'No import with id %', p_import_id;
  end if;
  if v_import.undone_at is not null then
    raise exception 'This import was already undone';
  end if;
  for c in
    select ch.*, p.updated_at as place_updated_at, p.name as place_name
    from public.place_import_changes ch join public.places p on p.id = ch.place_id
    where ch.import_id = p_import_id
    order by ch.id desc
  loop
    -- Changed since the import (by hand, by a later import): left as it is.
    if c.place_updated_at > c.after_at and not (c.place_id = any(v_done)) then
      v_left := v_left + 1;
      if array_length(v_left_names, 1) is null or array_length(v_left_names, 1) < 20 then
        v_left_names := v_left_names || c.place_name;
      end if;
      continue;
    end if;
    v_done := v_done || c.place_id;
    if c.action = 'added' then
      update public.places set active = false where id = c.place_id;
      v_off := v_off + 1;
    elsif c.action = 'attached' then
      update public.places set other_ids = coalesce(array(select jsonb_array_elements_text(c.before -> 'other_ids')), '{}') where id = c.place_id;
      v_restored := v_restored + 1;
    else
      update public.places p set
        name       = coalesce(c.before ->> 'name', p.name),
        region     = case when c.before ? 'region' then c.before ->> 'region' else p.region end,
        district   = case when c.before ? 'district' then c.before ->> 'district' else p.district end,
        depot      = case when c.before ? 'depot' then c.before ->> 'depot' else p.depot end,
        address    = case when c.before ? 'address' then c.before ->> 'address' else p.address end,
        kind       = coalesce(c.before ->> 'kind', p.kind),
        other_ids  = case when c.before ? 'other_ids' then coalesce(array(select jsonb_array_elements_text(c.before -> 'other_ids')), '{}') else p.other_ids end,
        lat        = case when c.before ? 'lat' then (c.before ->> 'lat')::double precision else p.lat end,
        lng        = case when c.before ? 'lng' then (c.before ->> 'lng')::double precision else p.lng end,
        pin_source = case when c.before ? 'pin_source' then c.before ->> 'pin_source' else p.pin_source end,
        active     = coalesce((c.before ->> 'active')::boolean, p.active)
      where p.id = c.place_id;
      v_restored := v_restored + 1;
    end if;
  end loop;
  v_result := jsonb_build_object('switched_off', v_off, 'restored', v_restored, 'left_as_is', v_left, 'left_names', to_jsonb(v_left_names));
  update public.place_imports set undone_at = now(), undone_by = p_by, undo_result = v_result where id = p_import_id;
  return v_result;
end;
$$;

revoke all on function public.search_places_ranked(text, integer) from public, anon, authenticated;
revoke all on function public.import_place_rows(jsonb, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.undo_place_import(uuid, text) from public, anon, authenticated;
grant execute on function public.search_places_ranked(text, integer) to service_role;
grant execute on function public.import_place_rows(jsonb, text, uuid, integer) to service_role;
grant execute on function public.undo_place_import(uuid, text) to service_role;

-- 6. The arrival nudge's time on a stop (the driver's phone writes it, like arrived_at) ------------
alter table public.task_stops add column auto_detected_at timestamptz;
comment on column public.task_stops.auto_detected_at is
  'The driver''s phone was within 150 m of the stop during the task (the arrival nudge); arrived_at is the driver''s own tap.';
grant update (auto_detected_at) on public.task_stops to authenticated;

-- 7. Calls a minute per provider (the map search's throttle) ------------------------------------
create table public.api_minute_calls (
  provider text not null,
  minute   timestamptz not null,
  calls    integer not null default 0,
  primary key (provider, minute)
);
alter table public.api_minute_calls enable row level security;

create function public.bump_minute_calls(p_provider text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_calls integer;
begin
  insert into public.api_minute_calls (provider, minute, calls) values (p_provider, date_trunc('minute', now()), 1)
  on conflict (provider, minute) do update set calls = public.api_minute_calls.calls + 1
  returning calls into v_calls;
  -- Keep an hour.
  delete from public.api_minute_calls where minute < now() - interval '1 hour';
  return v_calls;
end;
$$;
revoke all on function public.bump_minute_calls(text) from public, anon, authenticated;
grant execute on function public.bump_minute_calls(text) to service_role;

-- 8. Settings ------------------------------------------------------------------------------------
update public.fleet_settings set value = '2500'::jsonb, updated_at = now()
where key = 'ors_autocomplete_daily_cap' and updated_by = 'migration';
insert into public.fleet_settings (key, value, updated_by) values ('ors_autocomplete_per_minute', '90'::jsonb, 'migration')
on conflict (key) do nothing;

-- The shift nudge: Monday to Friday by default (a setting the office edited is kept).
create or replace function public.get_driver_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_start', coalesce((select value #>> '{}' from public.fleet_settings where key = 'shift_start'), '08:00'),
    'shift_days',  coalesce((select value from public.fleet_settings where key = 'shift_days' and jsonb_typeof(value) = 'array'),
                            '[1, 2, 3, 4, 5]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                              {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                              {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                              {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p')
  )
$$;
update public.fleet_settings set value = '[1, 2, 3, 4, 5]'::jsonb, updated_at = now()
where key = 'shift_days' and updated_by = 'migration';
