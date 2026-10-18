-- Sprint 13: DOCX remains the source; outgoing suspension payload must be PDF.
-- No backfill, conversion, mail, template activation or schedule enablement.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public._s13_prepare_before_pdf(uuid,uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.prepare_notification(uuid,uuid,jsonb) RENAME TO _s13_prepare_before_pdf;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.prepare_notification(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; effective jsonb; attachment jsonb;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id;
  IF n.notice_kind='nonresponse_suspension' THEN
    -- Preserve the workflow -> case -> outbox lock order used by 301/302.
    PERFORM 1 FROM tenant.renewal_clients__a WHERE tenant_id=n.tenant_id AND id=n.record_id FOR UPDATE;
    PERFORM 1 FROM tenant.nonresponse_cases WHERE tenant_id=n.tenant_id AND record_id=n.record_id FOR UPDATE;
    SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id AND lease_token=p_lease AND state='sending' AND lease_until>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stale lease'; END IF;
    -- Saved payloads may already have reached the provider. Never rewrite them.
    effective:=coalesce(n.payload,p_payload);
    attachment:=effective->'attachments'->0;
    IF jsonb_typeof(effective->'attachments') IS DISTINCT FROM 'array' THEN
      attachment:=NULL;
    ELSIF jsonb_array_length(effective->'attachments')<>1 THEN
      attachment:=NULL;
    END IF;
    IF attachment IS NULL OR attachment->>'filename' IS DISTINCT FROM 'suspension-'||n.record_id::text||'.pdf'
      OR attachment->>'content_type' IS DISTINCT FROM 'application/pdf'
      OR coalesce(attachment->>'content','') !~ '^JVBERi0[A-Za-z0-9+/]*={0,2}$'
      OR length(attachment->>'content')>13981016 OR length(attachment->>'content')%4<>0 THEN
      UPDATE tenant.notification_outbox SET state='review',last_error='suspension_pdf_required',lease_token=NULL,lease_until=NULL WHERE id=p_id;
      INSERT INTO tenant.notification_attempts(outbox_id,attempt,outcome,error_code) VALUES(p_id,n.attempts,'review','suspension_pdf_required');
      RETURN NULL;
    END IF;
  END IF;
  RETURN public._s13_prepare_before_pdf(p_id,p_lease,p_payload);
END; $$;
REVOKE ALL ON FUNCTION public._s13_prepare_before_pdf(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_notification(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_notification(uuid,uuid,jsonb) TO service_role;
COMMIT;
