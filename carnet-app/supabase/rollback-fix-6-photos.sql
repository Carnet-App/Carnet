-- Undo fix-6. Plan photos are dropped from the database (the image files stay in storage).
alter table public.items drop constraint if exists items_photos_is_list;
alter table public.items drop column if exists photos;
notify pgrst, 'reload schema';
