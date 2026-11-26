-- fix-7: "been here" and a thumbs up / down on places, one per person, seen by the trip.
-- Safe to run more than once.
create table if not exists public.place_ratings (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  visited boolean not null default true,
  vote smallint not null default 0 check (vote in (-1, 0, 1)),   -- 1 up, -1 down, 0 no vote yet
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, user_id)
);
create index if not exists place_ratings_trip on public.place_ratings (trip_id);

alter table public.place_ratings enable row level security;
grant select, insert, update, delete on public.place_ratings to authenticated;

drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings for select to authenticated using (
  user_id = auth.uid()
  or (trip_id is not null and public.is_member(trip_id))
  or exists (select 1 from public.places p where p.id = place_id and p.owner = auth.uid())
);

drop policy if exists place_ratings_insert on public.place_ratings;
create policy place_ratings_insert on public.place_ratings for insert to authenticated with check (
  user_id = auth.uid() and (trip_id is null or public.is_member(trip_id))
);

drop policy if exists place_ratings_update on public.place_ratings;
create policy place_ratings_update on public.place_ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (trip_id is null or public.is_member(trip_id)));

drop policy if exists place_ratings_delete on public.place_ratings;
create policy place_ratings_delete on public.place_ratings for delete to authenticated using (user_id = auth.uid());

-- Live updates, like the other tables.
do $$ begin
  alter publication supabase_realtime add table public.place_ratings;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
