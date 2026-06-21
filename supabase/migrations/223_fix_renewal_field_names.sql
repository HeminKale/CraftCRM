-- ============================================================
-- Migration 223: Fix renewal_clients__a field names in tenant.fields
--
-- finalize_file_upload does: _column_name := _field_name || '__a'
-- So tenant.fields.name must be stored WITHOUT the __a suffix
-- for file fields. Migration 221 may have inserted them with
-- __a already included, causing double-suffix and breaking
-- both the column update AND the status auto-advance check.
-- ============================================================

UPDATE tenant.fields f
SET name = regexp_replace(f.name, '__a$', '')
FROM tenant.objects o
WHERE o.id = f.object_id
  AND o.name = 'renewal_clients__a'
  AND f.name LIKE '%__a'
  AND f.name NOT IN ('status__a', 'rejection_notes__a');

-- Verify: after this runs, file fields should be:
--   surveillance_intimation_letter  (not surveillance_intimation_letter__a)
--   surveillance_audit_plan         (not surveillance_audit_plan__a)
--   surveillance_audit_report       (not surveillance_audit_report__a)
--   surveillance_certificates       (not surveillance_certificates__a)
-- Date fields:
--   intimation_sent_date            (not intimation_sent_date__a)
--   etc.
-- Text/link fields:
--   external_client_id, company_name, contact_person, email, iso_standards
