-- fix-4b: let signed-in users run the money checks that fire when a cost or payment is saved.
-- On newer Supabase projects nothing runs unless it's granted; fix-4's share check had no grant,
-- so new costs could be refused. This finds the money functions as they exist in this database
-- (whatever their exact arguments) and grants each one. Safe to run more than once.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'money\_%' or p.proname in ('currency_digits', 'to_minor', 'shares_to_minor'))
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- What's there now, and whether signed-in users can run it (every row should say true).
select p.oid::regprocedure as function, has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'money\_%' or p.proname in ('currency_digits', 'to_minor', 'shares_to_minor'))
order by 1;
