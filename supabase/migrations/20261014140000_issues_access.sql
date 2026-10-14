-- =============================================================================
-- Phase 5, Part 3b (1 of 2): who reads the issues follows the permission table
-- (docs/dispatch-plan.md, 4.1), not the view permission.
--
--   issues permission        every issue
--   assign_tasks permission  the task kinds only (signal, late_start, running_late,
--                            not_accepted, declined)
--   anyone else              nothing: the Issues page is hidden for them, and so is the
--                            table itself (a direct query or the Realtime channel with
--                            their own session returns no rows).
-- issue_events follow their issue. The list of task kinds is TASK_KINDS in
-- supabase/functions/_shared/fleet/issues.ts: keep the two the same.
-- =============================================================================

create function public.issue_visible(p_kind text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.office_can('issues'))
      or (p_kind in ('signal', 'late_start', 'running_late', 'not_accepted', 'declined')
          and (select public.office_can('assign_tasks')))
$$;
revoke all on function public.issue_visible(text) from public, anon;
grant execute on function public.issue_visible(text) to authenticated, service_role;

drop policy issues_select_office on public.issues;
create policy issues_select_office on public.issues
  for select to authenticated
  using (public.issue_visible(kind));

drop policy issue_events_select_office on public.issue_events;
create policy issue_events_select_office on public.issue_events
  for select to authenticated
  using (exists (select 1 from public.issues i where i.id = issue_events.issue_id));
