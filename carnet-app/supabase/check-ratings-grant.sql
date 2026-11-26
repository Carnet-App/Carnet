-- Read-only: does the signed-in role have access to the ratings table? Changes nothing.
-- Expect four rows for "authenticated": SELECT, INSERT, UPDATE, DELETE.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'place_ratings'
order by grantee, privilege_type;
