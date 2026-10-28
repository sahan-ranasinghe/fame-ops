-- Round 48 (28 October 2026), item 1: the approval queue covers every change to a task's driver, vehicle or time.
--
-- Before: only create_task went to the fleet admin while tasks_need_approval is on (Phase 7 §33). A dispatcher (assign_tasks
-- without approve) could still reassign a declined task, change a task's time, driver or vehicle, or change its stops, and
-- the driver got it straight away. Now such a change made by someone without approve is a request of kind 'change': it
-- names the task it changes (change_task_id), carries the exact change in proposal_json, waits in the same queue as a
-- proposed task, and the task stays as it is until an approver decides it (decide_request approve applies the change as the
-- approver; decline leaves the task alone). One waiting change per task.
alter table public.vehicle_requests drop constraint vehicle_requests_kind_check;
alter table public.vehicle_requests add constraint vehicle_requests_kind_check check (kind in ('request', 'task', 'change'));
alter table public.vehicle_requests add column change_task_id uuid references public.tasks (id);
-- One waiting change per task, kept by the database (two proposals sent at once: the second is refused).
create unique index vehicle_requests_change_waiting on public.vehicle_requests (change_task_id) where kind = 'change' and status = 'waiting';
comment on column public.vehicle_requests.change_task_id is
  'kind change: the task this proposed change applies to (the task is untouched until an approver approves the change)';

-- The reminders to the approvers (30 minutes before an undecided leave-by, once when it passes) name a proposed change as
-- "Task change · <title>", proposed by the person; the function is the Round 3 one with those words added.
create or replace function public.queue_request_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_n        integer := 0;
  v_what     text;
  v_when     text;
  v_approve  uuid[] := public.approve_recipients();
begin
  -- 30 minutes before the leave-by, once: the approvers and the person who asked.
  for r in
    update public.vehicle_requests q
       set decide_reminder_sent_at = now()
     where q.status = 'waiting' and q.decide_reminder_sent_at is null
       and q.needed_at > now() and q.needed_at <= now() + interval '30 minutes'
    returning q.*
  loop
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') when r.kind = 'change' then 'Task change · ' || coalesce(r.title, 'a task') else 'Vehicle request · ' || r.requested_by_name end;
    v_when := to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'HH24:MI');
    perform public.queue_notification('request.not_decided',
      jsonb_build_object('title', 'Not decided yet: ' || v_what || ' leaves ' || v_when,
                         'body', case when r.kind in ('task', 'change') then 'Proposed by ' || r.requested_by_name else coalesce(r.route_from || ' → ' || r.route_to, '') end,
                         'url', '/requests/' || r.id::text || '/decide', 'tag', 'request:' || r.id::text, 'request_id', r.id),
      array(select x from unnest(v_approve) x where x is distinct from r.requested_by_employee_id));
    if r.requested_by_employee_id is not null then
      perform public.queue_notification('request.not_decided',
        jsonb_build_object('title', 'Not decided yet: ' || v_what || ' leaves ' || v_when,
                           'body', 'The fleet admin has been reminded.',
                           'url', '/requests/' || r.id::text, 'tag', 'request:' || r.id::text, 'request_id', r.id),
        array[r.requested_by_employee_id]);
    end if;
    v_n := v_n + 1;
  end loop;

  -- The leave-by passed undecided, once: the approvers. It stays in the queue until the end of its day, then expires.
  for r in
    update public.vehicle_requests q
       set late_push_sent_at = now()
     where q.status = 'waiting' and q.late_push_sent_at is null
       and q.needed_at <= now() and q.needed_at > now() - interval '2 hours'
    returning q.*
  loop
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') when r.kind = 'change' then 'Task change · ' || coalesce(r.title, 'a task') else 'Vehicle request · ' || r.requested_by_name end;
    perform public.queue_notification('request.late',
      jsonb_build_object('title', 'Leave-by passed, not decided: ' || v_what,
                         'body', 'It was to leave at ' || to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'HH24:MI') ||
                                 '. It expires at the end of its day if nobody decides it.',
                         'url', '/requests/' || r.id::text || '/decide', 'tag', 'request:' || r.id::text, 'request_id', r.id),
      v_approve);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
