-- Hotfix O2-H2, Part 1c: the app's crash reports. When the app shows its crash screen (or catches an error it survived), it
-- sends the scrubbed details (lib/crashLogic.ts: no e-mail, phone, token, key or id) to office-api or driver-api
-- POST /errors, which writes one row here with the person who was signed in. The office reads the last ones with the tool
-- list_app_errors (users permission: the connector and the website's Settings → App errors). Service role only: no
-- policy, no grant to anyone else. Rows older than 90 days are removed by the nightly prune.

create table public.app_errors (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  -- The phone's own time of the crash (kept as sent; received_at is the server's).
  happened_at timestamptz,
  employee_id uuid references public.employees(id) on delete set null,
  side text not null check (side in ('office', 'driver')),
  fatal boolean not null default true,
  app_version text check (char_length(app_version) <= 40),
  update_id text check (char_length(update_id) <= 80),
  runtime text check (char_length(runtime) <= 40),
  screen text check (char_length(screen) <= 200),
  message text not null check (char_length(message) <= 300),
  stack text check (char_length(stack) <= 2000)
);

create index app_errors_received_idx on public.app_errors (received_at desc);

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

comment on table public.app_errors is
  'Hotfix O2-H2: the app''s crash reports (scrubbed on the phone), written by office-api / driver-api POST /errors, read by list_app_errors. Service role only.';

-- The nightly clean-up keeps 90 days (the same job as the location data).
create or replace function public.prune_app_errors() returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (delete from public.app_errors where received_at < now() - interval '90 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function public.prune_app_errors() from public, anon, authenticated;

select cron.schedule('prune-app-errors', '40 21 * * *', $$select public.prune_app_errors()$$);
