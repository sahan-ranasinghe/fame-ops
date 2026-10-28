-- Round 48, item 6 (cost controls): the Gemini odometer reads get the same gate as the Google calls.
--
-- Before this, read-odometer counted a driver's reads by counting odometer_reads rows AFTER the model call,
-- so a count that could not be read let the call through (null → 0: fail open), two calls at once both passed
-- the 60th, and the server's own checks (pg_cron check-odometer-photos) had no cap at all.
--
--   odometer_calls                          calls and refusals per Asia/Colombo day, mode (driver | server) and
--                                           scope (the driver's employee id, or 'server' for the job)
--   odometer_take(mode, scope, day_cap)     the one gate, like google_take: under an advisory lock per mode and
--                                           scope, counted BEFORE the call, refused at the day's cap; an error
--                                           reading or writing it makes read-odometer refuse the call (fail closed).
--                                           Service role only.
--
-- The issues centre reads the counters of every capped feature (google_calls, routing_calls, odometer_calls) and
-- opens one warning issue of kind usage_cap per feature, period and day when a counter passes 80 % of its cap
-- (critical at 100 %); issues.kind has no check constraint, so no change here. The cap of the server's reads is
-- the setting odometer_server_daily_cap (500 by default; fleet_settings takes any key).

create table public.odometer_calls (
  day         date not null,
  mode        text not null check (mode in ('driver', 'server')),
  scope       text not null,
  calls       integer not null default 0,
  refused     integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (day, mode, scope)
);
comment on table public.odometer_calls is
  'Gemini odometer reads per Asia/Colombo day, mode and scope (a driver''s id, or server), recorded before each call by odometer_take(); refused = turned away at the cap.';
alter table public.odometer_calls enable row level security;
revoke all on public.odometer_calls from public, anon, authenticated;
grant all on public.odometer_calls to service_role;

create function public.odometer_take(p_mode text, p_scope text, p_day_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day      date := (now() at time zone 'Asia/Colombo')::date;
  v_cap      integer := greatest(0, coalesce(p_day_cap, 0));
  v_used     integer;
begin
  if p_mode not in ('driver', 'server') then
    raise exception 'odometer_take: unknown mode %', p_mode;
  end if;
  if p_scope is null or p_scope = '' then
    raise exception 'odometer_take: a scope is needed';
  end if;
  -- One caller at a time per mode and scope: two photos sent at once cannot both pass the cap.
  perform pg_advisory_xact_lock(hashtext('odometer_take:' || p_mode || ':' || p_scope));
  select coalesce(sum(c.calls), 0) into v_used
    from public.odometer_calls c
   where c.day = v_day and c.mode = p_mode and c.scope = p_scope;
  if v_used >= v_cap then
    insert into public.odometer_calls (day, mode, scope, refused) values (v_day, p_mode, p_scope, 1)
      on conflict (day, mode, scope) do update set refused = public.odometer_calls.refused + 1, updated_at = now();
    return jsonb_build_object('allowed', false, 'reason', 'day', 'day', v_used, 'day_cap', v_cap);
  end if;
  insert into public.odometer_calls (day, mode, scope, calls) values (v_day, p_mode, p_scope, 1)
    on conflict (day, mode, scope) do update set calls = public.odometer_calls.calls + 1, updated_at = now();
  return jsonb_build_object('allowed', true, 'day', v_used + 1, 'day_cap', v_cap);
end;
$$;
revoke all on function public.odometer_take(text, text, integer) from public, anon, authenticated;
grant execute on function public.odometer_take(text, text, integer) to service_role;
