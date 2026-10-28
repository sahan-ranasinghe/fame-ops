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
create index vehicle_requests_change_waiting on public.vehicle_requests (change_task_id) where status = 'waiting';
comment on column public.vehicle_requests.change_task_id is
  'kind change: the task this proposed change applies to (the task is untouched until an approver approves the change)';
