-- Undo fix-9. Cuisine, price and hours on places are dropped; the places stay.
alter table public.places drop constraint if exists places_price_level_range;
alter table public.places drop column if exists cuisine;
alter table public.places drop column if exists price_level;
alter table public.places drop column if exists price_text;
alter table public.places drop column if exists hours;
alter table public.places drop column if exists facts_src;
alter table public.places drop column if exists google_id;
notify pgrst, 'reload schema';
