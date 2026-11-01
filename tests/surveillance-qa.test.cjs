const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { PGlite } = require('@electric-sql/pglite');
const XLSX = require('xlsx');
const { act } = renderer;

const root = path.resolve(__dirname, '..');
function loadTS(relative, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} }; cache.set(filename, mod);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  }}).outputText;
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) {
      if (name.endsWith('/providers/SupabaseProvider')) return mocks.provider;
      if (name.endsWith('/hooks/useCurrentApp')) return mocks.app;
      const base = path.resolve(path.dirname(filename), name);
      const target = ['.ts', '.tsx', ''].map(ext => base + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (target) return loadTS(path.relative(root, target), mocks, cache);
    }
    return require(name);
  };
  vm.runInNewContext(output, {
    module: mod, exports: mod.exports, require: localRequire, console,
    document: { addEventListener() {}, removeEventListener() {} },
    crypto: require('node:crypto').webcrypto, Date, File,
    localStorage: mocks.localStorage || {getItem:()=>null},
    fetch: async () => ({ json: async () => ({ success: true }) }),
  }, { filename });
  return mod.exports;
}
const base = 'app/commonfiles/core/components/custom/';
const mapping = loadTS(base + 'Renewal_Client/surveilanceSheetMapping.ts');
const recertMapping = loadTS(base + 'Recertification_Client/recertSheetMapping.ts');

test('summary parser handles vertical metadata, wide headers, dates and forward-only preview', () => {
  const vertical = mapping.parseSummaryWorkbookRows([['Company Name','Acme'],['Scope','Engineering'],['Acceptance by client','18/10/2026'],['surv tech review checklist','file.pdf']]);
  assert.equal(vertical.find(r => r.label === 'Company name').value, 'Acme');
  assert.equal(vertical.find(r => r.label === 'Scope').mapping.extColumn, 'scope__a');
  assert.equal(vertical.find(r => r.label === 'Acceptance by client').value, '2026-10-18');
  assert.equal(vertical.some(r => r.mapping.kind === 'file'), false);
  assert.equal(mapping.parseFlexibleDate('31/02/2026'), null);
  assert.equal(mapping.parseFlexibleDate('2026-02-31'), null);
  assert.equal(mapping.parseFlexibleDate('2024-02-29'), '2024-02-29');
  assert.equal(mapping.getSurveillanceImportStatus(vertical, null), 'Intimation_Accepted');
  assert.equal(mapping.getSurveillanceImportStatus(vertical, 'Certificate_Issued'), null);
  assert.equal(mapping.getSurveillanceImportStatus(vertical, 'Suspension_Letter_Sent'), null);
  assert.equal(mapping.getSurveillanceImportStatus(vertical, 'Future_Status'), null);
  const wideDates = mapping.parseSummaryWorkbookRows([['COMPANY NAME','Surveillance 1 mandays','surveillance intimation letter','surv tech review','certificate issue'],['Payal','3','22-Jan-26','31-Jan-26','2-Feb-26']]);
  assert.equal(wideDates.find(r => r.mapping.extColumn === 'intimation_sent_date__a').value, '2026-01-22');
  assert.equal(wideDates.find(r => r.mapping.extColumn === 'surv_tech_findings_date__a').value, '2026-01-31');
  assert.equal(mapping.getSurveillanceImportStatus(wideDates, null), 'Certificate_Issued');
  const wide = mapping.parseSummaryWorkbookRows([['Company Name','Scope'],['Acme','Manufacturing'],['surv  ncr RCA acceptance','19 Oct 2026']]);
  assert.equal(wide[0].value, 'Acme');
  assert.equal(mapping.getSurveillanceImportStatus(wide, 'Intimation_Sent'), 'Surv_Auditor_Accepted');
});

const ids = Object.fromEntries(['tenant','otherTenant','crm','client','auditor','otherAuditor','tech','otherTech','admin','crmRole','clientRole','auditorRole','techRole','record','latest','otherRecord','object','recertObject','recert','extClient','ncrField','checklistField'].map((key, i) => [key, `00000000-0000-4000-8000-${String(i + 1).padStart(12,'0')}`]));

test('database import and permission guards run against isolated PostgreSQL', async t => {
  const db = new PGlite();
  const allText = [...new Set(Object.values(mapping.FIELD_MAPPINGS_SURV).filter(m => m.kind === 'text').map(m => m.extColumn).concat(['contact_person__a','email__a']))];
  const dates = mapping.SURV_STAGE_PROGRESSION.map(s => s.column);
  const recertText = [...new Set(Object.values(recertMapping.FIELD_MAPPINGS_RECERT).filter(m=>m.kind==='text').map(m=>m.extColumn).concat(['contact_person__a']))];
  const recertDates = recertMapping.RECERT_STAGE_PROGRESSION.map(s=>s.column);
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA system; CREATE SCHEMA tenant; CREATE SCHEMA storage; CREATE ROLE authenticated;
    GRANT USAGE ON SCHEMA auth,storage TO authenticated;
    CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,UPDATE,DELETE ON storage.objects TO authenticated;
    CREATE POLICY base_read ON storage.objects FOR SELECT TO authenticated USING (true);
    CREATE POLICY base_delete ON storage.objects FOR DELETE TO authenticated USING (true);
    CREATE POLICY base_update ON storage.objects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE tenant.roles(id uuid primary key, name text);
    CREATE TABLE system.users(id uuid primary key, tenant_id uuid, role text, custom_role_id uuid, email text);
    CREATE TABLE tenant.objects(id uuid primary key, tenant_id uuid, name text);
    CREATE TABLE tenant.fields(id uuid primary key, object_id uuid, name text, type text default 'text',reference_table text,reference_display_field text);
    CREATE TABLE tenant.renewal_clients__a(id uuid primary key, tenant_id uuid, status__a text, name text, external_client_id__a uuid,
      client_user_id__a uuid, auditor_id__a uuid, tech_reviewer_id__a uuid, surv_audit_pack__a jsonb,
      created_by text, updated_by text, created_at timestamptz default now(), updated_at timestamptz default now(), certification_body__a text,
      record_owner__a text, surveillance_audit_report__a jsonb, surv_ncr_rca__a jsonb, surv_ncr__a jsonb, surv_tech_findings_file__a jsonb, surv_rca_rejection_notes__a text, ${allText.map(c => `"${c}" text`).join(',')}, ${dates.map(c => `"${c}" date`).join(',')});
    CREATE TABLE tenant.recertification_clients__a(id uuid primary key, tenant_id uuid, status__a text, client_user_id__a uuid,
      email__a text, auditor_id__a uuid, tech_reviewer_id__a uuid, record_owner__a text,created_by text,created_at timestamptz default now(),updated_at timestamptz default now(),recert_summary_pack__a jsonb,recert_audit_report__a jsonb,recert_application_form__a jsonb,recert_ncr_rca__a jsonb,recert_evidences__a jsonb, ${recertText.map(c=>`"${c}" text`).join(',')}, ${recertDates.map(c=>`"${c}" date`).join(',')});
    CREATE TABLE tenant.external_clients__a(id uuid primary key, tenant_id uuid, name text, "Company_name__a" text,
      "contactPerson__a" text, "email__a" text, "ISOStandard__a" text, client_user_id__a uuid);
    CREATE TABLE tenant.attachments(id uuid primary key default gen_random_uuid(),tenant_id uuid,object_id uuid,field_id uuid,record_id uuid,uploaded_by uuid default auth.uid(),filename text,mime_type text,byte_size bigint,storage_path text,storage_bucket text,version integer default 1,created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
    CREATE FUNCTION public.current_user_full_name() RETURNS text LANGUAGE sql AS $$ SELECT 'Test User'::text $$;
    CREATE FUNCTION public._check_permission(text,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $2::text IS DISTINCT FROM nullif(current_setting(CASE WHEN $3='edit' THEN 'test.denied_edit' ELSE 'test.denied_read' END,true),'') $$;
    CREATE FUNCTION public.get_file_download_url(uuid,integer default 1) RETURNS TABLE(success boolean,message text,download_url text) LANGUAGE sql AS $$ SELECT true,'OK'::text,'signed'::text $$;
    CREATE FUNCTION public.delete_file(uuid) RETURNS TABLE(success boolean,message text) LANGUAGE sql AS $$ SELECT true,'Deleted'::text $$;
    CREATE FUNCTION public._resolve_sharing_mode(uuid,uuid) RETURNS TABLE(effective_read_mode text,effective_edit_mode text)
      LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.read_mode',true),''),'all')::text,'all'::text $$;
    CREATE FUNCTION tenant.get_object_records_with_references(uuid,integer,integer,text)
      RETURNS TABLE(record_id uuid,record_data jsonb) LANGUAGE sql AS $$
      SELECT id,to_jsonb(r) FROM tenant.renewal_clients__a r WHERE $1 = '${ids.object}'
      UNION ALL SELECT id,to_jsonb(r) FROM tenant.recertification_clients__a r WHERE $1 = '${ids.recertObject}' $$;
    CREATE FUNCTION tenant.get_object_records(uuid,integer,integer)
      RETURNS TABLE(record_id uuid,record_data jsonb) LANGUAGE sql AS $$
      SELECT * FROM tenant.get_object_records_with_references($1,$2,$3,NULL) $$;
    INSERT INTO tenant.roles VALUES ('${ids.crmRole}','CRM Office'),('${ids.clientRole}','External Client'),('${ids.auditorRole}','Auditor'),('${ids.techRole}','Tech Reviewer');
    INSERT INTO system.users VALUES
      ('${ids.crm}','${ids.tenant}','user','${ids.crmRole}','crm@example.invalid'),
      ('${ids.client}','${ids.tenant}','user','${ids.clientRole}','client@example.invalid'),
      ('${ids.auditor}','${ids.tenant}','user','${ids.auditorRole}','auditor@example.invalid'),
      ('${ids.otherAuditor}','${ids.tenant}','user','${ids.auditorRole}','auditor2@example.invalid'),
      ('${ids.tech}','${ids.tenant}','user','${ids.techRole}','tech@example.invalid'),
      ('${ids.otherTech}','${ids.tenant}','user','${ids.techRole}','tech2@example.invalid'),
      ('${ids.admin}','${ids.tenant}','admin',null,'admin@example.invalid');
    INSERT INTO tenant.objects VALUES ('${ids.object}','${ids.tenant}','renewal_clients__a'),('${ids.recertObject}','${ids.tenant}','recertification_clients__a');
    INSERT INTO tenant.fields(id,object_id,name) VALUES ('${ids.ncrField}','${ids.object}','surv_ncr'),('${ids.checklistField}','${ids.object}','surv_tech_findings_file');
    INSERT INTO tenant.renewal_clients__a(id,tenant_id,status__a,client_user_id__a,email__a,auditor_id__a,tech_reviewer_id__a,scope__a,created_at) VALUES
      ('${ids.record}','${ids.tenant}','Surv_NCR_RCA_Uploaded','${ids.client}','client@example.invalid','${ids.auditor}','${ids.tech}','Original','2026-01-01'),
      ('${ids.latest}','${ids.tenant}','Certificate_Issued','${ids.client}','client@example.invalid','${ids.auditor}','${ids.tech}','Latest','2026-10-01'),
      ('${ids.otherRecord}','${ids.otherTenant}','Surv_NCR_RCA_Uploaded',null,null,null,null,'Other tenant','2026-01-01');
    INSERT INTO tenant.recertification_clients__a(id,tenant_id,status__a,client_user_id__a,email__a,auditor_id__a,tech_reviewer_id__a,recert_auditor_accepted_date__a,recert_team_assigned_date__a) VALUES ('${ids.recert}','${ids.tenant}','Recert_NCR_RCA_Uploaded','${ids.client}','client@example.invalid','${ids.auditor}','${ids.tech}',null,null);
    INSERT INTO tenant.external_clients__a VALUES ('${ids.extClient}','${ids.tenant}','New Client','Actual Company','Contact','client@example.invalid','ISO 9001','${ids.client}');
  `);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/231_fix_update_tenant_record_schema.sql'),'utf8'));
  for (const file of ['291_fix_surveillance_summary_import.sql','292_surveillance_client_and_team_guards.sql','293_workflow_read_and_upload_fixes.sql','294_workflow_field_permissions.sql','295_recert_summary_import.sql','296_workflow_attachment_read_guards.sql','297_surveillance_ends_at_certificate.sql']) {
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  }
  const sql = fs.readFileSync(path.join(root,'supabase/migrations/258_surv_ncr_rca.sql'),'utf8');
  const a = sql.indexOf('CREATE OR REPLACE FUNCTION public.review_surv_ncr_rca(');
  const b = sql.indexOf('$$;',a) + 3;
  await db.exec(sql.slice(a,b));
  const login = user => db.query("SELECT set_config('test.uid',$1,false)",[ids[user]]);
  const record = async (id = ids.record) => (await db.query('SELECT * FROM tenant.renewal_clients__a WHERE id=$1',[id])).rows[0];
  const importData = (data, pack = null, id = ids.record) => db.query('SELECT * FROM public.import_renewal_summary($1,$2::jsonb,$3::jsonb)',[id,JSON.stringify(data),pack ? JSON.stringify(pack) : null]);
  const setStatus = async status => { await login('admin'); await db.query('UPDATE tenant.renewal_clients__a SET status__a=$1 WHERE id=$2',[status,ids.record]); };

  await t.test('preview targets selected older record', async () => {
    await login('crm');
    const result = await db.query('SELECT * FROM public.get_renewal_summary_import_state($1)',[ids.record]);
    assert.equal(result.rows[0].current_status,'Surv_NCR_RCA_Uploaded');
  });
  await t.test('physical and legacy keys update real columns and attach the sheet atomically', async () => {
    await login('crm');
    const pack = {name:'summary.xlsx',bucket:'tenant-uploads',path:`${ids.tenant}/renewal_summary_${ids.record}_test.xlsx`};
    await importData({scope__a:'Engineering',country:'India',surv_auditor_accepted_date__a:'2026-10-18'},pack);
    const r = await record();
    assert.equal(r.scope__a,'Engineering'); assert.equal(r.country__a,'India');
    assert.equal(r.status__a,'Surv_Auditor_Accepted'); assert.equal(r.surv_audit_pack__a.length,1);
    assert.equal((await db.query("SELECT current_setting('craft.summary_import_record',true) AS flag")).rows[0].flag,'');
    await db.query('SELECT * FROM public.upsert_renewal_from_summary($1,$2)',[ids.record,{scope__a:'Saved from Summary tab'}]);
    assert.equal((await record()).scope__a,'Saved from Summary tab');
  });
  await t.test('bad dates or unsupported fields roll back metadata, status and pack', async () => {
    await login('crm'); const before = await record();
    await assert.rejects(importData({scope__a:'Do not save',surv_report_sent_date__a:'2026-02-31'}));
    assert.deepEqual(await record(),before);
    await assert.rejects(importData({auditor_id__a:ids.otherAuditor}),/Unsupported summary field/);
    await assert.rejects(importData({status__a:'Certificate_Issued'}),/Unsupported summary field/);
    await assert.rejects(importData({scope:'A',scope__a:'B'}),/Conflicting values/);
  });
  await t.test('blank cells preserve values and later/unknown statuses never regress', async () => {
    for (const status of ['Certificate_Issued','Suspension_Letter_Sent','Future_Status']) {
      // Seed a historical state, then test the normal protected import path.
      await db.exec('ALTER TABLE tenant.renewal_clients__a DISABLE TRIGGER paused_surveillance_changes_guard');
      await setStatus(status);
      await db.exec('ALTER TABLE tenant.renewal_clients__a ENABLE TRIGGER paused_surveillance_changes_guard');
      await login('crm');
      await importData({scope__a:'',surv_plan_sent_date__a:'2026-01-01'});
      assert.equal((await record()).status__a,status);
      assert.equal((await record()).scope__a,'Saved from Summary tab');
    }
  });
  await t.test('clients/auditors/tech reviewers and other-tenant records cannot import', async () => {
    for (const user of ['client','auditor','tech']) {
      await login(user); await assert.rejects(importData({scope:'Denied'}),/Access denied/);
    }
    await login('crm'); await assert.rejects(importData({scope:'Denied'},null,ids.otherRecord),/not found/);
    await assert.rejects(importData({scope:'Denied'},{name:'bad.xlsx',bucket:'tenant-uploads',path:'another-tenant/file.xlsx'}),/Invalid.*attachment/);
  });
  await t.test('client cannot approve through dedicated or generic update RPC', async () => {
    await setStatus('Surv_NCR_RCA_Uploaded'); await login('client');
    const r = await db.query("SELECT * FROM public.review_surv_ncr_rca($1,'accept',NULL)",[ids.record]);
    assert.equal(r.rows[0].success,false);
    await assert.rejects(db.query('SELECT public.update_tenant_record($1,$2,$3,$4)',
      ['renewal_clients__a',ids.record,ids.tenant,{status__a:'Surv_Auditor_Accepted'}]),/assigned Auditor|workflow action/);
    await assert.rejects(db.query('UPDATE tenant.recertification_clients__a SET status__a=$1 WHERE id=$2',['Recert_Auditor_Accepted',ids.recert]),/assigned Auditor/);
    await login('crm'); await assert.rejects(db.query('UPDATE tenant.renewal_clients__a SET status__a=$1 WHERE id=$2',['Surv_Auditor_Accepted',ids.record]),/assigned Auditor/);
    await login('otherAuditor');
    const denied = await db.query("SELECT * FROM public.review_surv_ncr_rca($1,'accept',NULL)",[ids.record]);
    assert.equal(denied.rows[0].success,false);
    await login('auditor');
    const approved = await db.query("SELECT * FROM public.review_surv_ncr_rca($1,'accept',NULL)",[ids.record]);
    assert.equal(approved.rows[0].success,true);
  });
  await t.test('team changes require CRM/admin, and uploads require the assigned user', async () => {
    await login('client');
    await assert.rejects(db.query('UPDATE tenant.renewal_clients__a SET auditor_id__a=$1 WHERE id=$2',[ids.otherAuditor,ids.record]),/only CRM Office/);
    for (const [user,field] of [['otherAuditor','ncrField'],['otherTech','checklistField']]) {
      await login(user);
      await assert.rejects(db.query('INSERT INTO tenant.attachments(tenant_id,object_id,field_id,record_id) VALUES ($1,$2,$3,$4)',[ids.tenant,ids.object,ids[field],ids.record]),/not the assigned/);
    }
    for (const [user,field] of [['auditor','ncrField'],['tech','checklistField']]) {
      await login(user);
      await db.query('INSERT INTO tenant.attachments(tenant_id,object_id,field_id,record_id) VALUES ($1,$2,$3,$4)',[ids.tenant,ids.object,ids[field],ids.record]);
    }
  });
  await t.test('client record responses omit team identities and dates', async () => {
    await login('client');
    const result = await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    const r = result.rows.find(r=>r.record_id===ids.record).record_data;
    assert.equal(Object.hasOwn(r,'auditor_id__a'),false); assert.equal(Object.hasOwn(r,'tech_reviewer_id__a'),false);
    assert.equal(Object.hasOwn(r,'team_assigned_date__a'),false);
    const legacy = await db.query('SELECT * FROM public.get_object_records($1,$2)',[ids.object,ids.tenant]);
    assert.equal(Object.hasOwn(legacy.rows.find(r=>r.record_id===ids.record).record_data,'auditor_id__a'),false);
    await login('admin');
    const visible = await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.equal(visible.rows.find(r=>r.record_id===ids.record).record_data.auditor_id__a,ids.auditor);
    await assert.rejects(db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.otherTenant]),/invalid tenant/);
  });
  await t.test('new surveillance requires a linked client and uses its company name', async () => {
    await login('crm');
    const empty = await db.query('SELECT * FROM public.create_renewal_client(NULL,NULL,NULL)');
    assert.equal(empty.rows[0].success,false);
    const created = await db.query('SELECT * FROM public.create_renewal_client($1,NULL,NULL)',[ids.extClient]);
    assert.equal(created.rows[0].success,true);
    assert.equal((await record(created.rows[0].record_id)).name,'Actual Company');
  });
  await t.test('tenant, client and assignment filtering happen before pagination',async()=>{
    await login('crm');
    await db.query('UPDATE tenant.renewal_clients__a SET created_at=$1 WHERE id=$2',['2027-01-01',ids.otherRecord]);
    const page=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2,1,0)',[ids.object,ids.tenant]);
    assert.equal(page.rows.length,1); assert.notEqual(page.rows[0].record_id,ids.otherRecord);
    await login('otherAuditor');
    const denied=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.equal(denied.rows.length,0);
    await login('crm'); await db.query('UPDATE tenant.renewal_clients__a SET record_owner__a=$1 WHERE id=$2',[ids.crm,ids.record]);
    await db.query("SELECT set_config('test.read_mode','owner',false)");
    const owned=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.deepEqual(owned.rows.map(r=>r.record_id),[ids.record]);
    await db.query("SELECT set_config('test.read_mode','all',false)");
  });
  await t.test('configured field denies remove raw values and block generic edits',async()=>{
    await login('admin');
    await db.query("INSERT INTO tenant.fields(id,object_id,name) VALUES ('00000000-0000-4000-8000-999999999991',$1,'scope')",[ids.object]);
    await login('crm'); await db.query("SELECT set_config('test.denied_read','00000000-0000-4000-8000-999999999991',false)");
    const data=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.equal(Object.hasOwn(data.rows.find(r=>r.record_id===ids.record).record_data,'scope__a'),false);
    await db.query("SELECT set_config('test.denied_edit','00000000-0000-4000-8000-999999999991',false)");
    await assert.rejects(db.query('SELECT public.update_tenant_record($1,$2,$3,$4)',['renewal_clients__a',ids.record,ids.tenant,{scope__a:'Denied'}]),/not editable/);
    await db.query("SELECT set_config('test.denied_read','',false),set_config('test.denied_edit','',false)");
    await assert.rejects(db.query('SELECT public.update_tenant_record($1,$2,$3,$4)',['renewal_clients__a',ids.record,ids.otherTenant,{scope__a:'Denied'}]),/invalid tenant/);
  });
  await t.test('reference reads and edits cannot cross tenant boundaries',async()=>{
    const foreignClient='00000000-0000-4000-8000-999999999981';
    const referenceField='00000000-0000-4000-8000-999999999982';
    await login('admin');
    await db.query('INSERT INTO tenant.external_clients__a(id,tenant_id,"Company_name__a") VALUES ($1,$2,$3)',[foreignClient,ids.otherTenant,'Other tenant secret']);
    await db.query("INSERT INTO tenant.fields(id,object_id,name,type,reference_table,reference_display_field) VALUES ($1,$2,'external_client_id','reference','external_clients__a','Company_name__a')",[referenceField,ids.object]);
    // Simulate incorrect historical data. The JOIN must not reveal its label.
    await db.query('UPDATE tenant.renewal_clients__a SET external_client_id__a=$1 WHERE id=$2',[foreignClient,ids.record]);
    await login('crm');
    const rows=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.notEqual(rows.rows.find(r=>r.record_id===ids.record).record_data.external_client_id,'Other tenant secret');
    await db.query('UPDATE tenant.renewal_clients__a SET external_client_id__a=NULL WHERE id=$1',[ids.record]);
    await assert.rejects(db.query('SELECT public.update_tenant_record($1,$2,$3,$4)',
      ['renewal_clients__a',ids.record,ids.tenant,{external_client_id__a:foreignClient}]),/Reference must belong to your tenant/);
  });
  await t.test('email-linked RCA upload finalizes and advances, including Recertification application',async()=>{
    const uploadId='00000000-0000-4000-8000-999999999992';
    const fieldId='00000000-0000-4000-8000-999999999993';
    await login('admin');
    await db.query("UPDATE tenant.renewal_clients__a SET client_user_id__a=NULL,status__a='Surv_NCR_Sent' WHERE id=$1",[ids.record]);
    await db.query("INSERT INTO tenant.fields(id,object_id,name,type) VALUES ($1,$2,'surv_ncr_rca','file')",[fieldId,ids.object]);
    await login('client');
    await db.query("INSERT INTO tenant.attachments(id,tenant_id,object_id,field_id,record_id,filename,storage_bucket,storage_path) VALUES ($1,$2,$3,$4,$5,'rca.pdf','tenant-uploads','test/rca.pdf')",[uploadId,ids.tenant,ids.object,fieldId,ids.record]);
    const result=await db.query('SELECT * FROM public.finalize_file_upload($1,NULL,NULL)',[uploadId]);
    assert.equal(result.rows[0].success,true); assert.equal((await record()).status__a,'Surv_NCR_RCA_Uploaded');
    await login('otherAuditor');
    const deny=await db.query('SELECT * FROM public.finalize_file_upload($1,NULL,NULL)',[uploadId]);
    assert.equal(deny.rows[0].success,false);
    await login('admin'); await db.query("UPDATE tenant.recertification_clients__a SET client_user_id__a=NULL,status__a='Recert_Intimation_Sent' WHERE id=$1",[ids.recert]);
    const recertField='00000000-0000-4000-8000-999999999994';
    await db.query("INSERT INTO tenant.fields(id,object_id,name,type) VALUES ($1,$2,'recert_application_form','file')",[recertField,ids.recertObject]);
    await login('client');
    const attachment=await db.query("INSERT INTO tenant.attachments(tenant_id,object_id,field_id,record_id,filename) VALUES ($1,$2,$3,$4,'application.pdf') RETURNING id",[ids.tenant,ids.recertObject,recertField,ids.recert]);
    assert.equal((await db.query('SELECT * FROM public.finalize_file_upload($1,NULL,NULL)',[attachment.rows[0].id])).rows[0].success,true);
    assert.equal((await db.query('SELECT status__a FROM tenant.recertification_clients__a WHERE id=$1',[ids.recert])).rows[0].status__a,'Recert_Application_Sent');
  });
  await t.test('Recertification summary import accepts physical keys and never rewinds',async()=>{
    await login('crm');
    await db.query('SELECT * FROM public.import_recert_summary($1,$2,NULL)',[ids.recert,{scope__a:'Recert scope',recert_auditor_accepted_date__a:'2026-10-18'}]);
    let r=(await db.query('SELECT * FROM tenant.recertification_clients__a WHERE id=$1',[ids.recert])).rows[0];
    assert.equal(r.scope__a,'Recert scope');assert.equal(r.status__a,'Recert_Auditor_Accepted');
    await db.query('SELECT * FROM public.import_recert_summary($1,$2,NULL)',[ids.recert,{recert_application_sent_date__a:'2026-01-01'}]);
    r=(await db.query('SELECT * FROM tenant.recertification_clients__a WHERE id=$1',[ids.recert])).rows[0];assert.equal(r.status__a,'Recert_Auditor_Accepted');
  });
  await t.test('client reports are denied by record, attachment, download and Storage until tech review',async()=>{
    const reportField='00000000-0000-4000-8000-999999999995';
    const reportPath=ids.tenant+'/report.pdf';
    await login('admin');
    await db.query("INSERT INTO tenant.fields(id,object_id,name,type) VALUES ($1,$2,'surveillance_audit_report','file')",[reportField,ids.object]);
    await db.query("UPDATE tenant.renewal_clients__a SET status__a='Surv_Report_Sent',surveillance_audit_report__a='{}'::jsonb WHERE id=$1",[ids.record]);
    const a=(await db.query("INSERT INTO tenant.attachments(tenant_id,object_id,field_id,record_id,storage_bucket,storage_path,filename) VALUES ($1,$2,$3,$4,'tenant-uploads',$5,'report.pdf') RETURNING id",[ids.tenant,ids.object,reportField,ids.record,reportPath])).rows[0].id;
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('tenant-uploads',$1)",[reportPath]);
    await login('client');
    const data=await db.query('SELECT * FROM public.get_object_records_with_references($1,$2)',[ids.object,ids.tenant]);
    assert.equal(Object.hasOwn(data.rows.find(r=>r.record_id===ids.record).record_data,'surveillance_audit_report__a'),false);
    assert.equal((await db.query('SELECT public.can_read_workflow_attachment($1) AS allowed',[a])).rows[0].allowed,false);
    assert.equal((await db.query('SELECT * FROM public.get_record_attachments($1,$2)',[ids.record,reportField])).rows.length,0);
    assert.equal((await db.query('SELECT * FROM public.get_file_download_url($1,1)',[a])).rows[0].success,false);
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT * FROM storage.objects WHERE name=$1',[reportPath])).rows.length,0);
    await db.exec('RESET ROLE');
    await login('admin');await db.query("UPDATE tenant.renewal_clients__a SET status__a='Surv_Tech_Findings_Given' WHERE id=$1",[ids.record]);
    await login('client');
    assert.equal((await db.query('SELECT public.can_read_workflow_attachment($1) AS allowed',[a])).rows[0].allowed,true);
    assert.equal((await db.query('SELECT * FROM public.delete_file($1)',[a])).rows[0].success,false);
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT * FROM storage.objects WHERE name=$1',[reportPath])).rows.length,1);
    assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING id',[reportPath])).rows.length,0);
    assert.equal((await db.query('UPDATE storage.objects SET name=name WHERE name=$1 RETURNING id',[reportPath])).rows.length,0);
    await db.exec('RESET ROLE');
  });
  await t.test('a previous assignee cannot finalize an upload after team reassignment',async()=>{
    const reportField='00000000-0000-4000-8000-999999999995';
    await login('auditor');
    const upload=(await db.query("INSERT INTO tenant.attachments(tenant_id,object_id,field_id,record_id,filename) VALUES ($1,$2,$3,$4,'replacement.pdf') RETURNING id",[ids.tenant,ids.object,reportField,ids.record])).rows[0].id;
    await login('crm');
    await db.query('UPDATE tenant.renewal_clients__a SET auditor_id__a=$1 WHERE id=$2',[ids.otherAuditor,ids.record]);
    await login('auditor');
    const denied=await db.query('SELECT * FROM public.finalize_file_upload($1,NULL,NULL)',[upload]);
    assert.equal(denied.rows[0].success,false);
    await login('crm');await db.query('UPDATE tenant.renewal_clients__a SET auditor_id__a=$1 WHERE id=$2',[ids.auditor,ids.record]);
  });
  await t.test('certificate is terminal and paused suspension actions are blocked even for admin',async()=>{
    await login('admin');
    await db.query('ALTER TABLE tenant.renewal_clients__a ADD COLUMN surv_suspension_intimation__a jsonb');
    await db.query("UPDATE tenant.renewal_clients__a SET status__a='Certificate_Issued' WHERE id=$1",[ids.record]);
    for(const status of ['Suspension_Intimation_Sent','Suspension_Decision_Uploaded','Suspension_Letter_Sent','Withdrawal_Intimation_Sent','Withdrawal_Decision_Uploaded','Withdrawal_Letter_Sent']) {
      await assert.rejects(db.query('UPDATE tenant.renewal_clients__a SET status__a=$1 WHERE id=$2',[status,ids.record]),/complete|on hold/);
    }
    await assert.rejects(db.query("UPDATE tenant.renewal_clients__a SET status__a='Surv_Plan_Sent' WHERE id=$1",[ids.record]),/complete/);
    await assert.rejects(db.query('UPDATE tenant.renewal_clients__a SET surv_suspension_intimation__a=$1 WHERE id=$2',[JSON.stringify({name:'new.pdf'}),ids.record]),/on hold/);
    const field='00000000-0000-4000-8000-000000000098';
    await db.query("INSERT INTO tenant.fields(id,object_id,name) VALUES ($1,$2,'surv_suspension_intimation__a')",[field,ids.object]);
    await assert.rejects(db.query("INSERT INTO tenant.attachments(id,tenant_id,object_id,record_id,field_id,storage_bucket,storage_path,uploaded_by) VALUES (gen_random_uuid(),$1,$2,$3,$4,'tenant-uploads','paused.pdf',$5)",[ids.tenant,ids.object,ids.record,field,ids.admin]),/on hold/);
    assert.equal((await db.query('SELECT status__a FROM tenant.renewal_clients__a WHERE id=$1',[ids.record])).rows[0].status__a,'Certificate_Issued');
    // Apply the migration over a pre-existing historical suspension record.
    await db.exec('ALTER TABLE tenant.renewal_clients__a DISABLE TRIGGER paused_surveillance_changes_guard');
    await db.query("UPDATE tenant.renewal_clients__a SET status__a='Suspension_Letter_Sent',surv_suspension_intimation__a=$1 WHERE id=$2",[JSON.stringify({name:'historic.pdf'}),ids.record]);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/297_surveillance_ends_at_certificate.sql'),'utf8'));
    await db.query("UPDATE tenant.renewal_clients__a SET scope__a='Metadata correction' WHERE id=$1",[ids.record]);
    const old=(await db.query('SELECT status__a,surv_suspension_intimation__a FROM tenant.renewal_clients__a WHERE id=$1',[ids.record])).rows[0];
    assert.equal(old.status__a,'Suspension_Letter_Sent'); assert.equal(old.surv_suspension_intimation__a.name,'historic.pdf');
  });
  await t.test('Supabase audit queries execute without changing business records',async()=>{
    await db.exec('CREATE TABLE tenant.client_summary__a(id uuid,tenant_id uuid,external_client_id__a uuid); CREATE TABLE tenant.tabs(id uuid,tenant_id uuid)');
    const before=await db.query('SELECT id,status__a,scope__a FROM tenant.renewal_clients__a ORDER BY id');
    const results=await db.exec(fs.readFileSync(path.join(root,'UAF New Changes/New Help Doc/General/Supabase_Read_Only_Record_Audit.sql'),'utf8'));
    assert.equal(results.length,3);
    assert.equal(results[0].rows[0].schema_audit.tables.length,4);
    assert.ok(results[1].rows[0].record_audit.links.some(r=>r.object==='renewal_clients__a'&&r.unlinked>0));
    const after=await db.query('SELECT id,status__a,scope__a FROM tenant.renewal_clients__a ORDER BY id');
    assert.deepEqual(after.rows,before.rows);
  });
  await db.close();
});

function text(node) { return node.children.map(c=>typeof c==='string'?c:text(c)).join(''); }
const stubToast = Object.assign(()=>{}, {success(){},error(){}});
const mocks = client => ({
  '@supabase/auth-helpers-nextjs': {createClientComponentClient:()=>client},
  'react-hot-toast': {__esModule:true,default:stubToast},
  'pdfjs-dist': {GlobalWorkerOptions:{},version:'test'},
  provider: {useSupabase:()=>({tenant:{id:ids.tenant},user:{id:ids.crm}})},
  app: {useCurrentApp:()=>({selectedApp:{name:'Test App'}})},
});

test('picker pins search/create above scrolling results and filters by email', async () => {
  const Picker = loadTS(base+'Renewal_Client/ClientPicker.tsx').default;
  let selected;
  let view;
  await act(async()=> {view=renderer.create(React.createElement(Picker,{options:[{id:'A',label:'Acme',email:'sales@acme.test'},{id:'B',label:'Beta',email:'beta@example.test'}],value:'',loading:false,canCreate:true,onChange:id=>selected=id,onCreate(){}}));});
  await act(async()=>view.root.findByProps({'aria-haspopup':'listbox'}).props.onClick());
  const list=view.root.findByProps({role:'listbox'});
  assert.equal(list.findAllByType('input').length,0);
  assert.equal(list.findAllByType('button').some(b=>text(b).includes('Create New Client')),false);
  await act(async()=>view.root.findByProps({'aria-label':'Search clients'}).props.onChange({target:{value:'beta@'}}));
  assert.equal(view.root.findAllByProps({role:'option'}).length,1);
  await act(async()=>view.root.findByProps({role:'option'}).props.onClick());
  assert.equal(selected,'B'); view.unmount();
});

test('inline existing New Client flow selects its result and preserves the surveillance letter', async () => {
  const calls=[];
  const client={rpc:async(name,args)=>{
    calls.push({name,args});
    const data={get_tenant_objects:[{id:ids.object,name:'external_clients__a'}],get_object_records:[],get_tenant_fields:[{id:'application-field',name:'application_Form'}],create_object_record:[{success:true,record_id:ids.extClient}],start_file_upload:[{success:true,bucket:'tenant-uploads',storage_path:'test/application.xlsx',attachment_id:'attachment'}],finalize_file_upload:[{success:true}],create_renewal_client:[{success:true,record_id:ids.record}]}[name];
    return {data,error:null};
  },storage:{from:()=>({upload:async()=>({data:{path:'test/application.xlsx'},error:null})})}};
  const Form=loadTS(base+'Renewal_Client/NewRenewalForm.tsx',mocks(client)).default;
  let view; await act(async()=>{view=renderer.create(React.createElement(Form,{objectId:ids.object,tenantId:ids.tenant}));});
  const letter = new File(['pdf'], 'intimation.pdf',{type:'application/pdf'});
  await act(async()=>view.root.findByProps({type:'file'}).props.onChange({target:{files:[letter]}}));
  await act(async()=>view.root.findByProps({'aria-haspopup':'listbox'}).props.onClick());
  await act(async()=>view.root.findAllByType('button').find(b=>text(b).includes('Create New Client')).props.onClick());
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Company Name','New Acme'],['Email','new@example.test'],['Contact Person','Jane']]),'Application');
  const application = new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'application.xlsx');
  await act(async()=>view.root.findByProps({type:'file'}).props.onChange({target:{files:[application]}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.match(text(view.root.findByProps({'aria-haspopup':'listbox'})),/New Acme.*Jane/);
  assert.equal(view.root.findByProps({type:'email'}).props.value,'new@example.test');
  assert.ok(view.root.findAllByType('span').some(n=>text(n)==='intimation.pdf'));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.find(c=>c.name==='create_renewal_client').args.p_external_client_id,ids.extClient);
  assert.equal(calls.find(c=>c.name==='create_object_record').args.p_record_data.Company_name__a,'New Acme');
  view.unmount();
});

test('client/unassigned users have no approval controls and client progress hides team', async () => {
  const Panel=loadTS(base+'Renewal_Client/RenewalActionPanel.tsx',mocks({})).default;
  for(const [id,role] of [[ids.client,'External Client'],[ids.otherAuditor,'Auditor']]) {
    let view; await act(async()=>{view=renderer.create(React.createElement(Panel,{recordId:ids.record,recordData:{status__a:'Surv_NCR_RCA_Uploaded',client_user_id__a:ids.client,auditor_id__a:ids.auditor},currentUserRole:'user',currentCustomRole:role,currentUserId:id,onActionComplete(){}}));});
    assert.equal(view.toJSON(),null); view.unmount();
  }
  for (const [folder,name,status] of [['Renewal_Client','RenewalWorkflowBar','Team_Assigned'],['Recertification_Client','RecertificationWorkflowBar','Recert_Team_Assigned']]) {
    const Bar=loadTS(base+folder+'/'+name+'.tsx').default;
    let view; await act(async()=>{view=renderer.create(React.createElement(Bar,{recordData:{status__a:status},hideTeamDetails:true}));});
    assert.equal(view.root.findAllByType('span').some(n=>text(n)==='Team Assigned'),false); view.unmount();
  }
});


test('actual permission helpers handle physical field names, assignments and email-linked clients',()=>{
  const file=path.join(root,'app/commonfiles/core/components/Application/RecordDetailView.tsx');
  const source=fs.readFileSync(file,'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=new Set(['STAGE_STATUS_ORDER','SURV_STATUS_ORDER','RECERT_STATUS_ORDER','STAGE_REPORT_UNLOCK_AT','isStageReportLockedForClient','EXTERNAL_CLIENT_FILE_FIELD_UPLOAD_ROLE','RENEWAL_FILE_FIELD_UPLOAD_ROLE','RECERT_FILE_FIELD_UPLOAD_ROLE','isFileUploadAllowedForRole']);
  const parts=tree.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.has(d.name.getText(tree)))).map(n=>n.getText(tree));
  const context={};
  vm.runInNewContext(ts.transpileModule(parts.join('\n')+'\nthis.upload=isFileUploadAllowedForRole;this.locked=isStageReportLockedForClient;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  const record={client_user_id__a:null,email__a:'client@example.test',status__a:'Surv_Report_Sent',auditor_id__a:ids.auditor,tech_reviewer_id__a:ids.tech};
  assert.equal(context.upload('surv_tech_findings_file__a',record,ids.crm,'user','CRM Office',true),false);
  assert.equal(context.upload('surv_tech_findings_file__a',record,ids.otherTech,'user','Tech Reviewer',true),false);
  assert.equal(context.upload('surv_tech_findings_file__a',record,ids.tech,'user','Tech Reviewer',true),true);
  assert.equal(context.upload('surv_ncr__a',record,ids.otherAuditor,'user','Auditor',true),false);
  assert.equal(context.upload('surv_ncr__a',record,ids.auditor,'user','Auditor',true),true);
  assert.equal(context.upload('surv_ncr_rca__a',record,ids.client,'user','External Client',true,false,'CLIENT@example.test'),true);
  assert.equal(context.locked('surveillance_audit_report__a',record,ids.client,'client@example.test'),true);
  assert.equal(context.locked('surveillance_audit_report__a',{...record,status__a:'Surv_Tech_Findings_Given'},ids.client,'client@example.test'),false);
  assert.equal(context.upload('surv_suspension_intimation__a',record,ids.admin,'admin',null,true),false);
  assert.equal(context.upload('surv_withdrawal_decision',record,ids.admin,'admin',null,true),false);
});

test('issued Surveillance shows completion and no suspension or withdrawal steps',async()=>{
  const Panel=loadTS(base+'Renewal_Client/RenewalActionPanel.tsx',mocks({})).default;
  const Bar=loadTS(base+'Renewal_Client/RenewalWorkflowBar.tsx').default;
  let panel,bar;
  await act(async()=>{
    panel=renderer.create(React.createElement(Panel,{recordId:ids.record,recordData:{status__a:'Certificate_Issued'},currentUserRole:'admin',currentUserId:ids.admin,onActionComplete(){}}));
    bar=renderer.create(React.createElement(Bar,{recordData:{status__a:'Certificate_Issued'}}));
  });
  assert.ok(JSON.stringify(panel.toJSON()).includes('Surveillance complete'));
  assert.equal(JSON.stringify(panel.toJSON()).includes('Suspension'),false);
  assert.ok(JSON.stringify(bar.toJSON()).includes('Certificate Issued'));
  assert.equal(JSON.stringify(bar.toJSON()).includes('Suspension'),false);
  assert.equal(JSON.stringify(bar.toJSON()).includes('Withdrawal'),false);
  panel.unmount();bar.unmount();
});

test('bulk controls are admin-only and show the exact button label for each existing Summary workflow',async()=>{
  for(const role of ['user','admin'])for(const [workflow,label]of [['initial','Bulk Summary Upload'],['surveillance','Bulk Surv 1 Summary Upload'],['recertification','Bulk Recert Summary Upload']]){
    const Bulk=loadTS(base+'BulkSummary/BulkSummaryUpload.tsx',{
      ...mocks({}),provider:{useSupabase:()=>({tenant:{id:ids.tenant},userProfile:{role}})},
    }).default;
    let view;await act(async()=>{view=renderer.create(React.createElement(Bulk,{workflow,onImported(){}}));});
    if(role==='admin')assert.equal(text(view.root.findByType('button')),label);
    else assert.equal(view.toJSON(),null);
    view.unmount();
  }
});

for(const scenario of ['same source','different source','unconfirmed result'])test(`bulk modal upload/preview/apply handles ${scenario}`,async()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Company name','Standard','Scope'],['Acme','9','New scope']]),'Sheet1');
  const file=new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'bulk.xlsx');
  let applied=0,downloaded=0,refreshed=0;
  const client={storage:{from:()=>({upload:async()=>({error:{statusCode:'400',message:'Duplicate'}}),download:async()=>{downloaded++;return {data:scenario==='different source'?new Blob(['different bytes']):file,error:null};}})},rpc:async(name,args)=>{
    if(name==='preview_bulk_summary_row')return {data:{body:'Test App',targets:[{id:ids.extClient,version:'v1',data:{Company_name__a:'Acme',ISOStandard__a:'ISO 14001',certification_body__a:'Test App',scope__a:'Old scope'}}],clients:[],separate_standard:false},error:null};
    assert.equal(name,'apply_bulk_summary_row');applied++;assert.equal(args.p_data.ISOStandard__a,'ISO 9001');assert.equal(args.p_target_id,ids.extClient);
    return {data:scenario==='unconfirmed result'?{}:{success:true,record_id:ids.extClient,created:false},error:null};
  }};
  const Bulk=loadTS(base+'BulkSummary/BulkSummaryUpload.tsx',{
    ...mocks(client),provider:{useSupabase:()=>({tenant:{id:ids.tenant},userProfile:{role:'admin'}})},
    app:{useCurrentApp:()=>({selectedApp:{id:ids.object,name:'Test App'}})},localStorage:{getItem:()=>JSON.stringify({id:ids.object,name:'Test App'})},
  }).default;
  let view;await act(async()=>{view=renderer.create(React.createElement(Bulk,{workflow:'initial',onImported(){refreshed++;}}));});
  await act(async()=>{view.root.findByType('button').props.onClick();});
  await act(async()=>{await view.root.findByProps({type:'file'}).props.onChange({target:{files:[file]}});});
  const findButton=prefix=>view.root.findAllByType('button').find(n=>text(n).startsWith(prefix));
  await act(async()=>{await findButton('Find matches').props.onClick();});
  assert.ok(JSON.stringify(view.toJSON()).includes('ISO 9001, ISO 14001'));
  assert.equal(findButton('Apply ').props.disabled,false);
  await act(async()=>{await findButton('Apply ').props.onClick();});
  assert.equal(downloaded,1);
  if(scenario==='different source'){assert.equal(applied,0);assert.equal(refreshed,0);assert.ok(JSON.stringify(view.toJSON()).includes('stored source workbook differs'));}
  else if(scenario==='unconfirmed result'){assert.equal(applied,1);assert.equal(refreshed,0);assert.ok(JSON.stringify(view.toJSON()).includes('server did not confirm'));}
  else {assert.equal(applied,1);assert.equal(refreshed,1);assert.ok(JSON.stringify(view.toJSON()).includes('Updated'));}
  view.unmount();
});
