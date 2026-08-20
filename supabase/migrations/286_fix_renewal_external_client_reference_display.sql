-- ============================================================
-- Migration 286: Fix Surveillance 1's External Client field showing a
--                 raw UUID instead of the linked company name
--
-- external_client_id was registered as type 'text' in the original
-- migration (221_renewal_clients.sql), even though the underlying column
-- (external_client_id__a) is a UUID FK to tenant.external_clients__a(id).
-- get_object_records_with_references (migration 129, still the live body)
-- only resolves a field to a readable label when tenant.fields.type =
-- 'reference' — for any other type it returns the raw column value
-- as-is, which is why the record detail page shows the bare UUID.
--
-- Fix: flip the type to 'reference' and point it at
-- external_clients__a."Company_name__a" (the same column
-- create_renewal_client already copies from at record-creation time, for
-- consistency). Once this is set, the existing reference-resolution join
-- in get_object_records_with_references picks it up automatically — no
-- code change needed, this is a metadata-only fix.
-- ============================================================

UPDATE tenant.fields f
SET type                     = 'reference',
    reference_table          = 'external_clients__a',
    reference_display_field  = 'Company_name__a',
    updated_at                = now()
FROM tenant.objects o
WHERE f.object_id = o.id
  AND o.name = 'renewal_clients__a'
  AND f.name = 'external_client_id';
