-- Round 49 (29 October 2026): set-password links that survive being opened (Google Workspace's and Slack's invite
-- pattern). The links were Supabase's own recovery links (auth.admin.generateLink): one GET of the link used it up, so
-- WhatsApp's link preview (fetched when the message is written) spent it before the person tapped it, and the person
-- landed on the sign-in page with no word of why (28 October: a new office user's first link; reproduced on the live
-- site the next morning). The rule now:
--   1. a link may be OPENED any number of times (a page load, a preview, a bot never uses it); valid 7 days;
--   2. only a successful password save uses it; it also dies when a newer link is made for the same person, when the
--      password was set another way since the link was made, or when the account is switched off;
--   3. the page says so in words (office-api's public routes answer the link's state).
-- The token itself is never stored: only its SHA-256. The link carries it after the '#', so no server (the site's
-- host, a preview fetcher) receives it from the address; the page posts it to office-api.
-- "Set another way": each link keeps a fingerprint of the account's password hash as it was when the link was made
-- (SHA-256 of auth.users.encrypted_password); a different fingerprint at use = the password changed since. Read
-- through these security definer functions only; nothing is added to the auth schema.

create table public.password_links (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees(id),
  token_hash           text not null unique,
  kind                 text not null,
  created_at           timestamptz not null default now(),
  created_by           text,
  expires_at           timestamptz not null,
  password_fingerprint text not null,
  opened_at            timestamptz,
  used_at              timestamptz,
  replaced_at          timestamptz,
  constraint password_links_kind_check check (kind in ('new_account', 'reset')),
  constraint password_links_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);
create index password_links_employee on public.password_links (employee_id, created_at desc);
comment on table public.password_links is
  'Set-password links (Round 49): the SHA-256 of each token, valid 7 days, used only by a password save (used_at); replaced by a newer link (replaced_at); opened_at = the page first checked it. Service role only.';
alter table public.password_links enable row level security;
revoke all on public.password_links from public, anon, authenticated;
grant select, insert, update on public.password_links to service_role;

/** The account's password hash as a fingerprint ('' = no password yet). Internal: the functions below call it. */
create or replace function public.password_fingerprint(p_auth_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(u.encrypted_password, ''), 'UTF8')), 'hex')
    from auth.users u
   where u.id = p_auth_user;
$$;
revoke all on function public.password_fingerprint(uuid) from public, anon, authenticated;

/** A new link for an office person: the older ones still open are replaced. Answers { id, expires_at }. */
create or replace function public.password_link_issue(
  p_employee uuid, p_token_hash text, p_kind text, p_by text, p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_id   uuid;
  v_exp  timestamptz;
begin
  select e.auth_user_id into v_user from public.employees e where e.id = p_employee;
  if v_user is null then
    raise exception 'password_link_issue: % has no sign-in', p_employee;
  end if;
  -- One issue at a time per person: two links made at once cannot both stay open.
  perform pg_advisory_xact_lock(hashtext('password_link:' || p_employee::text));
  update public.password_links l
     set replaced_at = now()
   where l.employee_id = p_employee and l.used_at is null and l.replaced_at is null;
  insert into public.password_links (employee_id, token_hash, kind, created_by, expires_at, password_fingerprint)
  values (p_employee, p_token_hash, p_kind, p_by, now() + make_interval(days => greatest(1, least(p_days, 30))),
          coalesce(public.password_fingerprint(v_user), ''))
  returning id, expires_at into v_id, v_exp;
  return jsonb_build_object('id', v_id, 'expires_at', v_exp);
end;
$$;
revoke all on function public.password_link_issue(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.password_link_issue(uuid, text, text, text, integer) to service_role;

/**
 * A link's state: valid | used | replaced | expired | switched_off | password_set | unknown. Opening the page asks it
 * with p_claim false (the first open is noted, nothing is used); the password save asks it with p_claim true, which
 * marks a valid link used in the same locked step, so two saves cannot both pass. A valid answer carries the person
 * (employee_id, auth_user_id, name, email) for office-api; the others carry only the state.
 */
create or replace function public.password_link_check(p_token_hash text, p_claim boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l       public.password_links%rowtype;
  e       record;
  v_state text;
begin
  select * into l from public.password_links where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  select x.id, x.name, x.email, x.active, x.auth_user_id into e from public.employees x where x.id = l.employee_id;
  v_state := case
    when l.used_at is not null then 'used'
    when l.replaced_at is not null
      or exists (select 1 from public.password_links n where n.employee_id = l.employee_id and n.created_at > l.created_at)
      then 'replaced'
    when l.expires_at <= now() then 'expired'
    when e.auth_user_id is null or not e.active then 'switched_off'
    when coalesce(public.password_fingerprint(e.auth_user_id), '') <> l.password_fingerprint then 'password_set'
    else 'valid'
  end;
  if v_state = 'valid' then
    update public.password_links
       set used_at = case when p_claim then now() else used_at end,
           opened_at = coalesce(opened_at, now())
     where id = l.id;
    return jsonb_build_object('state', v_state, 'link_id', l.id, 'expires_at', l.expires_at, 'employee_id', e.id,
      'auth_user_id', e.auth_user_id, 'name', e.name, 'email', e.email);
  end if;
  return jsonb_build_object('state', v_state);
end;
$$;
revoke all on function public.password_link_check(text, boolean) from public, anon, authenticated;
grant execute on function public.password_link_check(text, boolean) to service_role;

/** A claimed link given back: Auth refused the password (office-api asks right after a failed save). */
create or replace function public.password_link_release(p_link uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.password_links set used_at = null where id = p_link;
$$;
revoke all on function public.password_link_release(uuid) from public, anon, authenticated;
grant execute on function public.password_link_release(uuid) to service_role;
