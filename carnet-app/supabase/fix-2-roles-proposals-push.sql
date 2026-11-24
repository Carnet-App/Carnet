-- Carnet fix 2: trip admins, proposals, push notifications, tabs (includes fix 1).
-- Paste into Supabase → SQL Editor → Run (once). Safe to run again.

-- Fix 1: a new trip must be visible to its creator in the same moment it's created.
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (owner = auth.uid() or public.is_member(id));

-- Tabs: one-off splits outside a trip (no city, no schedule).
alter table public.trips add column if not exists kind text not null default 'trip';
alter table public.trips alter column city drop not null;

-- ── Roles & the approval switch ────────────────────────────────────────
alter table public.trips add column if not exists approval boolean not null default true;
-- trip_members.role is one of: owner | admin | member

create or replace function public.my_email()
returns text language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

create or replace function public.is_admin(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trips where id = t and owner = auth.uid())
      or exists (select 1 from public.trip_members m
                 where m.trip_id = t and lower(m.email) = public.my_email() and m.role in ('owner','admin'));
$$;

-- Can this person change the master schedule directly?
create or replace function public.can_edit_schedule(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(t)
      or (public.is_member(t) and exists (select 1 from public.trips where id = t and approval = false));
$$;

grant execute on function public.my_email() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.can_edit_schedule(uuid) to authenticated;

-- Trip settings (dates, approval switch, currency): admins only.
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated using (public.is_admin(id));

-- People: anyone on the trip can add people as members; only admins change roles or
-- remove others; you can always edit your own name or leave.
drop policy if exists members_all on public.trip_members;
drop policy if exists members_select on public.trip_members;
drop policy if exists members_insert on public.trip_members;
drop policy if exists members_update on public.trip_members;
drop policy if exists members_delete on public.trip_members;
create policy members_select on public.trip_members for select to authenticated using (public.is_member(trip_id));
create policy members_insert on public.trip_members for insert to authenticated
  with check (public.is_member(trip_id) and (role = 'member' or public.is_admin(trip_id)));
create policy members_update on public.trip_members for update to authenticated
  using (public.is_admin(trip_id) or lower(email) = public.my_email())
  with check (public.is_admin(trip_id) or role = 'member');
create policy members_delete on public.trip_members for delete to authenticated
  using ((public.is_admin(trip_id) and role <> 'owner') or (lower(email) = public.my_email() and role <> 'owner'));

-- The owner can't be demoted or removed, and nobody else can become owner.
create or replace function public.protect_owner() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'The trip owner stays owner';
  end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner')
     and not exists (select 1 from public.trips where id = new.trip_id and owner = auth.uid()) then
    raise exception 'Only the trip creator can be owner';
  end if;
  return new;
end $$;
drop trigger if exists protect_owner on public.trip_members;
create trigger protect_owner before insert or update on public.trip_members
  for each row execute function public.protect_owner();

-- ── The master schedule ────────────────────────────────────────────────
-- Shared items with a day are "the schedule". Members can still add ideas (no day yet)
-- and their own Busy / Just-me items directly; everything else goes through a proposal.
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (public.is_member(trip_id) and (
    public.can_edit_schedule(trip_id) or visibility <> 'shared' or day is null));
create policy items_update on public.items for update to authenticated
  using (public.is_member(trip_id) and (visibility <> 'hidden' or created_by = auth.uid()) and (
    public.can_edit_schedule(trip_id) or (created_by = auth.uid() and (visibility <> 'shared' or day is null))))
  with check (public.can_edit_schedule(trip_id) or visibility <> 'shared' or day is null);
create policy items_delete on public.items for delete to authenticated
  using (public.is_member(trip_id) and (visibility <> 'hidden' or created_by = auth.uid()) and (
    public.can_edit_schedule(trip_id) or (created_by = auth.uid() and (visibility <> 'shared' or day is null))));

-- ── Proposals ──────────────────────────────────────────────────────────
create table if not exists public.proposals (
  id uuid primary key,
  trip_id uuid not null references public.trips on delete cascade,
  item_id uuid,                       -- the item it changes/removes, or the id a new item will get
  kind text not null check (kind in ('add','change','remove')),
  payload jsonb not null default '{}'::jsonb,   -- proposed fields
  before jsonb,                                 -- what it was, for before → after
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  note text,
  proposed_by uuid not null default auth.uid(),
  proposed_by_email text not null default lower(auth.jwt() ->> 'email'),
  decided_by_email text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.proposals enable row level security;
drop policy if exists proposals_select on public.proposals;
drop policy if exists proposals_insert on public.proposals;
drop policy if exists proposals_update on public.proposals;
drop policy if exists proposals_delete on public.proposals;
create policy proposals_select on public.proposals for select to authenticated using (public.is_member(trip_id));
create policy proposals_insert on public.proposals for insert to authenticated
  with check (public.is_member(trip_id) and proposed_by = auth.uid());
create policy proposals_update on public.proposals for update to authenticated
  using (public.is_admin(trip_id) or proposed_by = auth.uid())
  with check (public.is_admin(trip_id) or (proposed_by = auth.uid() and status in ('pending','withdrawn')));
create policy proposals_delete on public.proposals for delete to authenticated
  using (public.is_admin(trip_id) or proposed_by = auth.uid());
grant select, insert, update, delete on public.proposals to authenticated;

-- ── Push notifications ─────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  email text not null default lower(auth.jwt() ->> 'email'),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Who to notify on a trip. Only callable by someone on that trip; never returns your own phones.
create or replace function public.trip_push_targets(t uuid, admins_only boolean default false, only_email text default null)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.trip_members m on lower(m.email) = lower(s.email) and m.trip_id = t
  where public.is_member(t)
    and lower(s.email) <> public.my_email()
    and (not admins_only or m.role in ('owner','admin'))
    and (only_email is null or lower(s.email) = lower(only_email));
$$;
grant execute on function public.trip_push_targets(uuid, boolean, text) to authenticated;

create or replace function public.forget_push_endpoint(e text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = e;
$$;
grant execute on function public.forget_push_endpoint(text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.proposals;
exception when duplicate_object then null; end $$;
