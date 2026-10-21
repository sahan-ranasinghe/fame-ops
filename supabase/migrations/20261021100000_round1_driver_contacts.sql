-- Round 1 (21 October 2026, the boss's review): the driver's Me showed "Call fleet admin" for every active person with the
-- approve permission and a phone, so an admin account that is not the fleet admin showed too (twice "Call fleet admin").
-- Now an explicit choice: each office person has "Show as a contact for drivers" (employees.driver_contact, set in Users
-- and in the app's Office users screen through update_office_user). Me lists only those people, each once, with
-- `fleet_admin` true only for a contact who has the approve permission (the app then says "Fleet admin", else "Office").
-- No contact chosen: only the office's number. A task's fallback ("the approvers" when its approver has no number) is
-- the chosen contacts who approve.

alter table public.employees add column if not exists driver_contact boolean not null default false;
comment on column public.employees.driver_contact is
  'Shown to drivers as a contact (Me: name, Call, WhatsApp). Office people only; set by update_office_user.';

-- Palitha (the fleet admin) is the contact to start with, when his account exists.
update public.employees
   set driver_contact = true
 where active and role <> 'driver' and name ilike 'Palitha%';

create or replace function public.my_office_contacts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver' and e.active) then
    return null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'office_phone', (select value #>> '{}' from public.fleet_settings where key = 'office_phone'),
    -- Round 1: the chosen contacts, each person once.
    'contacts', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone, 'fleet_admin', 'approve' = any (e.permissions))
                                  order by ('approve' = any (e.permissions)) desc, e.name)
                 from public.employees e
                 where e.active and e.driver_contact and e.phone is not null and e.role <> 'driver'),
    -- The app before Round 1 reads this one and calls everyone in it "fleet admin": only the chosen contacts who approve.
    'approvers', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone) order by e.name)
                  from public.employees e
                  where e.active and e.driver_contact and e.phone is not null and e.role <> 'driver'
                    and 'approve' = any (e.permissions))
  ));
end;
$$;
revoke all on function public.my_office_contacts() from public, anon;
grant execute on function public.my_office_contacts() to authenticated;

create or replace function public.my_task_contacts(p_task uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_req  public.vehicle_requests%rowtype;
  v_ask  jsonb;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found or v_me is null or v_task.employee_id <> v_me then
    return null;
  end if;
  if v_task.request_id is not null then
    select * into v_req from public.vehicle_requests where id = v_task.request_id;
    v_ask := case
      when v_req.requested_by_employee_id is not null then
        (select jsonb_build_object('name', coalesce(v_req.on_behalf_of, e.name), 'phone', coalesce(v_req.requester_phone, e.phone))
         from public.employees e where e.id = v_req.requested_by_employee_id)
      else jsonb_build_object('name', coalesce(v_req.on_behalf_of, v_req.requested_by_name), 'phone', v_req.requester_phone)
    end;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'requester', v_ask,
    'assigner', (select jsonb_build_object('name', e.name, 'phone', e.phone) from public.employees e where e.id = v_task.assigned_by_employee_id),
    'approver', (select jsonb_build_object('name', e.name, 'phone', e.phone, 'at', v_task.approved_at)
                 from public.employees e where e.id = v_task.approved_by_employee_id),
    -- Who to call when the approver has no number (or none is named): the chosen contacts who approve (Round 1).
    'approvers', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone) order by e.name)
                  from public.employees e
                  where e.active and e.driver_contact and e.phone is not null and e.role <> 'driver'
                    and 'approve' = any (e.permissions)),
    'office_phone', (select value #>> '{}' from public.fleet_settings where key = 'office_phone')
  ));
end;
$$;
revoke all on function public.my_task_contacts(uuid) from public, anon;
grant execute on function public.my_task_contacts(uuid) to authenticated;
