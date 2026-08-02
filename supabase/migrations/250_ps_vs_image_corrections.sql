-- ================================================================
-- Migration 250: bring Permission Set entries in line with the rights-
-- matrix image, per the one-shot comparison in rights_S5d_ps_vs_image.sql
-- (2026-08-02 — 42 mismatches found across Auditor/CDC/CRM Office/
-- External Customer/Tech reviewer on external_clients__a fields).
--
-- Reproduces every expected (ps_name, field_name, can_read, can_edit) tuple
-- from that comparison query — not just the ones that were mismatched, so
-- this is idempotent/safe to re-run and doubles as the canonical "this is
-- what these 5 roles should look like on this object" reference. Same
-- upsert pattern as migration 245.
--
-- Explicitly NOT covered here (see rights_S5d's header for why): the
-- "accept"/"assign"/"write" actions gated by RPC role checks, not PS, and
-- the client-agreement post-signing CRM lock (workflow-conditional, PS is
-- static).
-- ================================================================

DO $$
DECLARE
  _object_id UUID;
BEGIN
  SELECT id INTO _object_id FROM tenant.objects WHERE name = 'external_clients__a' LIMIT 1;

  INSERT INTO tenant.permission_set_entries (permission_set_id, tenant_id, resource_type, resource_id, can_read, can_edit)
  SELECT ps.id, ps.tenant_id, 'field', f.id, v.can_read, v.can_edit
  FROM (VALUES
    -- Application form (Client uploads, CRM/CDC view, Auditor/Tech none)
    ('External Customer', 'application_Form',            true,  true),
    ('CRM Office',        'application_Form',            true,  false),
    ('CDC',               'application_Form',            true,  false),
    ('Auditor',           'application_Form',            false, false),
    ('Tech reviewer',     'application_Form',            false, false),

    -- Quotation (CRM uploads, Client/CDC view, Auditor/Tech none)
    ('External Customer', 'quotation',                    true,  false),
    ('CRM Office',        'quotation',                    true,  true),
    ('CDC',               'quotation',                    true,  false),
    ('Auditor',           'quotation',                    false, false),
    ('Tech reviewer',     'quotation',                    false, false),

    -- Client agreement (CRM uploads; Client reads to sign; CDC views)
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

    -- Stage 1 audit report (CRM/Auditor upload; Client/Tech/CDC view —
    -- code separately hides it from Client until Tech findings are given)
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

    -- Stage 2 evidences (Client uploads; Auditor's "accept" is RPC-driven,
    -- so can_edit stays false; everyone else views)
    ('External Customer', 'stage2_evidences',             true,  true),
    ('CRM Office',        'stage2_evidences',             true,  false),
    ('Auditor',           'stage2_evidences',             true,  false),
    ('Tech reviewer',     'stage2_evidences',             true,  false),
    ('CDC',               'stage2_evidences',             true,  false),

    -- Stage 2 audit report (mirrors Stage 1 report)
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
  ) AS v(ps_name, field_name, can_read, can_edit)
  JOIN tenant.permission_sets ps ON ps.name = v.ps_name
  JOIN tenant.fields f ON f.object_id = _object_id AND f.name = v.field_name
  ON CONFLICT (permission_set_id, resource_type, resource_id)
  DO UPDATE SET can_read = EXCLUDED.can_read, can_edit = EXCLUDED.can_edit, updated_at = NOW();
END $$;
