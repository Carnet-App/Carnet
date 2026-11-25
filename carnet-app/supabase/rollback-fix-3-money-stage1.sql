-- Undo for fix-3-money-stage1.sql. Only needed if something goes wrong.
-- Removes everything stage 1 added. The original columns (amount, shares, …) were never changed,
-- so the app carries on exactly as before.

begin;

drop view if exists public.money_migration_report;

drop trigger if exists expenses_legacy_sync on public.expenses;
drop trigger if exists settlements_legacy_sync on public.settlements;
drop trigger if exists expenses_revision on public.expenses;
drop trigger if exists settlements_revision on public.settlements;
drop function if exists public.money_legacy_sync();
drop function if exists public.money_bump_revision();
drop function if exists public.shares_to_minor(jsonb, text);
drop function if exists public.to_minor(numeric, text);
drop function if exists public.currency_digits(text);

drop index if exists public.expenses_client_key_uq;
drop index if exists public.settlements_client_key_uq;

alter table public.expenses
  drop constraint if exists expenses_kind_chk,
  drop constraint if exists expenses_validation_chk,
  drop column if exists amount_minor,
  drop column if exists shares_minor,
  drop column if exists kind,
  drop column if exists adjustments,
  drop column if exists validation,
  drop column if exists client_key,
  drop column if exists revision,
  drop column if exists deleted_at,
  drop column if exists currency_uncertain,
  drop column if exists schema_version;

alter table public.settlements
  drop column if exists currency,
  drop column if exists amount_minor,
  drop column if exists client_key,
  drop column if exists revision,
  drop column if exists deleted_at,
  drop column if exists currency_uncertain,
  drop column if exists schema_version;

drop table if exists public.currencies;

commit;
