-- The map search's minute counter (Phase 6 Part 4b, bump_minute_calls) ran as its caller, service_role, which has no
-- DELETE on any table (by design since the first migration: the connector reads, inserts and updates, never deletes). Its
-- "keep an hour" delete therefore failed on every call, and with it the whole function. Until Round 48 the place search
-- ignored a counter that could not be read (fail open), so nobody saw it; Round 48 (28 October 2026) made every counter
-- fail closed, and since then every search not already cached answered "Map search paused: the call counter could not
-- be read" with no openrouteservice result (the last call out was on 22 October). Fix (30 October 2026): the function
-- runs as its owner (security definer, the search path empty as before), so the counter keeps its last hour itself;
-- service_role still deletes nothing anywhere else. The other functions with a delete and no definer
-- (prune_location_points, prune_driver_heartbeats, prune_route_matched) run only from pg_cron as their owner.
create or replace function public.bump_minute_calls(p_provider text)
returns integer
language plpgsql
security definer
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
