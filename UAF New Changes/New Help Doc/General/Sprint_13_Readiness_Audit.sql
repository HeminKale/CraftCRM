-- Targeted READ-ONLY evidence. No customer data, destinations or secrets.
-- Run sections independently; no migration application is implied.

-- 1. Physical statuses, linked entity, and intimation metadata.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='tenant'
  AND table_name IN ('external_clients__a','renewal_clients__a','recertification_clients__a')
  AND column_name IN ('id','tenant_id','status__a','nonresponse_suspended_at__a','external_client_id__a','surveillance_intimation_letter__a','recert_intimation_letter__a')
ORDER BY table_name,ordinal_position;

-- 2. Text storage does not prove that field metadata renders a dropdown.
SELECT o.tenant_id,o.name AS object_name,f.id AS field_id,f.name,f.type,
  p.value,p.label,p.is_active
FROM tenant.objects o JOIN tenant.fields f ON f.object_id=o.id
LEFT JOIN tenant.picklist_values p ON p.field_id=f.id
WHERE o.name IN ('external_clients__a','renewal_clients__a','recertification_clients__a')
  AND regexp_replace(f.name,'__a$','')='status'
ORDER BY o.tenant_id,o.name,p.display_order,p.value;

-- 3. Current layout evidence, including visibility and field normalisation.
-- JSON access tolerates differences in layout metadata columns.
SELECT o.tenant_id,o.name AS object_name,to_jsonb(lb) AS layout_metadata
FROM tenant.layout_blocks lb JOIN tenant.objects o ON o.id=lb.object_id
WHERE o.name IN ('external_clients__a','renewal_clients__a','recertification_clients__a')
  AND (to_jsonb(lb)::text ILIKE '%status%' OR to_jsonb(lb)->>'field_id' IN (
    SELECT f.id::text FROM tenant.fields f WHERE f.object_id=o.id AND regexp_replace(f.name,'__a$','')='status'
  ));

-- 4. Guards remain installed; inspect before claiming generic editing is safe.
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='tenant' AND NOT t.tgisinternal
  AND c.relname IN ('external_clients__a','renewal_clients__a','notice_responses','notification_outbox')
ORDER BY c.relname,t.tgname;
SELECT signature,to_regprocedure(signature) IS NOT NULL AS present
FROM (VALUES ('public.review_nonresponse_evidence()'),('public.get_record_nonresponse(text,uuid)'),
  ('public.process_nonresponse()'),('public._s13_ist_after(timestamp with time zone,integer)'),
  ('public.configure_suspension_docx(uuid,text,text,boolean)'),('public.release_suspension_letter()'),('public.suspension_docx_for_notice(uuid,uuid)'),
  ('public._s13_prepare_before_pdf(uuid,uuid,jsonb)'),('public.prepare_notification(uuid,uuid,jsonb)'),
  ('public.guard_paused_surveillance_changes()'),('public.review_surveillance_intimation(uuid,text,text)')) x(signature);

-- 5. Safe before/after 300: private relations, constraints and grants.
SELECT c.relname,c.relrowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='tenant' AND c.relname IN ('nonresponse_cases','nonresponse_audit','nonresponse_transitions','notification_templates');
SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='tenant' AND c.relname IN ('nonresponse_cases','nonresponse_audit','nonresponse_transitions','notification_templates');
SELECT routine_name,grantee,privilege_type FROM information_schema.routine_privileges
WHERE routine_schema='public' AND routine_name IN ('_observe_nonresponse','_register_nonresponse_notice',
  '_refresh_nonresponse_evidence','review_nonresponse_evidence','get_record_nonresponse','process_nonresponse',
  '_s13_prepare_notification_base','_s13_review_before_timing','_s13_transition','_guard_nonresponse_suspension',
  'configure_suspension_docx','release_suspension_letter','suspension_docx_for_notice','_s13_prepare_before_docx','_s13_prepare_before_pdf','prepare_notification')
ORDER BY routine_name,grantee;

-- 6. ONLY after 300. Aggregate state; no individual record details.
-- SELECT policy_version,automation_enabled,count(*),min(enrolled_at),max(last_checked_at),
--   count(*) FILTER(WHERE first_deadline_at IS NOT NULL OR final_deadline_at IS NOT NULL) AS unexpected_deadlines
-- FROM tenant.nonresponse_cases GROUP BY policy_version,automation_enabled;
-- SELECT outcome,worker,count(*) FROM tenant.nonresponse_audit GROUP BY outcome,worker;
-- SELECT notice_round,count(*) FROM tenant.notification_outbox GROUP BY notice_round;

-- 7. ONLY after 301: actual deadline stages and outcomes, without record details.
-- SELECT policy_version,stage,count(*),min(first_deadline_at),min(final_deadline_at)
-- FROM tenant.nonresponse_cases GROUP BY policy_version,stage;
-- SELECT outcome,count(*) FROM tenant.nonresponse_transitions GROUP BY outcome;
-- SELECT count(*) AS suspended_clients FROM tenant.external_clients__a WHERE nonresponse_suspended_at__a IS NOT NULL;
-- SELECT count(*) AS template_pending FROM tenant.notification_outbox
-- WHERE notice_kind='nonresponse_suspension' AND last_error='suspension_template_pending';

-- 8. ONLY after 302: no file contents, paths, customer destinations or secrets.
-- SELECT id,public FROM storage.buckets WHERE id='notification-templates';
-- SELECT active,count(*) FROM tenant.notification_templates GROUP BY active;
-- SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
-- WHERE schemaname='storage' AND tablename='objects' AND policyname='notification_templates_private';

-- 9. ONLY after 303: aggregate PDF recovery holds, without attachment bytes.
-- SELECT state,last_error,count(*) FROM tenant.notification_outbox
-- WHERE notice_kind='nonresponse_suspension' GROUP BY state,last_error;
-- Worker-host LibreOffice/font availability and actual PDF layout require separate QA.
