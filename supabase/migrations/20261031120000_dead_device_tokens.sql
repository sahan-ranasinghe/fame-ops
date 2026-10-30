-- Round 53 (a), 31 October 2026: dead phone tokens are removed. push-task and notify-office deleted the tokens Expo answers
-- DeviceNotRegistered for (the app was uninstalled, or the phone made a new token) with service_role, which deletes
-- nothing by design (the first migration; access_rules checks it), and nobody read the error: a dead token stayed and was
-- sent to on every push. This function is the one way to remove them: it runs as its owner, only service_role may call it,
-- and it removes only the rows named. It answers how many it removed.

create or replace function public.remove_dead_device_tokens(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 100 then
    raise exception 'too_many_tokens' using errcode = '22023';
  end if;
  delete from public.device_tokens where id = any (p_ids);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.remove_dead_device_tokens(uuid[]) from public, anon, authenticated;
grant execute on function public.remove_dead_device_tokens(uuid[]) to service_role;

comment on function public.remove_dead_device_tokens(uuid[]) is
  'Round 53: push-task and notify-office remove the tokens Expo reported DeviceNotRegistered (service_role deletes nothing itself).';
