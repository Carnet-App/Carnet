-- Carnet · money, stage 2 of 3
-- Run once in Supabase → SQL Editor, after fix-3-money-stage1.sql. Safe to run again.
-- Undo with rollback-fix-4-money-stage2.sql.
--
-- What it does:
--   1. Writes that say which revision they were based on are refused if the row has moved on
--      since (someone else's edit stands; the phone keeps its own aside).
--   2. A write the server has already applied (same operation id, sent twice) is ignored.
--   3. A deleted cost or payment can't be brought back by a phone that was offline and still
--      had an edit of it waiting to send.
--   4. Version 2 rows (amounts in cents) are checked: shares are whole, not negative, and add up
--      to the amount exactly. The old decimal fields are filled in from them, so older copies of
--      the app still read the right figures.
--
-- Works with the app as it is today: older versions send neither a revision nor an operation id,
-- and their writes go through exactly as before.

begin;

-- ── 1–2. Inputs the app sends with each write ───────────────────────
-- Both are cleared by the server on every write, so they never come back to a phone in a pull
-- (an older version of the app sends back whatever it pulled).
alter table public.expenses    add column if not exists op_id uuid, add column if not exists base_revision bigint, add column if not exists last_op_id uuid;
alter table public.settlements add column if not exists op_id uuid, add column if not exists base_revision bigint, add column if not exists last_op_id uuid;

-- ── 3. Deleted rows stay deleted ────────────────────────────────────
-- Deleting is still a real delete (older versions of the app don't hide soft-deleted rows),
-- and the server remembers the id here.
create table if not exists public.money_tombstones (
  table_name text not null check (table_name in ('expenses', 'settlements')),
  row_id uuid not null,
  trip_id uuid not null references public.trips on delete cascade,
  deleted_at timestamptz not null default now(),
  deleted_by uuid default auth.uid(),
  primary key (table_name, row_id)
);
alter table public.money_tombstones enable row level security;
drop policy if exists money_tombstones_read on public.money_tombstones;
create policy money_tombstones_read on public.money_tombstones for select to authenticated
  using (public.is_member(trip_id));
grant select on public.money_tombstones to authenticated;

create or replace function public.money_remember_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.money_tombstones (table_name, row_id, trip_id)
  values (tg_table_name, old.id, old.trip_id)
  on conflict (table_name, row_id) do update set deleted_at = now();
  return old;
end $$;

drop trigger if exists expenses_tombstone on public.expenses;
create trigger expenses_tombstone after delete on public.expenses
  for each row execute function public.money_remember_delete();
drop trigger if exists settlements_tombstone on public.settlements;
create trigger settlements_tombstone after delete on public.settlements
  for each row execute function public.money_remember_delete();

-- Runs before every other trigger on insert (names fire in alphabetical order: "a_" is first).
-- Returning nothing skips the insert without an error, so the phone's queue moves on.
create or replace function public.money_block_resurrection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.money_tombstones t where t.table_name = tg_table_name and t.row_id = new.id) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists a_expenses_tombstone_guard on public.expenses;
create trigger a_expenses_tombstone_guard before insert on public.expenses
  for each row execute function public.money_block_resurrection();
drop trigger if exists a_settlements_tombstone_guard on public.settlements;
create trigger a_settlements_tombstone_guard before insert on public.settlements
  for each row execute function public.money_block_resurrection();

-- ── 1–2, 4. Revision, replay and checks ─────────────────────────────
create or replace function public.money_check_expense_shares(shares jsonb, amount_minor bigint)
returns void language plpgsql immutable as $$
declare
  total numeric;
  bad boolean;
begin
  if shares is null or jsonb_typeof(shares) <> 'object' or shares = '{}'::jsonb then
    raise exception 'invalid_money: an expense needs at least one share' using errcode = 'CA422';
  end if;
  select coalesce(sum((v #>> '{}')::numeric), 0),
         bool_or(jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric))
    into total, bad
    from jsonb_each(shares) as s(k, v);
  if bad then
    raise exception 'invalid_money: shares must be whole, non-negative amounts in cents' using errcode = 'CA422';
  end if;
  if total <> amount_minor then
    raise exception 'invalid_money: shares add up to % but the amount is %', total, amount_minor using errcode = 'CA422';
  end if;
end $$;

-- Replaces stage 1's version of this function (same trigger: expenses_revision / settlements_revision).
-- Trigger order on each write: [a_..._tombstone_guard on insert] → ..._legacy_sync → ..._revision.
create or replace function public.money_bump_revision()
returns trigger language plpgsql set search_path = public as $$
declare
  digits int;
  op uuid := new.op_id;
begin
  if tg_op = 'UPDATE' then
    -- A pulled row sent straight back by an older app carries the op id stored on it: that's
    -- not an operation of its own.
    if op is not distinct from old.op_id then op := null; end if;
    -- The same operation arriving twice (a retry after a dropped reply): already applied.
    if op is not null and op = old.last_op_id then
      return old;
    end if;
    -- Based on an older revision than the server's: someone else changed it in between.
    if new.base_revision is not null and new.base_revision is distinct from old.base_revision
       and new.base_revision <> old.revision then
      raise exception 'stale_revision: % % is at revision %, this edit was based on %',
        tg_table_name, old.id, old.revision, new.base_revision
        using errcode = 'CA409';
    end if;
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;

  -- An older app edited a version 2 row it had pulled: it changed only the decimal fields, and
  -- sent no operation id. Treat it as a version 1 write and derive the cents again.
  -- (Each table is handled in its own branch: settlements have no shares column.)
  if new.schema_version = 2 and op is null then
    if tg_table_name = 'expenses' then
      if new.amount_minor is distinct from public.to_minor(new.amount, new.currency)
         or new.shares_minor is distinct from public.shares_to_minor(new.shares, new.currency) then
        new.schema_version := 1;
        new.amount_minor := public.to_minor(new.amount, new.currency);
        new.shares_minor := public.shares_to_minor(new.shares, new.currency);
      end if;
    elsif new.amount_minor is distinct from public.to_minor(new.amount, new.currency) then
      new.schema_version := 1;
      new.amount_minor := public.to_minor(new.amount, new.currency);
    end if;
  end if;

  if new.schema_version = 2 then
    digits := public.currency_digits(new.currency);
    if digits is null then
      raise exception 'invalid_money: currency % is not supported', new.currency using errcode = 'CA422';
    end if;
    if new.amount_minor is null or new.amount_minor <= 0 then
      raise exception 'invalid_money: amount must be more than zero' using errcode = 'CA422';
    end if;
    -- The cents are the record; the decimals older apps read are derived from them.
    new.amount := new.amount_minor::numeric / power(10, digits);
    if tg_table_name = 'expenses' then
      perform public.money_check_expense_shares(new.shares_minor, new.amount_minor);
      new.shares := (select jsonb_object_agg(k, (v #>> '{}')::numeric / power(10, digits)) from jsonb_each(new.shares_minor) as s(k, v));
    end if;
    new.currency_uncertain := false;
  end if;

  new.last_op_id := op;
  if tg_op = 'UPDATE' then
    -- Inputs only: cleared so they never come back to a phone in a pull.
    new.op_id := null;
    new.base_revision := null;
  end if;
  -- On insert they're left as sent: an upsert of an existing row runs this insert branch first,
  -- and the update branch reads them from the proposed row. New rows are sent with no base revision.
  new.updated_at := now();
  return new;
end $$;

-- Newer Supabase projects run nothing that isn't granted.
grant execute on function public.money_check_expense_shares(jsonb, bigint) to authenticated;
grant execute on function public.money_bump_revision() to authenticated;
grant execute on function public.money_remember_delete() to authenticated;
grant execute on function public.money_block_resurrection() to authenticated;

commit;

-- ── Check ────────────────────────────────────────────────────────────
-- Should show: true, true, 2, and your counts unchanged from stage 1.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'expenses' and column_name = 'base_revision') as revisions_ready,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'money_tombstones') as tombstones_ready,
  (select count(*) from pg_trigger where tgname in ('a_expenses_tombstone_guard', 'a_settlements_tombstone_guard')) as guards,
  (select count(*) from public.expenses) as expenses,
  (select count(*) from public.settlements) as settlements,
  (select count(*) from public.money_migration_report) as rows_to_review;
