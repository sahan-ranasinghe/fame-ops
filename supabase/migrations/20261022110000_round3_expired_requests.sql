-- Round 3, Part A 6 (Sahan, 21 October 2026): a request still waiting when its trip day is over becomes "Expired" by
-- itself: out of the waiting lists and counts (they read status 'waiting'), its request_waiting issue resolves at the next
-- sync, the person who asked is told once (the request.decided notice they already follow), and its page offers "Request
-- again" (the clients copy it into a new request). A changed booking (approved, its change waiting) is not a waiting
-- request and never expires.

alter table public.vehicle_requests add column expired_at timestamptz;
comment on column public.vehicle_requests.expired_at is 'When a request still waiting after its trip day was marked expired (Round 3)';

alter table public.vehicle_requests drop constraint vehicle_requests_status_check;
alter table public.vehicle_requests add constraint vehicle_requests_status_check
  check (status in ('waiting', 'approved', 'changed', 'declined', 'cancelled', 'expired'));
alter table public.vehicle_requests add constraint vehicle_requests_expired_check
  check ((status = 'expired') = (expired_at is not null));
-- Nobody decided an expired request: like a waiting one it has no decided_at (the schema's rule said only waiting).
alter table public.vehicle_requests drop constraint vehicle_requests_decided_at_check;
alter table public.vehicle_requests add constraint vehicle_requests_decided_at_check
  check ((status in ('waiting', 'expired')) = (decided_at is null));

alter table public.request_events drop constraint request_events_action_check;
alter table public.request_events add constraint request_events_action_check
  check (action in ('created', 'seen', 'edited', 'approved', 'declined', 'changed', 'redecided', 'postponed', 'cancelled', 'expired'));

-- Every request still waiting whose day (Colombo) is over. Answers how many expired.
create function public.expire_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
  v_day text;
begin
  for r in
    update public.vehicle_requests q
       set status = 'expired', expired_at = now(), version = q.version + 1
     where q.status = 'waiting'
       and (coalesce(q.leave_by, q.needed_at) at time zone 'Asia/Colombo')::date < (now() at time zone 'Asia/Colombo')::date
    returning q.*
  loop
    insert into public.request_events (request_id, at, action, actor, note)
    values (r.id, now(), 'expired', 'Fame Fleet', 'Nobody decided it before its day was over');
    v_day := to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'Dy FMDD Mon');
    if r.requested_by_employee_id is not null then
      perform public.queue_notification('request.decided',
        jsonb_build_object(
          'title', case when r.kind = 'task' then 'Your task expired · ' else 'Your request expired · ' end || v_day,
          'body', 'Nobody decided it before its day was over. Open it to request again.',
          'url', '/requests/' || r.id::text, 'tag', 'request:' || r.id::text, 'request_id', r.id),
        array[r.requested_by_employee_id]);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.expire_requests() from public, anon, authenticated;
grant execute on function public.expire_requests() to service_role;

-- Requests already past their day when this arrives expire quietly (no burst of notices for old ones); from now on each
-- one is told.
with old as (
  update public.vehicle_requests q
     set status = 'expired', expired_at = now(), version = q.version + 1
   where q.status = 'waiting'
     and (coalesce(q.leave_by, q.needed_at) at time zone 'Asia/Colombo')::date < (now() at time zone 'Asia/Colombo')::date
  returning q.id
)
insert into public.request_events (request_id, at, action, actor, note)
select id, now(), 'expired', 'Fame Fleet', 'Nobody decided it before its day was over' from old;

select cron.schedule('expire-requests', '*/15 * * * *', $$select public.expire_requests()$$);

-- The approvers' "leave-by passed" notice (phase7_approval.sql) said it stays waiting until someone decides it; now it
-- expires at the end of its day. The function as it was, with that one sentence changed.
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
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') else 'Vehicle request · ' || r.requested_by_name end;
    v_when := to_char(coalesce(r.leave_by, r.needed_at) at time zone 'Asia/Colombo', 'HH24:MI');
    perform public.queue_notification('request.not_decided',
      jsonb_build_object('title', 'Not decided yet: ' || v_what || ' leaves ' || v_when,
                         'body', case when r.kind = 'task' then 'Proposed by ' || r.requested_by_name else coalesce(r.route_from || ' → ' || r.route_to, '') end,
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
    v_what := case when r.kind = 'task' then coalesce(r.title, 'Task') else 'Vehicle request · ' || r.requested_by_name end;
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
revoke all on function public.queue_request_reminders() from public, anon, authenticated;
