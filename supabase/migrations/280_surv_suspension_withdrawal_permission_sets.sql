-- ============================================================
-- Migration 280: Surveillance 1 (Renewal) — Sprint 8 Permission Set entries
-- Suspension & Withdrawal
--
-- Same technique as migration 263 — direct INSERT into
-- tenant.permission_set_entries (the confirmed live enforcement table),
-- matched by tenant + Permission Set name + field name, not hardcoded
-- UUIDs. Safe to re-run; a tenant missing a named Permission Set just
-- gets no entry for it (RAISE NOTICE + CONTINUE), same as 263.
--
-- Per the confirmed matrix (00_Sprint_Plan.md, Sprint 8 "Roles" table):
--   - Auditor, Tech reviewer: blank on all six rows — deny can_read on all
--     12 new fields (6 file + 6 date).
--   - Client ("External Customer"): blank on the two decision rows only —
--     deny can_read on surv_suspension_decision / surv_withdrawal_decision
--     + their date columns.
--   - CDC: blank on the four intimation/letter rows — deny can_read on
--     those 4 file fields + their date columns.
--   - CRM: "view" (not upload) on the two decision rows — can_edit denied,
--     can_read stays true. Defense-in-depth alongside migration 278's RPC
--     hard block, same pattern migration 263 used for cdc_report.
-- ============================================================

DO $$
DECLARE
  _tenant_id      UUID;
  _object_id      UUID;
  _field_id       UUID;
  _perm_set_id    UUID;
  _row            RECORD;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'renewal_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        -- Auditor / Tech reviewer — blank across all six rows
        ('surv_suspension_intimation',      'Auditor',          false, false),
        ('surv_suspension_intimation_date', 'Auditor',          false, false),
        ('surv_suspension_decision',        'Auditor',          false, false),
        ('surv_suspension_decision_date',   'Auditor',          false, false),
        ('surv_suspension_letter',          'Auditor',          false, false),
        ('surv_suspension_letter_date',     'Auditor',          false, false),
        ('surv_withdrawal_intimation',      'Auditor',          false, false),
        ('surv_withdrawal_intimation_date', 'Auditor',          false, false),
        ('surv_withdrawal_decision',        'Auditor',          false, false),
        ('surv_withdrawal_decision_date',   'Auditor',          false, false),
        ('surv_withdrawal_letter',          'Auditor',          false, false),
        ('surv_withdrawal_letter_date',     'Auditor',          false, false),

        ('surv_suspension_intimation',      'Tech reviewer',    false, false),
        ('surv_suspension_intimation_date', 'Tech reviewer',    false, false),
        ('surv_suspension_decision',        'Tech reviewer',    false, false),
        ('surv_suspension_decision_date',   'Tech reviewer',    false, false),
        ('surv_suspension_letter',          'Tech reviewer',    false, false),
        ('surv_suspension_letter_date',     'Tech reviewer',    false, false),
        ('surv_withdrawal_intimation',      'Tech reviewer',    false, false),
        ('surv_withdrawal_intimation_date', 'Tech reviewer',    false, false),
        ('surv_withdrawal_decision',        'Tech reviewer',    false, false),
        ('surv_withdrawal_decision_date',   'Tech reviewer',    false, false),
        ('surv_withdrawal_letter',          'Tech reviewer',    false, false),
        ('surv_withdrawal_letter_date',     'Tech reviewer',    false, false),

        -- Client ("External Customer") — blank on the two decision rows only
        ('surv_suspension_decision',        'External Customer', false, false),
        ('surv_suspension_decision_date',   'External Customer', false, false),
        ('surv_withdrawal_decision',        'External Customer', false, false),
        ('surv_withdrawal_decision_date',   'External Customer', false, false),

        -- CDC — blank on the four intimation/letter rows
        ('surv_suspension_intimation',      'CDC',              false, false),
        ('surv_suspension_intimation_date', 'CDC',              false, false),
        ('surv_suspension_letter',          'CDC',              false, false),
        ('surv_suspension_letter_date',     'CDC',              false, false),
        ('surv_withdrawal_intimation',      'CDC',              false, false),
        ('surv_withdrawal_intimation_date', 'CDC',              false, false),
        ('surv_withdrawal_letter',          'CDC',              false, false),
        ('surv_withdrawal_letter_date',     'CDC',              false, false),

        -- CRM — view only on the two decision rows (can_read true, can_edit
        -- false); defense-in-depth alongside the RPC hard block
        ('surv_suspension_decision',        'CRM Office',       true,  false),
        ('surv_withdrawal_decision',        'CRM Office',       true,  false)
      ) AS t(field_name, ps_name, can_read, can_edit)
    LOOP
      SELECT id INTO _field_id FROM tenant.fields
      WHERE object_id = _object_id AND name = _row.field_name LIMIT 1;

      IF _field_id IS NULL THEN
        RAISE NOTICE 'Skipped: field % not found on renewal_clients__a (tenant %)', _row.field_name, _tenant_id;
        CONTINUE;
      END IF;

      SELECT id INTO _perm_set_id FROM tenant.permission_sets
      WHERE tenant_id = _tenant_id AND lower(name) = lower(_row.ps_name) LIMIT 1;

      IF _perm_set_id IS NULL THEN
        RAISE NOTICE 'Skipped: permission set "%" not found (tenant %)', _row.ps_name, _tenant_id;
        CONTINUE;
      END IF;

      INSERT INTO tenant.permission_set_entries (
        permission_set_id, tenant_id, resource_type, resource_id,
        can_read, can_edit, can_create, can_delete
      ) VALUES (
        _perm_set_id, _tenant_id, 'field', _field_id,
        _row.can_read, _row.can_edit, false, false
      )
      ON CONFLICT (permission_set_id, resource_type, resource_id)
      DO UPDATE SET
        can_read   = EXCLUDED.can_read,
        can_edit   = EXCLUDED.can_edit,
        updated_at = NOW();
    END LOOP;
  END LOOP;
END $$;
