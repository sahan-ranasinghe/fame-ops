-- Round 49 (29 October 2026): set-password links survive being opened. Opening (a check) never uses a link; only a
-- claim (the password save) does; a newer link, a password set another way, the 7 days and a switched-off account end
-- it. Only the token's SHA-256 is stored; the functions are the service role's alone.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-0000-0000-000000000049', 'new.r49@fame.test', ''),
  ('00000000-0000-0000-0000-000000000149', 'old.r49@fame.test', 'bcrypt-hash-one');
insert into public.employees (id, code, name, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000049', 'O-R49A', 'Round 49 New', 'new.r49@fame.test', 'office', '{view}', true, '00000000-0000-0000-0000-000000000049'),
  ('10000000-0000-0000-0000-000000000149', 'O-R49B', 'Round 49 Old', 'old.r49@fame.test', 'office', '{view}', true, '00000000-0000-0000-0000-000000000149');

-- 1. A new account's link: 7 days, opened any number of times without being used.
select lives_ok($$ select public.password_link_issue('10000000-0000-0000-0000-000000000049', repeat('a', 64), 'new_account', 'Admin', 7) $$,
  'a new account''s link');
select ok((select expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
             from public.password_links where token_hash = repeat('a', 64)), 'a link is valid 7 days');
select is(public.password_link_check(repeat('a', 64), false)->>'state', 'valid', 'opened once: valid');
select is(public.password_link_check(repeat('a', 64), false)->>'state', 'valid', 'opened again (a preview, a second tap): still valid');
select is(public.password_link_check(repeat('a', 64), false)->>'email', 'new.r49@fame.test', 'a valid answer names the person for office-api');
select ok((select opened_at is not null and used_at is null from public.password_links where token_hash = repeat('a', 64)),
  'the first open is noted; nothing is used');
select is(public.password_link_check(repeat('f', 64), false), '{"state": "unknown"}'::jsonb, 'a token never issued: unknown, nothing else');

-- 2. The save claims it once: a second save (or a later open) finds it used and learns nothing about the person.
select is(public.password_link_check(repeat('a', 64), true)->>'state', 'valid', 'the save claims the valid link');
select is(public.password_link_check(repeat('a', 64), true), '{"state": "used"}'::jsonb, 'a second save: used');
select is(public.password_link_check(repeat('a', 64), false), '{"state": "used"}'::jsonb, 'opened after the save: used');

-- 3. Auth refused the password: the claim is given back and the link works again.
select lives_ok($$ select public.password_link_release((select id from public.password_links where token_hash = repeat('a', 64))) $$,
  'release gives a claimed link back');
select is(public.password_link_check(repeat('a', 64), false)->>'state', 'valid', 'after the release: valid again');

-- 4. The password set another way (here: a new hash) ends every link made before it.
update auth.users set encrypted_password = 'bcrypt-hash-new' where id = '00000000-0000-0000-0000-000000000049';
select is(public.password_link_check(repeat('a', 64), false)->>'state', 'password_set', 'the password changed since the link: password_set');

-- 5. A reset link for a person who has a password: a newer link replaces it.
select lives_ok($$ select public.password_link_issue('10000000-0000-0000-0000-000000000149', repeat('b', 64), 'reset', 'Admin', 7) $$, 'reset link one');
select is(public.password_link_check(repeat('b', 64), false)->>'state', 'valid', 'a reset link with the password unchanged: valid');
select lives_ok($$ select public.password_link_issue('10000000-0000-0000-0000-000000000149', repeat('c', 64), 'reset', 'Admin', 7) $$, 'reset link two');
select is(public.password_link_check(repeat('b', 64), false)->>'state', 'replaced', 'the older link: replaced');
select is(public.password_link_check(repeat('c', 64), false)->>'state', 'valid', 'the newer link: valid');

-- 6. Seven days later: expired. Switched off: no link works.
update public.password_links set expires_at = now() - interval '1 second' where token_hash = repeat('c', 64);
select is(public.password_link_check(repeat('c', 64), true)->>'state', 'expired', 'past its 7 days: expired, and a save cannot claim it');
select ok((select used_at is null from public.password_links where token_hash = repeat('c', 64)), 'an expired link is not marked used');
select lives_ok($$ select public.password_link_issue('10000000-0000-0000-0000-000000000149', repeat('d', 64), 'reset', 'Admin', 7) $$, 'reset link three');
update public.employees set active = false where id = '10000000-0000-0000-0000-000000000149';
select is(public.password_link_check(repeat('d', 64), false)->>'state', 'switched_off', 'the account switched off: switched_off');

-- 7. The table and the functions are the service role's alone; the token is stored only as its hash.
select ok(not has_table_privilege('authenticated', 'public.password_links', 'select')
  and not has_table_privilege('anon', 'public.password_links', 'select'), 'nobody but the service role reads the links');
select ok(not has_function_privilege('authenticated', 'public.password_link_check(text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.password_link_check(text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.password_link_issue(uuid, text, text, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.password_fingerprint(uuid)', 'execute'),
  'nor calls the functions');
select ok(has_function_privilege('service_role', 'public.password_link_check(text, boolean)', 'execute'), 'office-api (the service role) does');
select throws_ok($$ insert into public.password_links (employee_id, token_hash, kind, expires_at, password_fingerprint)
  values ('10000000-0000-0000-0000-000000000049', 'the-token-itself', 'reset', now(), '') $$,
  '23514', null, 'a token that is not a SHA-256 is refused');

select * from finish();
rollback;
