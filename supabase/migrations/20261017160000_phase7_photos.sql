-- Phase 7, Part 3: requester updates (item 4), the driver's profile photo (item 5), vehicle photos (item 6) and vehicle
-- documents (item 28). docs/phase7-plan.md §4, §5, §6, §28, §30.
--
-- Photos and documents live in private buckets and are shown only through 1-hour signed links (the office through the
-- tools; the driver app signs its own where a policy lets it read). A driver adds their own profile photo, and a photo
-- of a vehicle that has none; nothing else about vehicles or documents is written by a phone. A driver reads the
-- revenue licence, insurance and emission test of the vehicle they hold (the open assignment) and nothing else. The
-- person who asked for a vehicle hears when the driver is on the way, arrives at the first pickup, changes, or the trip
-- is cancelled. Nothing is deleted: a replaced or removed document is kept, marked.

-- 1. The driver's profile photo (§5) -----------------------------------------------------------------------------------
alter table public.photos drop constraint photos_kind_check;
alter table public.photos add constraint photos_kind_check
  check (kind in ('odometer', 'fuel_receipt', 'vehicle_report', 'bill', 'profile'));

alter table public.employees
  add column photo_id uuid references public.photos (id),
  add column photo_updated_at timestamptz;

-- The driver sets their own photo: a photos row of kind profile, theirs, in their own profile folder.
create function public.set_my_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_employee_id();
  v_photo public.photos%rowtype;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  select * into v_photo from public.photos where id = p_photo_id;
  if not found or v_photo.employee_id <> v_me or v_photo.kind <> 'profile'
     or not starts_with(v_photo.storage_path, v_me::text || '/profile/') then
    return 'not_yours';
  end if;
  update public.employees set photo_id = p_photo_id, photo_updated_at = now() where id = v_me;
  return 'ok';
end;
$$;
revoke all on function public.set_my_photo(uuid) from public, anon;
grant execute on function public.set_my_photo(uuid) to authenticated;

-- The driver reads their own photo id (the Me tab and the first-run step: "Add your photo" until there is one).
grant select (photo_id, photo_updated_at) on public.employees to authenticated;

-- 2. Vehicle photos (§6) -------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.vehicles
  add column photo_path text,
  add column photo_thumb_path text,
  add column photo_updated_at timestamptz;
-- Drivers see a vehicle's photo in the picker and on the task card (their column list grows by these).
grant select (photo_path, photo_thumb_path, photo_updated_at) on public.vehicles to authenticated;

-- Any signed-in driver reads the vehicle photos (the app signs its own links).
create policy vehicle_photos_select_drivers on storage.objects
  for select to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.current_employee_id()) is not null);

-- A driver may add a photo only to an active vehicle that has none: <vehicle_id>/<uuid>.jpg and its thumbnail.
create policy vehicle_photos_insert_when_none on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (select public.current_employee_id()) is not null
    and exists (
      select 1 from public.vehicles v
      where v.id::text = (storage.foldername(name))[1] and v.active and v.photo_path is null
    )
  );

create function public.set_vehicle_photo_from_driver(p_vehicle_id uuid, p_path text, p_thumb_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  if not starts_with(p_path, p_vehicle_id::text || '/') or not starts_with(p_thumb_path, p_vehicle_id::text || '/') then
    return 'not_this_vehicle';
  end if;
  update public.vehicles
     set photo_path = p_path, photo_thumb_path = p_thumb_path, photo_updated_at = now()
   where id = p_vehicle_id and active and photo_path is null;
  if not found then
    return 'has_photo';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.set_vehicle_photo_from_driver(uuid, text, text) from public, anon;
grant execute on function public.set_vehicle_photo_from_driver(uuid, text, text) to authenticated;

-- 3. Vehicle documents (§28) ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-docs', 'vehicle-docs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.vehicle_documents (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles (id),
  kind            text not null check (kind in ('revenue_licence', 'insurance', 'emission', 'registration', 'lease', 'other')),
  name            text check (name is null or btrim(name) <> ''),
  path            text not null,
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  bytes           bigint check (bytes is null or bytes between 1 and 10485760),
  expiry          date,
  uploaded_by     uuid references public.employees (id),
  uploaded_by_name text,
  uploaded_at     timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      text,
  removed_reason  text check (removed_reason is null or removed_reason in ('removed', 'replaced')),
  constraint vehicle_documents_path_check check (starts_with(path, vehicle_id::text || '/' || kind || '/')),
  constraint vehicle_documents_other_named check (kind <> 'other' or name is not null),
  constraint vehicle_documents_removed_together check ((removed_at is null) = (removed_reason is null))
);
create index vehicle_documents_current_idx on public.vehicle_documents (vehicle_id, kind, uploaded_at desc) where removed_at is null;
comment on table public.vehicle_documents is
  'A vehicle''s documents (Phase 7 §28): the current one of a kind is the newest not removed. Office writes go through '
  'the tools; a driver reads the three roadside kinds of the vehicle they hold.';

-- The vehicle a driver holds now: their open assignment (Phase 7 §1).
create function public.my_held_vehicle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.vehicle_id from public.vehicle_assignments a
  where a.employee_id = public.current_employee_id() and a.to_at is null
  limit 1
$$;
revoke all on function public.my_held_vehicle() from public, anon;
grant execute on function public.my_held_vehicle() to authenticated;

alter table public.vehicle_documents enable row level security;
revoke all on public.vehicle_documents from anon, authenticated;
grant select (id, vehicle_id, kind, name, path, content_type, expiry, uploaded_at) on public.vehicle_documents to authenticated;
create policy vehicle_documents_driver_held on public.vehicle_documents
  for select to authenticated
  using (
    vehicle_id = (select public.my_held_vehicle())
    and kind in ('revenue_licence', 'insurance', 'emission')
    and removed_at is null
  );

create policy vehicle_docs_select_held on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-docs'
    and (storage.foldername(name))[1] = (select public.my_held_vehicle())::text
    and (storage.foldername(name))[2] in ('revenue_licence', 'insurance', 'emission')
  );

-- One expiry date, two ways in: the current document's expiry is the vehicle's date, and a date set on the vehicle
-- (update_vehicle, the old artifact) is the current document's. Each side writes only what differs, so they settle.
create function public.vehicle_documents_expiry_to_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.vehicle_documents%rowtype;
begin
  if new.kind not in ('revenue_licence', 'insurance', 'emission', 'lease') then
    return null;
  end if;
  select * into v_current from public.vehicle_documents d
   where d.vehicle_id = new.vehicle_id and d.kind = new.kind and d.removed_at is null
   order by d.uploaded_at desc limit 1;
  if not found or v_current.expiry is null then
    return null;
  end if;
  if new.kind = 'revenue_licence' then
    update public.vehicles set licence_expiry = v_current.expiry where id = new.vehicle_id and licence_expiry is distinct from v_current.expiry;
  elsif new.kind = 'insurance' then
    update public.vehicles set insurance_expiry = v_current.expiry where id = new.vehicle_id and insurance_expiry is distinct from v_current.expiry;
  elsif new.kind = 'emission' then
    update public.vehicles set emission_expiry = v_current.expiry where id = new.vehicle_id and emission_expiry is distinct from v_current.expiry;
  else
    update public.vehicles set rent_until = v_current.expiry where id = new.vehicle_id and rent_until is distinct from v_current.expiry;
  end if;
  return null;
end;
$$;
revoke all on function public.vehicle_documents_expiry_to_vehicle() from public, anon, authenticated;
create trigger vehicle_documents_expiry
  after insert or update of expiry, removed_at on public.vehicle_documents
  for each row execute function public.vehicle_documents_expiry_to_vehicle();

create function public.vehicles_expiry_to_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.licence_expiry is distinct from old.licence_expiry and new.licence_expiry is not null then
    update public.vehicle_documents d set expiry = new.licence_expiry
     where d.id = (select x.id from public.vehicle_documents x where x.vehicle_id = new.id and x.kind = 'revenue_licence'
                    and x.removed_at is null order by x.uploaded_at desc limit 1)
       and d.expiry is distinct from new.licence_expiry;
  end if;
  if new.insurance_expiry is distinct from old.insurance_expiry and new.insurance_expiry is not null then
    update public.vehicle_documents d set expiry = new.insurance_expiry
     where d.id = (select x.id from public.vehicle_documents x where x.vehicle_id = new.id and x.kind = 'insurance'
                    and x.removed_at is null order by x.uploaded_at desc limit 1)
       and d.expiry is distinct from new.insurance_expiry;
  end if;
  if new.emission_expiry is distinct from old.emission_expiry and new.emission_expiry is not null then
    update public.vehicle_documents d set expiry = new.emission_expiry
     where d.id = (select x.id from public.vehicle_documents x where x.vehicle_id = new.id and x.kind = 'emission'
                    and x.removed_at is null order by x.uploaded_at desc limit 1)
       and d.expiry is distinct from new.emission_expiry;
  end if;
  if new.rent_until is distinct from old.rent_until and new.rent_until is not null then
    update public.vehicle_documents d set expiry = new.rent_until
     where d.id = (select x.id from public.vehicle_documents x where x.vehicle_id = new.id and x.kind = 'lease'
                    and x.removed_at is null order by x.uploaded_at desc limit 1)
       and d.expiry is distinct from new.rent_until;
  end if;
  return null;
end;
$$;
revoke all on function public.vehicles_expiry_to_document() from public, anon, authenticated;
create trigger vehicles_expiry_document
  after update of licence_expiry, insurance_expiry, emission_expiry, rent_until on public.vehicles
  for each row execute function public.vehicles_expiry_to_document();

-- 4. Requester updates (§4) ----------------------------------------------------------------------------------------------
alter table public.vehicle_requests
  add column requester_phone text check (requester_phone is null or btrim(requester_phone) <> ''),
  add column arrived_push_sent_at timestamptz;

-- The person who asked (with an office account) hears about their trip. The payload carries the driver's photo and the
-- vehicle's photo as storage paths; notify-office signs them (1 hour) when it sends.
create function public.notify_requester(p_task uuid, p_event text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
begin
  select r.id as request_id, r.requested_by_employee_id as requester, r.status as request_status,
         p.storage_path as driver_photo, veh.photo_thumb_path as vehicle_photo
    into x
    from public.tasks t
    join public.vehicle_requests r on r.id = t.request_id
    join public.employees e on e.id = t.employee_id
    left join public.photos p on p.id = e.photo_id
    left join public.vehicles veh on veh.id = t.vehicle_id
   where t.id = p_task;
  if not found or x.requester is null then
    return;
  end if;
  perform public.queue_notification(p_event,
    jsonb_build_object('title', p_title, 'body', p_body, 'url', '/requests/' || x.request_id::text,
                       'tag', 'request:' || x.request_id::text, 'request_id', x.request_id, 'task_id', p_task)
    || case when x.driver_photo is not null then jsonb_build_object('icon_path', jsonb_build_object('bucket', 'driver-photos', 'path', x.driver_photo)) else '{}'::jsonb end
    || case when x.vehicle_photo is not null then jsonb_build_object('image_path', jsonb_build_object('bucket', 'vehicle-photos', 'path', x.vehicle_photo)) else '{}'::jsonb end,
    array[x.requester]);
end;
$$;
revoke all on function public.notify_requester(uuid, text, text, text) from public, anon, authenticated;

create function public.tasks_notify_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver text;
  v_old    text;
  v_plate  text;
  v_status text;
begin
  if new.request_id is null or current_setting('fleet.quiet', true) = 'on' then
    return null;
  end if;
  select name into v_driver from public.employees where id = new.employee_id;
  select reg_no into v_plate from public.vehicles where id = new.vehicle_id;
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    perform public.notify_requester(new.id, 'request.on_the_way',
      'On the way · ' || split_part(v_driver, ' ', 1) || ' · ' || coalesce(v_plate, ''),
      'Left at ' || to_char(coalesce(new.started_at, now()) at time zone 'Asia/Colombo', 'HH24:MI') || ' · ' || new.title);
  end if;
  if new.employee_id is distinct from old.employee_id and new.status in ('assigned', 'in_progress') then
    select name into v_old from public.employees where id = old.employee_id;
    perform public.notify_requester(new.id, 'request.driver_changed',
      'Driver changed: ' || v_driver || ' instead of ' || coalesce(v_old, 'the driver before'),
      new.title || ' · ' || to_char(new.start_at at time zone 'Asia/Colombo', 'DD Mon HH24:MI'));
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    -- A request cancelled or declined as a whole already tells the person who asked (request.decided / redecided).
    select status into v_status from public.vehicle_requests where id = new.request_id;
    if v_status not in ('cancelled', 'declined') then
      perform public.notify_requester(new.id, 'request.cancelled', 'Trip cancelled · ' || new.title,
        coalesce(new.cancelled_reason, 'Cancelled by the office'));
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_notify_requester() from public, anon, authenticated;
create trigger tasks_notify_requester
  after update of status, employee_id on public.tasks
  for each row execute function public.tasks_notify_requester();

-- The first pickup reached (the Arrived tap or the arrival nudge, whichever comes first), once per request.
create function public.task_stops_notify_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task    public.tasks%rowtype;
  v_first   uuid;
  v_driver  text;
  v_claimed uuid;
begin
  if (new.arrived_at is null or old.arrived_at is not null) and (new.auto_detected_at is null or old.auto_detected_at is not null) then
    return null;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if v_task.request_id is null then
    return null;
  end if;
  select s.id into v_first from public.task_stops s
   where s.task_id = new.task_id and s.type = 'pickup' and s.status <> 'removed' order by s.seq limit 1;
  if v_first is distinct from new.id then
    return null;
  end if;
  update public.vehicle_requests set arrived_push_sent_at = now()
   where id = v_task.request_id and arrived_push_sent_at is null
  returning id into v_claimed;
  if v_claimed is null then
    return null;
  end if;
  select name into v_driver from public.employees where id = v_task.employee_id;
  perform public.notify_requester(v_task.id, 'request.arrived',
    'Arrived at ' || new.place_name || ' · ' || split_part(v_driver, ' ', 1),
    to_char(coalesce(new.arrived_at, new.auto_detected_at) at time zone 'Asia/Colombo', 'HH24:MI') || ' · ' || v_task.title);
  return null;
end;
$$;
revoke all on function public.task_stops_notify_requester() from public, anon, authenticated;
create trigger task_stops_notify_requester
  after update of arrived_at, auto_detected_at on public.task_stops
  for each row execute function public.task_stops_notify_requester();
