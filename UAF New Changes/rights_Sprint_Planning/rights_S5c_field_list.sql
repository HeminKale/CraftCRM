-- Run this first — I need the exact field names on external_clients__a
-- before I can write the full PS-vs-image comparison query without guessing
-- names for "Application form" / "Signed client agreement" / etc.
select f.name, f.label, f.type
from tenant.fields f
join tenant.objects o on o.id = f.object_id
where o.name = 'external_clients__a'
order by f.name;

-- Also confirm the exact Permission Set names in use (I've seen 'CRM Office',
-- 'Auditor', 'Tech reviewer', 'External Customer' so far — need to confirm
-- the CDC one's exact name/casing too).
select id, name from tenant.permission_sets order by name;
