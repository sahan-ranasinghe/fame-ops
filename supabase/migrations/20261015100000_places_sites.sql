-- =============================================================================
-- Phase 6, Part 4: site lists and the location search box (docs/phase6-plan.md 3.3, 8)
--
--   places          the operator's site lists (Dialog, Mobitel) become places:
--                   operator, site_id, other_ids, region, district, depot, source
--                   (the preset, 'manual', 'claude', 'ors' or 'link'), pin_source
--                   (where the pin came from: an import pin is replaced only by the
--                   same preset; a pin set by hand is never replaced), attribution
--                   and provider_ref (a place saved from the map search keeps its
--                   credit and the provider's id), imported_at, updated_at, pinned
--                   (generated), ids_text (site id and other ids, lower case, for
--                   the trigram search; kept by a trigger).
--   indexes         one place per (operator, site_id); one Mobitel place without an
--                   id per coordinate at 4 decimals; trigram on name and ids_text;
--                   GIN on other_ids; (operator, district); lower(name).
--   search_places_ranked(text, limit)   our places: an exact id, then name or id
--                   prefixes, then a word of the name starting so, then trigram
--                   similarity; offices before saved places before sites at equal
--                   rank.
--   recent_places(text, since, limit)    names used in tasks (stops and starts not
--                   tied to a saved place) and requests (from, to) since a time.
--   import_place_rows(rows, preset)      the upsert rules of 8.3 in one
--                   transaction per call (at most 500 rows: the tool's limit).
--   geocode_cache   the map search's answers per normalised text, 30 days.
--   ors_autocomplete_daily_cap           the fleet setting (1000 a day by default).
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- 1. The new columns ----------------------------------------------------------------
alter table public.places
  add column operator     text not null default 'other'
    constraint places_operator_check check (operator in ('dialog', 'mobitel', 'other')),
  add column site_id      text,
  add column other_ids    text[] not null default '{}',
  add column region       text,
  add column district     text,
  add column depot        text,
  add column source       text not null default 'manual',
  add column pin_source   text,
  add column attribution  text,
  add column provider_ref text,
  add column imported_at  timestamptz,
  add column updated_at   timestamptz not null default now(),
  add column ids_text     text not null default '',
  add column pinned       boolean generated always as (lat is not null) stored;

comment on column public.places.pin_source is
  'Where the pin came from: the import preset, manual (set by hand on the place page: an import never replaces it), ors or link.';
update public.places set pin_source = 'manual' where lat is not null;

create function public.places_keep_ids_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.site_id := nullif(upper(trim(new.site_id)), '');
  new.ids_text := lower(trim(coalesce(new.site_id, '') || ' ' || array_to_string(new.other_ids, ' ')));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger places_ids_text before insert or update on public.places
  for each row execute function public.places_keep_ids_text();
revoke all on function public.places_keep_ids_text() from public, anon, authenticated;
update public.places set ids_text = ids_text; -- fills ids_text for the rows already there

-- 2. Keys and indexes -----------------------------------------------------------
-- Names were unique across all places; site names repeat (thousands of towers, a few hundred towns), so the
-- rule now holds for the office's own saved places only. Places saved from the map search or a pasted pin
-- may share a name (two branches of one shop); save_place answers the existing one within 30 m instead.
drop index public.places_name_key;
create unique index places_saved_name_key on public.places (lower(name)) where operator = 'other' and source in ('manual', 'claude');
create unique index places_operator_site_id_key on public.places (operator, site_id) where site_id is not null;
create unique index places_mobitel_coordinate_key on public.places (operator, round(lat::numeric, 4), round(lng::numeric, 4))
  where site_id is null and operator = 'mobitel' and lat is not null;
create index places_name_trgm on public.places using gin (name extensions.gin_trgm_ops);
create index places_ids_trgm on public.places using gin (ids_text extensions.gin_trgm_ops);
create index places_other_ids on public.places using gin (other_ids);
create index places_operator_district on public.places (operator, district);
create index places_lower_name on public.places (lower(name));

-- 3. Our places for a text ----------------------------------------------------------
create function public.search_places_ranked(p_text text, p_limit integer default 8)
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

-- 4. Names used before (tasks and requests), not tied to a saved place ---------------
create function public.recent_places(p_text text, p_since timestamptz, p_limit integer default 5)
returns table (name text, address text, lat double precision, lng double precision, last_used timestamptz, uses bigint)
language sql
stable
set search_path = public, extensions
as $$
  with q as (select replace(replace(replace(lower(trim(p_text)), '\', '\\'), '%', '\%'), '_', '\_') as e),
  used as (
    select s.place_name as name, s.address, s.lat, s.lng, t.start_at as at
    from public.task_stops s join public.tasks t on t.id = s.task_id, q
    where s.place_id is null and s.status <> 'removed' and t.start_at >= p_since and s.place_name ilike '%' || q.e || '%'
    union all
    select t.start_name, null, t.start_lat, t.start_lng, t.start_at
    from public.tasks t, q
    where t.start_place_id is null and t.start_name is not null and t.start_at >= p_since and t.start_name ilike '%' || q.e || '%'
    union all
    select r.route_from, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_from ilike '%' || q.e || '%'
    union all
    select r.route_to, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r, q
    where r.created_at >= p_since and r.route_to ilike '%' || q.e || '%'
  ),
  grouped as (
    select lower(trim(u.name)) as k,
           (array_agg(trim(u.name) order by (u.lat is null), u.at desc))[1] as name,
           (array_agg(u.address order by (u.address is null), u.at desc))[1] as address,
           (array_agg(u.lat order by (u.lat is null), u.at desc))[1] as lat,
           (array_agg(u.lng order by (u.lat is null), u.at desc))[1] as lng,
           max(u.at) as last_used,
           count(*) as uses
    from used u
    where trim(coalesce(u.name, '')) <> ''
    group by lower(trim(u.name))
  )
  select g.name, g.address, g.lat, g.lng, g.last_used, g.uses
  from grouped g, q
  -- not the name of one of our places (those show in the first layer)
  where not exists (select 1 from public.places p where lower(p.name) = g.k)
  order by (g.k like q.e || '%') desc, g.uses desc, g.last_used desc
  limit greatest(1, least(p_limit, 20))
$$;

-- 5. The import (docs/phase6-plan.md 8.3) ---------------------------------------------
create function public.import_place_rows(p_rows jsonb, p_preset text)
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
  v_place    public.places%rowtype;
  v_owner    public.places%rowtype;
  v_metres   double precision;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_attached integer := 0;
  v_same     integer := 0;
  v_no_pin   integer := 0;
  v_skipped  jsonb := '[]'::jsonb;
begin
  if p_preset not in ('dialog', 'mobitel_4g', 'mobitel_ep', 'claude', 'manual') then
    raise exception 'Unknown preset %', p_preset;
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

    if v_op not in ('dialog', 'mobitel', 'other') then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', format('unknown operator %s', v_op));
      continue;
    end if;
    if v_id is null and v_lat is null and v_name is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'no id, no coordinates and no name');
      continue;
    end if;

    -- Mobitel EP: the id joins the Mobitel place within 100 m, else it is a place of its own.
    if p_preset = 'mobitel_ep' then
      if v_id is null or v_lat is null then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'an EP row needs an id and coordinates');
        continue;
      end if;
      select * into v_place from public.places p where p.operator = 'mobitel' and (p.site_id = v_id or v_id = any(p.other_ids)) limit 1;
      if found then
        if v_place.lat is null then
          update public.places set lat = v_lat, lng = v_lng, pin_source = p_preset, imported_at = now() where id = v_place.id;
          v_updated := v_updated + 1;
        else
          v_same := v_same + 1; -- already a site id or an other id of a Mobitel place
        end if;
        continue;
      end if;
      select p.* into v_place from public.places p
      where p.operator = 'mobitel' and p.lat between v_lat - 0.0015 and v_lat + 0.0015 and p.lng between v_lng - 0.0015 and v_lng + 0.0015
      order by power(p.lat - v_lat, 2) + power((p.lng - v_lng) * cos(radians(v_lat)), 2)
      limit 1;
      v_metres := case when found then 111320 * sqrt(power(v_place.lat - v_lat, 2) + power((v_place.lng - v_lng) * cos(radians(v_lat)), 2)) end;
      if v_metres is not null and v_metres <= 100 then
        update public.places set other_ids = array(select distinct x from unnest(other_ids || v_id) as t(x) order by x), imported_at = now()
        where id = v_place.id;
        v_attached := v_attached + 1;
      else
        insert into public.places (name, kind, operator, site_id, lat, lng, source, pin_source, imported_at)
        values (v_id, 'site', 'mobitel', v_id, v_lat, v_lng, p_preset, p_preset, now());
        v_added := v_added + 1;
      end if;
      continue;
    end if;

    -- The key: the id, else the coordinates (Mobitel), else the name (a place with neither).
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
      update public.places set
        name        = coalesce(v_name, name),
        region      = coalesce(v_region, region),
        district    = coalesce(v_district, district),
        depot       = coalesce(v_depot, depot),
        other_ids   = array(select distinct x from unnest(other_ids || v_others) as t(x) order by x),
        lat         = case when v_lat is not null and (lat is null or pin_source = p_preset) then v_lat else lat end,
        lng         = case when v_lat is not null and (lat is null or pin_source = p_preset) then v_lng else lng end,
        pin_source  = case when v_lat is not null and (lat is null or pin_source = p_preset) then p_preset else pin_source end,
        imported_at = now()
      where id = v_place.id;
      v_updated := v_updated + 1;
    else
      insert into public.places (name, kind, operator, site_id, other_ids, region, district, depot, lat, lng, source, pin_source, imported_at)
      values (coalesce(v_name, v_id), 'site', v_op, v_id, v_others, v_region, v_district, v_depot, v_lat, v_lng, p_preset,
              case when v_lat is not null then p_preset end, now());
      v_added := v_added + 1;
      if v_lat is null then
        v_no_pin := v_no_pin + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'attached', v_attached, 'unchanged', v_same, 'no_pin', v_no_pin, 'skipped', v_skipped);
end;
$$;

revoke all on function public.search_places_ranked(text, integer) from public, anon, authenticated;
revoke all on function public.recent_places(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.import_place_rows(jsonb, text) from public, anon, authenticated;
grant execute on function public.search_places_ranked(text, integer) to service_role;
grant execute on function public.recent_places(text, timestamptz, integer) to service_role;
grant execute on function public.import_place_rows(jsonb, text) to service_role;

-- 6. The map search's cache (service role only) -----------------------------------------
create table public.geocode_cache (
  provider   text not null,
  query      text not null,
  answer     jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (provider, query)
);
alter table public.geocode_cache enable row level security;
comment on table public.geocode_cache is 'The location search box''s public-place answers per normalised text, kept 30 days (pruned nightly).';

select cron.schedule('prune-geocode-cache', '30 21 * * *', $$delete from public.geocode_cache where fetched_at < now() - interval '30 days'$$);

-- 7. The daily cap of the map search ---------------------------------------------------
insert into public.fleet_settings (key, value, updated_by) values ('ors_autocomplete_daily_cap', '1000'::jsonb, 'migration')
on conflict (key) do nothing;
