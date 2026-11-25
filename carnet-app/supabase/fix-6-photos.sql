-- fix-6: photos of the place on a plan (the room, the menu, the door), separate from tickets.
--   items.photos = [{ "path": "<stored image path>", "by": "<email of who added it>" }, ...]
-- Safe to run more than once.
alter table public.items add column if not exists photos jsonb;

alter table public.items drop constraint if exists items_photos_is_list;
alter table public.items add constraint items_photos_is_list
  check (photos is null or (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 60));

notify pgrst, 'reload schema';
