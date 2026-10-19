-- =============================================================================
-- Phase 8, O1 item 9 (Sahan, 19 October 2026; behind his go): the office's notifications also reach the phone.
--
--   notifications.channel    'expo_push' beside 'web_push' and 'email': one outbox row per recipient per channel.
--   queue_notification       as before (the notification centre row for everyone told; the Web Push row for a browser
--                            that has it on), plus an 'expo_push' row for an office person whose phone registered a
--                            device token (device_tokens: register_device_token takes any signed-in employee since
--                            Phase A2; the office app registers at sign-in and removes it at sign-out). The event's
--                            on/off per person applies to both channels alike. notify-office delivers it through Expo
--                            on the Part 6 channels (urgent and alarm loud on task-ring, the rest on task-updates).
--   The custodian case (docs/phase8-plan.md section 10): a task whose employee is an office person never gets the
--   driver's task pushes once they hold a token: push-task checks the role (function code), not this migration.
-- =============================================================================

alter table public.notifications drop constraint if exists notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check check (channel in ('web_push', 'email', 'expo_push'));

create or replace function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_phones integer := 0;
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
  insert into public.office_inbox (employee_id, event, title, body, url, who)
  select r.id, p_event, coalesce(nullif(p_payload ->> 'title', ''), p_event), p_payload ->> 'body', p_payload ->> 'url',
         p_payload ->> 'who'
  from (select distinct unnest(p_recipients) as id) r
  join public.employees e on e.id = r.id
  where e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
    and not exists (select 1 from public.notification_settings s
                    where s.employee_id = r.id and s.event = p_event and not s.enabled);
  -- The Web Push outbox, as before: only for a browser that has it on.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id)
    select p_event, p_payload, r.id
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
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
      and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.device_tokens d where d.employee_id = r.id)
    returning 1
  )
  select count(*) into v_phones from ins;
  return v_count + v_phones;
end;
$$;
