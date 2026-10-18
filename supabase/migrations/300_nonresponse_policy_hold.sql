-- Sprint 13: evidence/review only. Policy and letter templates remain unapproved.
-- No backfill, deadline, round 2, client status change, or restoration is enabled.
BEGIN;
CREATE TABLE IF NOT EXISTS tenant.nonresponse_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, record_id uuid NOT NULL,
  source_notice_id uuid NOT NULL REFERENCES tenant.notification_outbox(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL DEFAULT 's13-unapproved-v1' CHECK(policy_version='s13-unapproved-v1'),
  automation_enabled boolean NOT NULL DEFAULT false CHECK(automation_enabled=false),
  first_deadline_at timestamptz CHECK(first_deadline_at IS NULL),
  final_deadline_at timestamptz CHECK(final_deadline_at IS NULL),
  last_checked_at timestamptz, next_check_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(tenant_id,record_id)
);
CREATE INDEX IF NOT EXISTS nonresponse_review_due ON tenant.nonresponse_cases(next_check_at,id);
CREATE TABLE IF NOT EXISTS tenant.nonresponse_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES tenant.nonresponse_cases(id),
  observed_at timestamptz NOT NULL DEFAULT now(), actor_id uuid,
  worker text NOT NULL, outcome text NOT NULL CHECK(outcome='policy_hold'),
  policy_version text NOT NULL CHECK(policy_version='s13-unapproved-v1'),
  evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS nonresponse_audit_case ON tenant.nonresponse_audit(case_id,id);
ALTER TABLE tenant.nonresponse_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.nonresponse_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant.nonresponse_cases,tenant.nonresponse_audit FROM PUBLIC,anon,authenticated;

-- All observation writers lock the workflow first, just like the software
-- response RPC in 299, then its case. They never lock an outbox row. Provider
-- reconciliation locks outbox rows; this order avoids a reverse lock cycle.
CREATE OR REPLACE FUNCTION public._observe_nonresponse(p_tenant uuid,p_record uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r jsonb; c tenant.nonresponse_cases; n tenant.notification_outbox;
  response jsonb; snapshot jsonb; holds jsonb := '["policy_unapproved","letter_template_pending"]'::jsonb;
BEGIN
  SELECT to_jsonb(t) INTO r FROM tenant.renewal_clients__a t
    WHERE id=p_record AND tenant_id=p_tenant FOR UPDATE;
  IF r IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=p_tenant AND record_id=p_record FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO n FROM tenant.notification_outbox
    WHERE tenant_id=p_tenant AND object_name='renewal_clients__a' AND record_id=p_record
      AND notice_kind='intimation' AND notice_round=1
      AND revision=r->'surveillance_intimation_letter__a'->>'id'
    ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT jsonb_build_object('action',action,'acted_at',acted_at,'revision',revision,'actor',actor_id)
    INTO response FROM tenant.notice_responses
    WHERE tenant_id=p_tenant AND object_name='renewal_clients__a' AND record_id=p_record AND notice_kind='intimation'
    ORDER BY acted_at DESC,id DESC LIMIT 1;
  IF nullif(trim(r->>'email__a'),'') IS NULL THEN holds:=holds||'"missing_record_email"'::jsonb; END IF;
  IF n.id IS NULL THEN holds:=holds||'"current_notice_untracked"'::jsonb;
  ELSE
    IF lower(trim(r->>'email__a')) IS DISTINCT FROM n.recipient THEN holds:=holds||'"recipient_changed"'::jsonb; END IF;
    IF n.id<>c.source_notice_id THEN holds:=holds||'"replacement_policy_pending"'::jsonb; END IF;
    IF n.failed_at IS NOT NULL OR n.state NOT IN ('accepted','delivered') THEN holds:=holds||'"delivery_policy_pending"'::jsonb; END IF;
  END IF;
  IF response IS NOT NULL THEN holds:=holds||'"software_response_recorded"'::jsonb; END IF;
  IF r->>'status__a' IS DISTINCT FROM 'Intimation_Sent' THEN holds:=holds||'"checkpoint_not_awaiting_response"'::jsonb; END IF;
  IF nullif(r->>'external_client_id__a','') IS NULL OR NOT EXISTS (
    SELECT 1 FROM tenant.external_clients__a e WHERE e.tenant_id=p_tenant AND e.id::text=r->>'external_client_id__a'
  ) THEN holds:=holds||'"linked_client_unavailable"'::jsonb; END IF;
  snapshot:=jsonb_build_object('policy_version',c.policy_version,'automation_enabled',false,'outcome','policy_hold',
    'holds',holds,'source_notice_id',c.source_notice_id,'current_notice_id',n.id,
    'revision',r->'surveillance_intimation_letter__a'->>'id','workflow_status',r->>'status__a',
    'notice_state',n.state,'upload_finalized_at',n.upload_finalized_at,'provider_accepted_at',n.accepted_at,
    'mail_server_delivered_at',n.delivered_at,'failed_at',n.failed_at,'software_response',response,
    'deadline_start_at',NULL,'first_deadline_at',NULL,'final_deadline_at',NULL);
  -- Consecutive identical reviews do not create audit noise. A change back to
  -- earlier evidence is still a new event. The case lock serializes duplicates.
  IF snapshot IS DISTINCT FROM c.evidence THEN
    INSERT INTO tenant.nonresponse_audit(case_id,actor_id,worker,outcome,policy_version,evidence)
      VALUES(c.id,auth.uid(),p_worker,'policy_hold',c.policy_version,snapshot);
  END IF;
  UPDATE tenant.nonresponse_cases SET evidence=snapshot,last_checked_at=clock_timestamp(),next_check_at=now()+interval '5 minutes' WHERE id=c.id;
  RETURN snapshot;
END; $$;

-- Enrol only NEW transactional Surveillance intimation notices. Existing
-- notices and imported milestone dates are deliberately not backfilled.
CREATE OR REPLACE FUNCTION public._register_nonresponse_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.object_name='renewal_clients__a' AND NEW.notice_kind='intimation' AND NEW.notice_round=1 THEN
    INSERT INTO tenant.nonresponse_cases(tenant_id,record_id,source_notice_id)
      VALUES(NEW.tenant_id,NEW.record_id,NEW.id) ON CONFLICT(tenant_id,record_id) DO NOTHING;
    PERFORM public._observe_nonresponse(NEW.tenant_id,NEW.record_id,'notice_transaction');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS nonresponse_notice ON tenant.notification_outbox;
CREATE TRIGGER nonresponse_notice AFTER INSERT ON tenant.notification_outbox FOR EACH ROW EXECUTE FUNCTION public._register_nonresponse_notice();

CREATE OR REPLACE FUNCTION public._refresh_nonresponse_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='notice_responses' THEN
    IF NEW.object_name='renewal_clients__a' AND NEW.notice_kind='intimation' THEN
      PERFORM public._observe_nonresponse(NEW.tenant_id,NEW.record_id,'software_response_transaction');
    END IF;
  ELSIF current_setting('craft.summary_import_record',true) IS DISTINCT FROM NEW.id::text THEN
    PERFORM public._observe_nonresponse(NEW.tenant_id,NEW.id,'record_transaction');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS nonresponse_response ON tenant.notice_responses;
CREATE TRIGGER nonresponse_response AFTER INSERT ON tenant.notice_responses FOR EACH ROW EXECUTE FUNCTION public._refresh_nonresponse_evidence();
DROP TRIGGER IF EXISTS zz_nonresponse_record ON tenant.renewal_clients__a;
CREATE TRIGGER zz_nonresponse_record AFTER UPDATE OF email__a,status__a,surveillance_intimation_letter__a,external_client_id__a
  ON tenant.renewal_clients__a FOR EACH ROW EXECUTE FUNCTION public._refresh_nonresponse_evidence();

-- Bounded evidence worker. A crash rolls back both snapshot and audit. No
-- network work, durable lease, customer email or status change is involved.
CREATE OR REPLACE FUNCTION public.review_nonresponse_evidence()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record;
BEGIN
  SELECT t.id,t.tenant_id INTO r FROM tenant.renewal_clients__a t
    JOIN tenant.nonresponse_cases c ON c.record_id=t.id AND c.tenant_id=t.tenant_id
    WHERE c.next_check_at<=now() ORDER BY c.next_check_at,c.id
    LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('processed',false,'automation_enabled',false); END IF;
  PERFORM public._observe_nonresponse(r.tenant_id,r.id,'evidence_worker_v1');
  RETURN jsonb_build_object('processed',true,'automation_enabled',false,'outcome','policy_hold');
END; $$;

-- Reuse the existing tenant/object/field/sharing/linked-client history checks.
-- Wrapper is read-only; a page visit must not enrol records or start timers.
CREATE OR REPLACE FUNCTION public.get_record_nonresponse(p_object text,p_record uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history jsonb; c tenant.nonresponse_cases; audit jsonb; t uuid;
BEGIN
  history:=public.get_record_notifications(p_object,p_record);
  IF p_object<>'renewal_clients__a' THEN RETURN jsonb_build_object('in_scope',false); END IF;
  SELECT tenant_id INTO t FROM system.users WHERE id=auth.uid();
  SELECT * INTO c FROM tenant.nonresponse_cases WHERE tenant_id=t AND record_id=p_record;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO audit FROM (
    SELECT id,observed_at,actor_id,worker,outcome,policy_version,evidence FROM tenant.nonresponse_audit
    WHERE case_id=c.id ORDER BY id DESC LIMIT 20
  ) a;
  RETURN jsonb_build_object('in_scope',true,'automation_enabled',false,'policy_version','s13-unapproved-v1',
    'enrolled_at',c.enrolled_at,'last_checked_at',c.last_checked_at,'evidence',c.evidence,
    'responses',history->'responses','audit',audit,'first_deadline_at',NULL,'final_deadline_at',NULL);
END; $$;
REVOKE ALL ON FUNCTION public._observe_nonresponse(uuid,uuid,text),public._register_nonresponse_notice(),public._refresh_nonresponse_evidence(),public.review_nonresponse_evidence(),public.get_record_nonresponse(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_nonresponse_evidence() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_record_nonresponse(text,uuid) TO authenticated;
COMMIT;
