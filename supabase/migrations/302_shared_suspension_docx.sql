-- Sprint 13: tenant-shared, versioned DOCX templates. No template/backfill/live enablement.
BEGIN;
INSERT INTO storage.buckets(id,name,public) VALUES('notification-templates','notification-templates',false) ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS notification_templates_private ON storage.objects;
CREATE POLICY notification_templates_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(bucket_id<>'notification-templates') WITH CHECK(bucket_id<>'notification-templates');
CREATE TABLE IF NOT EXISTS tenant.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
  storage_path text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid,
  activated_at timestamptz,activated_by uuid,UNIQUE(tenant_id,storage_path)
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_active_template ON tenant.notification_templates(tenant_id) WHERE active;
ALTER TABLE tenant.notification_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant.notification_templates FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.configure_suspension_docx(p_tenant uuid,p_path text,p_sha256 text,p_activate boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE template tenant.notification_templates;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||'/suspension-template',0));
  IF p_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM tenant.objects WHERE tenant_id=p_tenant AND name='external_clients__a') OR
    p_path IS NULL OR p_path NOT LIKE p_tenant::text||'/suspension/%' OR p_path !~ '^[a-zA-Z0-9/_-]+\.docx$' OR
    p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_activate IS NULL THEN RAISE EXCEPTION 'Invalid template configuration'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='notification-templates' AND public=false) OR NOT EXISTS(
    SELECT 1 FROM storage.objects WHERE bucket_id='notification-templates' AND name=p_path
      AND coalesce((metadata->>'size')::bigint,0)>0 AND (metadata->>'size')::bigint<=2097152
  ) THEN RAISE EXCEPTION 'Private DOCX template object unavailable'; END IF;
  SELECT * INTO template FROM tenant.notification_templates WHERE tenant_id=p_tenant AND storage_path=p_path;
  IF FOUND AND template.sha256<>p_sha256 THEN RAISE EXCEPTION 'Use a new version path for changed template bytes'; END IF;
  IF NOT FOUND THEN
    INSERT INTO tenant.notification_templates(tenant_id,storage_path,sha256,created_by) VALUES(p_tenant,p_path,p_sha256,auth.uid()) RETURNING * INTO template;
  END IF;
  IF p_activate THEN
    UPDATE tenant.notification_templates SET active=false WHERE tenant_id=p_tenant AND active;
    UPDATE tenant.notification_templates SET active=true,activated_at=now(),activated_by=auth.uid() WHERE id=template.id;
  END IF;
  RETURN template.id;
END; $$;

-- Mail worker calls this only after its delivery configuration has passed.
-- Registration alone never releases/sends a letter; explicit activation is required.
CREATE OR REPLACE FUNCTION public.release_suspension_letter()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r tenant.renewal_clients__a; c tenant.nonresponse_cases; t tenant.notification_templates; n tenant.notification_outbox;
BEGIN
  SELECT w.* INTO r FROM tenant.renewal_clients__a w JOIN tenant.nonresponse_cases candidate ON candidate.tenant_id=w.tenant_id AND candidate.record_id=w.id
    WHERE candidate.stage='suspended' AND EXISTS(SELECT 1 FROM tenant.notification_templates tpl WHERE tpl.tenant_id=w.tenant_id AND tpl.active)
      AND EXISTS(SELECT 1 FROM tenant.notification_outbox queued WHERE queued.tenant_id=w.tenant_id AND queued.record_id=w.id AND queued.object_name='renewal_clients__a'
        AND queued.notice_kind='nonresponse_suspension' AND queued.state='blocked' AND queued.last_error='suspension_template_pending' AND queued.first_request_at IS NULL AND queued.payload IS NULL)
    ORDER BY candidate.suspended_at,candidate.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=r.tenant_id AND record_id=r.id FOR UPDATE;
  SELECT * INTO t FROM tenant.notification_templates WHERE tenant_id=r.tenant_id AND active;
  SELECT * INTO n FROM tenant.notification_outbox WHERE tenant_id=r.tenant_id AND record_id=r.id AND object_name='renewal_clients__a'
    AND notice_kind='nonresponse_suspension' AND state='blocked' AND last_error='suspension_template_pending' AND first_request_at IS NULL AND payload IS NULL FOR UPDATE;
  IF n.id IS NULL OR t.id IS NULL THEN RETURN; END IF;
  IF c.external_client_id IS DISTINCT FROM r.external_client_id__a OR lower(trim(r.email__a)) IS DISTINCT FROM n.recipient THEN
    UPDATE tenant.notification_outbox SET last_error='suspension_letter_requires_review' WHERE id=n.id;
    PERFORM public._s13_transition(c.id,'template_release_worker','suspension_letter_requires_review',jsonb_build_object('notice_id',n.id));
    PERFORM public._observe_nonresponse(r.tenant_id,r.id,'template_release_worker');RETURN;
  END IF;
  UPDATE tenant.notification_outbox SET state='queued',last_error=NULL,next_attempt_at=now(),
    context=context||jsonb_build_object('template_id',t.id,'template_sha256',t.sha256) WHERE id=n.id;
  PERFORM public._s13_transition(c.id,'template_release_worker','suspension_letter_released',jsonb_build_object('notice_id',n.id,'template_id',t.id,'template_sha256',t.sha256));
  PERFORM public._observe_nonresponse(r.tenant_id,r.id,'template_release_worker');
END; $$;

CREATE OR REPLACE FUNCTION public.suspension_docx_for_notice(p_id uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object('bucket','notification-templates','path',t.storage_path,'sha256',t.sha256,
    'values',jsonb_build_object('company_name',coalesce(n.context->>'company',''),'contact_name',coalesce(n.context->>'contact',''),
      'record_id',n.record_id::text,'letter_reference',n.id::text,
      'suspension_date',to_char(c.suspended_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST',
      'intimation_upload_date',to_char(c.deadline_start_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST',
      'response_deadline',to_char(c.final_deadline_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST')) INTO result
  FROM tenant.notification_outbox n JOIN tenant.nonresponse_cases c ON c.tenant_id=n.tenant_id AND c.record_id=n.record_id
  JOIN tenant.notification_templates t ON t.tenant_id=n.tenant_id AND t.id::text=n.context->>'template_id' AND t.sha256=n.context->>'template_sha256'
  JOIN storage.buckets b ON b.id='notification-templates' AND b.public=false
  WHERE n.id=p_id AND n.lease_token=p_lease AND n.state='sending' AND n.lease_until>now() AND n.notice_kind='nonresponse_suspension' AND c.stage='suspended';
  RETURN result;
END; $$;

DO $$ BEGIN
  IF to_regprocedure('public._s13_prepare_before_docx(uuid,uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.prepare_notification(uuid,uuid,jsonb) RENAME TO _s13_prepare_before_docx;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.prepare_notification(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; r tenant.renewal_clients__a; c tenant.nonresponse_cases;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id;
  IF n.notice_kind<>'nonresponse_suspension' THEN RETURN public._s13_prepare_before_docx(p_id,p_lease,p_payload); END IF;
  SELECT * INTO r FROM tenant.renewal_clients__a WHERE id=n.record_id AND tenant_id=n.tenant_id FOR UPDATE;
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=n.tenant_id AND record_id=n.record_id FOR UPDATE;
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id AND lease_token=p_lease AND state='sending' AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale lease'; END IF;
  IF r.id IS NULL OR c.id IS NULL OR c.stage<>'suspended' OR c.external_client_id IS DISTINCT FROM r.external_client_id__a
    OR lower(trim(r.email__a)) IS DISTINCT FROM n.recipient OR public.suspension_docx_for_notice(p_id,p_lease) IS NULL OR NOT EXISTS(
      SELECT 1 FROM tenant.external_clients__a e WHERE e.id=c.external_client_id AND e.tenant_id=n.tenant_id
        AND e.status__a='Suspended' AND e.nonresponse_suspended_at__a=c.suspended_at
    ) THEN
    UPDATE tenant.notification_outbox SET state='blocked',last_error='suspension_letter_requires_review',lease_token=NULL,lease_until=NULL WHERE id=p_id;RETURN NULL;
  END IF;
  RETURN public._s13_prepare_notification_base(p_id,p_lease,p_payload);
END; $$;
REVOKE ALL ON FUNCTION public.configure_suspension_docx(uuid,text,text,boolean),public.release_suspension_letter(),public.suspension_docx_for_notice(uuid,uuid),
  public._s13_prepare_before_docx(uuid,uuid,jsonb),public.prepare_notification(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_suspension_docx(uuid,text,text,boolean),public.release_suspension_letter(),public.suspension_docx_for_notice(uuid,uuid),public.prepare_notification(uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public._observe_nonresponse(p_tenant uuid,p_record uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r jsonb; c tenant.nonresponse_cases; n tenant.notification_outbox; response jsonb;
  snapshot jsonb; holds jsonb := '[]'::jsonb; previous_stage text;
BEGIN
  SELECT to_jsonb(t) INTO r FROM tenant.renewal_clients__a t WHERE id=p_record AND tenant_id=p_tenant FOR UPDATE;
  IF r IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=p_tenant AND record_id=p_record FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  previous_stage:=c.stage;
  SELECT * INTO n FROM tenant.notification_outbox WHERE tenant_id=p_tenant AND id=c.source_notice_id;
  SELECT jsonb_build_object('action',action,'acted_at',acted_at,'revision',revision,'actor',actor_id) INTO response
    FROM tenant.notice_responses WHERE tenant_id=p_tenant AND object_name='renewal_clients__a'
      AND record_id=p_record AND notice_kind='intimation' ORDER BY acted_at DESC,id DESC LIMIT 1;
  IF NOT c.automation_enabled THEN holds:=holds||'"legacy_case_requires_review"'::jsonb;
  ELSIF c.suspended_at IS NOT NULL THEN
    c.stage:='suspended';
    IF response IS NOT NULL THEN holds:=holds||'"late_response_crm"'::jsonb; END IF;
    IF EXISTS(SELECT 1 FROM tenant.notification_outbox WHERE tenant_id=p_tenant AND record_id=p_record AND object_name='renewal_clients__a' AND notice_kind='nonresponse_suspension' AND last_error='suspension_template_pending') THEN
      holds:=holds||'"suspension_letter_template_pending"'::jsonb;
    END IF;
  ELSIF response->>'action'='reject' OR c.stage='rejected_ba_hold' THEN
    c.stage:='rejected_ba_hold';holds:=holds||'"reject_ba_pending"'::jsonb;
  ELSIF response->>'action'='accept' OR c.stage='accepted' THEN c.stage:='accepted';
  END IF;
  IF c.stage IN ('accepted','rejected_ba_hold','suspended') THEN
    -- Preserve any already-submitted provider evidence; a request in flight
    -- cannot be recalled. Lock order stays workflow -> case -> outbox.
    UPDATE tenant.notification_outbox SET state='cancelled',last_error='software_response_before_submission',lease_token=NULL,lease_until=NULL
      WHERE tenant_id=p_tenant AND record_id=p_record AND object_name='renewal_clients__a'
        AND notice_kind='nonresponse_reminder' AND first_request_at IS NULL AND state IN ('queued','retry','sending','blocked');
  END IF;
  IF nullif(trim(r->>'email__a'),'') IS NULL THEN holds:=holds||'"missing_record_email"'::jsonb; END IF;
  IF r->>'status__a' IS DISTINCT FROM 'Intimation_Sent' AND c.stage NOT IN ('accepted','rejected_ba_hold','suspended') THEN
    holds:=holds||'"checkpoint_not_awaiting_response"'::jsonb;
  END IF;
  IF c.external_client_id::text IS DISTINCT FROM r->>'external_client_id__a' THEN holds:=holds||'"linked_client_changed"'::jsonb; END IF;
  snapshot:=jsonb_build_object('policy_version',c.policy_version,'automation_enabled',c.automation_enabled,'outcome',c.stage,
    'holds',holds,'source_notice_id',c.source_notice_id,'revision',n.revision,'workflow_status',r->>'status__a',
    'notice_state',n.state,'upload_finalized_at',n.upload_finalized_at,'provider_accepted_at',n.accepted_at,
    'mail_server_delivered_at',n.delivered_at,'failed_at',n.failed_at,'software_response',response,
    'deadline_start_at',c.deadline_start_at,'first_deadline_at',c.first_deadline_at,'second_notice_issued_at',c.second_notice_issued_at,
    'final_deadline_at',c.final_deadline_at,'suspended_at',c.suspended_at);
  IF snapshot IS DISTINCT FROM c.evidence THEN
    INSERT INTO tenant.nonresponse_audit(case_id,actor_id,worker,outcome,policy_version,evidence)
      VALUES(c.id,auth.uid(),p_worker,'policy_hold',c.policy_version,snapshot);
  END IF;
  UPDATE tenant.nonresponse_cases SET stage=c.stage,evidence=snapshot,last_checked_at=clock_timestamp(),
    next_check_at=CASE WHEN c.stage IN ('accepted','rejected_ba_hold','suspended','crm_review') THEN now()+interval '1 day'
      ELSE least(now()+interval '5 minutes',coalesce(c.final_deadline_at,c.first_deadline_at,now()+interval '5 minutes')) END WHERE id=c.id;
  IF previous_stage IS DISTINCT FROM c.stage THEN PERFORM public._s13_transition(c.id,p_worker,c.stage,jsonb_build_object('software_response',response)); END IF;
  RETURN snapshot;
END; $$;

COMMIT;
