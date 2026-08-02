-- ================================================================
-- One-shot PS-vs-image comparison (2026-08-02)
--
-- Encodes every field-level rule from the rights-matrix image that is
-- actually a Permission Set concern (static can_read/can_edit per role) as
-- an "expected" table, then diffs it against what's really configured in
-- tenant.permission_set_entries. Missing entries default to can_read=true,
-- can_edit=true (this app's PS model is deny-list — no row means fully
-- unrestricted), matching how the app itself evaluates access.
--
-- Deliberately OUT of this query (not PS, needs separate RPC/code
-- investigation instead — see notes below each):
--   - "Application acceptance", "Stage N plan accept", "Assign team",
--     "Stage N NCR RCA acceptance" rows: these are actions performed via
--     RPC (assign_stage_team, review_stage1_ncr_rca, etc.), not a field's
--     can_edit — a role having "accept" in the image doesn't mean they
--     should have can_edit=true on any field.
--   - "Stage N tech review findings" (tech "write"): submitted via RPC
--     (submit_stage1_tech_findings) into longtext fields
--     (stage1_tech_findings_notes etc.) — not the same as the checklist
--     FILE field below, and not meaningfully "upload"-shaped for PS.
--   - "Signed client agreement" (client "accept n sign", CRM drops to
--     "view" after signing): same physical field as "Client agreement"
--     (clientAgreement__c) across two workflow phases — PS is static and
--     can't express "CRM can edit until signed, then can't"; only the
--     always-true parts (CRM can edit at all, Client can read to sign) are
--     checked below. The revoke-after-signing behavior would need the same
--     kind of code-side lock as stage1_report/stage2_report, not a PS row.
--   - Certificate issuance, application_reviewer/lead_auditor/etc. text
--     fields: out of scope per rights_S6/S5 docs already.
-- ================================================================

WITH expected(ps_name, field_name, exp_can_read, exp_can_edit) AS (
  VALUES
    -- Application form (Client uploads, CRM/CDC view)
    ('External Customer', 'application_Form',            true,  true),
    ('CRM Office',        'application_Form',            true,  false),
    ('CDC',               'application_Form',            true,  false),
    ('Auditor',           'application_Form',            false, false),
    ('Tech reviewer',     'application_Form',            false, false),

    -- Quotation (CRM uploads, Client/CDC view)
    ('External Customer', 'quotation',                    true,  false),
    ('CRM Office',        'quotation',                    true,  true),
    ('CDC',               'quotation',                    true,  false),
    ('Auditor',           'quotation',                    false, false),
    ('Tech reviewer',     'quotation',                    false, false),

    -- Client agreement (CRM uploads; Client must be able to read it to sign;
    -- CDC views) — see note above re: the post-signing CRM lock not being
    -- expressible here.
    ('CRM Office',        'clientAgreement__c',           true,  true),
    ('External Customer', 'clientAgreement__c',           true,  false),
    ('CDC',               'clientAgreement__c',           true,  false),
    ('Auditor',           'clientAgreement__c',           false, false),
    ('Tech reviewer',     'clientAgreement__c',           false, false),

    -- Stage 1 audit plan (CRM/Auditor upload, Tech/CDC view, Client none)
    ('CRM Office',        'stage_one_audit_plan',         true,  true),
    ('Auditor',           'stage_one_audit_plan',         true,  true),
    ('Tech reviewer',     'stage_one_audit_plan',         true,  false),
    ('CDC',               'stage_one_audit_plan',         true,  false),
    ('External Customer', 'stage_one_audit_plan',         false, false),

    -- Stage 1 NCR (CRM/Auditor upload, CDC view, Client/Tech none)
    ('CRM Office',        'stage1_ncr',                   true,  true),
    ('Auditor',           'stage1_ncr',                   true,  true),
    ('CDC',               'stage1_ncr',                   true,  false),
    ('External Customer', 'stage1_ncr',                   false, false),
    ('Tech reviewer',     'stage1_ncr',                   false, false),

    -- Stage 1 NCR+RCA (Client uploads, everyone else views)
    ('External Customer', 'stage1_ncr_rca',               true,  true),
    ('CRM Office',        'stage1_ncr_rca',               true,  false),
    ('Auditor',           'stage1_ncr_rca',               true,  false),
    ('Tech reviewer',     'stage1_ncr_rca',               true,  false),
    ('CDC',               'stage1_ncr_rca',               true,  false),

    -- Stage 1 audit report (CRM/Auditor upload; Client read-only — code
    -- additionally hides it entirely until Tech Reviewer findings; Tech/CDC view)
    ('CRM Office',        'stage1_report',                true,  true),
    ('Auditor',           'stage1_report',                true,  true),
    ('External Customer', 'stage1_report',                true,  false),
    ('Tech reviewer',     'stage1_report',                true,  false),
    ('CDC',               'stage1_report',                true,  false),

    -- Stage 1 tech review checklist file (Tech uploads, CRM/Auditor/CDC view, Client none)
    ('Tech reviewer',     'stage1_tech_findings_file',    true,  true),
    ('CRM Office',        'stage1_tech_findings_file',    true,  false),
    ('Auditor',           'stage1_tech_findings_file',    true,  false),
    ('CDC',               'stage1_tech_findings_file',    true,  false),
    ('External Customer', 'stage1_tech_findings_file',    false, false),

    -- Stage 2 audit plan (mirrors Stage 1)
    ('CRM Office',        'Stage_two_audit_plan',         true,  true),
    ('Auditor',           'Stage_two_audit_plan',         true,  true),
    ('Tech reviewer',     'Stage_two_audit_plan',         true,  false),
    ('CDC',               'Stage_two_audit_plan',         true,  false),
    ('External Customer', 'Stage_two_audit_plan',         false, false),

    -- Stage 2 NCR (mirrors Stage 1)
    ('CRM Office',        'stage2_ncr',                   true,  true),
    ('Auditor',           'stage2_ncr',                   true,  true),
    ('CDC',               'stage2_ncr',                   true,  false),
    ('External Customer', 'stage2_ncr',                   false, false),
    ('Tech reviewer',     'stage2_ncr',                   false, false),

    -- Stage 2 NCR+RCA (mirrors Stage 1)
    ('External Customer', 'stage2_ncr_rca',               true,  true),
    ('CRM Office',        'stage2_ncr_rca',               true,  false),
    ('Auditor',           'stage2_ncr_rca',               true,  false),
    ('Tech reviewer',     'stage2_ncr_rca',               true,  false),
    ('CDC',               'stage2_ncr_rca',               true,  false),

    -- Stage 2 evidences (Client uploads, Auditor's "accept" is RPC-driven —
    -- so can_edit stays false here; everyone else views)
    ('External Customer', 'stage2_evidences',             true,  true),
    ('CRM Office',        'stage2_evidences',             true,  false),
    ('Auditor',           'stage2_evidences',             true,  false),
    ('Tech reviewer',     'stage2_evidences',             true,  false),
    ('CDC',               'stage2_evidences',             true,  false),

    -- Stage 2 audit report (mirrors Stage 1 report; Tech is plain "view" for
    -- Stage 2, no accept/findings step, but PS-wise it's still read-only)
    ('CRM Office',        'stage2_report',                true,  true),
    ('Auditor',           'stage2_report',                true,  true),
    ('External Customer', 'stage2_report',                true,  false),
    ('Tech reviewer',     'stage2_report',                true,  false),
    ('CDC',               'stage2_report',                true,  false),

    -- Stage 2 tech review checklist file (mirrors Stage 1)
    ('Tech reviewer',     'stage2_tech_findings_file',    true,  true),
    ('CRM Office',        'stage2_tech_findings_file',    true,  false),
    ('Auditor',           'stage2_tech_findings_file',    true,  false),
    ('CDC',               'stage2_tech_findings_file',    true,  false),
    ('External Customer', 'stage2_tech_findings_file',    false, false),

    -- CDC report (CDC uploads, CRM views, Auditor/Tech/Client none)
    ('CDC',               'cdc_report',                   true,  true),
    ('CRM Office',        'cdc_report',                   true,  false),
    ('Auditor',           'cdc_report',                   false, false),
    ('Tech reviewer',     'cdc_report',                   false, false),
    ('External Customer', 'cdc_report',                   false, false)
),
actual AS (
  SELECT
    ps.name AS ps_name,
    f.name  AS field_name,
    COALESCE(pse.can_read, true) AS act_can_read,
    COALESCE(pse.can_edit, true) AS act_can_edit
  FROM tenant.permission_sets ps
  CROSS JOIN tenant.fields f
  JOIN tenant.objects o ON o.id = f.object_id AND o.name = 'external_clients__a'
  LEFT JOIN tenant.permission_set_entries pse
    ON pse.permission_set_id = ps.id
   AND pse.resource_type = 'field'
   AND pse.resource_id = f.id
)
SELECT
  e.ps_name,
  e.field_name,
  e.exp_can_read, e.exp_can_edit,
  a.act_can_read, a.act_can_edit,
  CASE WHEN a.act_can_read IS NULL THEN 'PERMISSION SET NOT FOUND (name mismatch?)'
       WHEN e.exp_can_read <> a.act_can_read OR e.exp_can_edit <> a.act_can_edit THEN 'MISMATCH'
       ELSE 'ok' END AS status
FROM expected e
LEFT JOIN actual a ON a.ps_name = e.ps_name AND a.field_name = e.field_name
WHERE a.act_can_read IS NULL
   OR e.exp_can_read <> a.act_can_read
   OR e.exp_can_edit <> a.act_can_edit
ORDER BY e.field_name, e.ps_name;

-- ================================================================
-- Part 2 — role → permission set assignment check
-- Confirms every user whose custom_role_id maps to one of these 5 roles
-- actually HAS a row in tenant.user_permission_sets for the matching
-- permission set (a role→PS mapping existing isn't enough if the specific
-- user's row was never backfilled — this bit Auditor/Tech before, migration 245).
-- ================================================================
SELECT su.email, r.name AS custom_role_name, ps.name AS permission_set_name,
       CASE WHEN ups.user_id IS NULL THEN 'MISSING — user has no PS row, gets unrestricted access'
            ELSE 'ok' END AS status
FROM system.users su
JOIN tenant.roles r ON r.id = su.custom_role_id
LEFT JOIN tenant.role_permission_set_mappings m ON m.role_id = r.id AND m.tenant_id = su.tenant_id
LEFT JOIN tenant.permission_sets ps ON ps.id = m.permission_set_id
LEFT JOIN tenant.user_permission_sets ups ON ups.user_id = su.id AND ups.perm_set_id = ps.id
WHERE r.name IN ('CRM Office', 'Auditor', 'Tech reviewer', 'External Customer', 'CDC')
ORDER BY su.email;
