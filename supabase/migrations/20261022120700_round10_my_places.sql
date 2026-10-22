-- Round 4–7, item 10 (Sahan, 22 October 2026): per person, not shared (Uber / Google Maps / Uber for Business). The place
-- suggestions showed the WHOLE company's history to everyone (recent_places read every trip and request). Now a person's
-- "Recent" is only their own: the stops of trips they asked for, assigned, booked, ride in as a passenger, and (a driver)
-- drove, personal trips included, the last 90 days, ranked by how often and how lately. The company's saved places stay
-- shared ("Saved"). One person's destinations and a driver's personal trips never reach another person's suggestions.

-- p_personal false: the person's places as shown to someone else editing their trip (approve / assign_tasks): never their
-- personal trips.
create function public.my_recent_places(p_employee uuid, p_text text, p_since timestamptz, p_limit integer default 5,
                                        p_personal boolean default true)
returns table (name text, address text, lat double precision, lng double precision, last_used timestamptz, uses bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select replace(replace(replace(lower(trim(coalesce(p_text, ''))), '\', '\\'), '%', '\%'), '_', '\_') as e),
  mine as (
    -- The trips the person is in: drove or holds (a personal trip only then), assigned, asked for, rides in.
    select t.* from public.tasks t
    where t.start_at >= p_since and not t.demo and t.status <> 'cancelled'
      and (
        (t.employee_id = p_employee and (p_personal or t.purpose is distinct from 'personal'))
        or (t.purpose <> 'personal' and (
              t.assigned_by_employee_id = p_employee
              or exists (select 1 from public.vehicle_requests r where r.id = t.request_id and r.requested_by_employee_id = p_employee)
              or exists (select 1 from public.task_passengers x where x.task_id = t.id and x.employee_id = p_employee and x.removed_at is null)))
      )
  ),
  used as (
    select s.place_name as name, s.address, s.lat, s.lng, m.start_at as at
    from mine m join public.task_stops s on s.task_id = m.id, q
    where s.place_id is null and s.google_place_id is null and s.status <> 'removed'
      and s.place_name ilike '%' || q.e || '%'
    union all
    select m.start_name, null, m.start_lat, m.start_lng, m.start_at
    from mine m, q
    where m.start_place_id is null and m.start_google_place_id is null and m.start_name is not null
      and m.start_name ilike '%' || q.e || '%'
    -- Their own requests, before or without a task: the From and To they typed.
    union all
    select x.place, null, null::double precision, null::double precision, r.created_at
    from public.vehicle_requests r
    cross join lateral (values (r.route_from), (r.route_to)) as x(place), q
    where r.requested_by_employee_id = p_employee and r.created_at >= p_since
      and x.place ilike '%' || q.e || '%'
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
  -- not one of the company's saved places (those are "Saved")
  where not exists (select 1 from public.places p where lower(p.name) = g.k)
  order by (g.k like q.e || '%') desc, g.uses desc, g.last_used desc
  limit greatest(1, least(p_limit, 20))
$$;
revoke all on function public.my_recent_places(uuid, text, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.my_recent_places(uuid, text, timestamptz, integer, boolean) to service_role;
comment on function public.my_recent_places(uuid, text, timestamptz, integer, boolean) is
  'Round 4–7 (item 10): one person''s own recent places (never another''s); the office''s search_places and driver-api.';

-- The company-wide history is no longer read by anyone: kept for the record, callable only by the service role.
revoke all on function public.recent_places(text, timestamptz, integer) from public, anon, authenticated;
