-- Carnet · undo money stage 2 (fix-4-money-stage2.sql). Leaves stage 1 in place.
-- Run in Supabase → SQL Editor. Deploy the previous app version first if you also roll back the app.
begin;

drop trigger if exists a_expenses_tombstone_guard on public.expenses;
drop trigger if exists a_settlements_tombstone_guard on public.settlements;
drop trigger if exists expenses_tombstone on public.expenses;
drop trigger if exists settlements_tombstone on public.settlements;
drop function if exists public.money_block_resurrection();
drop function if exists public.money_remember_delete();
drop table if exists public.money_tombstones;

-- Stage 1's revision function, as it was.
create or replace function public.money_bump_revision()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop function if exists public.money_check_expense_shares(jsonb, bigint);

alter table public.expenses    drop column if exists op_id, drop column if exists base_revision, drop column if exists last_op_id;
alter table public.settlements drop column if exists op_id, drop column if exists base_revision, drop column if exists last_op_id;

commit;
