-- ============================================================
-- Migration 269: Recertification — Sprint 6 Permission Set entries
--
-- Same technique as Surveillance 1's 263: resolve each Permission Set by
-- tenant + exact name, resolve each field by object + name, direct
-- INSERT ... ON CONFLICT into tenant.permission_set_entries — NOT the
-- public.upsert_permission_entry RPC, which requires auth.uid() to resolve
-- to an admin and is NULL in a migration context. Confirmed
-- tenant.permission_set_entries (not permission_set_fields) is the table
-- actually read by get_my_effective_permissions() — same verification
-- 263's header already did for this schema, not re-derived from scratch
-- here since nothing about that enforcement path has changed since.
--
-- Permission Set names matched EXACTLY (case-insensitive) against the same
-- five confirmed live in this tenant: "CRM Office", "Auditor",
-- "Tech reviewer", "CDC", "External Customer". Same "External Customer" =
-- Client-role inference 263 flagged — still an inference, not something
-- re-confirmed this session; if wrong, only the External-Customer rows
-- below need correcting.
--
-- ── Scope discipline, matched to 263's precedent exactly ──────────────
-- Only rows with a genuinely BLANK cell on a primary content field (file/
-- text the row is actually about) get a deny entry — not every row with
-- *some* blank cell. Two categories deliberately excluded, both flagged
-- here so the reasoning is visible rather than silently absent:
--
--   1. "Accept-only" rows (Application acceptance, Signed client agreement,
--      Recert plan accept, NCR+RCA acceptance, Tech findings "close") have
--      no distinct content field for a blank cell to gate — the row's
--      blank cells there mean "no accept button for this role", already
--      enforced by each RPC's own role check (review_recert_application,
--      review_recert_agreement, review_recert_plan, review_recert_ncr_rca,
--      close_recert_audit — none of these have a CRM/wrong-role bypass).
--      Surveillance 1's 263 set this exact precedent: zero PS entries exist
--      for its own equivalent accept-only rows (Intimation Accepted, Plan
--      Accepted, RCA Accepted, Closed) even though some of those rows also
--      have blank cells for some roles.
--
--   2. Reject-reason/remarks fields (rejection_notes__a,
--      recert_plan_client_remarks__a, recert_rca_rejection_notes__a,
--      recert_evidences_rejection_notes__a) are deliberately NOT
--      PS-restricted, even where the matrix shows a blank cell on their
--      row for CRM/Auditor. CRM/Auditor need to READ these to revise and
--      re-upload — RecertificationActionPanel.tsx displays them directly
--      from recordData to drive its own "Revise ..." prompts, bypassing
--      Permission Sets entirely (per project_rpc_vs_permission_sets_
--      craftcrm's point 1: workflow-action panels call zero can()/
--      usePermissions() anywhere). Denying read here would not even hide
--      anything from the ActionPanel — it would only affect the generic
--      Page Layout field renderer, inconsistently. Surveillance 1's 263
--      set this same precedent: surv_plan_client_remarks__a and
--      surv_rca_rejection_notes__a got zero PS entries either.
--
--   3. auditor_id__a / tech_reviewer_id__a (assign-team row) are not
--      registered in tenant.fields at all (deliberate Sprint 2 decision —
--      see 266's header) — nothing for a PS entry to target regardless of
--      the matrix's blank Client cell there.
--
--   4. recert_ncr_rca, recert_evidences, recert_audit_report have NO
--      blank cells at all in the actual matrix (every role has at least
--      "view") — no entry needed. recert_audit_report's client-side
--      conditional visibility ("view only after tech review acceptance")
--      is handled by Sprint 5's RECERT_STATUS_ORDER frontend lock, a
--      different mechanism (status-conditional, which static Permission
--      Sets cannot express — see the same memory's point 2).
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
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        -- Row 1 — intimation letter: blank for Auditor/Tech. CDC = view on
        -- THIS matrix (differs from Surveillance 1's own intimation row,
        -- which also denies CDC — not copied forward, this epic's matrix
        -- genuinely grants CDC view here).
        ('recert_intimation_letter',    'Auditor',           false, false),
        ('recert_intimation_letter',    'Tech reviewer',     false, false),

        -- Row 2 — application form: blank for Auditor/Tech.
        ('recert_application_form',     'Auditor',           false, false),
        ('recert_application_form',     'Tech reviewer',     false, false),

        -- Row 4 — quotation: blank for Auditor/Tech.
        ('recert_quotation',            'Auditor',           false, false),
        ('recert_quotation',            'Tech reviewer',     false, false),

        -- Row 5 — client agreement: blank for Auditor/Tech.
        ('recert_agreement',            'Auditor',           false, false),
        ('recert_agreement',            'Tech reviewer',     false, false),

        -- Row 8 — audit plan: blank for Tech Reviewer only (Auditor uploads).
        ('recert_audit_plan',           'Tech reviewer',     false, false),

        -- Row 10 — NCR: blank for Tech Reviewer only. Matches
        -- Surveillance 1's surv_ncr precedent exactly (same single-role deny).
        ('recert_ncr',                  'Tech reviewer',     false, false),

        -- Row 15/16 — tech review findings/checklist: blank for Client.
        -- Matches surv_tech_findings_notes/file precedent exactly.
        ('recert_tech_findings_notes',  'External Customer', false, false),
        ('recert_tech_findings_file',   'External Customer', false, false),

        -- Row 17 — CDC report: blank for Client/Auditor/Tech Reviewer;
        -- CRM is view-only (can_read stays true, can_edit denied) — defense
        -- in depth alongside migration 268's RPC hard block, not the
        -- primary control. Matches cdc_report's precedent exactly (same
        -- 4-role pattern: 3 denies + 1 CRM view-only).
        ('recert_cdc_report',           'External Customer', false, false),
        ('recert_cdc_report',           'Auditor',           false, false),
        ('recert_cdc_report',           'Tech reviewer',     false, false),
        ('recert_cdc_report',           'CRM Office',        true,  false),

        -- Row 18 — certificate issue: blank for Auditor/Tech Reviewer.
        -- Matches surveillance_certificates precedent exactly.
        ('recert_certificates',         'Auditor',           false, false),
        ('recert_certificates',         'Tech reviewer',     false, false)
      ) AS t(field_name, ps_name, can_read, can_edit)
    LOOP
      SELECT id INTO _field_id FROM tenant.fields
      WHERE object_id = _object_id AND name = _row.field_name LIMIT 1;

      IF _field_id IS NULL THEN
        RAISE NOTICE 'Skipped: field % not found on recertification_clients__a (tenant %)', _row.field_name, _tenant_id;
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
