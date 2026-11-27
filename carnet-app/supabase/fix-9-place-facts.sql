-- fix-9: what a place is like, for filtering and the place sheet.
--   cuisine      'Nepali', 'French, wine bar' …
--   price_level  1–4 (€ … €€€€), price_text '€16–35'
--   hours        { "periods": [[day 0=Mon…6=Sun, open minute, close minute], …], "text": "Mo-Sa 19:00-23:00" }
--   facts_src    where each came from and when: { "cuisine": "capture", "hours": "osm", "at": "…" }
--   google_id    Google's id for the place, once matched (so it's never searched for twice)
-- Safe to run more than once.
alter table public.places add column if not exists cuisine text;
alter table public.places add column if not exists price_level smallint;
alter table public.places add column if not exists price_text text;
alter table public.places add column if not exists hours jsonb;
alter table public.places add column if not exists facts_src jsonb;
alter table public.places add column if not exists google_id text;

alter table public.places drop constraint if exists places_price_level_range;
alter table public.places add constraint places_price_level_range check (price_level is null or price_level between 1 and 4);

notify pgrst, 'reload schema';
