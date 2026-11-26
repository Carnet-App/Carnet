-- Undo fix-8. Backup choices on plans are dropped; the main plans stay.
alter table public.items drop constraint if exists items_alternatives_is_list;
alter table public.items drop column if exists alternatives;
notify pgrst, 'reload schema';
