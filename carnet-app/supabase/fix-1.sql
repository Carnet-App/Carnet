-- Fix: new trips were refused because the "can see this trip" rule couldn't see a trip
-- in the same moment it was being created. Paste into Supabase → SQL Editor → Run.
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (owner = auth.uid() or public.is_member(id));
