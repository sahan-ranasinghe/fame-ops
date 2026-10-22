-- Round 4–7, feature 5 (Sahan, 22 October 2026): the fuel card at Start task, advisory, never blocking (Google Maps' fuel
-- estimate, Samsara / Fleetio's fuel plan, Uber's trip info card). "About 180 km · roughly 12–15 L petrol (approx.)" and
-- "Enough fuel?" Yes / I'll fill up on the way (the app reminds the driver to Log fuel). Vehicles get a fuel type and an
-- optional grade (the forms require the type; existing vehicles say "Fuel type: not set" until filled); Log fuel
-- preselects the vehicle's. km per litre from the vehicle's last 3 fills with an odometer (tank to tank), else a default by
-- vehicle type and fuel type; electric: the km and "check the battery". The office sees the answer on the task. The switch
-- fuel_card (Settings → Dispatch) hides the card; the fuel type stays.

alter table public.vehicles
  add column fuel_type text,
  add column fuel_grade text;
alter table public.vehicles add constraint vehicles_fuel_type_check
  check (fuel_type is null or fuel_type in ('petrol', 'diesel', 'hybrid', 'electric'));
-- Petrol and a hybrid (petrol) take a petrol grade, diesel a diesel one, electric none.
alter table public.vehicles add constraint vehicles_fuel_grade_check check (
  fuel_grade is null
  or (fuel_type in ('petrol', 'hybrid') and fuel_grade in ('petrol_92', 'petrol_95'))
  or (fuel_type = 'diesel' and fuel_grade in ('auto_diesel', 'super_diesel'))
);
comment on column public.vehicles.fuel_type is 'Round 4–7 (5): petrol, diesel, hybrid (petrol) or electric; null = not set yet.';
comment on column public.vehicles.fuel_grade is 'Round 4–7 (5): petrol_92, petrol_95, auto_diesel or super_diesel (optional).';
-- The driver app reads both (its one list of vehicle columns).
grant select (fuel_type, fuel_grade) on public.vehicles to authenticated;

-- What was filled (the driver's Log fuel preselects the vehicle's; a hybrid fills petrol).
alter table public.fuel_logs
  add column fuel_type text,
  add column fuel_grade text;
alter table public.fuel_logs add constraint fuel_logs_fuel_type_check check (fuel_type is null or fuel_type in ('petrol', 'diesel'));
alter table public.fuel_logs add constraint fuel_logs_fuel_grade_check check (
  fuel_grade is null
  or (fuel_type = 'petrol' and fuel_grade in ('petrol_92', 'petrol_95'))
  or (fuel_type = 'diesel' and fuel_grade in ('auto_diesel', 'super_diesel'))
);

-- The driver's answer at Start task.
alter table public.tasks
  add column fuel_answer text,
  add column fuel_answer_at timestamptz;
alter table public.tasks add constraint tasks_fuel_answer_check check (fuel_answer is null or fuel_answer in ('enough', 'fill_on_way'));
comment on column public.tasks.fuel_answer is 'Round 4–7 (5): the driver''s "Enough fuel?" at Start task: enough or fill_on_way.';

-- The default km per litre by vehicle type and fuel type, until the vehicle has fills of its own.
create function public.fuel_default_km_per_l(p_type text, p_fuel text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_type, 'other')
    when 'car'        then case p_fuel when 'diesel' then 15 when 'hybrid' then 20 else 12 end
    when 'van'        then case p_fuel when 'diesel' then 10 when 'hybrid' then 12 else 8 end
    when 'double_cab' then case p_fuel when 'diesel' then 10 when 'hybrid' then 12 else 8 end
    when 'lorry'      then case p_fuel when 'diesel' then 6 when 'hybrid' then 7 else 5 end
    else                   case p_fuel when 'diesel' then 11 when 'hybrid' then 14 else 10 end
  end::numeric
$$;

revoke all on function public.fuel_default_km_per_l(text, text) from public, anon, authenticated;

-- The estimate for a task: its planned km, the vehicle's km per litre and the litres as a range (±10 %). The task's own
-- driver, or the office's tools (service role). Answers null when the task is not theirs.
create function public.fuel_estimate(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t        public.tasks%rowtype;
  v        public.vehicles%rowtype;
  v_km     numeric;
  v_kmpl   numeric;
  v_source text := 'default';
  v_span   numeric;
  v_litres numeric;
  v_n      integer;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then
    return null;
  end if;
  -- A signed-in caller (the app: the request's role is authenticated) reads only their own task; the office's tools run as
  -- the service role. (Inside a security definer function current_user is the owner, so the request's claims say who.)
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'authenticated'
     and t.employee_id is distinct from public.current_employee_id() then
    return null;
  end if;
  select * into v from public.vehicles where id = t.vehicle_id;
  -- The plan's km (with the drive back when the trip returns), else its legs added up.
  v_km := coalesce((t.plan_json ->> 'total_km')::numeric,
                   (select sum((l ->> 'km')::numeric) from jsonb_array_elements(coalesce(t.plan_json -> 'legs', '[]'::jsonb)) l));
  if v.id is not null and coalesce(v.fuel_type, '') <> 'electric' then
    -- Tank to tank over the last 3 fills with an odometer: the km between the first and the last, over the litres put in
    -- after the first.
    with f as (
      select x.odometer_km, x.litres, row_number() over (order by x.logged_at desc) as rn
      from public.fuel_logs x
      where x.vehicle_id = v.id and x.odometer_km is not null and x.litres is not null and not x.demo
      order by x.logged_at desc
      limit 3
    )
    select count(*), max(odometer_km) - min(odometer_km),
           sum(litres) filter (where rn < (select max(rn) from f))
      into v_n, v_span, v_litres
    from f;
    if v_n >= 2 and v_litres > 0 and v_span > 0 and v_span / v_litres between 2 and 40 then
      v_kmpl := round(v_span / v_litres, 1);
      v_source := 'history';
    end if;
  end if;
  if v_kmpl is null then
    v_kmpl := public.fuel_default_km_per_l(v.vehicle_type, v.fuel_type);
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'task_id', t.id,
    'km', case when v_km is null then null else round(v_km) end,
    'fuel_type', v.fuel_type,
    'fuel_grade', v.fuel_grade,
    'electric', coalesce(v.fuel_type = 'electric', false),
    'km_per_l', case when v.fuel_type = 'electric' then null else v_kmpl end,
    'source', case when v.fuel_type = 'electric' then null else v_source end,
    'litres_low', case when v_km is null or v.fuel_type = 'electric' then null
                       else greatest(1, floor(v_km / (v_kmpl * 1.1))) end,
    'litres_high', case when v_km is null or v.fuel_type = 'electric' then null
                        else greatest(1, ceil(v_km / (v_kmpl * 0.9))) end,
    'answer', t.fuel_answer,
    'answered_at', t.fuel_answer_at));
end;
$$;
revoke all on function public.fuel_estimate(uuid) from public, anon;
grant execute on function public.fuel_estimate(uuid) to authenticated, service_role;

-- The driver's answer: only the task's own driver; the latest answer wins. Queued on the phone like every write.
create function public.answer_fuel_card(p_task_id uuid, p_answer text, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_answer not in ('enough', 'fill_on_way') then
    return 'bad';
  end if;
  update public.tasks
     set fuel_answer = p_answer, fuel_answer_at = least(coalesce(p_at, now()), now())
   where id = p_task_id and employee_id = public.current_employee_id();
  if not found then
    return 'not_yours';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.answer_fuel_card(uuid, text, timestamptz) from public, anon;
grant execute on function public.answer_fuel_card(uuid, text, timestamptz) to authenticated;
