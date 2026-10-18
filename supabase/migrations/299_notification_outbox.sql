-- Sprint 12 only. Local/manual migration; no suspension scheduler or backfill sends.
BEGIN;
CREATE TABLE IF NOT EXISTS tenant.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  object_name text NOT NULL CHECK(object_name IN ('renewal_clients__a','recertification_clients__a','user_invitations')),
  record_id uuid NOT NULL, notice_kind text NOT NULL CHECK(notice_kind IN ('record_created','intimation','invitation')),
  notice_round integer NOT NULL DEFAULT 1 CHECK(notice_round=1), revision text NOT NULL,
  recipient text, context jsonb NOT NULL, attachment_id uuid,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','retry','accepted','delivered','delayed','bounced','failed','complained','suppressed','blocked','cancelled','review')),
  created_at timestamptz NOT NULL DEFAULT now(), upload_finalized_at timestamptz,
  first_request_at timestamptz, accepted_at timestamptz, delivered_at timestamptz, failed_at timestamptz,
  -- Intentionally unset: BA must decide which evidence starts future deadlines.
  deadline_start_at timestamptz CHECK(deadline_start_at IS NULL),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid, lease_until timestamptz, provider_id text UNIQUE,
  payload jsonb, last_error text,
  UNIQUE(tenant_id,object_name,record_id,notice_kind,notice_round,revision)
);
CREATE INDEX IF NOT EXISTS notification_due ON tenant.notification_outbox(next_attempt_at) WHERE state IN ('queued','retry','sending');
CREATE TABLE IF NOT EXISTS tenant.notification_events (
  event_id text PRIMARY KEY, provider_id text NOT NULL, event_type text NOT NULL,
  occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  recipients jsonb NOT NULL, details jsonb NOT NULL,
  outbox_id uuid REFERENCES tenant.notification_outbox(id)
);
CREATE INDEX IF NOT EXISTS notification_events_provider ON tenant.notification_events(provider_id);
CREATE TABLE IF NOT EXISTS tenant.notification_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, outbox_id uuid NOT NULL REFERENCES tenant.notification_outbox(id),
  attempted_at timestamptz NOT NULL DEFAULT now(), attempt integer NOT NULL, outcome text NOT NULL, error_code text
);
CREATE TABLE IF NOT EXISTS tenant.notice_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, record_id uuid NOT NULL,
  object_name text NOT NULL, notice_kind text NOT NULL, notice_round integer NOT NULL DEFAULT 1,
  actor_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('accept','reject')),
  acted_at timestamptz NOT NULL DEFAULT now(), workflow_status text, revision text
);
ALTER TABLE tenant.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.notice_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant.notification_outbox,tenant.notification_events,tenant.notification_attempts,tenant.notice_responses FROM PUBLIC,anon,authenticated;

-- Internal only: recipient/context always come from the same tenant record.
CREATE OR REPLACE FUNCTION public._enqueue_record_notice(p_tenant uuid,p_object text,p_record uuid,p_kind text,p_revision text,p_attachment uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r jsonb; n uuid; recipient text; a record;
BEGIN
  IF p_object NOT IN ('renewal_clients__a','recertification_clients__a','user_invitations') THEN RAISE EXCEPTION 'Unsupported object'; END IF;
  IF (p_object='user_invitations') IS DISTINCT FROM (p_kind='invitation') OR p_kind NOT IN ('record_created','intimation','invitation') THEN RAISE EXCEPTION 'Unsupported notice'; END IF;
  IF p_kind='intimation' AND p_attachment IS NULL THEN RAISE EXCEPTION 'Attachment required'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM %I.%I t WHERE id=$1 AND tenant_id=$2',CASE WHEN p_object='user_invitations' THEN 'system' ELSE 'tenant' END,p_object) INTO r USING p_record,p_tenant;
  IF r IS NULL THEN RAISE EXCEPTION 'Record not found'; END IF;
  recipient:=lower(trim(CASE WHEN p_kind='invitation' THEN r->>'email' ELSE r->>'email__a' END));
  IF p_attachment IS NOT NULL THEN
    SELECT at.id,at.created_at INTO a FROM tenant.attachments at
    JOIN tenant.objects o ON o.id=at.object_id JOIN tenant.fields f ON f.id=at.field_id AND f.object_id=o.id
    WHERE at.id=p_attachment AND at.tenant_id=p_tenant AND at.record_id=p_record AND at.deleted_at IS NULL
      AND o.name=p_object AND regexp_replace(f.name,'__a$','')=CASE WHEN p_object='renewal_clients__a' THEN 'surveillance_intimation_letter' ELSE 'recert_intimation_letter' END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not owned by notice record'; END IF;
  END IF;
  -- Replacement cancels only work that has never been submitted. In-flight requests
  -- cannot be recalled; preserve them and their immutable revision evidence.
  UPDATE tenant.notification_outbox SET state='cancelled',last_error='superseded_before_submission'
    WHERE tenant_id=p_tenant AND object_name=p_object AND record_id=p_record
      AND (notice_kind=p_kind OR (p_kind='intimation' AND notice_kind='record_created'))
      AND revision<>p_revision AND first_request_at IS NULL AND state IN ('queued','retry','blocked');
  INSERT INTO tenant.notification_outbox(tenant_id,object_name,record_id,notice_kind,revision,recipient,context,attachment_id,state,last_error,upload_finalized_at,next_attempt_at)
  VALUES(p_tenant,p_object,p_record,p_kind,p_revision,recipient,
    CASE WHEN p_kind='invitation' THEN jsonb_build_object('token',r->>'invitation_token','role',r->>'role')
    ELSE jsonb_build_object('company',coalesce(r->>'company_name__a',r->>'name'),'contact',r->>'contact_person__a') END,
    p_attachment,CASE WHEN coalesce(recipient,'') ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN 'queued' ELSE 'blocked' END,
    CASE WHEN coalesce(recipient,'') ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN NULL ELSE 'missing_or_invalid_record_email' END,
    CASE WHEN p_attachment IS NOT NULL THEN now() END,
    now()+CASE WHEN p_kind='record_created' THEN interval '2 minutes' ELSE interval '0 seconds' END)
  ON CONFLICT(tenant_id,object_name,record_id,notice_kind,notice_round,revision) DO NOTHING RETURNING id INTO n;
  IF n IS NULL THEN SELECT id INTO n FROM tenant.notification_outbox WHERE tenant_id=p_tenant AND object_name=p_object AND record_id=p_record AND notice_kind=p_kind AND revision=p_revision; END IF;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public._workflow_notice_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r jsonb; letter jsonb; old_letter jsonb; field text; att uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    -- Deferred creation reads the final committed transaction shape. Bulk imports
    -- have an audit result by this point and must never send historical notices.
    IF EXISTS(SELECT 1 FROM tenant.bulk_summary_import_results b WHERE b.tenant_id=NEW.tenant_id AND b.result->>'record_id'=NEW.id::text) THEN RETURN NEW; END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM tenant.%I t WHERE id=$1 AND tenant_id=$2',TG_TABLE_NAME) INTO r USING NEW.id,NEW.tenant_id;
    IF r IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF current_setting('craft.summary_import_record',true)=NEW.id::text THEN RETURN NEW; END IF;
    r:=to_jsonb(NEW);
  END IF;
  field:=CASE WHEN TG_TABLE_NAME='renewal_clients__a' THEN 'surveillance_intimation_letter__a' ELSE 'recert_intimation_letter__a' END;
  letter:=r->field;
  IF TG_OP='INSERT' THEN
    IF nullif(letter->>'id','') IS NULL THEN PERFORM public._enqueue_record_notice(NEW.tenant_id,TG_TABLE_NAME,NEW.id,'record_created','creation'); END IF;
  ELSE
    old_letter:=to_jsonb(OLD)->field;
    IF nullif(letter->>'id','') IS NOT NULL AND letter->>'id' IS DISTINCT FROM old_letter->>'id' THEN
      att:=(letter->>'id')::uuid;
      PERFORM public._enqueue_record_notice(NEW.tenant_id,TG_TABLE_NAME,NEW.id,'intimation',att::text,att);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notification_created ON tenant.renewal_clients__a;
CREATE CONSTRAINT TRIGGER notification_created AFTER INSERT ON tenant.renewal_clients__a DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public._workflow_notice_trigger();
DROP TRIGGER IF EXISTS notification_created ON tenant.recertification_clients__a;
CREATE CONSTRAINT TRIGGER notification_created AFTER INSERT ON tenant.recertification_clients__a DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public._workflow_notice_trigger();
DROP TRIGGER IF EXISTS notification_letter ON tenant.renewal_clients__a;
CREATE TRIGGER notification_letter AFTER UPDATE ON tenant.renewal_clients__a FOR EACH ROW EXECUTE FUNCTION public._workflow_notice_trigger();
DROP TRIGGER IF EXISTS notification_letter ON tenant.recertification_clients__a;
CREATE TRIGGER notification_letter AFTER UPDATE ON tenant.recertification_clients__a FOR EACH ROW EXECUTE FUNCTION public._workflow_notice_trigger();

CREATE OR REPLACE FUNCTION public._invitation_notice_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.status='pending' AND (TG_OP='INSERT' OR NEW.invitation_token IS DISTINCT FROM OLD.invitation_token) THEN
    PERFORM public._enqueue_record_notice(NEW.tenant_id,'user_invitations',NEW.id,'invitation',md5(NEW.invitation_token));
  END IF;
  IF NEW.status<>'pending' THEN
    UPDATE tenant.notification_outbox SET state='cancelled',last_error='invitation_no_longer_pending'
      WHERE tenant_id=NEW.tenant_id AND record_id=NEW.id AND object_name='user_invitations' AND state IN ('queued','retry','blocked');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notification_invitation ON system.user_invitations;
CREATE TRIGGER notification_invitation AFTER INSERT OR UPDATE ON system.user_invitations FOR EACH ROW EXECUTE FUNCTION public._invitation_notice_trigger();

-- Authenticated compatibility endpoint: acknowledge durable work; never accept
-- a destination, template, attachment URL or round from the browser.
CREATE OR REPLACE FUNCTION public.check_record_notification(p_object text,p_record uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u record; n record;
BEGIN
  SELECT su.tenant_id,su.role,r.name AS custom INTO u FROM system.users su LEFT JOIN tenant.roles r ON r.id=su.custom_role_id WHERE su.id=auth.uid();
  IF u.tenant_id IS NULL OR (u.role IS DISTINCT FROM 'admin' AND lower(coalesce(u.custom,'')) NOT LIKE '%crm%') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT id,state INTO n FROM tenant.notification_outbox WHERE tenant_id=u.tenant_id AND object_name=p_object AND record_id=p_record ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','No notification queued; check migration and record history'); END IF;
  RETURN jsonb_build_object('success',true,'id',n.id,'state',n.state,'message','Notification recorded; delivery is tracked separately');
END; $$;

CREATE OR REPLACE FUNCTION public.check_invitation_notification(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t uuid; i uuid;
BEGIN
  SELECT tenant_id INTO t FROM system.users WHERE id=auth.uid() AND role='admin';
  IF t IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT id INTO i FROM system.user_invitations WHERE tenant_id=t AND invitation_token=p_token AND status='pending' AND expires_at>now();
  IF i IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  RETURN public.check_record_notification('user_invitations',i);
END; $$;

-- Only explicitly authorised application actions are notice responses. Import
-- dates, delivery/open events and email replies cannot populate this audit.
DO $$ BEGIN
  IF to_regprocedure('public._s12_review_surveillance_intimation(uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.review_surveillance_intimation(uuid,text,text) RENAME TO _s12_review_surveillance_intimation;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.review_surveillance_intimation(p_record_id uuid,p_action text,p_notes text DEFAULT NULL)
RETURNS TABLE(success boolean,message text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u record; r record; result record;
BEGIN
  SELECT tenant_id,role,email INTO u FROM system.users WHERE id=auth.uid();
  SELECT client_user_id__a,email__a,status__a,surveillance_intimation_letter__a INTO r FROM tenant.renewal_clients__a WHERE id=p_record_id AND tenant_id=u.tenant_id FOR UPDATE;
  IF NOT FOUND OR u.tenant_id IS NULL OR (u.role IS DISTINCT FROM 'admin' AND r.client_user_id__a IS DISTINCT FROM auth.uid()
    AND (nullif(trim(r.email__a),'') IS NULL OR lower(trim(r.email__a)) IS DISTINCT FROM lower(trim(u.email)))) THEN
    RETURN QUERY SELECT false,'Access denied'::text; RETURN;
  END IF;
  IF p_action NOT IN ('accept','reject') OR p_action IS NULL THEN RETURN QUERY SELECT false,'Invalid action'::text; RETURN; END IF;
  IF r.status__a IS DISTINCT FROM 'Intimation_Sent' THEN RETURN QUERY SELECT false,'Intimation is not awaiting response'::text; RETURN; END IF;
  SELECT * INTO result FROM public._s12_review_surveillance_intimation(p_record_id,p_action,p_notes);
  IF result.success THEN INSERT INTO tenant.notice_responses(tenant_id,record_id,object_name,notice_kind,actor_id,action,workflow_status,revision)
    VALUES(u.tenant_id,p_record_id,'renewal_clients__a','intimation',auth.uid(),p_action,r.status__a,r.surveillance_intimation_letter__a->>'id'); END IF;
  RETURN QUERY SELECT result.success,result.message;
END; $$;

-- Worker operations are service_role only. Row locks + lease fencing prevent
-- concurrent workers from advancing each other's attempts.
CREATE OR REPLACE FUNCTION public.claim_notification()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; current_recipient text; valid boolean;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE
    ((state IN ('queued','retry') AND next_attempt_at<=now()) OR (state='sending' AND lease_until<now()))
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF n.first_request_at IS NOT NULL AND (n.first_request_at<now()-interval '23 hours' OR n.attempts>=8) THEN
    UPDATE tenant.notification_outbox SET state='review',last_error='uncertain_or_exhausted_do_not_resend',lease_token=NULL,lease_until=NULL WHERE id=n.id;
    RETURN jsonb_build_object('skipped',true);
  END IF;
  IF n.object_name='user_invitations' THEN
    SELECT lower(trim(email)),status='pending' AND expires_at>now() AND invitation_token=n.context->>'token' INTO current_recipient,valid
      FROM system.user_invitations WHERE id=n.record_id AND tenant_id=n.tenant_id;
  ELSE
    EXECUTE format('SELECT lower(trim(email__a)),true FROM tenant.%I WHERE id=$1 AND tenant_id=$2',n.object_name) INTO current_recipient,valid USING n.record_id,n.tenant_id;
  END IF;
  IF valid IS DISTINCT FROM true OR current_recipient IS DISTINCT FROM n.recipient THEN
    UPDATE tenant.notification_outbox SET state='blocked',last_error='record_deleted_recipient_changed_or_invitation_invalid' WHERE id=n.id;
    RETURN jsonb_build_object('skipped',true);
  END IF;
  UPDATE tenant.notification_outbox SET state='sending',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    WHERE id=n.id RETURNING * INTO n;
  INSERT INTO tenant.notification_attempts(outbox_id,attempt,outcome) VALUES(n.id,n.attempts,'claimed');
  RETURN to_jsonb(n);
END; $$;

CREATE OR REPLACE FUNCTION public.notification_attachment(p_id uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a jsonb;
BEGIN
  SELECT jsonb_build_object('bucket',at.storage_bucket,'path',at.storage_path,'name',at.filename,'size',at.byte_size) INTO a
    FROM tenant.notification_outbox n JOIN tenant.attachments at ON at.id=n.attachment_id AND at.tenant_id=n.tenant_id AND at.record_id=n.record_id
    JOIN tenant.objects o ON o.id=at.object_id AND o.name=n.object_name
    JOIN tenant.fields f ON f.id=at.field_id AND f.object_id=o.id
    WHERE n.id=p_id AND n.lease_token=p_lease AND n.state='sending' AND n.lease_until>now() AND at.deleted_at IS NULL
    AND regexp_replace(f.name,'__a$','')=CASE WHEN n.object_name='renewal_clients__a' THEN 'surveillance_intimation_letter' ELSE 'recert_intimation_letter' END;
  RETURN a;
END; $$;

CREATE OR REPLACE FUNCTION public.prepare_notification(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; r jsonb; address text; letter jsonb;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id AND lease_token=p_lease AND state='sending' AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale lease'; END IF;
  IF p_payload->>'to' IS DISTINCT FROM n.recipient THEN RAISE EXCEPTION 'Recipient mismatch'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM %I.%I t WHERE id=$1 AND tenant_id=$2',CASE WHEN n.object_name='user_invitations' THEN 'system' ELSE 'tenant' END,n.object_name)
    INTO r USING n.record_id,n.tenant_id;
  address:=lower(trim(CASE WHEN n.object_name='user_invitations' THEN r->>'email' ELSE r->>'email__a' END));
  IF r IS NULL OR address IS DISTINCT FROM n.recipient OR (n.object_name='user_invitations' AND
    (r->>'status' IS DISTINCT FROM 'pending' OR (r->>'expires_at')::timestamptz<=now() OR r->>'invitation_token' IS DISTINCT FROM n.context->>'token')) THEN
    UPDATE tenant.notification_outbox SET state='blocked',last_error='record_changed_before_submission',lease_token=NULL,lease_until=NULL WHERE id=p_id;
    RETURN NULL;
  END IF;
  IF n.object_name<>'user_invitations' AND n.first_request_at IS NULL THEN
    letter:=r->CASE WHEN n.object_name='renewal_clients__a' THEN 'surveillance_intimation_letter__a' ELSE 'recert_intimation_letter__a' END;
    IF (n.notice_kind='intimation' AND letter->>'id' IS DISTINCT FROM n.attachment_id::text) OR
       (n.notice_kind='record_created' AND nullif(letter->>'id','') IS NOT NULL) THEN
      UPDATE tenant.notification_outbox SET state='cancelled',last_error='superseded_before_submission',lease_token=NULL,lease_until=NULL WHERE id=p_id;
      RETURN NULL;
    END IF;
  END IF;
  UPDATE tenant.notification_outbox SET payload=coalesce(payload,p_payload),first_request_at=coalesce(first_request_at,now()) WHERE id=p_id RETURNING * INTO n;
  RETURN n.payload;
END; $$;

CREATE OR REPLACE FUNCTION public._reconcile_notification(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox; e record;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id FOR UPDATE;
  UPDATE tenant.notification_events SET outbox_id=p_id WHERE provider_id=n.provider_id AND recipients = jsonb_build_array(n.recipient);
  FOR e IN SELECT * FROM tenant.notification_events WHERE outbox_id=p_id ORDER BY occurred_at,event_id LOOP
    IF e.event_type='email.sent' THEN n.accepted_at:=least(n.accepted_at,e.occurred_at);
    ELSIF e.event_type='email.delivered' THEN n.delivered_at:=least(n.delivered_at,e.occurred_at);
    ELSIF e.event_type IN ('email.bounced','email.failed','email.complained','email.suppressed') THEN n.failed_at:=least(n.failed_at,e.occurred_at); END IF;
  END LOOP;
  SELECT event_type INTO e FROM tenant.notification_events WHERE outbox_id=p_id AND event_type IN ('email.bounced','email.failed','email.complained','email.suppressed') ORDER BY occurred_at DESC,event_id DESC LIMIT 1;
  IF FOUND THEN n.state:=substring(e.event_type from 7);
  ELSIF n.delivered_at IS NOT NULL THEN n.state:='delivered';
  ELSIF EXISTS(SELECT 1 FROM tenant.notification_events WHERE outbox_id=p_id AND event_type='email.delivery_delayed') THEN n.state:='delayed';
  ELSIF n.accepted_at IS NOT NULL THEN n.state:='accepted'; END IF;
  UPDATE tenant.notification_outbox SET state=n.state,accepted_at=n.accepted_at,delivered_at=n.delivered_at,failed_at=n.failed_at WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_notification(p_id uuid,p_lease uuid,p_provider text,p_error text,p_retry boolean DEFAULT false,p_retry_after integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n tenant.notification_outbox;
BEGIN
  SELECT * INTO n FROM tenant.notification_outbox WHERE id=p_id AND lease_token=p_lease AND state='sending' AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale lease'; END IF;
  UPDATE tenant.notification_outbox SET provider_id=p_provider,accepted_at=CASE WHEN p_provider IS NOT NULL THEN now() END,
    state=CASE WHEN p_provider IS NOT NULL THEN 'accepted' WHEN p_retry AND n.attempts<8 THEN 'retry' WHEN p_retry THEN 'review' ELSE 'failed' END,
    failed_at=CASE WHEN p_provider IS NULL AND NOT p_retry THEN now() END,last_error=p_error,lease_token=NULL,lease_until=NULL,
    next_attempt_at=now()+make_interval(secs=>greatest(least(coalesce(p_retry_after,0),86400),least(3600,30*power(2,n.attempts-1)::integer))) WHERE id=p_id;
  INSERT INTO tenant.notification_attempts(outbox_id,attempt,outcome,error_code) VALUES(p_id,n.attempts,CASE WHEN p_provider IS NOT NULL THEN 'accepted' WHEN p_retry THEN 'retry' ELSE 'failed' END,p_error);
  IF p_provider IS NOT NULL THEN PERFORM public._reconcile_notification(p_id); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.record_resend_event(p_event_id text,p_provider text,p_type text,p_occurred timestamptz,p_recipients jsonb,p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n uuid;
BEGIN
  INSERT INTO tenant.notification_events(event_id,provider_id,event_type,occurred_at,recipients,details)
    VALUES(p_event_id,p_provider,p_type,p_occurred,p_recipients,p_details) ON CONFLICT(event_id) DO NOTHING;
  SELECT id INTO n FROM tenant.notification_outbox WHERE provider_id=p_provider;
  IF n IS NOT NULL THEN PERFORM public._reconcile_notification(n); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_record_notifications(p_object text,p_record uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u record; r jsonb; o uuid; notices jsonb; responses jsonb; mode text; owner_id text;
BEGIN
  IF p_object NOT IN ('renewal_clients__a','recertification_clients__a') THEN RAISE EXCEPTION 'Unsupported object'; END IF;
  SELECT su.tenant_id,su.role,su.email,su.custom_role_id,ro.name AS custom INTO u FROM system.users su LEFT JOIN tenant.roles ro ON ro.id=su.custom_role_id WHERE su.id=auth.uid();
  IF u.tenant_id IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM tenant.%I t WHERE id=$1 AND tenant_id=$2',p_object) INTO r USING p_record,u.tenant_id;
  IF r IS NULL THEN RAISE EXCEPTION 'Record not found'; END IF;
  SELECT id INTO o FROM tenant.objects WHERE name=p_object AND tenant_id=u.tenant_id LIMIT 1;
  IF o IS NULL OR NOT public._check_permission('object',o,'read') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF u.role IS DISTINCT FROM 'admin' THEN
    IF NOT EXISTS(SELECT 1 FROM tenant.fields f WHERE f.object_id=o
      AND regexp_replace(f.name,'__a$','')=CASE WHEN p_object='renewal_clients__a' THEN 'surveillance_intimation_letter' ELSE 'recert_intimation_letter' END
      AND public._check_permission('field',f.id,'read')) THEN RAISE EXCEPTION 'Access denied'; END IF;
    SELECT effective_read_mode INTO mode FROM public._resolve_sharing_mode(o,u.tenant_id);
    owner_id:=coalesce(r->>'record_owner__a',r->>'created_by');
    IF (mode='owner' OR (mode='role_peers' AND u.custom_role_id IS NULL)) AND owner_id IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'Access denied'; END IF;
    IF mode='role_peers' AND u.custom_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM system.users su WHERE su.id::text=owner_id AND su.tenant_id=u.tenant_id AND su.custom_role_id=u.custom_role_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  -- Delivery evidence is visible to admin, CRM, and the linked client only.
  -- It is deliberately not exposed through broad generic table policies.
  IF u.role IS DISTINCT FROM 'admin' AND lower(coalesce(u.custom,'')) NOT LIKE '%crm%' AND
     r->>'client_user_id__a' IS DISTINCT FROM auth.uid()::text AND
     (nullif(trim(r->>'email__a'),'') IS NULL OR lower(trim(r->>'email__a')) IS DISTINCT FROM lower(trim(u.email))) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',notice_kind,'round',notice_round,'revision',revision,'state',state,'queued_at',created_at,
    'upload_finalized_at',upload_finalized_at,'accepted_at',accepted_at,'delivered_at',delivered_at,'failed_at',failed_at,'deadline_start_at',deadline_start_at,
    'provider_id',provider_id,'attempts',attempts,'error',last_error) ORDER BY created_at),'[]') INTO notices
    FROM tenant.notification_outbox WHERE tenant_id=u.tenant_id AND object_name=p_object AND record_id=p_record;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'acted_at',acted_at,'actor',actor_id,'round',notice_round,'revision',revision) ORDER BY acted_at),'[]') INTO responses
    FROM tenant.notice_responses WHERE tenant_id=u.tenant_id AND object_name=p_object AND record_id=p_record;
  RETURN jsonb_build_object('notices',notices,'responses',responses);
END; $$;

-- Default PostgreSQL PUBLIC execute is never left on internal/worker functions.
REVOKE ALL ON FUNCTION public._enqueue_record_notice(uuid,text,uuid,text,text,uuid),public._workflow_notice_trigger(),public._invitation_notice_trigger(),public._s12_review_surveillance_intimation(uuid,text,text),public._reconcile_notification(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_notification(),public.notification_attachment(uuid,uuid),public.prepare_notification(uuid,uuid,jsonb),public.finish_notification(uuid,uuid,text,text,boolean,integer),public.record_resend_event(text,text,text,timestamptz,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification(),public.notification_attachment(uuid,uuid),public.prepare_notification(uuid,uuid,jsonb),public.finish_notification(uuid,uuid,text,text,boolean,integer),public.record_resend_event(text,text,text,timestamptz,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.check_record_notification(text,uuid),public.check_invitation_notification(text),public.get_record_notifications(text,uuid),public.review_surveillance_intimation(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_record_notification(text,uuid),public.check_invitation_notification(text),public.get_record_notifications(text,uuid),public.review_surveillance_intimation(uuid,text,text) TO authenticated;
COMMIT;
