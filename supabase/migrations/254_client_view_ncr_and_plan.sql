-- ================================================================
-- Migration 254: give External Customer (Client) VIEW access to the
-- Stage 1/2 NCR and Stage 1/2 Audit Plan fields
--
-- Stakeholder request (2026-08-04): the rights-matrix image was blank for
-- these four fields under the Client's column — explicit follow-up request
-- to grant view-only access (can_read=true, can_edit=false), matching the
-- Client's access pattern on every other stage document (Auditor/Tech/CDC
-- all already view these; Client was the one role excluded). Upload/edit
-- stays CRM/Auditor-only — nothing else about these fields changes.
--
-- Same idempotent upsert pattern as migrations 245/250 — only touches the
-- 4 (ps_name, field_name) tuples below, every other PS entry on
-- external_clients__a (including this same PS's other field rows) is left
-- exactly as migration 250 set it.
-- ================================================================

DO $$
DECLARE
  _object_id UUID;
BEGIN
  SELECT id INTO _object_id FROM tenant.objects WHERE name = 'external_clients__a' LIMIT 1;

  INSERT INTO tenant.permission_set_entries (permission_set_id, tenant_id, resource_type, resource_id, can_read, can_edit)
  SELECT ps.id, ps.tenant_id, 'field', f.id, v.can_read, v.can_edit
  FROM (VALUES
    ('External Customer', 'stage_one_audit_plan',  true, false),
    ('External Customer', 'Stage_two_audit_plan',  true, false),
    ('External Customer', 'stage1_ncr',            true, false),
    ('External Customer', 'stage2_ncr',             true, false)
  ) AS v(ps_name, field_name, can_read, can_edit)
  JOIN tenant.permission_sets ps ON ps.name = v.ps_name
  JOIN tenant.fields f ON f.object_id = _object_id AND f.name = v.field_name
  ON CONFLICT (permission_set_id, resource_type, resource_id)
  DO UPDATE SET can_read = EXCLUDED.can_read, can_edit = EXCLUDED.can_edit, updated_at = NOW();
END $$;
