-- Read-only: the costs saved on the server for each trip, newest first. Changes nothing.
select t.city, e.title, e.amount, e.currency, e.payer_email, e.created_at,
       (select u.email from auth.users u where u.id = e.created_by) as added_by
from public.expenses e join public.trips t on t.id = e.trip_id
order by e.created_at desc
limit 30;
