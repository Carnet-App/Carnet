-- fix-4b: let signed-in users run the money checks that fire when a cost or payment is saved.
-- fix-4 added public.money_check_expense_shares without a grant; on newer Supabase projects
-- nothing runs unless it's granted, so every new cost was refused ("permission denied for
-- function money_check_expense_shares"). The trigger functions get grants too, to be sure.
-- Safe to run more than once.

-- Before: which of these can't signed-in users run? (The list should be empty after.)
select p.proname as missing_permission
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('money_check_expense_shares', 'money_bump_revision', 'money_legacy_sync', 'money_remember_delete',
                    'money_block_resurrection', 'currency_digits', 'to_minor', 'shares_to_minor')
  and not has_function_privilege('authenticated', p.oid, 'execute');

grant execute on function public.money_check_expense_shares(jsonb, bigint) to authenticated;
grant execute on function public.money_bump_revision() to authenticated;
grant execute on function public.money_legacy_sync() to authenticated;
grant execute on function public.money_remember_delete() to authenticated;
grant execute on function public.money_block_resurrection() to authenticated;
grant execute on function public.currency_digits(text) to authenticated;
grant execute on function public.to_minor(numeric, text) to authenticated;
grant execute on function public.shares_to_minor(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
