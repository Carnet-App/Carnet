-- Undo fix-7: removes everyone's visited / thumbs up-down ratings.
do $$ begin
  alter publication supabase_realtime drop table public.place_ratings;
exception when others then null; end $$;
drop table if exists public.place_ratings;
notify pgrst, 'reload schema';
