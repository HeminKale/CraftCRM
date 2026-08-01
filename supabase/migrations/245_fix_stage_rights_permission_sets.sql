-- ================================================================
-- Sprint 2 correction (2026-08-01) — two independent bugs found while
-- verifying the manual Permission Set config against S6's row 9/14/23/24:
--
-- 1. permission_set_entries: some rows wrong, several missing entirely.
-- 2. auditor@craftcrm.test / tech@craftcrm.test have their role set but
--    have ZERO rows in tenant.user_permission_sets — confirmed via
--    _check_permission (209_enforce_permissions_in_rpcs.sql:42-51): no
--    rows there means FULL UNRESTRICTED ACCESS, not "mostly restricted".
--    The auto-assign trigger (212) only fires on a fresh UPDATE of
--    custom_role_id — it does not retroactively backfill users whose role
--    was already set before today's role->permission-set mappings existed.
--
-- Both parts are safe to re-run (upsert / NOT EXISTS guards).
-- ================================================================

-- ── Part 1: fix / complete the field-level entries ──────────────────
DO $$
DECLARE
  _object_id UUID;
BEGIN
  SELECT id INTO _object_id FROM tenant.objects WHERE name = 'external_clients__a' LIMIT 1;

  INSERT INTO tenant.permission_set_entries (permission_set_id, tenant_id, resource_type, resource_id, can_read, can_edit)
  SELECT ps.id, ps.tenant_id, 'field', f.id, v.can_read, v.can_edit
  FROM (VALUES
    ('CRM Office',        'cdc_report',                true,  false),
    ('Auditor',           'cdc_report',                false, false),
    ('Tech reviewer',     'cdc_report',                false, false),
    ('External Customer', 'cdc_report',                false, false),
    ('External Customer', 'stage1_ncr',                false, false),
    ('CRM Office',        'stage1_tech_findings_file', true,  false),
    ('External Customer', 'stage1_tech_findings_file', false, false),
    ('CRM Office',        'stage2_tech_findings_file', true,  false),
    ('External Customer', 'stage2_tech_findings_file', false, false)
  ) AS v(ps_name, field_name, can_read, can_edit)
  JOIN tenant.permission_sets ps ON ps.name = v.ps_name
  JOIN tenant.fields f ON f.object_id = _object_id AND f.name = v.field_name
  ON CONFLICT (permission_set_id, resource_type, resource_id)
  DO UPDATE SET can_read = EXCLUDED.can_read, can_edit = EXCLUDED.can_edit, updated_at = NOW();

  -- Remove the incorrect Auditor restriction on stage1_ncr. Auditor must stay
  -- fully unrestricted here (CRM/Auditor upload it per the rights matrix) —
  -- no entry at all IS the "unrestricted" state in this deny-list model.
  DELETE FROM tenant.permission_set_entries e
  USING tenant.permission_sets ps, tenant.fields f
  WHERE e.permission_set_id = ps.id
    AND e.resource_id = f.id
    AND e.resource_type = 'field'
    AND ps.name = 'Auditor'
    AND f.object_id = _object_id
    AND f.name = 'stage1_ncr';
END $$;

-- ── Part 2: backfill missing user_permission_sets rows ──────────────
-- Generic, not just for the two users found today — catches anyone whose
-- role->permission-set mapping exists but never got attached (including
-- whoever gets the CDC role assigned in future).
INSERT INTO tenant.user_permission_sets (user_id, perm_set_id, tenant_id)
SELECT su.id, m.permission_set_id, su.tenant_id
FROM system.users su
JOIN tenant.role_permission_set_mappings m
  ON m.role_id = su.custom_role_id AND m.tenant_id = su.tenant_id
WHERE su.custom_role_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant.user_permission_sets ups
    WHERE ups.user_id = su.id AND ups.perm_set_id = m.permission_set_id
  );

-- ================================================================
-- Verification — re-run these after the above, share the output
-- ================================================================

-- Should now show exactly 11 rows: 4 cdc_report + 1 stage1_ncr + 3
-- stage1_tech_findings_file + 3 stage2_tech_findings_file (2 of the 11 —
-- Auditor's tech-findings-file entries — were already correct beforehand
-- and untouched by this migration; confirmed live 2026-08-01).
SELECT ps.name AS permission_set_name, f.name AS field_name, pse.can_read, pse.can_edit
FROM tenant.permission_set_entries pse
JOIN tenant.permission_sets ps ON ps.id = pse.permission_set_id
JOIN tenant.fields f ON f.id = pse.resource_id
WHERE pse.resource_type = 'field'
  AND f.name IN ('stage1_ncr', 'cdc_report', 'stage1_tech_findings_file', 'stage2_tech_findings_file')
ORDER BY f.name, ps.name;

-- auditor@craftcrm.test and tech@craftcrm.test should now show their PS
SELECT su.email, r.name AS role_name, ps.name AS actually_assigned_permission_set
FROM system.users su
LEFT JOIN tenant.roles r ON r.id = su.custom_role_id
LEFT JOIN tenant.user_permission_sets ups ON ups.user_id = su.id
LEFT JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
ORDER BY su.email, ps.name;
