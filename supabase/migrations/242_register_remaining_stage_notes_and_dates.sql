-- ================================
-- Migration 242: Register remaining Stage 1/2 notes/remarks + 2 dates
--
-- Follows the same pattern and reasoning as 240_register_stage_workflow_dates.sql
-- (which registered 9 milestone dates). This migration covers the columns
-- that migration didn't: the *_notes/*_remarks columns (all still actively
-- written by a live RPC) and 3 dates that were still unregistered.
--
-- All 12 columns already exist and are already stamped correctly by their
-- owning RPCs (233/234/237/238) — this migration only adds tenant.fields
-- rows so they become visible in Object Manager and placeable on the Page
-- Layout, and so Permission Sets' can_read/can_edit gain a field_id to
-- attach to. No column, RPC, or auto-advance logic changes here.
--
-- Notes/remarks fields registered as 'longtext' (renders as a 4-row
-- textarea per RecordDetailView.tsx:951), not 'text' — these routinely hold
-- multi-sentence rejection reasons/findings, unlike stage1_audit_date /
-- stage2_audit_date (237/238) which are short free-text entries.
--
-- Same trust model already accepted for the 9 dates in 240: this app has no
-- read-only-unless-owner concept beyond Permission Sets, so anyone with edit
-- rights on the record can now also hand-edit these through the generic
-- form, bypassing the RPC that normally owns each one (e.g. editing
-- stage1_rejection_notes directly instead of going through
-- review_stage1_ncr_rca's reject branch). This mirrors the existing
-- precedent (Report_Sent_Date, Stage_one_Audit_Done_on were already both
-- RPC/legacy-status-driven AND generically editable before this epic
-- started) rather than introducing a new pattern.
--
-- Deliberately EXCLUDED from this migration (do not add later without
-- re-confirming — see RPC for file fields.md for the full reasoning):
--   - stage1_report_uploaded_date, stage1_ncr_uploaded_date — orphaned by
--     the Stage 1 report+NCR merge (237), nothing writes to them anymore
--   - stage1_ncr_rca_uploaded_date, stage2_ncr_rca_uploaded_date — retired
--     per explicit stakeholder instruction ("shall never be under
--     consideration in the flow")
--   - stage2_closed_date, stage2_tech_final_accepted_date,
--     stage2_closure_notes, stage2_tech_final_rejection_notes — dead, since
--     close_stage2_audit / accept_stage2_tech_review are retired for
--     Stage 2 (238's tail restructure)
--   - stage2_registration_date — deliberately RPC-only
--     (set_stage2_registration_date sets it and status__a together in one
--     call); registering it generically would let someone edit the date
--     without moving status__a, the same reasoning 240 already documented
--     and 241 reconfirms for the separate registration_date__a field
-- ================================

DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT v.id, v.tenant_id, v.object_id, v.name, v.label, v.type, v.is_required, v.is_system_field, v.display_order, now(), now()
    FROM (VALUES
      -- Stage 1 notes/remarks
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_rejection_notes',           'Stage 1 Auditor Remarks',            'longtext', false, false, 160),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_plan_client_remarks',       'Stage 1 Plan Client Remarks',        'longtext', false, false, 161),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_findings_notes',       'Stage 1 Tech Findings Notes',        'longtext', false, false, 162),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_closure_notes',             'Stage 1 Closure Notes',              'longtext', false, false, 163),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_final_rejection_notes','Stage 1 Tech Final Rejection Notes', 'longtext', false, false, 164),
      -- Stage 1 dates not covered by 240
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_findings_date',        'Stage 1 Tech Findings Date',         'date',     false, false, 165),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_closed_date',               'Stage 1 Closed Date',                'date',     false, false, 166),
      -- Stage 2 notes/remarks (only the ones still live — see exclusions above)
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_plan_client_remarks',       'Stage 2 Plan Client Remarks',        'longtext', false, false, 167),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_rejection_notes',           'Stage 2 Auditor Remarks',            'longtext', false, false, 168),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_evidences_rejection_notes', 'Stage 2 Evidences Rejection Notes',  'longtext', false, false, 169),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_tech_findings_notes',       'Stage 2 Tech Findings Notes',        'longtext', false, false, 170),
      -- Stage 2 date not covered by 240
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_evidences_uploaded_date',   'Stage 2 Evidences Uploaded Date',    'date',     false, false, 171)
    ) AS v(id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order)
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant.fields f WHERE f.object_id = v.object_id AND f.name = v.name
    );
  END LOOP;
END $$;
