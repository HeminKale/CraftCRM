-- Read-only readiness evidence. No email addresses, tokens or credentials selected.
-- Run sections separately in Supabase SQL Editor and share their results.

-- 1. Local migration prerequisites and Sprint 12 entry points present in live schema?
SELECT signature, to_regprocedure(signature) IS NOT NULL AS present
FROM (VALUES
 ('public.import_renewal_summary(uuid,jsonb,jsonb)'),
 ('public.import_recert_summary(uuid,jsonb,jsonb)'),
 ('public.apply_bulk_summary_row(uuid,text,text,text,integer,jsonb,jsonb,uuid,text,uuid,text)'),
 ('public.finalize_file_upload(uuid,bigint,text)'),
 ('public.claim_notification()'),
 ('public.record_resend_event(text,text,text,timestamp with time zone,jsonb,jsonb)'),
 ('public.get_record_notifications(text,uuid)')
) AS expected(signature);

-- 2. Record/attachment/invitation column evidence (metadata only).
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE (table_schema='tenant' AND table_name IN ('renewal_clients__a','recertification_clients__a','attachments')
  AND column_name IN ('id','tenant_id','email__a','client_user_id__a','surveillance_intimation_letter__a','recert_intimation_letter__a',
    'storage_bucket','storage_path','record_id','object_id','field_id','deleted_at'))
 OR (table_schema='system' AND table_name='user_invitations'
  AND column_name IN ('id','tenant_id','email','status','expires_at','invitation_token'))
ORDER BY table_schema,table_name,ordinal_position;

-- 3. Trigger definitions, including existing paused-chain guards.
SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND ((n.nspname='tenant' AND c.relname IN ('renewal_clients__a','recertification_clients__a'))
 OR (n.nspname='system' AND c.relname='user_invitations'))
ORDER BY schema_name,table_name,t.tgname;

-- 4. Private audit tables: RLS and grants; safe before or after 299.
SELECT n.nspname,c.relname,c.relrowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='tenant' AND c.relname IN ('notification_outbox','notification_events','notification_attempts','notice_responses');
SELECT routine_name,grantee,privilege_type FROM information_schema.routine_privileges
WHERE routine_schema='public' AND routine_name IN ('claim_notification','prepare_notification','finish_notification','record_resend_event',
 '_enqueue_record_notice','_s12_review_surveillance_intimation','get_record_notifications') ORDER BY routine_name,grantee;

-- 5. Only after 299 is applied: aggregate queue and reconciliation evidence.
-- No tokens, destinations, message contents or invitation links are exposed.
-- SELECT object_name,notice_kind,state,count(*),min(created_at),max(created_at)
-- FROM tenant.notification_outbox GROUP BY object_name,notice_kind,state ORDER BY 1,2,3;
-- SELECT event_type,count(*),count(*) FILTER(WHERE outbox_id IS NULL) AS unmatched
-- FROM tenant.notification_events GROUP BY event_type ORDER BY event_type;
-- SELECT count(*) AS expired_leases FROM tenant.notification_outbox WHERE state='sending' AND lease_until<now();
