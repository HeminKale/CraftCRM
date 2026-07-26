-- ================================
-- Migration 240: Register 9 Stage 1/2 workflow dates in tenant.fields
--
-- All 9 columns already exist and are already stamped correctly by their
-- owning RPCs (233/234/237/238) — this migration only adds their
-- tenant.fields rows so they become visible in Object Manager's Fields tab
-- and placeable on the Page Layout. No column, RPC, or auto-advance logic
-- changes here.
--
-- Registered as plain editable 'date' fields, same trust model already
-- accepted for stage1_audit_date/stage2_audit_date (237/238) — this app has
-- no read-only field concept, so anyone with edit rights on the record can
-- now also hand-edit these through the generic form, bypassing the RPC that
-- normally owns each one. Confirmed acceptable by the stakeholder.
--
-- stage2_registration_date__a is deliberately NOT included here — see
-- 238's own comment: it's captured through StageAuditActionPanel's date
-- input + Confirm button, which sets status__a = 'Client_Registered' in the
-- same RPC call (set_stage2_registration_date). Registering it generically
-- would add a second write path that sets the date without moving status.
-- Confirmed with the stakeholder to leave this one alone.
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
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage1_plan_accepted_date', 'Stage 1 Plan Accept Date', 'date', false, false, 130, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage1_plan_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage1_auditor_accepted_date', 'Stage 1 NCR RCA Acceptance Date', 'date', false, false, 131, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage1_auditor_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_final_accepted_date', 'Tech Review 1 Date', 'date', false, false, 132, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage1_tech_final_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_plan_sent_date', 'Stage 2 Plan Sent Date', 'date', false, false, 133, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_plan_sent_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_plan_accepted_date', 'Stage 2 Plan Accept Date', 'date', false, false, 134, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_plan_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_auditor_accepted_date', 'Stage 2 Audit RCA Accept Date', 'date', false, false, 135, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_auditor_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_evidences_accepted_date', 'Stage 2 NCR Closure Date', 'date', false, false, 136, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_evidences_accepted_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_tech_findings_date', 'Tech Review 2 Date', 'date', false, false, 137, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_tech_findings_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'cdc_date', 'CDC Date', 'date', false, false, 138, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'cdc_date');
  END LOOP;
END $$;
