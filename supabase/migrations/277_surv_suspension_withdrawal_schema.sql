-- ============================================================
-- Migration 277: Surveillance 1 (Renewal) — Sprint 8 schema
-- Suspension & Withdrawal chain
--
-- Part of UAF New Changes/New Help Doc/Renewal/Sprints/00_Sprint_Plan.md,
-- Sprint 8. Un-defers the six rights-matrix rows after Certificate Issue.
-- Confirmed shape: every one of these six rows is a plain file/document
-- field with no accept/reject step — "upload IS the action" — same pattern
-- migration 260 already used for cdc_report / surveillance_certificates.
--
-- 12 new columns (6 file, 6 date). No new text/notes columns — confirmed
-- these six rows are file/document-only, unlike earlier checkpoints
-- (plan, RCA) which had a client-remarks/rejection-notes column alongside
-- the file.
-- ============================================================

-- ================================================================
-- PART A — New columns
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS "surv_suspension_intimation__a"      JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_suspension_intimation_date__a" DATE,
  ADD COLUMN IF NOT EXISTS "surv_suspension_decision__a"        JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_suspension_decision_date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "surv_suspension_letter__a"          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_suspension_letter_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_intimation__a"      JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_intimation_date__a" DATE,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_decision__a"        JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_decision_date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_letter__a"          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_withdrawal_letter_date__a"     DATE;

-- ================================================================
-- PART B — Register new fields
-- display_order 53-64, continuing directly after Sprint 7's
-- surv_audit_pack (52). Sprint 7's later fix-up (migration 275,
-- address__a/cdc_name__a) deliberately used 65/66 to avoid colliding
-- with this reserved range.
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
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_intimation',      'Suspension Intimation',       'file', false, false, 53, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_intimation_date', 'Suspension Intimation Date',  'date', false, false, 54, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_decision',        'Suspension Decision',         'file', false, false, 55, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_decision_date',   'Suspension Decision Date',    'date', false, false, 56, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_letter',          'Suspension Letter',           'file', false, false, 57, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_suspension_letter_date',     'Suspension Letter Date',      'date', false, false, 58, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_intimation',      'Withdrawal Intimation',       'file', false, false, 59, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_intimation_date', 'Withdrawal Intimation Date',  'date', false, false, 60, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_decision',        'Withdrawal Decision',         'file', false, false, 61, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_decision_date',   'Withdrawal Decision Date',    'date', false, false, 62, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_letter',          'Withdrawal Letter',           'file', false, false, 63, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_withdrawal_letter_date',     'Withdrawal Letter Date',      'date', false, false, 64, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ================================================================
-- PART C — status__a picklist values
-- Continues directly after Sprint 3's Certificate_Issued (display_order 13).
-- ================================================================
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
  _row       RECORD;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'renewal_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        ('Suspension_Intimation_Sent',   'Suspension Intimation Sent',   14),
        ('Suspension_Decision_Uploaded', 'Suspension Decision Uploaded', 15),
        ('Suspension_Letter_Sent',       'Suspension Letter Sent',       16),
        ('Withdrawal_Intimation_Sent',   'Withdrawal Intimation Sent',   17),
        ('Withdrawal_Decision_Uploaded', 'Withdrawal Decision Uploaded', 18),
        ('Withdrawal_Letter_Sent',       'Withdrawal Letter Sent',       19)
      ) AS t(value, label, display_order)
    LOOP
      IF EXISTS (SELECT 1 FROM tenant.picklist_values WHERE field_id = _field_id AND value = _row.value) THEN
        UPDATE tenant.picklist_values
        SET label = _row.label, display_order = _row.display_order, is_active = true, updated_at = now()
        WHERE field_id = _field_id AND value = _row.value;
      ELSE
        INSERT INTO tenant.picklist_values (tenant_id, field_id, value, label, display_order, is_active)
        VALUES (_tenant_id, _field_id, _row.value, _row.label, _row.display_order, true);
      END IF;
    END LOOP;
  END LOOP;
END $$;
