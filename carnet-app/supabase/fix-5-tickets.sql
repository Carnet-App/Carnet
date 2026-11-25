-- fix-5: several tickets on one plan.
-- The first ticket still lives in items.qr_text / items.attachment_path (older copies of the
-- app read those); the full list, when there's more than one, is in items.tickets:
--   [{ "qr": "<text in the QR code or null>", "path": "<stored image path or null>" }, ...]
-- Safe to run more than once.
alter table public.items add column if not exists tickets jsonb;

alter table public.items drop constraint if exists items_tickets_is_list;
alter table public.items add constraint items_tickets_is_list
  check (tickets is null or (jsonb_typeof(tickets) = 'array' and jsonb_array_length(tickets) <= 40));

notify pgrst, 'reload schema';
