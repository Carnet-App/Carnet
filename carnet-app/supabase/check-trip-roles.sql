-- Read-only: who created each trip and each crew member's role. Changes nothing.
select t.city, t.id as trip_id, ou.email as created_by, m.email as member, m.role
from public.trips t
left join auth.users ou on ou.id = t.owner
left join public.trip_members m on m.trip_id = t.id
order by t.created_at desc, m.role;
