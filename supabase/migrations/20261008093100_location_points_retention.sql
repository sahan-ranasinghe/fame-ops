-- =============================================================================
-- Retention: location points older than 90 days are removed every night by
-- pg_cron (03:00 Colombo = 21:30 UTC), in batches so the table is never
-- locked for long. driver_latest and the sharing periods (duty_sessions) are
-- kept; only the raw points go.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

create function public.prune_location_points(p_keep_days integer default 90, p_batch integer default 50000)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from public.location_points
    where id in (
      select id from public.location_points
      where recorded_at < now() - make_interval(days => p_keep_days)
      order by id
      limit p_batch
    )
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

comment on function public.prune_location_points is
  'Deletes up to p_batch location points older than p_keep_days. Run nightly by pg_cron (job prune-location-points).';

revoke all on function public.prune_location_points(integer, integer) from public, anon, authenticated;

-- cron.schedule with a job name replaces the job if it already exists.
select cron.schedule('prune-location-points', '30 21 * * *', $$select public.prune_location_points()$$);
