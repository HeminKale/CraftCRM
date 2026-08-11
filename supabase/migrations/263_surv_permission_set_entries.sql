-- ============================================================
-- Migration 263: Surveillance 1 (Renewal) — Sprint 5 Permission Set entries
--
-- Replaces the manual Settings-UI walkthrough in Sprint_5.md with SQL,
-- per the stakeholder's ask this session ("Can we not do PS using SQL").
-- Writes directly into tenant.permission_set_entries — confirmed the live
-- enforcement table by reading the actual deployed body of
-- get_my_effective_permissions() via pg_get_functiondef() this session
-- (it joins permission_set_entries, NOT permission_set_fields — the two
-- tables have drifted into looking similar live, but only one is read by
-- the app). Does NOT call the public.upsert_permission_entry RPC — that
-- function requires auth.uid() to resolve to an admin user, which is NULL
-- in a migration context, so every call would fail its own admin check.
-- Direct INSERT ... ON CONFLICT is the correct approach here, mirroring
-- how tenant.fields / tenant.picklist_values are already populated
-- directly elsewhere in this migration set.
--
-- Permission Set names matched EXACTLY (case-insensitive) against what you
-- confirmed live in this tenant: "CRM Office", "Auditor", "Tech reviewer",
-- "CDC", "External Customer". One assumption worth flagging: "External
-- Customer" is treated as the Client-role set — there's no separate
-- "Renewal Client" set in your tenant's permission_sets table, and a
-- renewal record's client_user_id__a is the same system.users row as their
-- external_clients__a linkage, so this should be correct — but it's an
-- inference, not something you explicitly confirmed. If wrong, only Part B
-- below needs correcting (the four Client-deny rows).
--
-- Safe to re-run: every row is looked up by name and upserted, not
-- hardcoded by UUID. A tenant missing one of these five Permission Sets
-- simply gets no entry written for it (silent no-op per row, matching this
-- migration set's established "IF NOT FOUND THEN CONTINUE" convention) —
-- it will not error the whole migration.
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
        -- Row 1 — surveillance intimation letter: blank for Auditor/Tech/CDC
        ('surveillance_intimation_letter', 'Auditor',          false, false),
        ('surveillance_intimation_letter', 'Tech reviewer',    false, false),
        ('surveillance_intimation_letter', 'CDC',              false, false),

        -- Row 6 — surv ncr: blank for Tech Reviewer only
        -- (NOT Client — corrects the wrong "Client" claim in the original
        -- 00_Sprint_Plan.md Sprint 5 draft, caught re-checking the matrix
        -- image directly)
        ('surv_ncr',                       'Tech reviewer',    false, false),

        -- Row 10/11 — tech review findings/checklist: blank for Client
        ('surv_tech_findings_notes',       'External Customer', false, false),
        ('surv_tech_findings_file',        'External Customer', false, false),

        -- Row 12 — CDC report: blank for Client/Auditor/Tech Reviewer;
        -- CRM is view-only (can_read stays true, can_edit denied) — this
        -- is defense-in-depth alongside migration 261's RPC hard block,
        -- not the primary control.
        ('cdc_report',                     'External Customer', false, false),
        ('cdc_report',                     'Auditor',           false, false),
        ('cdc_report',                     'Tech reviewer',     false, false),
        ('cdc_report',                     'CRM Office',        true,  false),

        -- Row 13 — certificate issue: blank for Auditor/Tech Reviewer
        ('surveillance_certificates',      'Auditor',          false, false),
        ('surveillance_certificates',      'Tech reviewer',    false, false)
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
