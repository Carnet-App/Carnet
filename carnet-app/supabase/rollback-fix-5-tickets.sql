-- Undo fix-5. Extra tickets (beyond the first on each plan) are lost; the first stays in qr_text / attachment_path.
alter table public.items drop constraint if exists items_tickets_is_list;
alter table public.items drop column if exists tickets;
notify pgrst, 'reload schema';
