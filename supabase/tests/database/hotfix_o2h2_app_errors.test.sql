-- Hotfix O2-H2, Part 1c, checked with pgTAP: the app's crash reports (app_errors) are the server's only (office-api and
-- driver-api write them as service role; list_app_errors reads them), and the nightly job keeps 90 days.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.app_errors'::regclass), 'app_errors has row level security');
select ok(not has_table_privilege('authenticated', 'public.app_errors', 'select')
  and not has_table_privilege('authenticated', 'public.app_errors', 'insert')
  and not has_table_privilege('anon', 'public.app_errors', 'select')
  and not has_table_privilege('anon', 'public.app_errors', 'insert'), 'no driver, office person or visitor reads or writes it directly');
select ok(not has_function_privilege('authenticated', 'public.prune_app_errors()', 'execute')
  and not has_function_privilege('anon', 'public.prune_app_errors()', 'execute'), 'only the server runs the prune');
-- Round 4–7 (item 9): app errors go with the one nightly retention job (90 days, a setting).
select is((select count(*) from cron.job where jobname = 'retention'), 1::bigint, 'the nightly retention job removes them');

insert into public.app_errors (side, fatal, message, received_at) values
  ('office', true, 'old', now() - interval '91 days'),
  ('driver', false, 'recent', now() - interval '89 days');
select is(public.prune_app_errors(), 1, 'the prune removes the reports older than 90 days');
select results_eq($$ select message from public.app_errors where message in ('old', 'recent') $$, $$ values ('recent') $$,
  'and keeps the rest');

select * from finish();
rollback;
