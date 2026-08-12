-- ============================================================
-- Migration 275: Surveillance 1 (Renewal) — Sprint 7 fix-up
-- Adds address__a + cdc_name__a; fixes a live data-corruption bug
--
-- Triggered by re-checking surveilanceSheetMapping.ts against the real
-- summary sheet (Surv 1 Summary.csv), not just the field-mapping analysis
-- doc. Found the ADDRESS column was mapped onto company_name__a (no
-- address column existed on renewal_clients__a at all) — importing a real
-- sheet would have silently overwritten the company name with the address
-- text. Also found the sheet has a second, distinct set of team columns
-- (surv auditor / surv LA / surv Tech reviewer / surv CDC / surv audit
-- date) that describe THIS surveillance visit's team, separate from
-- Auditor Stg 1 / Auditor Stg 2 / Tech Reviewer / lead auditor, which
-- describe the client's ORIGINAL certification team (historical reference
-- only — confirmed not to be imported here, same treatment External
-- Client gives its own restated wide-table columns).
--
-- This migration only adds the two genuinely missing columns
-- (address__a, cdc_name__a). auditor_name__a / tech_reviewer_name__a /
-- lead_auditor__a already exist (migration 271) — only their MAPPING
-- SOURCE changes (surveilanceSheetMapping.ts, not the schema).
-- surveillance_audit_date__a already exists (migration 221, TEXT,
-- unregistered-in-import until now) — no schema change needed there either.
-- ============================================================

-- ================================================================
-- PART A — New columns
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS "address__a"   TEXT,
  ADD COLUMN IF NOT EXISTS "cdc_name__a"  TEXT;

-- ================================================================
-- PART B — Register new fields
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

    -- display_order 53-64 is already reserved for Sprint 8 (Suspension &
    -- Withdrawal, planned in 00_Sprint_Plan.md but not yet migrated) —
    -- using 65/66 here to avoid a future collision once that sprint ships.
    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'address',   'Address',   'text', false, false, 65, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'cdc_name',  'CDC Name',  'text', false, false, 66, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
