-- fix-7b: fix-7 made the place_ratings table but didn't let signed-in users read or write it
-- ("permission denied for table place_ratings"). The row rules from fix-7 still decide which rows.
-- Safe to run more than once.
grant select, insert, update, delete on public.place_ratings to authenticated;
notify pgrst, 'reload schema';
