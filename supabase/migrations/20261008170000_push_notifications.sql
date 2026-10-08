-- =============================================================================
-- Push notifications for the driver app.
--
--   device_tokens   one row per phone signed in to the app (Expo push token).
--                   The app registers it after sign-in with
--                   register_device_token() and removes it on sign-out with
--                   remove_device_token(). A phone used by two drivers in turn
--                   keeps one row: the token moves to the driver signed in.
--   push_log        what was sent, per task change (service role only).
--   tasks_notify_push  a trigger on tasks: a new task, a task given to another
--                   driver, a cancelled task and a changed time or vehicle are
--                   handed to the Edge Function push-task through pg_net, which
--                   sends the push through Expo. Changes made by the driver's
--                   own app (role authenticated) are not pushed.
--
-- The function's URL and the shared key come from Vault (secrets functions_url
-- and server_key, the same ones read-odometer uses), never from a migration.
-- =============================================================================

create table public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  token        text not null,
  platform     text not null default 'android',
  device_model text,
  app_version  text,
  language     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint device_tokens_token_key unique (token),
  constraint device_tokens_platform_check check (platform in ('android', 'ios')),
  constraint device_tokens_token_shape_check check (token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'),
  constraint device_tokens_language_check check (language is null or language in ('en', 'si'))
);

create index device_tokens_employee_idx on public.device_tokens (employee_id);

create table public.push_log (
  id          bigint generated always as identity primary key,
  task_id     uuid references public.tasks (id),
  employee_id uuid references public.employees (id),
  kind        text not null,
  tokens      integer not null default 0,
  sent        integer not null default 0,
  failed      integer not null default 0,
  errors      jsonb,
  created_at  timestamptz not null default now(),
  constraint push_log_kind_check check (kind in ('new', 'changed', 'cancelled', 'removed'))
);

create index push_log_task_idx on public.push_log (task_id);

alter table public.device_tokens enable row level security;
alter table public.push_log      enable row level security;

-- Drivers see their own tokens (for the Me screen and the tests); they write through the functions below.
grant select on public.device_tokens to authenticated;
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated
  using (employee_id = (select public.current_employee_id()));
revoke all on public.push_log from public, anon, authenticated;

-- The app registers its token after sign-in. A token that belonged to another
-- driver (the same phone, a different sign-in) moves to the driver signed in.
create function public.register_device_token(
  p_token        text,
  p_platform     text default 'android',
  p_device_model text default null,
  p_app_version  text default null,
  p_language     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    raise exception 'Only a signed-in driver can register a device';
  end if;
  delete from public.device_tokens where token = p_token and employee_id <> v_me;
  insert into public.device_tokens (employee_id, token, platform, device_model, app_version, language)
  values (v_me, p_token, p_platform, p_device_model, p_app_version, p_language)
  on conflict (token) do update
    set device_model = excluded.device_model,
        app_version  = excluded.app_version,
        language     = excluded.language,
        updated_at   = now();
end;
$$;

-- The app removes its token on sign-out.
create function public.remove_device_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.device_tokens
  where token = p_token and employee_id = public.current_employee_id();
$$;

-- Hands one task change to the Edge Function push-task (through pg_net).
create function public.send_push(p_task_id uuid, p_kind text, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'server_key';
  if v_url is null or v_key is null then
    raise notice 'send_push: Vault secrets functions_url / server_key are not set; no push for task %', p_task_id;
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/push-task',
    body := jsonb_build_object('task_id', p_task_id, 'kind', p_kind, 'employee_id', p_employee_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-server-key', v_key),
    timeout_milliseconds := 10000
  );
end;
$$;

-- Which task changes are pushed, and to whom.
create function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The driver's own app (seen, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
    return null;
  end if;

  if new.employee_id <> old.employee_id then
    perform public.send_push(new.id, 'removed', old.employee_id);
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.send_push(new.id, 'cancelled', new.employee_id);
  elsif new.status in ('assigned', 'in_progress')
    and (new.start_at, new.end_by, new.vehicle_id, new.title) is distinct from (old.start_at, old.end_by, old.vehicle_id, old.title) then
    perform public.send_push(new.id, 'changed', new.employee_id);
  end if;
  return null;
end;
$$;

create trigger tasks_notify_push after insert or update on public.tasks
  for each row execute function public.tasks_notify_push();

revoke all on function public.register_device_token(text, text, text, text, text) from public, anon;
revoke all on function public.remove_device_token(text)                          from public, anon;
revoke all on function public.send_push(uuid, text, uuid)                          from public, anon, authenticated;
revoke all on function public.tasks_notify_push()                                  from public, anon, authenticated;
grant execute on function public.register_device_token(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.remove_device_token(text)                          to authenticated, service_role;
