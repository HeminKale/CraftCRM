-- ================================================================
-- Migration 252: create_client_from_summary — admin-only RPC
--
-- "New Client from Summary" (NewClientFromSummaryForm.tsx) was originally
-- built calling create_object_record + upsert_client_summary directly from
-- the client, gated only by a client-side isCrmOrAdmin check — the same
-- pattern StageDateImport.tsx (Import Summary, an *update*-only flow) uses.
--
-- Stakeholder decision (2026-08-02): unlike Import Summary, creating a
-- brand-new client straight from a Summary sheet — which asserts every
-- workflow date up to whatever stage the sheet reaches actually happened,
-- with zero approval-chain RPCs involved (rights_S0-S6's normal
-- auditor/tech-reviewer/CDC review sequence never runs) — is admin-only.
-- CRM must not be able to do this.
--
-- A client-side role check alone is not a security boundary (same class of
-- gap 246 already found and fixed for auditor_id__a/tech_reviewer_id__a:
-- "can_edit in Permission Sets is enforced client-side only for
-- update_tenant_record — a DB trigger is not optional defense-in-depth
-- here, it's the only real enforcement available"). create_object_record
-- and upsert_client_summary are both generic, still-needed-elsewhere RPCs
-- (NewClientForm, the manual Summary edit form, Import Summary) — locking
-- them down would break those. So instead: one new wrapper RPC scoped to
-- exactly this flow, checking role = 'admin' itself before doing anything,
-- called from the client instead of the two generic RPCs directly.
-- Bonus: the External Client insert and the Summary upsert now happen
-- inside one function call, which is also more atomic than the previous
-- two-separate-round-trips approach.
-- ================================================================

CREATE OR REPLACE FUNCTION public.create_client_from_summary(
  p_tenant_id    UUID,
  p_ext_data     JSONB,  -- external_clients__a columns -> values (name, status__a, Date__a, created_by, updated_by, plus every parsed extColumn)
  p_summary_data JSONB   -- client_summary__a-only columns -> values, same shape upsert_client_summary already takes
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _new_id       UUID;
  _cols         TEXT;
  _vals         TEXT;
  _sql          TEXT;
  _summary_res  RECORD;
BEGIN
  _caller_id := auth.uid();
  SELECT su.role INTO _caller_role
  FROM system.users su
  WHERE su.id = _caller_id AND su.tenant_id = p_tenant_id;

  IF _caller_role IS DISTINCT FROM 'admin' THEN
    RETURN QUERY SELECT false, 'Cannot upload summary directly.', NULL::UUID;
    RETURN;
  END IF;

  IF p_ext_data IS NULL OR p_ext_data = '{}'::jsonb THEN
    RETURN QUERY SELECT false, 'No fields to create the client with.', NULL::UUID;
    RETURN;
  END IF;

  _new_id := gen_random_uuid();

  SELECT
    string_agg(format('%I', key), ', '),
    string_agg(format('%L', value), ', ')
  INTO _cols, _vals
  FROM jsonb_each_text(p_ext_data);

  _sql := format(
    'INSERT INTO tenant.external_clients__a (id, tenant_id, %s, created_at, updated_at) VALUES (%L, %L, %s, now(), now())',
    _cols, _new_id, p_tenant_id, _vals
  );
  EXECUTE _sql;
  -- trg_create_client_summary (220) fires here, auto-creating the linked
  -- client_summary__a row backfilled from the columns just inserted.

  IF p_summary_data IS NOT NULL AND p_summary_data <> '{}'::jsonb THEN
    SELECT * INTO _summary_res FROM public.upsert_client_summary(_new_id, p_summary_data);
    IF NOT _summary_res.success THEN
      RETURN QUERY SELECT false, COALESCE(_summary_res.message, 'Client created, but failed to write Summary fields'), _new_id;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'Client created from Summary sheet', _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client_from_summary(UUID, JSONB, JSONB) TO authenticated;
