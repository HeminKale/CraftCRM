-- READ ONLY. Run each numbered query separately in Supabase SQL Editor.
-- These queries do not apply migrations, change rows, deploy code or send mail.
-- Start with Query 1. Query 2 assumes the four expected business tables exist.
-- Results contain schema, IDs, counts and statuses, not client names/emails.

-- QUERY 1: physical schema, link constraints, indexes, triggers and RPC versions.
-- Copy its single JSON result. Null/empty entries identify missing objects.
WITH wanted AS (
  SELECT unnest(ARRAY['external_clients__a','client_summary__a',
                     'renewal_clients__a','recertification_clients__a']) AS name
)
SELECT jsonb_build_object(
  'tables', (SELECT jsonb_agg(jsonb_build_object(
    'table', w.name, 'exists', to_regclass('tenant.'||w.name) IS NOT NULL,
    'columns', (SELECT jsonb_agg(jsonb_build_object('column',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=to_regclass('tenant.'||w.name)
      AND a.attnum>0 AND NOT a.attisdropped),
    'constraints', (SELECT jsonb_agg(jsonb_build_object('name',c.conname,
      'definition',pg_get_constraintdef(c.oid)))
      FROM pg_constraint c WHERE c.conrelid=to_regclass('tenant.'||w.name)),
    'indexes', (SELECT jsonb_agg(indexdef) FROM pg_indexes
      WHERE schemaname='tenant' AND tablename=w.name),
    'triggers', (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,
      'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)))
      FROM pg_trigger t WHERE t.tgrelid=to_regclass('tenant.'||w.name) AND NOT t.tgisinternal)
  ) ORDER BY w.name) FROM wanted w),
  'rpcs', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'definition_md5',md5(pg_get_functiondef(p.oid)),
    'requires_external_client_text',position('An External Client is required' IN pg_get_functiondef(p.oid))>0
  ) ORDER BY n.nspname,p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'create_renewal_client','create_recertification_client','create_client_from_summary',
      'get_renewal_summary_import_state','import_renewal_summary','import_recert_summary',
      'get_recert_summary_import_state','upsert_renewal_from_summary','upsert_recert_from_summary',
      'guard_paused_surveillance_changes','guard_paused_surveillance_upload'
    ))
) AS schema_audit;

-- QUERY 2: actual linkage and duplication counts, grouped by tenant.
-- A nullable link is different from an invalid or cross-tenant link.
-- Company-name collision counts are diagnostic only, not permission to merge.
WITH counts AS (
  SELECT 'external_clients__a' AS object, tenant_id, count(*) AS records
    FROM tenant.external_clients__a GROUP BY tenant_id
  UNION ALL SELECT 'client_summary__a',tenant_id,count(*) FROM tenant.client_summary__a GROUP BY tenant_id
  UNION ALL SELECT 'renewal_clients__a',tenant_id,count(*) FROM tenant.renewal_clients__a GROUP BY tenant_id
  UNION ALL SELECT 'recertification_clients__a',tenant_id,count(*) FROM tenant.recertification_clients__a GROUP BY tenant_id
), linked AS (
  SELECT 'renewal_clients__a' AS object,to_jsonb(r) AS row FROM tenant.renewal_clients__a r
  UNION ALL SELECT 'recertification_clients__a',to_jsonb(r) FROM tenant.recertification_clients__a r
  UNION ALL SELECT 'client_summary__a',to_jsonb(r) FROM tenant.client_summary__a r
), links AS (
  SELECT l.object,l.row->>'tenant_id' AS tenant_id,
    count(*) AS total,
    count(*) FILTER (WHERE nullif(l.row->>'external_client_id__a','') IS NULL) AS unlinked,
    count(*) FILTER (WHERE nullif(l.row->>'external_client_id__a','') IS NOT NULL AND c.id IS NULL) AS broken_link,
    count(*) FILTER (WHERE c.id IS NOT NULL AND c.tenant_id::text IS DISTINCT FROM l.row->>'tenant_id') AS cross_tenant_link,
    count(*) FILTER (WHERE l.object<>'client_summary__a' AND c.id IS NOT NULL AND
      coalesce(l.row->>'client_user_id__a','') IS DISTINCT FROM coalesce(to_jsonb(c)->>'client_user_id__a','')) AS copied_login_differs,
    count(*) FILTER (WHERE c.id IS NOT NULL AND
      coalesce(l.row->>'email__a','') IS DISTINCT FROM coalesce(to_jsonb(c)->>'email__a','')) AS copied_email_differs
  FROM linked l LEFT JOIN tenant.external_clients__a c ON c.id::text=l.row->>'external_client_id__a'
  GROUP BY l.object,l.row->>'tenant_id'
), duplicate_links AS (
  SELECT object,row->>'tenant_id' AS tenant_id,row->>'external_client_id__a' AS client_id,count(*) AS records
  FROM linked WHERE nullif(row->>'external_client_id__a','') IS NOT NULL
  GROUP BY object,row->>'tenant_id',row->>'external_client_id__a' HAVING count(*)>1
), company_collisions AS (
  SELECT c.tenant_id,
    lower(regexp_replace(trim(coalesce(to_jsonb(c)->>'Company_name__a',c.name,'')),'\s+',' ','g')) AS company_key,
    lower(trim(coalesce(to_jsonb(c)->>'certification_body__a',''))) AS body_key,
    count(*) AS records
  FROM tenant.external_clients__a c
  GROUP BY c.tenant_id,company_key,body_key HAVING count(*)>1
), statuses AS (
  SELECT 'external_clients__a' AS object,c.tenant_id,to_jsonb(c)->>'status__a' AS status,count(*) AS records
  FROM tenant.external_clients__a c GROUP BY c.tenant_id,to_jsonb(c)->>'status__a'
  UNION ALL SELECT 'renewal_clients__a',r.tenant_id,to_jsonb(r)->>'status__a',count(*)
    FROM tenant.renewal_clients__a r GROUP BY r.tenant_id,to_jsonb(r)->>'status__a'
  UNION ALL SELECT 'recertification_clients__a',r.tenant_id,to_jsonb(r)->>'status__a',count(*)
    FROM tenant.recertification_clients__a r GROUP BY r.tenant_id,to_jsonb(r)->>'status__a'
)
SELECT jsonb_build_object(
  'counts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.object,c.tenant_id) FROM counts c),'[]'::jsonb),
  'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.object,l.tenant_id) FROM links l),'[]'::jsonb),
  'clients_with_multiple_linked_rows',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.object,d.tenant_id,d.client_id) FROM duplicate_links d),'[]'::jsonb),
  'company_name_body_collision_groups',coalesce((SELECT jsonb_agg(jsonb_build_object('tenant_id',g.tenant_id,
    'groups',g.groups,'records_in_groups',g.records)) FROM
    (SELECT tenant_id,count(*) AS groups,sum(records) AS records FROM company_collisions GROUP BY tenant_id) g),'[]'::jsonb),
  'statuses',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.object,s.tenant_id,s.status) FROM statuses s),'[]'::jsonb)
) AS record_audit;

-- QUERY 3: app-facing object and tab metadata. This can reveal a renamed tab
-- called Surveillance 2 without assuming a new physical table exists.
SELECT jsonb_build_object(
  'objects',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'tenant_id',o.tenant_id,
    'name',o.name,'label',to_jsonb(o)->>'label')) FROM tenant.objects o
    WHERE o.name IN ('external_clients__a','client_summary__a','renewal_clients__a','recertification_clients__a')),
  'tabs',(SELECT jsonb_agg(jsonb_build_object('id',t.id,'tenant_id',to_jsonb(t)->>'tenant_id',
    'name',to_jsonb(t)->>'name','label',to_jsonb(t)->>'label','type',to_jsonb(t)->>'tab_type',
    'object_id',to_jsonb(t)->>'object_id','component',to_jsonb(t)->>'custom_component_path'))
    FROM tenant.tabs t),
  'cycle_fields',(SELECT jsonb_agg(jsonb_build_object('object',o.name,'tenant_id',o.tenant_id,
    'field',f.name,'label',to_jsonb(f)->>'label','type',to_jsonb(f)->>'type'))
    FROM tenant.fields f JOIN tenant.objects o ON o.id=f.object_id
    WHERE o.name IN ('external_clients__a','renewal_clients__a','recertification_clients__a')
      AND (f.name ~* '(cycle|surv.*2|renewal_type|audit_type|certification_body)' OR
           coalesce(to_jsonb(f)->>'label','') ~* '(cycle|surv.*2)'))
) AS application_metadata;
