-- Carnet: database setup. Paste into Supabase → SQL Editor → Run (once).
-- Creates the tables, the rules for who can see what, file storage, and live sync.

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.trips (
  id uuid primary key,
  owner uuid not null default auth.uid(),
  name text not null,
  city text not null,
  center_lat double precision,
  center_lng double precision,
  start_date date,
  end_date date,
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  email text not null,
  name text,
  role text not null default 'member',
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, email)
);

create table if not exists public.stays (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  from_date date,
  to_date date,
  updated_at timestamptz not null default now()
);

-- City guides: places belong to a person and a city, and outlive any one trip.
create table if not exists public.places (
  id uuid primary key,
  owner uuid not null default auth.uid(),
  city text not null,
  name text not null,
  category text not null default 'explore',
  address text,
  lat double precision,
  lng double precision,
  source text,            -- 'instagram' | 'screenshot' | 'friend' | 'osm' | 'google' | 'manual'
  source_detail text,     -- e.g. @account, who recommended it
  link text,
  photo_url text,
  photo_path text,
  notes text,
  collection text,
  visited boolean not null default false,
  needs_check boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Things on a trip's schedule (or loose ideas for it).
create table if not exists public.items (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  place_id uuid references public.places on delete set null,
  title text not null,
  category text,
  day date,
  start_time time,
  end_time time,
  visibility text not null default 'shared' check (visibility in ('shared','busy','hidden')),
  status text not null default 'planned' check (status in ('idea','planned','booked')),
  lat double precision,
  lng double precision,
  address text,
  booking_ref text,
  qr_text text,
  attachment_path text,
  notes text,
  created_by uuid not null default auth.uid(),
  created_by_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The real title/notes of a "busy" item. Only its creator can read this.
create table if not exists public.private_notes (
  id uuid primary key references public.items on delete cascade,
  owner uuid not null default auth.uid(),
  title text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  title text not null,
  amount numeric(10,2) not null,
  currency text not null default 'EUR',
  payer_email text not null,
  shares jsonb not null default '{}'::jsonb,   -- { "email": amount_owed, ... }
  method text,                                  -- 'evenly' | 'custom' | 'per item' | 'percent'
  receipt jsonb,
  receipt_path text,
  spent_on date default current_date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  from_email text not null,
  to_email text not null,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Who belongs to a trip ───────────────────────────────────────────────
create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trips where id = t and owner = auth.uid())
      or exists (select 1 from public.trip_members m
                 where m.trip_id = t and lower(m.email) = lower(auth.jwt() ->> 'email'));
$$;

-- Tiny function the Cloudflare Worker calls daily so the free project never pauses.
create or replace function public.ping()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.trips;
$$;

-- ── Row level security ─────────────────────────────────────────────────
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.stays enable row level security;
alter table public.places enable row level security;
alter table public.items enable row level security;
alter table public.private_notes enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;

drop policy if exists trips_select on public.trips;
drop policy if exists trips_insert on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;
create policy trips_select on public.trips for select to authenticated using (public.is_member(id));
create policy trips_insert on public.trips for insert to authenticated with check (owner = auth.uid());
create policy trips_update on public.trips for update to authenticated using (public.is_member(id));
create policy trips_delete on public.trips for delete to authenticated using (owner = auth.uid());

drop policy if exists members_all on public.trip_members;
create policy members_all on public.trip_members for all to authenticated
  using (public.is_member(trip_id)) with check (public.is_member(trip_id));

drop policy if exists stays_all on public.stays;
create policy stays_all on public.stays for all to authenticated
  using (public.is_member(trip_id)) with check (public.is_member(trip_id));

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses for all to authenticated
  using (public.is_member(trip_id)) with check (public.is_member(trip_id));

drop policy if exists settlements_all on public.settlements;
create policy settlements_all on public.settlements for all to authenticated
  using (public.is_member(trip_id)) with check (public.is_member(trip_id));

-- Hidden items are visible only to whoever made them. Busy items show to the crew
-- (as "Busy"); their real title sits in private_notes.
drop policy if exists items_select on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_select on public.items for select to authenticated
  using (public.is_member(trip_id) and (visibility <> 'hidden' or created_by = auth.uid()));
create policy items_insert on public.items for insert to authenticated
  with check (public.is_member(trip_id));
create policy items_update on public.items for update to authenticated
  using (public.is_member(trip_id) and (visibility <> 'hidden' or created_by = auth.uid()));
create policy items_delete on public.items for delete to authenticated
  using (public.is_member(trip_id) and (visibility <> 'hidden' or created_by = auth.uid()));

drop policy if exists private_all on public.private_notes;
create policy private_all on public.private_notes for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Your guide is yours; crew can see a place once it's on a shared trip.
drop policy if exists places_select on public.places;
drop policy if exists places_insert on public.places;
drop policy if exists places_update on public.places;
drop policy if exists places_delete on public.places;
create policy places_select on public.places for select to authenticated
  using (owner = auth.uid() or exists (
    select 1 from public.items i where i.place_id = places.id and public.is_member(i.trip_id)));
create policy places_insert on public.places for insert to authenticated with check (owner = auth.uid());
create policy places_update on public.places for update to authenticated using (owner = auth.uid());
create policy places_delete on public.places for delete to authenticated using (owner = auth.uid());

-- Explicit grants (required for projects created after May 2026).
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on
  public.trips, public.trip_members, public.stays, public.places, public.items,
  public.private_notes, public.expenses, public.settlements to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ── Live sync between phones ────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table
    public.trips, public.trip_members, public.stays, public.places,
    public.items, public.expenses, public.settlements;
exception when duplicate_object then null; end $$;

-- ── File storage (screenshots, tickets, receipts) ───────────────────────
-- Paths: trips/<trip id>/<file>  or  users/<user id>/<file>
insert into storage.buckets (id, name, public) values ('captures', 'captures', false)
on conflict (id) do nothing;

drop policy if exists captures_rw on storage.objects;
create policy captures_rw on storage.objects for all to authenticated
  using (bucket_id = 'captures' and (
    ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'trips' and public.is_member(((storage.foldername(name))[2])::uuid))))
  with check (bucket_id = 'captures' and (
    ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'trips' and public.is_member(((storage.foldername(name))[2])::uuid))));
