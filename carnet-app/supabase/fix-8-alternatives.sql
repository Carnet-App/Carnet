-- fix-8: backups for a slot — other places to go instead of a meal, drink or coffee plan.
--   items.alternatives = [{ "place_id", "title", "category", "lat", "lng", "address", "by" }, ...]
--   in order: the first is the 2nd choice, then the 3rd... They take no time on the schedule.
-- Safe to run more than once.
alter table public.items add column if not exists alternatives jsonb;

alter table public.items drop constraint if exists items_alternatives_is_list;
alter table public.items add constraint items_alternatives_is_list
  check (alternatives is null or (jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 10));

notify pgrst, 'reload schema';
