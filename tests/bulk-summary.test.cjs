const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite'),XLSX=require('xlsx');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
    {module:mod,exports:mod.exports,Date,require:n=>load(path.resolve(path.dirname(file),n+'.ts'))});return mod.exports;}
const mapping=load('app/commonfiles/core/components/custom/BulkSummary/bulkSummaryMapping.ts');
test('bulk parser canonicalises messy integrated standards and automatically splits other standards',()=>{
  assert.equal(mapping.canonicalStandards('9, ISO 14;45001:2018'),'ISO 9001, ISO 14001, ISO 45001');
  assert.equal(mapping.canonicalStandards('ISO9001:2015 / ISO-14001:2015'),'ISO 9001, ISO 14001');
  assert.equal(mapping.isIntegrated('27001,9001'),false);
  assert.equal(mapping.isIntegrated('19001'),false);
  const parsed=mapping.parseBulkRows([['COMPANY NAME','Standard','Certificate no','application'],['A c m e','ISO 27001\n9\n14','C27001\nC9001\nC14001','18/10/2026']], 'initial');
  assert.equal(parsed.rows.length,2);
  assert.equal(parsed.rows[0].standards,'ISO 9001, ISO 14001');
  assert.equal(parsed.rows[0].data.certificate_no__a,'C9001\nC14001');
  assert.equal(parsed.rows[1].standards,'ISO 27001');
  assert.equal(parsed.rows[1].data.certificate_no__a,'C27001');
  assert.equal(parsed.rows[1].data.Date__a,'2026-10-18');
  assert.equal(parsed.rows[0].errors.length,0);
  for(const standards of ['14001,9001','27001,14001,9001']){
    const certs=standards.split(',').map(n=>`CERT-${n}`).join('\n');
    const reversed=mapping.parseBulkRows([['company name','standard','certificate no'],['Reverse',standards,certs]],'initial');
    assert.equal(reversed.rows[0].standards,'ISO 9001, ISO 14001');
    assert.equal(reversed.rows[0].data.certificate_no__a,'CERT-9001\nCERT-14001');
  }
});
test('bulk parser reads sample wide dates, flags unmapped headings, bad dates, conflicts and duplicate rows',()=>{
  const w=XLSX.readFile(path.join(root,'UAF New Changes/SUmmary Bulk/sample bulk upload summary sheet.xlsx'));
  const data=XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{header:1,raw:false,defval:''});
  const result=mapping.parseBulkRows(data,'initial');
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].data.registration_date__a,'2026-05-26');
  assert.equal(result.rows[0].data.Date__a,'2026-03-15');
  assert.ok(result.ignored.includes('Recert plan sent date'));assert.equal(result.rows[0].errors.length,0);
  const invalid=mapping.parseBulkRows([['Company name','standard','application'],['Acme','9','31/02/2026'],['A c m e','14','2026-01-01']], 'initial');
  assert.ok(invalid.rows[0].errors.some(e=>e.includes('Invalid')));assert.ok(invalid.rows[1].errors.some(e=>e.includes('Duplicate')));
  const rollover=mapping.parseBulkRows([['company name','standard','application'],['Calendar check','9','31 April 2026']], 'initial');
  assert.ok(rollover.rows[0].errors.some(e=>e.includes('Invalid')));
  const mixed=mapping.parseBulkRows([['Company name','standard','certificate no'],['Acme','9001,27001','ONE']], 'initial');
  assert.ok(mixed.rows.every(r=>r.errors.some(e=>e.includes('Cannot pair'))));
  const conflict=mapping.parseBulkRows([['company name','standard','total mandays','surv mandays'],['Acme','9','8','3']], 'surveillance');
  assert.ok(conflict.rows[0].errors.some(e=>e.includes('Conflicting')));
});

test('bulk database transactions, permissions, matching, split parts and retries',async t=>{
  const db=new PGlite();
  const tenant='10000000-0000-4000-8000-000000000001',admin='10000000-0000-4000-8000-000000000002',crm='10000000-0000-4000-8000-000000000003',app='10000000-0000-4000-8000-000000000004',otherApp='10000000-0000-4000-8000-000000000005';
  const hash='a'.repeat(64),source={bucket:'tenant-uploads',name:'bulk.xlsx',path:`${tenant}/bulk_summary_${hash}.xlsx`};
  const migration=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
  const createTable=(workflow,table,extra)=>{
    const cols=new Map([['id','uuid primary key default gen_random_uuid()'],['tenant_id','uuid'],['name','text'],['status__a','text'],['created_at','timestamptz default now()'],['updated_at','timestamptz default now()'],['created_by',workflow==='initial'?'uuid':'text'],['updated_by',workflow==='initial'?'uuid':'text'],['certification_body__a','text'],['client_user_id__a',workflow==='initial'?'text':'uuid'],...extra]);
    for(const [name,field]of Object.entries(mapping.bulkSpec(workflow).fields))cols.set(name,field.kind==='date'?'date':'text');
    return `CREATE TABLE tenant.${table}(${Array.from(cols,([n,type])=>`"${n}" ${type}`).join(',')});`;
  };
  await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA tenant;CREATE SCHEMA system;CREATE SCHEMA storage;CREATE ROLE authenticated;CREATE ROLE anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE system.users(id uuid primary key,tenant_id uuid,role text,custom_role_id uuid,email text);
    CREATE TABLE tenant.roles(id uuid,name text);CREATE TABLE tenant.apps(id uuid,tenant_id uuid,name text,is_active boolean);
    CREATE TABLE tenant.objects(id uuid,name text);CREATE TABLE tenant.fields(id uuid,object_id uuid,name text);
    CREATE TABLE tenant.attachments(id uuid,object_id uuid,field_id uuid);
    CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    CREATE TABLE storage.buckets(id text primary key,public boolean);INSERT INTO storage.buckets VALUES('tenant-uploads',false);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;CREATE POLICY base ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
    ${createTable('initial','external_clients__a',[])}
    ${createTable('surveillance','renewal_clients__a',[['external_client_id__a','uuid references tenant.external_clients__a(id)'],['surv_audit_pack__a','jsonb']])}
    ${createTable('recertification','recertification_clients__a',[['external_client_id__a','uuid not null references tenant.external_clients__a(id)'],['recert_summary_pack__a','jsonb']])}
    INSERT INTO system.users(id,tenant_id,role) VALUES ('${admin}','${tenant}','admin'),('${crm}','${tenant}','user');
    INSERT INTO tenant.apps VALUES('${app}','${tenant}','Test App',true),('${otherApp}','20000000-0000-4000-8000-000000000001','Other App',true);
    INSERT INTO storage.objects(bucket_id,name) VALUES('tenant-uploads','${source.path}');
  `);
  const summaryCols=new Map([['id','uuid primary key default gen_random_uuid()'],['tenant_id','uuid'],['external_client_id__a','uuid'],['updated_at','timestamptz default now()'],['created_at','timestamptz default now()'],['audit_pack__a','jsonb']]);
  for(const f of Object.values(mapping.bulkSpec('initial').fields))if(f.summaryColumn)summaryCols.set(f.summaryColumn,f.kind==='date'?'date':'text');
  for(const n of ['stage1_report_sent_date__a','stage2_report_sent_date__a','certificates_sent_date__a'])summaryCols.set(n,'date');
  for(const n of ['stage2_tech_reviewer__a','stage1_tech_reviewer__a','stage1_auditor__a','stage2_auditor__a'])summaryCols.set(n,'text');
  await db.exec(`CREATE TABLE tenant.client_summary__a(${Array.from(summaryCols,([n,type])=>`"${n}" ${type}`).join(',')});`);
  const fn=(sql,name)=>{const start=sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);assert.ok(start>=0);return sql.slice(start,sql.indexOf('$$;',start)+3);};
  await db.exec(fn(migration('251_backfill_client_summary_on_upsert.sql'),'public.upsert_client_summary'));
  await db.exec(fn(migration('220_client_summary_object.sql'),'tenant.on_external_client_created'));
  await db.exec('CREATE TRIGGER trg_create_client_summary AFTER INSERT ON tenant.external_clients__a FOR EACH ROW EXECUTE FUNCTION tenant.on_external_client_created()');
  for(const f of ['291_fix_surveillance_summary_import.sql','295_recert_summary_import.sql','297_surveillance_ends_at_certificate.sql','298_admin_bulk_summary.sql'])await db.exec(migration(f));
  // Exercise the real Sprint 12 deferred creation trigger against the actual
  // bulk writer/importers. Historical spreadsheets must not enqueue notices.
  await db.exec(`CREATE ROLE service_role;
    CREATE TABLE system.user_invitations(id uuid primary key,tenant_id uuid,email text,invitation_token text,status text,expires_at timestamptz,role text);`);
  await db.exec(fn(migration('287_surv_client_access_by_email.sql'),'public.review_surveillance_intimation'));
  await db.exec(migration('299_notification_outbox.sql'));
  // The summary-only fixture previously omitted the real workflow file column.
  await db.exec('ALTER TABLE tenant.renewal_clients__a ADD surveillance_intimation_letter__a jsonb');
  await db.exec(migration('300_nonresponse_policy_hold.sql'));
  await db.exec(`ALTER TABLE tenant.objects ADD tenant_id uuid;
    CREATE TABLE tenant.picklist_values(tenant_id uuid,field_id uuid,value text,label text,display_order integer,is_active boolean);`);
  await db.exec(migration('301_nonresponse_upload_deadlines.sql'));
  await db.exec('ALTER TABLE storage.buckets ADD name text;ALTER TABLE storage.objects ADD metadata jsonb');
  await db.exec(migration('302_shared_suspension_docx.sql'));
  await db.exec(migration('303_suspension_pdf_delivery.sql'));
  await db.query("SELECT set_config('test.uid',$1,false)",[admin]);
  const preview=async(workflow,data,whichApp=app)=>(await db.query('SELECT public.preview_bulk_summary_row($1,$2,$3) AS p',[whichApp,workflow,JSON.stringify(data)])).rows[0].p;
  const apply=async(workflow,data,row,target=null,client=null)=>(await db.query('SELECT public.apply_bulk_summary_row($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS r',[app,workflow,hash,'Sheet1',row,JSON.stringify(data),JSON.stringify(source),target?.id||null,target?.version||null,client?.id||null,client?.version||null])).rows[0].r;
  let clientId;
  await t.test('legacy shorthand matches a whitespace-free company and merges only integrated standards',async()=>{
    const created=await apply('initial',{Company_name__a:'Acme',ISOStandard__a:'14001',scope__a:'Old'},2);clientId=created.record_id;
    await db.query('UPDATE tenant.external_clients__a SET "ISOStandard__a"=$1 WHERE id=$2',['14',clientId]);
    const data={Company_name__a:'A c m e',ISOStandard__a:'ISO9001:2015,45001',scope__a:'New'};
    const p=await preview('initial',data);assert.equal(p.targets.length,1);
    const result=await apply('initial',data,3,p.targets[0]);assert.equal(result.created,false);
    const c=(await db.query('SELECT "ISOStandard__a",scope__a FROM tenant.external_clients__a WHERE id=$1',[clientId])).rows[0];
    assert.equal(c.ISOStandard__a,'ISO 9001, ISO 14001, ISO 45001');assert.equal(c.scope__a,'New');
    assert.equal((await db.query('SELECT iso_standards__a FROM tenant.client_summary__a WHERE external_client_id__a=$1',[clientId])).rows[0].iso_standards__a,c.ISOStandard__a);
    await db.query('INSERT INTO tenant.external_clients__a(tenant_id,name,"Company_name__a","ISOStandard__a",certification_body__a) VALUES($1,$2,$3,$4,$5)',[tenant,'Fallback Company',' \t ','9','Test App']);
    assert.equal((await preview('initial',{Company_name__a:'Fallback Company',ISOStandard__a:'14'})).targets.length,1);
  });
  await t.test('all non-integrated standards create separate records and a completed split part retries once',async()=>{
    for(const [index,standard]of ['27001','22000','50001'].entries()){
      const data={Company_name__a:'Acme',ISOStandard__a:standard};assert.equal((await preview('initial',data)).targets.length,0);
      const first=await apply('initial',data,10+index);assert.equal(first.created,true);
      const retry=await apply('initial',data,10+index);assert.equal(retry.record_id,first.record_id);assert.equal(retry.already_applied,true);
    }
    const split=mapping.parseBulkRows([['company name','standard'],['Split Co','9,14,27001,22000']], 'initial');
    const results=[];for(const part of split.rows)results.push(await apply('initial',part.data,20));
    assert.equal(new Set(results.map(r=>r.record_id)).size,3);
    await assert.rejects(apply('initial',{Company_name__a:'Bad',ISOStandard__a:'9001,27001'},21),/Split non-integrated/);
  });
  await t.test('multiple candidates require explicit choice; stale previews and cross-app targets fail',async()=>{
    await db.query('INSERT INTO tenant.external_clients__a(tenant_id,name,"Company_name__a","ISOStandard__a",certification_body__a) VALUES($1,$2,$2,$3,$4)',[tenant,'Acme','9','Test App']);
    const data={Company_name__a:'Acme',ISOStandard__a:'9001',scope__a:'Selected'};const p=await preview('initial',data);assert.equal(p.targets.length,2);
    await assert.rejects(apply('initial',data,30),/Matching records exist/);
    await db.query('UPDATE tenant.external_clients__a SET scope__a=$1 WHERE id=$2',['Concurrent edit',p.targets[0].id]);
    await assert.rejects(apply('initial',data,30,p.targets[0]),/changed since preview/);
    await assert.rejects(preview('initial',data,otherApp),/belonging to your tenant/);
  });
  await t.test('Surveillance and Recertification create linked identities and use their own atomic importers',async()=>{
    for(const [workflow,date]of [['surveillance','surv_plan_sent_date__a'],['recertification','recert_plan_sent_date__a']]){
      const data={company_name__a:`New ${workflow}`,iso_standards__a:'9',scope__a:'Imported',[date]:'2026-10-18'};
      const first=await apply(workflow,data,40);assert.equal(first.created,true);assert.equal(first.client_created,true);
      const p=await preview(workflow,{...data,iso_standards__a:'14001'});assert.equal(p.targets.length,1);assert.equal(p.clients.length,1);
      const updated=await apply(workflow,{...data,iso_standards__a:'14001'},41,p.targets[0],p.clients[0]);assert.equal(updated.record_id,first.record_id);
      const original=(await db.query('SELECT "ISOStandard__a",status__a,scope__a FROM tenant.external_clients__a WHERE id=$1',[first.client_id])).rows[0];
      assert.equal(original.ISOStandard__a,'ISO 9001, ISO 14001');assert.equal(original.status__a,null);
      assert.equal(original.scope__a,'Imported');
    }
  });
  await t.test('new audit records inherit the linked client contact/login and honour explicit row overrides',async()=>{
    for(const [i,workflow]of ['surveillance','recertification'].entries()){
      const company=`Inherited ${workflow}`;
      const original=await apply('initial',{Company_name__a:company,ISOStandard__a:'9',email__a:'original@example.invalid',contactPerson__a:'Original Contact'},70+i*3);
      await db.query('UPDATE tenant.external_clients__a SET client_user_id__a=$1 WHERE id=$2',[crm,original.record_id]);
      const data={company_name__a:company,iso_standards__a:'14',...(i?{email__a:'override@example.invalid',contact_person__a:'Row Contact'}:{})};
      const p=await preview(workflow,data);
      const result=await apply(workflow,data,71+i*3,null,p.clients[0]);
      const table=workflow==='surveillance'?'renewal_clients__a':'recertification_clients__a';
      const child=(await db.query(`SELECT email__a,contact_person__a,client_user_id__a FROM tenant.${table} WHERE id=$1`,[result.record_id])).rows[0];
      assert.equal(child.email__a,i?'override@example.invalid':'original@example.invalid');
      assert.equal(child.contact_person__a,i?'Row Contact':'Original Contact');assert.equal(child.client_user_id__a,crm);
      assert.equal((await db.query('SELECT email__a FROM tenant.external_clients__a WHERE id=$1',[original.record_id])).rows[0].email__a,'original@example.invalid');
    }
  });
  await t.test('bad fields/dates roll back new clients, and CRM cannot preview or apply',async()=>{
    const before=(await db.query('SELECT count(*) AS n FROM tenant.external_clients__a')).rows[0].n;
    await assert.rejects(apply('initial',{Company_name__a:'Invalid',ISOStandard__a:'9001',Date__a:'2026-02-31'},50),/out of range/);
    await assert.rejects(apply('initial',{Company_name__a:'Invalid',ISOStandard__a:'9001',status__a:'Client_Registered'},50),/Unsupported bulk field/);
    assert.equal((await db.query('SELECT count(*) AS n FROM tenant.external_clients__a')).rows[0].n,before);
    await db.query("SELECT set_config('test.uid',$1,false)",[crm]);
    await assert.rejects(preview('initial',{Company_name__a:'Acme',ISOStandard__a:'9'}),/Admin role/);
    await assert.rejects(apply('initial',{Company_name__a:'Acme',ISOStandard__a:'9'},50),/Admin role/);
    await db.exec('SET ROLE authenticated');assert.equal((await db.query('SELECT count(*) AS n FROM storage.objects')).rows[0].n,0);
    await assert.rejects(db.query('SELECT * FROM tenant.bulk_summary_import_results'),/permission denied/);
    await assert.rejects(db.query("SELECT public._bulk_candidates($1,'Test App','external_clients__a','Acme','9001')",[tenant]),/permission denied/);
    await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[admin]);
    await db.exec('SET ROLE authenticated');assert.equal((await db.query('SELECT count(*) AS n FROM storage.objects')).rows[0].n,1);await db.exec('RESET ROLE');
    // Even a permissive legacy anonymous policy cannot expose bulk sources.
    await db.exec('GRANT USAGE ON SCHEMA storage,auth TO anon; GRANT SELECT ON storage.objects TO anon; CREATE POLICY permissive_anon ON storage.objects FOR SELECT TO anon USING(true)');
    await db.exec("SELECT set_config('test.uid','',false); SET ROLE anon");
    assert.equal((await db.query('SELECT count(*) AS n FROM storage.objects')).rows[0].n,0);
    await db.exec("RESET ROLE;INSERT INTO storage.objects(bucket_id,name) VALUES('tenant-uploads','unrelated-fixture.pdf'); SET ROLE anon");
    assert.equal((await db.query('SELECT count(*) AS n FROM storage.objects')).rows[0].n,1);
    await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[admin]);
  });
  await t.test('server/client normalisation agrees and summary rejection rolls back client plus trigger-created summary',async()=>{
    for(const workflow of ['initial','surveillance','recertification']){
      const spec=(await db.query('SELECT public._bulk_summary_spec($1) AS s',[workflow])).rows[0].s;
      assert.deepEqual(spec,JSON.parse(JSON.stringify(mapping.bulkSpec(workflow))));
    }
    for(const value of ['9,14,45001','ISO9001:2015 / ISO-14001:2015','45','ISO 27001:2022','90017','9 001','9001, 22000']){
      const sql=(await db.query('SELECT public._bulk_standards($1) AS n, public._bulk_integrated($1) AS integrated',[value])).rows[0];
      assert.equal(sql.n,mapping.canonicalStandards(value));assert.equal(sql.integrated,mapping.isIntegrated(value));
    }
    const before=(await db.query('SELECT (SELECT count(*) FROM tenant.external_clients__a) AS clients,(SELECT count(*) FROM tenant.client_summary__a) AS summaries')).rows[0];
    await db.exec(`CREATE OR REPLACE FUNCTION public.upsert_client_summary(p_external_client_id UUID,p_data JSONB) RETURNS TABLE(success BOOLEAN,message TEXT,summary_id UUID) LANGUAGE sql AS $$ SELECT false,'Forced summary failure'::text,NULL::uuid $$;`);
    await assert.rejects(apply('initial',{Company_name__a:'Rollback',ISOStandard__a:'9'},60),/Forced summary failure/);
    const after=(await db.query('SELECT (SELECT count(*) FROM tenant.external_clients__a) AS clients,(SELECT count(*) FROM tenant.client_summary__a) AS summaries')).rows[0];
    assert.deepEqual(after,before);
    await db.exec(fn(migration('251_backfill_client_summary_on_upsert.sql'),'public.upsert_client_summary'));
    await db.exec("UPDATE storage.buckets SET public=true WHERE id='tenant-uploads'");
    await assert.rejects(preview('initial',{Company_name__a:'Private source',ISOStandard__a:'9'}),/private tenant-uploads/);
    await db.exec("UPDATE storage.buckets SET public=false WHERE id='tenant-uploads'");
  });
  await t.test('reapplying the revised 298 preserves existing clients and import history',async()=>{
    const before=(await db.query('SELECT (SELECT count(*) FROM tenant.external_clients__a) AS clients,(SELECT count(*) FROM tenant.bulk_summary_import_results) AS history')).rows[0];
    await db.exec(migration('298_admin_bulk_summary.sql'));
    const retry=await apply('initial',{Company_name__a:'Acme',ISOStandard__a:'14001',scope__a:'Old'},2);
    assert.equal(retry.record_id,clientId);assert.equal(retry.already_applied,true);
    const after=(await db.query('SELECT (SELECT count(*) FROM tenant.external_clients__a) AS clients,(SELECT count(*) FROM tenant.bulk_summary_import_results) AS history')).rows[0];
    assert.deepEqual(after,before);
  });
  await t.test('Sprints 12/13 leave actual historical bulk creates, updates and retries mail/case-silent',async()=>{
    assert.equal((await db.query('SELECT count(*)::int AS count FROM tenant.notification_outbox')).rows[0].count,0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM tenant.nonresponse_cases')).rows[0].count,0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM tenant.nonresponse_audit')).rows[0].count,0);
  });
  await db.close();
});
