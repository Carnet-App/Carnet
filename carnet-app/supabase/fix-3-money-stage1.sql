-- Carnet fix 3, stage 1: money groundwork. Paste into Supabase → SQL Editor → Run (once).
--
-- What this does
--   • Adds a table of supported currencies, with each currency's number of decimal places.
--   • Adds new columns to expenses and settlements: amounts in whole minor units (pence, cents),
--     a currency on settlements, server-managed revision numbers, a delete marker, an
--     idempotency key, refund/expense kind, and fields for printed adjustments and validation.
--   • Fills the new amount columns from the existing ones, using each currency's precision.
--   • Keeps them in step automatically while the current app version is still writing the
--     old columns, so nothing you do in the app today gets out of sync.
--   • Adds a report view listing anything that needs a look (shares that don't add up,
--     currencies that can't be established).
--
-- What this does NOT do (yet)
--   • It doesn't reject anything the current app writes. Validation that refuses bad
--     allocations arrives in stage 2, together with the app version that uses these columns.
--
-- Safe to run more than once. Undo: supabase/rollback-fix-3-money-stage1.sql

begin;

-- ── Supported currencies ──────────────────────────────────────────────
-- One definition of decimal places, shared by the app and the database (ISO 4217).
create table if not exists public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  minor_digits smallint not null check (minor_digits between 0 and 3),
  name text not null
);
insert into public.currencies (code, minor_digits, name) values
  ('EUR', 2, 'Euro'), ('GBP', 2, 'Pound sterling'), ('USD', 2, 'US dollar'),
  ('CHF', 2, 'Swiss franc'), ('DKK', 2, 'Danish krone'), ('SEK', 2, 'Swedish krona'),
  ('NOK', 2, 'Norwegian krone'), ('CZK', 2, 'Czech koruna'), ('PLN', 2, 'Polish złoty'),
  ('HUF', 2, 'Hungarian forint'), ('ISK', 0, 'Icelandic króna'), ('JPY', 0, 'Japanese yen'),
  ('KRW', 0, 'South Korean won'), ('AUD', 2, 'Australian dollar'), ('CAD', 2, 'Canadian dollar'),
  ('MAD', 2, 'Moroccan dirham'), ('TRY', 2, 'Turkish lira')
on conflict (code) do nothing;
alter table public.currencies enable row level security;
drop policy if exists currencies_read on public.currencies;
create policy currencies_read on public.currencies for select to authenticated, anon using (true);
grant select on public.currencies to authenticated, anon;

-- ── New columns ──────────────────────────────────────────────────────
alter table public.expenses
  add column if not exists amount_minor bigint,
  add column if not exists shares_minor jsonb,
  add column if not exists kind text not null default 'expense',
  add column if not exists adjustments jsonb not null default '[]'::jsonb,
  add column if not exists validation text,
  add column if not exists client_key uuid,
  add column if not exists revision bigint not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists currency_uncertain boolean not null default false,
  add column if not exists schema_version smallint not null default 1;

alter table public.settlements
  add column if not exists currency text,
  add column if not exists amount_minor bigint,
  add column if not exists client_key uuid,
  add column if not exists revision bigint not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists currency_uncertain boolean not null default false,
  add column if not exists schema_version smallint not null default 1;

-- Checks on the new columns only (the current app never writes them, so nothing it does is refused).
do $$ begin
  alter table public.expenses add constraint expenses_kind_chk check (kind in ('expense', 'refund'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_validation_chk
    check (validation is null or validation in ('reconciled', 'unverified', 'difference', 'manual'));
exception when duplicate_object then null; end $$;

-- One row per submission, however many times a phone retries or a finger double-taps.
create unique index if not exists expenses_client_key_uq on public.expenses (trip_id, client_key) where client_key is not null;
create unique index if not exists settlements_client_key_uq on public.settlements (trip_id, client_key) where client_key is not null;

-- ── Helpers ──────────────────────────────────────────────────────────
create or replace function public.currency_digits(c text)
returns smallint language sql stable set search_path = public as $$
  select minor_digits from public.currencies where code = upper(c)
$$;
grant execute on function public.currency_digits(text) to authenticated;

-- Decimal amount → whole minor units for a currency (null if the currency isn't supported).
create or replace function public.to_minor(amount numeric, c text)
returns bigint language sql stable set search_path = public as $$
  select case when public.currency_digits(c) is null or amount is null then null
              else round(amount * power(10, public.currency_digits(c)))::bigint end
$$;
grant execute on function public.to_minor(numeric, text) to authenticated;

-- {"email": 12.5, …} → {"email": 1250, …}
create or replace function public.shares_to_minor(shares jsonb, c text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(lower(k), public.to_minor(v::numeric, c)), '{}'::jsonb)
  from jsonb_each_text(coalesce(shares, '{}'::jsonb)) as e(k, v)
  where v ~ '^-?[0-9]+(\.[0-9]+)?$'
$$;
grant execute on function public.shares_to_minor(jsonb, text) to authenticated;

-- ── Server-managed revisions and timestamps ─────────────────────────
-- Every change bumps the revision on the server, whatever the phone sent.
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

-- While the app still writes the old decimal columns (schema_version 1), derive the new ones
-- from them so the two never disagree. Stage 2's app writes version 2 rows and owns the new columns.
create or replace function public.money_legacy_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.schema_version = 1 then
    if tg_table_name = 'expenses' then
      new.amount_minor := public.to_minor(new.amount, new.currency);
      new.shares_minor := public.shares_to_minor(new.shares, new.currency);
      new.currency_uncertain := public.currency_digits(new.currency) is null;
    else
      if new.currency is null then
        new.currency := (select t.currency from public.trips t where t.id = new.trip_id);
        new.currency_uncertain := true;   -- inferred from the trip, not recorded at the time
      end if;
      new.amount_minor := public.to_minor(new.amount, new.currency);
      if public.currency_digits(new.currency) is null then new.currency_uncertain := true; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists expenses_legacy_sync on public.expenses;
create trigger expenses_legacy_sync before insert or update on public.expenses
  for each row execute function public.money_legacy_sync();
drop trigger if exists settlements_legacy_sync on public.settlements;
create trigger settlements_legacy_sync before insert or update on public.settlements
  for each row execute function public.money_legacy_sync();

drop trigger if exists expenses_revision on public.expenses;
create trigger expenses_revision before insert or update on public.expenses
  for each row execute function public.money_bump_revision();
drop trigger if exists settlements_revision on public.settlements;
create trigger settlements_revision before insert or update on public.settlements
  for each row execute function public.money_bump_revision();

-- ── Backfill existing rows ───────────────────────────────────────────
-- Touching each row runs the sync trigger above, which fills the new columns.
update public.expenses set schema_version = schema_version where amount_minor is null;
update public.settlements set schema_version = schema_version where amount_minor is null;

-- ── What needs a look ───────────────────────────────────────────────
create or replace view public.money_migration_report with (security_invoker = true) as
  select 'expense' as row_type, e.id, e.trip_id, e.title as what, e.currency,
         e.amount_minor,
         (select coalesce(sum(v::bigint), 0) from jsonb_each_text(e.shares_minor) as s(k, v)) as shares_total_minor,
         case
           when e.currency_uncertain then 'currency not supported or unknown'
           when e.amount_minor is null then 'amount could not be converted'
           when (select coalesce(sum(v::bigint), 0) from jsonb_each_text(e.shares_minor) as s(k, v)) <> e.amount_minor
             then 'shares don''t add up to the amount'
         end as issue
  from public.expenses e
  where e.deleted_at is null
    and (e.currency_uncertain or e.amount_minor is null
         or (select coalesce(sum(v::bigint), 0) from jsonb_each_text(e.shares_minor) as s(k, v)) <> e.amount_minor)
  union all
  select 'settlement', s.id, s.trip_id, s.from_email || ' → ' || s.to_email, s.currency,
         s.amount_minor, null,
         case when s.currency_uncertain then 'currency inferred from the trip' else 'amount could not be converted' end
  from public.settlements s
  where s.deleted_at is null and (s.currency_uncertain or s.amount_minor is null);
grant select on public.money_migration_report to authenticated;

commit;

-- ── Check ────────────────────────────────────────────────────────────
-- Run after the script: you should see your expense and settlement counts, and the rows to review.
select
  (select count(*) from public.expenses) as expenses,
  (select count(*) from public.expenses where amount_minor is not null) as expenses_converted,
  (select count(*) from public.settlements) as settlements,
  (select count(*) from public.money_migration_report) as rows_to_review;
