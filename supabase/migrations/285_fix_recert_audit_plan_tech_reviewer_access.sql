-- ============================================================
-- Migration 285: Fix incorrect Tech Reviewer deny on recert_audit_plan
--
-- Migration 269 (Recertification Sprint 6 Permission Set entries) denied
-- Tech Reviewer read access on recert_audit_plan ("Row 8 — audit plan:
-- blank for Tech Reviewer only"). Re-checking against the actual
-- rights-matrix screenshot (confirmed by the user) shows Tech Reviewer =
-- "view" on this row, not blank — 269's entry was a mistake, not a
-- deliberate divergence.
--
-- Fix: remove the incorrect deny entry. No replacement entry needed —
-- Permission Sets are deny-list for object/field resources (accessible
-- unless explicitly denied), so removing the row restores the correct
-- default "view" access, matching how every other non-blank cell in both
-- the Surveillance 1 and Recertification matrices needs no PS entry at
-- all (see 263's and 269's own header comments).
--
-- Matched by tenant + Permission Set name + field name, not a hardcoded
-- UUID, same technique as 263/269. Safe to re-run — a second run simply
-- deletes nothing if the row is already gone.
-- ============================================================

DO $$
DECLARE
  _tenant_id   UUID;
  _object_id   UUID;
  _field_id    UUID;
  _perm_set_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'recert_audit_plan' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _perm_set_id FROM tenant.permission_sets
    WHERE tenant_id = _tenant_id AND lower(name) = lower('Tech reviewer') LIMIT 1;
    IF _perm_set_id IS NULL THEN CONTINUE; END IF;

    DELETE FROM tenant.permission_set_entries
    WHERE permission_set_id = _perm_set_id
      AND tenant_id = _tenant_id
      AND resource_type = 'field'
      AND resource_id = _field_id;
  END LOOP;
END $$;
