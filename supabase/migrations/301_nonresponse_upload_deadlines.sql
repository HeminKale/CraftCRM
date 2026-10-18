-- Sprint 13 continuation: user-approved upload-based 30 + 10 IST calendar days.
-- No live enablement/backfill. Reject -> BA hold; late responses -> CRM, no restore.
BEGIN;
CREATE OR REPLACE FUNCTION public._s13_ist_after(p_start timestamptz,p_days integer)
RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT (p_start AT TIME ZONE 'Asia/Kolkata' + make_interval(days=>p_days)) AT TIME ZONE 'Asia/Kolkata'
$$;
ALTER TABLE tenant.nonresponse_cases
  DROP CONSTRAINT IF EXISTS nonresponse_cases_policy_version_check,
  DROP CONSTRAINT IF EXISTS nonresponse_cases_automation_enabled_check,
  DROP CONSTRAINT IF EXISTS nonresponse_cases_first_deadline_at_check,
  DROP CONSTRAINT IF EXISTS nonresponse_cases_final_deadline_at_check;
ALTER TABLE tenant.nonresponse_cases
  ADD COLUMN IF NOT EXISTS deadline_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_notice_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_notice_id uuid REFERENCES tenant.notification_outbox(id),
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_client_id uuid,
  ADD COLUMN IF NOT EXISTS prior_client_status text,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'legacy_hold';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='tenant.nonresponse_cases'::regclass AND conname='nonresponse_timing_policy') THEN
    ALTER TABLE tenant.nonresponse_cases ADD CONSTRAINT nonresponse_timing_policy CHECK (
      (policy_version='s13-unapproved-v1' AND NOT automation_enabled AND deadline_start_at IS NULL AND first_deadline_at IS NULL AND final_deadline_at IS NULL)
      OR (policy_version='s13-upload-ist-v1' AND automation_enabled AND deadline_start_at IS NOT NULL
        AND first_deadline_at IS NOT NULL AND first_deadline_at=public._s13_ist_after(deadline_start_at,30)
        AND ((second_notice_issued_at IS NULL AND second_notice_id IS NULL AND final_deadline_at IS NULL)
          OR (second_notice_issued_at IS NOT NULL AND second_notice_id IS NOT NULL AND final_deadline_at IS NOT NULL AND final_deadline_at=public._s13_ist_after(second_notice_issued_at,10))))
    );
  END IF;
END $$;
ALTER TABLE tenant.nonresponse_audit DROP CONSTRAINT IF EXISTS nonresponse_audit_policy_version_check;
ALTER TABLE tenant.nonresponse_audit ADD CONSTRAINT nonresponse_audit_policy_version_check CHECK(policy_version IN ('s13-unapproved-v1','s13-upload-ist-v1'));
-- Keep the stable outcome for the original evidence-review API. New transitions
-- have a separate private, append-only application journal.
CREATE TABLE IF NOT EXISTS tenant.nonresponse_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES tenant.nonresponse_cases(id),
  occurred_at timestamptz NOT NULL DEFAULT now(), actor_id uuid,
  worker text NOT NULL, outcome text NOT NULL, evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS nonresponse_transitions_case ON tenant.nonresponse_transitions(case_id,id);
ALTER TABLE tenant.nonresponse_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant.nonresponse_transitions FROM PUBLIC,anon,authenticated;

ALTER TABLE tenant.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_notice_kind_check,
  DROP CONSTRAINT IF EXISTS notification_outbox_notice_round_check;
ALTER TABLE tenant.notification_outbox ADD CONSTRAINT notification_outbox_notice_kind_check
  CHECK(notice_kind IN ('record_created','intimation','invitation','nonresponse_reminder','nonresponse_suspension'));
ALTER TABLE tenant.notification_outbox ADD CONSTRAINT notification_outbox_notice_round_check CHECK (
  (notice_kind IN ('record_created','intimation','invitation') AND notice_round=1)
  OR (object_name='renewal_clients__a' AND notice_kind='nonresponse_reminder' AND notice_round=2)
  OR (object_name='renewal_clients__a' AND notice_kind='nonresponse_suspension' AND notice_round=3)
);
CREATE UNIQUE INDEX IF NOT EXISTS nonresponse_logical_notice ON tenant.notification_outbox(tenant_id,object_name,record_id,notice_kind)
  WHERE notice_kind IN ('nonresponse_reminder','nonresponse_suspension');
ALTER TABLE tenant.external_clients__a ADD COLUMN IF NOT EXISTS nonresponse_suspended_at__a timestamptz;

CREATE OR REPLACE FUNCTION public._s13_transition(p_case uuid,p_worker text,p_outcome text,p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  INSERT INTO tenant.nonresponse_transitions(case_id,actor_id,worker,outcome,evidence)
  SELECT id,auth.uid(),p_worker,p_outcome,jsonb_build_object('policy',policy_version,'source_notice_id',source_notice_id,
    'deadline_start_at',deadline_start_at,'first_deadline_at',first_deadline_at,'second_notice_id',second_notice_id,
    'second_notice_issued_at',second_notice_issued_at,'final_deadline_at',final_deadline_at,'suspended_at',suspended_at,
    'external_client_id',external_client_id,'prior_client_status',prior_client_status,'stage',stage)||p_extra
  FROM tenant.nonresponse_cases WHERE id=p_case
$$;

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
    holds:=holds||'"suspension_letter_template_pending"'::jsonb;
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

CREATE OR REPLACE FUNCTION public._register_nonresponse_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE linked uuid; c uuid; start_at timestamptz;
BEGIN
  IF NEW.object_name='renewal_clients__a' AND NEW.notice_kind='intimation' AND NEW.notice_round=1 THEN
    -- Upload finalisation, not attachment-start, provider acceptance or delivery.
    -- No migration backfill. ON CONFLICT preserves every original window.
    SELECT external_client_id__a INTO linked FROM tenant.renewal_clients__a WHERE id=NEW.record_id AND tenant_id=NEW.tenant_id FOR UPDATE;
    start_at:=NEW.upload_finalized_at;
    IF start_at IS NULL THEN RETURN NEW; END IF;
    INSERT INTO tenant.nonresponse_cases(tenant_id,record_id,source_notice_id,policy_version,automation_enabled,
      deadline_start_at,first_deadline_at,external_client_id,stage)
    VALUES(NEW.tenant_id,NEW.record_id,NEW.id,'s13-upload-ist-v1',true,start_at,public._s13_ist_after(start_at,30),linked,'first_window')
    ON CONFLICT(tenant_id,record_id) DO NOTHING RETURNING id INTO c;
    IF c IS NOT NULL THEN PERFORM public._s13_transition(c,'notice_transaction','first_window_started'); END IF;
    PERFORM public._observe_nonresponse(NEW.tenant_id,NEW.record_id,'notice_transaction');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public._guard_nonresponse_suspension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.nonresponse_suspended_at__a IS NOT NULL OR NEW.status__a='Suspended' THEN
      RAISE EXCEPTION 'A new client cannot assert a non-response suspension';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.nonresponse_suspended_at__a IS NOT NULL AND
    (NEW.nonresponse_suspended_at__a IS DISTINCT FROM OLD.nonresponse_suspended_at__a OR NEW.status__a IS DISTINCT FROM 'Suspended') THEN
    RAISE EXCEPTION 'Non-response suspension remains active. Restoration requires an approved CRM process.';
  END IF;
  IF NEW.nonresponse_suspended_at__a IS DISTINCT FROM OLD.nonresponse_suspended_at__a OR
    (NEW.status__a='Suspended' AND OLD.status__a IS DISTINCT FROM 'Suspended') THEN
    IF NEW.status__a IS DISTINCT FROM 'Suspended' OR NEW.nonresponse_suspended_at__a IS NULL OR NOT EXISTS (
      SELECT 1 FROM tenant.nonresponse_cases c WHERE c.tenant_id=NEW.tenant_id AND c.external_client_id=NEW.id
        AND c.stage='suspended' AND c.suspended_at=NEW.nonresponse_suspended_at__a
    ) THEN RAISE EXCEPTION 'Use the authorised non-response transition to suspend this client'; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS nonresponse_suspension_guard ON tenant.external_clients__a;
CREATE TRIGGER nonresponse_suspension_guard BEFORE INSERT OR UPDATE ON tenant.external_clients__a FOR EACH ROW EXECUTE FUNCTION public._guard_nonresponse_suspension();

CREATE OR REPLACE FUNCTION public.process_nonresponse()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r tenant.renewal_clients__a; c tenant.nonresponse_cases; source tenant.notification_outbox;
  e tenant.external_clients__a; notice uuid; address text; due timestamptz;
BEGIN
  SELECT t.* INTO r FROM tenant.renewal_clients__a t JOIN tenant.nonresponse_cases x ON x.record_id=t.id AND x.tenant_id=t.tenant_id
    WHERE x.automation_enabled AND x.stage IN ('first_window','second_window') AND x.next_check_at<=now()
    ORDER BY x.next_check_at,x.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('processed',false); END IF;
  PERFORM public._observe_nonresponse(r.tenant_id,r.id,'deadline_worker_v1');
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE record_id=r.id AND tenant_id=r.tenant_id FOR UPDATE;
  IF c.stage NOT IN ('first_window','second_window') THEN RETURN jsonb_build_object('processed',true,'outcome',c.stage); END IF;
  address:=lower(trim(r.email__a));
  due:=coalesce(c.final_deadline_at,c.first_deadline_at);
  IF r.status__a IS DISTINCT FROM 'Intimation_Sent' OR c.external_client_id IS DISTINCT FROM r.external_client_id__a THEN
    UPDATE tenant.nonresponse_cases SET stage='crm_review' WHERE id=c.id;
    PERFORM public._s13_transition(c.id,'deadline_worker_v1','crm_review',jsonb_build_object('reason','checkpoint_or_link_changed'));
    RETURN jsonb_build_object('processed',true,'outcome','crm_review');
  END IF;
  IF coalesce(address,'') !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' OR due>now() THEN
    UPDATE tenant.nonresponse_cases SET next_check_at=CASE WHEN due>now() THEN due ELSE now()+interval '5 minutes' END WHERE id=c.id;
    RETURN jsonb_build_object('processed',true,'outcome',CASE WHEN due>now() THEN 'not_due' ELSE 'ignored_missing_email' END);
  END IF;
  -- The workflow lock serializes with Accept/Reject. Recheck immediately before
  -- either mutation, including responses on an earlier replacement revision.
  IF EXISTS(SELECT 1 FROM tenant.notice_responses WHERE tenant_id=r.tenant_id AND record_id=r.id AND object_name='renewal_clients__a' AND notice_kind='intimation') THEN
    PERFORM public._observe_nonresponse(r.tenant_id,r.id,'deadline_worker_v1');
    RETURN jsonb_build_object('processed',true,'outcome','software_response');
  END IF;
  SELECT * INTO e FROM tenant.external_clients__a WHERE id=c.external_client_id AND tenant_id=r.tenant_id FOR UPDATE;
  IF NOT FOUND OR lower(coalesce(e.status__a,'')) LIKE ANY(ARRAY['%suspend%','%suspens%','%withdraw%']) THEN
    UPDATE tenant.nonresponse_cases SET stage='crm_review' WHERE id=c.id;
    PERFORM public._s13_transition(c.id,'deadline_worker_v1','crm_review',jsonb_build_object('reason','missing_or_already_suspended_client'));
    RETURN jsonb_build_object('processed',true,'outcome','crm_review');
  END IF;
  SELECT * INTO source FROM tenant.notification_outbox WHERE id=c.source_notice_id AND tenant_id=r.tenant_id;
  IF c.stage='first_window' THEN
    INSERT INTO tenant.notification_outbox(tenant_id,object_name,record_id,notice_kind,notice_round,revision,recipient,context,attachment_id)
      VALUES(r.tenant_id,'renewal_clients__a',r.id,'nonresponse_reminder',2,c.id::text,address,
        jsonb_build_object('company',coalesce(to_jsonb(r)->>'company_name__a',to_jsonb(r)->>'name'),'contact',to_jsonb(r)->>'contact_person__a',
          'case_id',c.id,'source_notice_id',source.id,'response_due_at',public._s13_ist_after(now(),10)),source.attachment_id)
      RETURNING id INTO notice;
    UPDATE tenant.nonresponse_cases SET stage='second_window',second_notice_id=notice,second_notice_issued_at=now(),
      final_deadline_at=public._s13_ist_after(now(),10),next_check_at=public._s13_ist_after(now(),10) WHERE id=c.id;
    PERFORM public._s13_transition(c.id,'deadline_worker_v1','second_notice_issued');
  ELSE
    -- Suspension is a status change on the linked External Client only. Keep
    -- the Surveillance checkpoint and all audit/certificate history intact.
    UPDATE tenant.nonresponse_cases SET stage='suspended',suspended_at=now(),prior_client_status=e.status__a WHERE id=c.id;
    UPDATE tenant.external_clients__a SET status__a='Suspended',nonresponse_suspended_at__a=now() WHERE id=e.id AND tenant_id=r.tenant_id;
    INSERT INTO tenant.notification_outbox(tenant_id,object_name,record_id,notice_kind,notice_round,revision,recipient,context,state,last_error)
      VALUES(r.tenant_id,'renewal_clients__a',r.id,'nonresponse_suspension',3,c.id::text,address,
        jsonb_build_object('company',coalesce(to_jsonb(r)->>'company_name__a',to_jsonb(r)->>'name'),'contact',to_jsonb(r)->>'contact_person__a',
          'case_id',c.id,'source_notice_id',source.id,'suspended_at',now()),'blocked','suspension_template_pending');
    PERFORM public._s13_transition(c.id,'deadline_worker_v1','client_suspended',jsonb_build_object('letter_outcome','blocked_template_pending'));
  END IF;
  PERFORM public._observe_nonresponse(r.tenant_id,r.id,'deadline_worker_v1');
  RETURN jsonb_build_object('processed',true,'outcome',CASE WHEN c.stage='first_window' THEN 'second_notice_issued' ELSE 'client_suspended' END);
END; $$;

-- Preserve Sprint 12 payload/lease/recipient validation. Additional response
-- checks acquire workflow before outbox; no outbox -> workflow lock cycle.
DO $$ BEGIN
  IF to_regprocedure('public._s13_prepare_notification_base(uuid,uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.prepare_notification(uuid,uuid,jsonb) RENAME TO _s13_prepare_notification_base;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.prepare_notification(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; r tenant.renewal_clients__a; c tenant.nonresponse_cases; address text;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id;
  IF n.notice_kind='nonresponse_suspension' THEN RAISE EXCEPTION 'Approved suspension letter template is not configured'; END IF;
  IF n.notice_kind='nonresponse_reminder' THEN
    SELECT * INTO r FROM tenant.renewal_clients__a WHERE id=n.record_id AND tenant_id=n.tenant_id FOR UPDATE;
    SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=n.tenant_id AND record_id=n.record_id FOR UPDATE;
    SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id AND lease_token=p_lease AND state='sending' AND lease_until>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stale lease'; END IF;
    IF r.id IS NULL OR c.id IS NULL OR c.second_notice_id IS DISTINCT FROM n.id OR c.stage<>'second_window' OR r.status__a IS DISTINCT FROM 'Intimation_Sent'
      OR c.external_client_id IS DISTINCT FROM r.external_client_id__a
      OR NOT EXISTS(SELECT 1 FROM tenant.external_clients__a e WHERE e.id=c.external_client_id AND e.tenant_id=n.tenant_id
        AND lower(coalesce(e.status__a,'')) NOT LIKE ALL(ARRAY['%suspend%','%suspens%','%withdraw%']))
      OR EXISTS(SELECT 1 FROM tenant.notice_responses WHERE tenant_id=n.tenant_id AND record_id=n.record_id AND object_name='renewal_clients__a' AND notice_kind='intimation') THEN
      UPDATE tenant.notification_outbox SET state='cancelled',last_error='nonresponse_no_longer_eligible',lease_token=NULL,lease_until=NULL WHERE id=p_id;RETURN NULL;
    END IF;
    address:=lower(trim(r.email__a));
    IF address IS DISTINCT FROM n.recipient THEN
      UPDATE tenant.notification_outbox SET state='blocked',last_error='recipient_changed_before_submission',lease_token=NULL,lease_until=NULL WHERE id=p_id;RETURN NULL;
    END IF;
  END IF;
  RETURN public._s13_prepare_notification_base(p_id,p_lease,p_payload);
END; $$;

-- A late response is a CRM matter: record it without advancing the workflow or
-- clearing suspension. The authorised linked-client/admin identity gate stays.
DO $$ BEGIN
  IF to_regprocedure('public._s13_review_before_timing(uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.review_surveillance_intimation(uuid,text,text) RENAME TO _s13_review_before_timing;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.review_surveillance_intimation(p_record_id uuid,p_action text,p_notes text DEFAULT NULL)
RETURNS TABLE(success boolean,message text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u record; r tenant.renewal_clients__a; c tenant.nonresponse_cases;
BEGIN
  SELECT tenant_id,role,email INTO u FROM system.users WHERE id=auth.uid();
  SELECT * INTO r FROM tenant.renewal_clients__a WHERE id=p_record_id AND tenant_id=u.tenant_id FOR UPDATE;
  IF NOT FOUND OR u.tenant_id IS NULL OR (u.role IS DISTINCT FROM 'admin' AND r.client_user_id__a IS DISTINCT FROM auth.uid()
    AND (nullif(trim(r.email__a),'') IS NULL OR lower(trim(r.email__a)) IS DISTINCT FROM lower(trim(u.email)))) THEN
    RETURN QUERY SELECT false,'Access denied'::text;RETURN;
  END IF;
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=u.tenant_id AND record_id=p_record_id FOR UPDATE;
  IF c.suspended_at IS NULL THEN RETURN QUERY SELECT * FROM public._s13_review_before_timing(p_record_id,p_action,p_notes);RETURN; END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept','reject') THEN RETURN QUERY SELECT false,'Invalid action'::text;RETURN; END IF;
  IF EXISTS(SELECT 1 FROM tenant.notice_responses WHERE tenant_id=u.tenant_id AND record_id=p_record_id AND object_name='renewal_clients__a' AND notice_kind='intimation') THEN
    RETURN QUERY SELECT false,'A response is already recorded for CRM review'::text;RETURN;
  END IF;
  INSERT INTO tenant.notice_responses(tenant_id,record_id,object_name,notice_kind,actor_id,action,workflow_status,revision)
    VALUES(u.tenant_id,p_record_id,'renewal_clients__a','intimation',auth.uid(),p_action,r.status__a,r.surveillance_intimation_letter__a->>'id');
  PERFORM public._s13_transition(c.id,'software_response_transaction','late_response_for_crm',jsonb_build_object('action',p_action,'notes',p_notes));
  RETURN QUERY SELECT true,'Response recorded for CRM review. Client remains suspended.'::text;
END; $$;

CREATE OR REPLACE FUNCTION public.get_record_nonresponse(p_object text,p_record uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history jsonb; c tenant.nonresponse_cases; audit jsonb; transitions jsonb; t uuid;
BEGIN
  history:=public.get_record_notifications(p_object,p_record);
  IF p_object<>'renewal_clients__a' THEN RETURN jsonb_build_object('in_scope',false); END IF;
  SELECT tenant_id INTO t FROM system.users WHERE id=auth.uid();
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=t AND record_id=p_record;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO audit FROM (
    SELECT id,observed_at,actor_id,worker,outcome,policy_version,evidence FROM tenant.nonresponse_audit WHERE case_id=c.id ORDER BY id DESC LIMIT 20
  ) a;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO transitions FROM (
    SELECT id,occurred_at,actor_id,worker,outcome,evidence FROM tenant.nonresponse_transitions WHERE case_id=c.id ORDER BY id DESC LIMIT 20
  ) a;
  RETURN jsonb_build_object('in_scope',true,'automation_enabled',coalesce(c.automation_enabled,false),'policy_version',c.policy_version,
    'enrolled_at',c.enrolled_at,'last_checked_at',c.last_checked_at,'evidence',c.evidence,'stage',c.stage,
    'responses',history->'responses','audit',audit,'transitions',transitions,'deadline_start_at',c.deadline_start_at,
    'first_deadline_at',c.first_deadline_at,'final_deadline_at',c.final_deadline_at,'second_notice_issued_at',c.second_notice_issued_at,'suspended_at',c.suspended_at);
END; $$;

-- Register the approved semantic External Client status without altering a
-- field's existing type/layout or granting generic edit/restoration rights.
INSERT INTO tenant.picklist_values(tenant_id,field_id,value,label,display_order,is_active)
SELECT o.tenant_id,f.id,'Suspended','Suspended',999,true
FROM tenant.objects o JOIN tenant.fields f ON f.object_id=o.id
WHERE o.name='external_clients__a' AND regexp_replace(f.name,'__a$','')='status'
  AND NOT EXISTS(SELECT 1 FROM tenant.picklist_values p WHERE p.field_id=f.id AND p.value='Suspended');
REVOKE ALL ON FUNCTION public._s13_ist_after(timestamptz,integer),public._s13_transition(uuid,text,text,jsonb),public._guard_nonresponse_suspension(),
  public._s13_prepare_notification_base(uuid,uuid,jsonb),public._s13_review_before_timing(uuid,text,text),public.process_nonresponse() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_nonresponse() TO service_role;
REVOKE ALL ON FUNCTION public.prepare_notification(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_notification(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.review_surveillance_intimation(uuid,text,text),public.get_record_nonresponse(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_surveillance_intimation(uuid,text,text),public.get_record_nonresponse(text,uuid) TO authenticated;
COMMIT;
