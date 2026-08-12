-- ============================================================
-- Migration 265: Surveillance 1 (Renewal) — Sprint 7 schema
-- Metadata fields for summary import
--
-- Adds 15 new columns to tenant.renewal_clients__a to support
-- Excel summary import (SurveilanceImport.tsx). Follows External
-- Client's migration 241 pattern exactly: ALTER TABLE, then
-- register fields per tenant.
--
-- New columns:
--   certificate_no__a, country__a, scope__a (if missing),
--   iaf_code__a, no_of_employees__a, surv_mandays__a,
--   auditor_name__a, tech_reviewer_name__a, director_name__a,
--   auditor_team__a, application_reviewer__a, lead_auditor__a,
--   food_category__a, soa_date__a (manual text, no status implication),
--   surv_audit_pack__a (file field, stores uploaded summary sheets)
--
-- Naming note: auditor_name__a / tech_reviewer_name__a are TEXT,
-- separate from auditor_id__a / tech_reviewer_id__a (UUIDs, set via
-- assign_surv_team RPC). Both coexist — summary import populates
-- text names, RPC assignment continues to use UUIDs. Matches
-- External Client's stage1_auditor__a (text) + RPC assignment pattern.
-- ============================================================

-- ================================================================
-- PART A — Add columns
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS "certificate_no__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "country__a"                  TEXT,
  ADD COLUMN IF NOT EXISTS "scope__a"                    TEXT,
  ADD COLUMN IF NOT EXISTS "iaf_code__a"                 TEXT,
  ADD COLUMN IF NOT EXISTS "no_of_employees__a"          TEXT,
  ADD COLUMN IF NOT EXISTS "surv_mandays__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_name__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "tech_reviewer_name__a"       TEXT,
  ADD COLUMN IF NOT EXISTS "director_name__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_team__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "application_reviewer__a"     TEXT,
  ADD COLUMN IF NOT EXISTS "lead_auditor__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "food_category__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "soa_date__a"                 TEXT,
  ADD COLUMN IF NOT EXISTS "surv_audit_pack__a"          JSONB DEFAULT '{}'::jsonb;

-- ================================================================
-- PART B — Register new fields in tenant.fields per tenant
-- ================================================================
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'renewal_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'certificate_no',           'Certificate No',                  'text',  false, false, 38, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'country',                  'Country',                         'text',  false, false, 39, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'scope',                    'Scope',                           'text',  false, false, 40, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'iaf_code',                 'IAF Code',                        'text',  false, false, 41, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'no_of_employees',          'Number of Employees',             'text',  false, false, 42, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_mandays',             'Surveillance Mandays',            'text',  false, false, 43, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'auditor_name',             'Auditor Name',                    'text',  false, false, 44, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'tech_reviewer_name',       'Tech Reviewer Name',              'text',  false, false, 45, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'director_name',            'Director Name',                   'text',  false, false, 46, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'auditor_team',             'Auditor Team',                    'text',  false, false, 47, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'application_reviewer',     'Application Reviewer',            'text',  false, false, 48, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'lead_auditor',             'Lead Auditor',                    'text',  false, false, 49, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'food_category',            'Food Category',                   'text',  false, false, 50, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'soa_date',                 'SOA Date',                        'text',  false, false, 51, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_audit_pack',          'Summary Sheets',                  'file',  false, false, 52, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ================================================================
-- PART C — Status picklist cross-check (should be complete from 257–260)
-- Comment only — no new statuses added in this migration.
-- ================================================================
-- If any Surv_NCR_Sent or Surv_NCR_RCA_Uploaded statuses are missing,
-- they should have been registered in 258/259. Verify before applying:
-- SELECT value, label FROM tenant.picklist_values
-- WHERE field_id = (SELECT id FROM tenant.fields WHERE name = 'status' ...)
-- ORDER BY display_order;
