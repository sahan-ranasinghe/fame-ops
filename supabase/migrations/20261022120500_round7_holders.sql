-- Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle (Google Calendar's room booking:
-- who holds it, their photo and the time, "propose a new time"; its resource view; Airbnb's host to contact). Never blocks.
--   - The busy warning names the holder (the tools: holders.ts) and offers "Ask for it": holder_asks, one row per ask; the
--     holder answers Yes or No in one tap from the notification centre (office_inbox.actions: the buttons, each a tool
--     call); the fleet admins see the ask and can reassign.
--   - A task's driver or vehicle changes: the person who assigned a task made directly (no request) is told in plain words
--     too, by the tools, which know who made the change (the requester, the custodian, the passengers and the driver
--     already are).
-- The switch holder_contact (Settings → Dispatch) hides the holder and Ask for it; asks already made stay.

create table public.holder_asks (
  id            uuid primary key default gen_random_uuid(),
  -- The trip that holds the driver or the vehicle, and which of the two is asked for.
  task_id       uuid not null references public.tasks (id),
  resource      text not null,
  resource_id   uuid not null,
  asked_by      uuid not null references public.employees (id),
  holder_id     uuid references public.employees (id),
  -- What it is wanted for: a window (and the trip being planned, when it exists).
  wanted_from   timestamptz not null,
  wanted_to     timestamptz,
  for_task_id   uuid references public.tasks (id),
  for_request_id uuid references public.vehicle_requests (id),
  note          text,
  answer        text,
  answered_by   uuid references public.employees (id),
  answered_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint holder_asks_resource_check check (resource in ('driver', 'vehicle')),
  constraint holder_asks_answer_check check (answer is null or answer in ('yes', 'no')),
  constraint holder_asks_answered check ((answer is null) = (answered_at is null)),
  constraint holder_asks_note_check check (note is null or length(note) <= 300)
);
create index holder_asks_holder_idx on public.holder_asks (holder_id, created_at desc);
create index holder_asks_asker_idx on public.holder_asks (asked_by, created_at desc);
create index holder_asks_task_idx on public.holder_asks (task_id);
comment on table public.holder_asks is
  'Round 4–7 (7): "Ask for it": someone asks the holder of a busy driver or vehicle; the holder answers yes or no.';
alter table public.holder_asks enable row level security;
-- The office reads and writes through the tools (service role).

-- The notification centre's buttons: [{label, tool, args}] (Yes / No of an ask), shown on the item; nothing else changes.
alter table public.office_inbox add column actions jsonb;
alter table public.office_inbox add constraint office_inbox_actions_check
  check (actions is null or (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 3));
comment on column public.office_inbox.actions is
  'Round 4–7 (7): the item''s buttons, each a tool call ({label, tool, args}); e.g. Yes / No of an Ask for it.';

-- queue_notification as in Round 2b, with the payload's actions on the person's notification centre item.
create or replace function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_phones integer := 0;
  v_actions jsonb := case when jsonb_typeof(p_payload -> 'actions') = 'array' then p_payload -> 'actions' end;
begin
  if p_event is null or p_payload is null or coalesce(array_length(p_recipients, 1), 0) = 0 then
    return 0;
  end if;
  -- Part 6: the reviewers' demo stays out of the office's notifications.
  if (p_payload ->> 'task_id') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.tasks t where t.id = (p_payload ->> 'task_id')::uuid and t.demo) then
    return 0;
  end if;
  if (p_payload ->> 'tag') ~ '^vehicle-needed:[0-9a-f-]{36}$'
     and exists (select 1 from public.vehicle_reports r
                 where r.id = split_part(p_payload ->> 'tag', ':', 2)::uuid and r.demo) then
    return 0;
  end if;
  -- Hotfix 2 (A): everyone told has it in their notification centre, with or without a browser for Web Push.
  insert into public.office_inbox (employee_id, event, title, body, url, who, actions)
  select r.id, p_event, coalesce(nullif(p_payload ->> 'title', ''), p_event), p_payload ->> 'body', p_payload ->> 'url',
         p_payload ->> 'who', v_actions
  from (select distinct unnest(p_recipients) as id) r
  join public.employees e on e.id = r.id
  where e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
    and not exists (select 1 from public.notification_settings s
                    where s.employee_id = r.id and s.event = p_event and not s.enabled);
  -- The Web Push outbox, as before: only for a browser that has it on.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id)
    select p_event, p_payload, r.id
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.web_push_subscriptions w
                  where w.employee_id = r.id and w.removed_at is null)
    returning 1
  )
  select count(*) into v_count from ins;
  -- Phase 8 (O1 item 9): the phone, for an office person whose app registered a token.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id, channel)
    select p_event, p_payload, r.id, 'expo_push'
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.device_tokens d where d.employee_id = r.id)
    returning 1
  )
  select count(*) into v_phones from ins;
  return v_count + v_phones;
end;
$$;
