const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const assert=require('node:assert/strict'),{test}=require('node:test'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),tenant='10000000-0000-4000-8000-000000000010',other='20000000-0000-4000-8000-000000000010';
const admin='10000000-0000-4000-8000-000000000011',client='10000000-0000-4000-8000-000000000012',stranger='10000000-0000-4000-8000-000000000013';
const object='10000000-0000-4000-8000-000000000020',field='10000000-0000-4000-8000-000000000021';
const sql=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
function load(file,overrides={}){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.React},fileName:file}).outputText,{module:mod,exports:mod.exports,require:n=>overrides[n]||require(n),process,Response,Date,Buffer,URL,AbortSignal,fetch,setInterval,clearInterval});return mod.exports;}

test('approved upload-based non-response transitions in isolated PostgreSQL',async t=>{
 const db=new PGlite();const q=async(s,a=[])=> (await db.query(s,a)).rows,v=async(s,a=[])=> (await q(s,a))[0]?.v;
 const uid=id=>q("SELECT set_config('test.uid',$1,false)",[id]);
 try {
 await db.exec(`CREATE SCHEMA tenant;CREATE SCHEMA system;CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE storage.buckets(id text primary key,name text,public boolean);
 CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO authenticated,anon;GRANT SELECT ON storage.objects TO authenticated,anon;
 CREATE POLICY old_permissive_storage ON storage.objects FOR SELECT TO authenticated,anon USING(true);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE system.users(id uuid primary key,tenant_id uuid,role text,email text,custom_role_id uuid);
 CREATE TABLE tenant.roles(id uuid,name text);CREATE TABLE tenant.objects(id uuid primary key,name text,tenant_id uuid);
 CREATE FUNCTION public._check_permission(text,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 CREATE FUNCTION public._resolve_sharing_mode(uuid,uuid) RETURNS TABLE(effective_read_mode text) LANGUAGE sql AS $$ SELECT 'all'::text $$;
 CREATE TABLE tenant.fields(id uuid primary key,object_id uuid,name text);
 CREATE TABLE tenant.picklist_values(tenant_id uuid,field_id uuid,value text,label text,display_order integer,is_active boolean);
 CREATE TABLE tenant.attachments(id uuid primary key,tenant_id uuid,record_id uuid,object_id uuid,field_id uuid,storage_bucket text,storage_path text,filename text,byte_size bigint,created_at timestamptz default now(),deleted_at timestamptz);
 CREATE TABLE tenant.bulk_summary_import_results(tenant_id uuid,result jsonb);
 CREATE TABLE system.user_invitations(id uuid primary key,tenant_id uuid,email text,invitation_token text,status text,expires_at timestamptz,role text);
 CREATE TABLE tenant.external_clients__a(id uuid primary key default gen_random_uuid(),tenant_id uuid,status__a text);
 CREATE TABLE tenant.renewal_clients__a(id uuid primary key default gen_random_uuid(),tenant_id uuid,email__a text,name text,company_name__a text,contact_person__a text,client_user_id__a uuid,external_client_id__a uuid,status__a text,surveillance_intimation_letter__a jsonb,intimation_accepted_date__a date,rejection_notes__a text);
 CREATE TABLE tenant.recertification_clients__a(LIKE tenant.renewal_clients__a INCLUDING ALL);ALTER TABLE tenant.recertification_clients__a ADD recert_intimation_letter__a jsonb;
 CREATE FUNCTION public.review_surveillance_intimation(p_record_id uuid,p_action text,p_notes text default null) RETURNS TABLE(success boolean,message text) LANGUAGE plpgsql AS $$ BEGIN UPDATE tenant.renewal_clients__a SET status__a=CASE WHEN p_action='accept' THEN 'Intimation_Accepted' ELSE null END WHERE id=p_record_id;RETURN QUERY SELECT true,'done'::text;END $$;
 INSERT INTO system.users VALUES('${admin}','${tenant}','admin','admin@example.test',null),('${client}','${tenant}','user','client@example.test',null),('${stranger}','${other}','admin','wrong@example.test',null);
 INSERT INTO tenant.objects VALUES('${object}','renewal_clients__a','${tenant}');INSERT INTO tenant.fields VALUES('${field}','${object}','surveillance_intimation_letter');
 INSERT INTO tenant.objects VALUES('10000000-0000-4000-8000-000000000030','external_clients__a','${tenant}');
 INSERT INTO tenant.fields VALUES('10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000030','status__a');
 GRANT USAGE ON SCHEMA auth TO authenticated;`);
 for(const f of ['297_surveillance_ends_at_certificate.sql','299_notification_outbox.sql','300_nonresponse_policy_hold.sql'])await db.exec(sql(f));
 await uid(admin);
 const add=async()=>{
  const external=await v("INSERT INTO tenant.external_clients__a(tenant_id,status__a) VALUES($1,'Certificate_Issued') RETURNING id AS v",[tenant]);
  return v("INSERT INTO tenant.renewal_clients__a(tenant_id,email__a,name,external_client_id__a) VALUES($1,'client@example.test','Company',$2) RETURNING id AS v",[tenant,external]);
 };
 const letter=async id=>{
  const att=await v("INSERT INTO tenant.attachments VALUES(gen_random_uuid(),$1,$2,$3,$4,'tenant-uploads','safe/path','letter.pdf',4,now()-interval '3 days',null) RETURNING id AS v",[tenant,id,object,field]);
  await q("UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1,status__a='Intimation_Sent' WHERE id=$2",[{id:att},id]);return att;
 };
 const row=id=>v('SELECT to_jsonb(c) AS v FROM tenant.nonresponse_cases c WHERE record_id=$1',[id]);
 const notices=(id,kind)=>q('SELECT * FROM tenant.notification_outbox WHERE record_id=$1 AND notice_kind=$2',[id,kind]);
 const target=async id=>{await q("UPDATE tenant.nonresponse_cases SET next_check_at=now()+interval '1 day'");await q('UPDATE tenant.nonresponse_cases SET next_check_at=now() WHERE record_id=$1',[id]);};
 const run=async id=>{await target(id);return v('SELECT public.process_nonresponse() AS v');};
 const firstAge=async(id,age)=>q("UPDATE tenant.nonresponse_cases SET deadline_start_at=now()-$2::interval,first_deadline_at=public._s13_ist_after(now()-$2::interval,30),next_check_at=now() WHERE record_id=$1",[id,age]);
 const finalAge=async(id,age)=>q("UPDATE tenant.nonresponse_cases SET second_notice_issued_at=now()-$2::interval,final_deadline_at=public._s13_ist_after(now()-$2::interval,10),next_check_at=now() WHERE record_id=$1",[id,age]);
 const ready=async()=>{const id=await add();await letter(id);return id;};
 const legacy=await ready();const migration=sql('301_nonresponse_upload_deadlines.sql');await db.exec(migration);await db.exec(sql('302_shared_suspension_docx.sql'));await db.exec(sql('303_suspension_pdf_delivery.sql'));
 await t.test('no backfill/promotion of old cases; upload finalisation starts new cases, not attachment-start',async()=>{
  assert.equal((await row(legacy)).automation_enabled,false);assert.equal((await row(legacy)).first_deadline_at,null);
  const id=await ready(),c=await row(id);assert.equal(c.policy_version,'s13-upload-ist-v1');assert.equal(c.stage,'first_window');
  assert.ok(Date.now()-Date.parse(c.deadline_start_at)<10000);assert.equal(Date.parse(c.first_deadline_at)-Date.parse(c.deadline_start_at),30*86400000);
  await letter(legacy);assert.equal((await row(legacy)).automation_enabled,false);
  assert.equal(await v("SELECT count(*)::int AS v FROM tenant.picklist_values WHERE value='Suspended'"),1);
  await assert.rejects(q('UPDATE tenant.nonresponse_cases SET first_deadline_at=NULL WHERE record_id=$1',[id]),/check constraint/);
 });
 await t.test('IST boundaries are independent of server timezone, including midnight/year rollover',async()=>{
  for(const zone of ['UTC','America/New_York']){
   await q("SELECT set_config('TimeZone',$1,false)",[zone]);
   const deadline=await v("SELECT public._s13_ist_after('2026-12-31T18:29:59Z',30) AS v");
   assert.equal(deadline.toISOString(),'2027-01-30T18:29:59.000Z');
  }await q("SELECT set_config('TimeZone','UTC',false)");
 });
 await t.test('before/exactly at/after first deadline creates one transactional second notice',async()=>{
  for(const [age,due] of [['29 days 23:59:59',false],['30 days',true],['30 days 00:00:01',true]]){
   const id=await ready();await db.exec('BEGIN');await firstAge(id,age);const result=await run(id);
   assert.equal((await notices(id,'nonresponse_reminder')).length,due?1:0);assert.equal(result.outcome,due?'second_notice_issued':'not_due');
   if(due){const c=await row(id);assert.equal(Date.parse(c.final_deadline_at)-Date.parse(c.second_notice_issued_at),10*86400000);}
   await db.exec('COMMIT');await run(id);assert.equal((await notices(id,'nonresponse_reminder')).length,due?1:0);
  }
 });
 await t.test('before/exactly at/after further deadline suspends External Client, preserving Surveillance checkpoint',async()=>{
  for(const [age,due] of [['9 days 23:59:59',false],['10 days',true],['10 days 00:00:01',true]]){
   const id=await ready();await firstAge(id,'31 days');await run(id);await db.exec('BEGIN');await finalAge(id,age);await run(id);
   const c=await row(id);assert.equal(c.stage,due?'suspended':'second_window');
   assert.equal(await v('SELECT status__a AS v FROM tenant.external_clients__a WHERE id=$1',[c.external_client_id]),due?'Suspended':'Certificate_Issued');
   assert.equal(await v('SELECT status__a AS v FROM tenant.renewal_clients__a WHERE id=$1',[id]),'Intimation_Sent');
   const letters=await notices(id,'nonresponse_suspension');assert.equal(letters.length,due?1:0);
   if(due){assert.equal(letters[0].state,'blocked');assert.equal(letters[0].last_error,'suspension_template_pending');assert.equal(c.prior_client_status,'Certificate_Issued');}
   await db.exec('COMMIT');
  }
 });
 await t.test('provider failures, bounce, suppression and delay do not prevent either window',async()=>{
  for(const state of ['failed','bounced','delayed','suppressed','complained','blocked','queued']){
   const id=await ready();await q("UPDATE tenant.notification_outbox SET state=$2,failed_at=now() WHERE record_id=$1 AND notice_kind='intimation'",[id,state]);
   await firstAge(id,'31 days');assert.equal((await run(id)).outcome,'second_notice_issued');
   await q("UPDATE tenant.notification_outbox SET state=$2 WHERE record_id=$1 AND notice_kind='nonresponse_reminder'",[id,state]);
   await finalAge(id,'11 days');assert.equal((await run(id)).outcome,'client_suspended');
  }
 });
 await t.test('replacements and corrected emails preserve original start/deadlines/source; missing email is ignored',async()=>{
  const id=await ready();await firstAge(id,'31 days');const before=await row(id);await letter(id);
  await q("UPDATE tenant.renewal_clients__a SET email__a='corrected@example.test' WHERE id=$1",[id]);
  let c=await row(id);assert.equal(c.deadline_start_at,before.deadline_start_at);assert.equal(c.first_deadline_at,before.first_deadline_at);assert.equal(c.source_notice_id,before.source_notice_id);
  await run(id);assert.equal((await notices(id,'nonresponse_reminder'))[0].recipient,'corrected@example.test');
  const due=(await row(id)).final_deadline_at;await letter(id);assert.equal((await row(id)).final_deadline_at,due);
  await q("UPDATE tenant.renewal_clients__a SET email__a='' WHERE id=$1",[id]);await finalAge(id,'11 days');assert.equal((await run(id)).outcome,'ignored_missing_email');
  assert.equal((await row(id)).suspended_at,null);
 });
 await t.test('software Accept stops both windows; Reject holds for BA and never sends direct suspension',async()=>{
  for(const action of ['accept','reject'])for(const afterSecond of [false,true]){
   const id=await ready();await firstAge(id,'31 days');if(afterSecond)await run(id);
   await uid(client);assert.equal((await q('SELECT * FROM public.review_surveillance_intimation($1,$2,null)',[id,action]))[0].success,true);await uid(admin);
   if(afterSecond)await finalAge(id,'11 days');await run(id);const c=await row(id);
   assert.equal(c.stage,action==='accept'?'accepted':'rejected_ba_hold');assert.equal(c.suspended_at,null);assert.equal((await notices(id,'nonresponse_suspension')).length,0);
   if(afterSecond)assert.equal((await notices(id,'nonresponse_reminder'))[0].state,'cancelled');
  }
 });
 await t.test('response between reminder claim and prepare cancels provider submission; submitted evidence stays immutable',async()=>{
  for(const beforePrepare of [true,false]){
   const id=await ready();await firstAge(id,'31 days');await run(id);const n=(await notices(id,'nonresponse_reminder'))[0];
   await q("UPDATE tenant.notification_outbox SET next_attempt_at=now()+interval '1 day' WHERE state IN ('queued','retry')");await q('UPDATE tenant.notification_outbox SET next_attempt_at=now() WHERE id=$1',[n.id]);
   const claimed=await v('SELECT public.claim_notification() AS v');assert.equal(claimed.id,n.id);
   if(!beforePrepare)await q('SELECT public.prepare_notification($1,$2,$3)',[n.id,claimed.lease_token,{to:'client@example.test',html:'frozen'}]);
   await uid(client);await q("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]);await uid(admin);
   if(beforePrepare)await assert.rejects(q('SELECT public.prepare_notification($1,$2,$3)',[n.id,claimed.lease_token,{to:'client@example.test'}]),/Stale lease/);
   else {await q('SELECT public.finish_notification($1,$2,$3,null,false,0)',[n.id,claimed.lease_token,'submitted-'+n.id]);assert.equal((await notices(id,'nonresponse_reminder'))[0].payload.html,'frozen');}
   assert.equal((await row(id)).stage,'accepted');
  }
 });
 await t.test('late responses are recorded for CRM without workflow advancement or automatic restoration',async()=>{
  const id=await ready();await firstAge(id,'31 days');await run(id);await finalAge(id,'11 days');await run(id);const c=await row(id);
  await uid(stranger);assert.equal((await q("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]))[0].success,false);
  await uid(client);const result=(await q("SELECT * FROM public.review_surveillance_intimation($1,'accept','late')",[id]))[0];assert.equal(result.success,true);assert.match(result.message,/CRM/);
  assert.equal((await q("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]))[0].success,false);await uid(admin);
  assert.equal(await v('SELECT status__a AS v FROM tenant.renewal_clients__a WHERE id=$1',[id]),'Intimation_Sent');
  assert.equal(await v('SELECT status__a AS v FROM tenant.external_clients__a WHERE id=$1',[c.external_client_id]),'Suspended');
  await assert.rejects(q("UPDATE tenant.external_clients__a SET status__a='Certificate_Issued' WHERE id=$1",[c.external_client_id]),/Restoration/);
 });
 await t.test('crash rollback, duplicate requests, manual suspension and changed links never produce duplicate transitions',async()=>{
  const id=await ready();await firstAge(id,'31 days');await db.exec('BEGIN');await run(id);await db.exec('ROLLBACK');assert.equal((await row(id)).stage,'first_window');assert.equal((await notices(id,'nonresponse_reminder')).length,0);
  await run(id);await Promise.all([run(id),run(id)]);assert.equal((await notices(id,'nonresponse_reminder')).length,1);
  await finalAge(id,'11 days');await db.exec('BEGIN');await run(id);await db.exec('ROLLBACK');assert.equal((await row(id)).stage,'second_window');assert.equal((await notices(id,'nonresponse_suspension')).length,0);
  await run(id);await run(id);assert.equal((await notices(id,'nonresponse_suspension')).length,1);
  const manual=await ready(),m=await row(manual);await q("UPDATE tenant.external_clients__a SET status__a='Legacy_Suspended' WHERE id=$1",[m.external_client_id]);await firstAge(manual,'31 days');assert.equal((await run(manual)).outcome,'crm_review');
  const changed=await ready();await q('UPDATE tenant.renewal_clients__a SET external_client_id__a=$2 WHERE id=$1',[changed,m.external_client_id]);await firstAge(changed,'31 days');assert.equal((await run(changed)).outcome,'crm_review');
 });
 await t.test('tenant/private grants, wrong recipient, migration replay and certificate terminal guard',async()=>{
  const id=await ready();await firstAge(id,'31 days');await run(id);let c=await row(id);const n=(await notices(id,'nonresponse_reminder'))[0];
  await db.exec('SET ROLE authenticated');await assert.rejects(q('SELECT public.process_nonresponse()'),/permission denied/);await assert.rejects(q('SELECT * FROM tenant.nonresponse_transitions'),/permission denied/);await db.exec('RESET ROLE');
  await uid(stranger);await assert.rejects(q('SELECT public.get_record_nonresponse($1,$2)',['renewal_clients__a',id]),/Record not found/);await uid(admin);
  await q("UPDATE tenant.notification_outbox SET state='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' WHERE id=$1",[n.id]);
  const lease=await v('SELECT lease_token AS v FROM tenant.notification_outbox WHERE id=$1',[n.id]);
  await assert.rejects(q('SELECT public.prepare_notification($1,$2,$3)',[n.id,lease,{to:'wrong@example.test'}]),/Recipient mismatch/);
  await q("UPDATE tenant.renewal_clients__a SET email__a='corrected@example.test' WHERE id=$1",[id]);assert.equal(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,lease,{to:'client@example.test'}]),null);
  const before=await v('SELECT count(*)::int AS v FROM tenant.nonresponse_transitions');await db.exec(migration);await db.exec(sql('302_shared_suspension_docx.sql'));await db.exec(sql('303_suspension_pdf_delivery.sql'));assert.equal(await v('SELECT count(*)::int AS v FROM tenant.nonresponse_transitions'),before);assert.equal((await row(id)).deadline_start_at,c.deadline_start_at);
  assert.equal(await v("SELECT count(*)::int AS v FROM tenant.picklist_values WHERE value='Suspended'"),1);
  await assert.rejects(q("UPDATE tenant.external_clients__a SET status__a='Suspended' WHERE id=$1",[c.external_client_id]),/authorised non-response/);
  await assert.rejects(q("INSERT INTO tenant.external_clients__a(tenant_id,status__a) VALUES($1,'Suspended')",[tenant]),/new client/);
  const complete=await ready();await q("UPDATE tenant.renewal_clients__a SET status__a='Certificate_Issued' WHERE id=$1",[complete]);await firstAge(complete,'31 days');assert.equal((await run(complete)).outcome,'crm_review');
  await assert.rejects(q("UPDATE tenant.renewal_clients__a SET status__a='Suspension_Intimation_Sent' WHERE id=$1",[complete]),/complete/);
 });
 await t.test('shared DOCX registration is tenant/private/version-bound; activation releases one pinned final letter',async()=>{
  const id=await ready();await firstAge(id,'31 days');await run(id);await finalAge(id,'11 days');await run(id);const c=await row(id);
  await q("UPDATE tenant.notification_outbox SET last_error='operator_hold' WHERE notice_kind='nonresponse_suspension' AND record_id<>$1",[id]);
  const path1=tenant+'/suspension/version1.docx',path2=tenant+'/suspension/version2.docx',hash='a'.repeat(64);
  await q("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('notification-templates',$1,'{\"size\":100}')",[path1]);
  const template=await v('SELECT public.configure_suspension_docx($1,$2,$3,false) AS v',[tenant,path1,hash]);
  await q('SELECT public.release_suspension_letter()');assert.equal((await notices(id,'nonresponse_suspension'))[0].state,'blocked');
  await assert.rejects(q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[other,path1,hash]),/Invalid template/);
  await assert.rejects(q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[tenant,tenant+'/suspension/../wrong.docx',hash]),/Invalid template/);
  await assert.rejects(q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[tenant,path1,'b'.repeat(64)]),/new version path/);
  for(const role of ['authenticated','anon']){
   await db.exec('SET ROLE '+role);assert.equal(await v("SELECT count(*)::int AS v FROM storage.objects WHERE bucket_id='notification-templates'"),0);
   await assert.rejects(q('SELECT * FROM tenant.notification_templates'),/permission denied/);
   await assert.rejects(q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[tenant,path1,hash]),/permission denied/);await db.exec('RESET ROLE');
  }
  await q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[tenant,path1,hash]);await q('SELECT public.release_suspension_letter()');await q('SELECT public.release_suspension_letter()');
  let n=(await notices(id,'nonresponse_suspension'))[0];assert.equal(n.state,'queued');assert.equal(n.context.template_id,template);
  await q("UPDATE tenant.notification_outbox SET next_attempt_at=now()+interval '1 day' WHERE state IN ('queued','retry')");await q('UPDATE tenant.notification_outbox SET next_attempt_at=now() WHERE id=$1',[n.id]);
  n=await v('SELECT public.claim_notification() AS v');const file=await v('SELECT public.suspension_docx_for_notice($1,$2) AS v',[n.id,n.lease_token]);
  assert.equal(file.path,path1);assert.equal(file.sha256,hash);assert.equal(file.values.company_name,'Company');
  const docxPayload={to:n.recipient,attachments:[{filename:'suspension.docx',content:'frozen'}]};
  assert.equal(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,docxPayload]),null);
  let held=(await notices(id,'nonresponse_suspension'))[0];assert.equal(held.state,'review');assert.equal(held.last_error,'suspension_pdf_required');assert.equal(held.payload,null);assert.equal(held.first_request_at,null);
  await q("UPDATE tenant.notification_outbox SET state='sending',lease_token=$2,lease_until=now()+interval '5 minutes' WHERE id=$1",[n.id,n.lease_token]);
  const payload={to:n.recipient,attachments:[{filename:`suspension-${n.record_id}.pdf`,content_type:'application/pdf',content:Buffer.from('%PDF-1.7\nfrozen\n%%EOF').toString('base64')}]};
  assert.deepEqual(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,payload]),payload);
  await q("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('notification-templates',$1,'{\"size\":120}')",[path2]);
  await q('SELECT public.configure_suspension_docx($1,$2,$3,true)',[tenant,path2,'b'.repeat(64)]);
  assert.equal((await v('SELECT public.suspension_docx_for_notice($1,$2) AS v',[n.id,n.lease_token])).path,path1);
  assert.deepEqual(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,{to:n.recipient,html:'changed'}]),payload);
  await db.exec(sql('303_suspension_pdf_delivery.sql'));assert.deepEqual(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,docxPayload]),payload);
  await db.exec('SET ROLE service_role');await assert.rejects(q('SELECT public._s13_prepare_before_pdf($1,$2,$3)',[n.id,n.lease_token,payload]),/permission denied/);await db.exec('RESET ROLE');
  const submittedAt=await v('SELECT first_request_at AS v FROM tenant.notification_outbox WHERE id=$1',[n.id]);
  await q('UPDATE tenant.notification_outbox SET payload=$2 WHERE id=$1',[n.id,docxPayload]);
  await db.exec(sql('303_suspension_pdf_delivery.sql'));assert.deepEqual((await notices(id,'nonresponse_suspension'))[0].payload,docxPayload);
  assert.equal(await v('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,payload]),null);
  held=(await notices(id,'nonresponse_suspension'))[0];assert.equal(held.state,'review');assert.deepEqual(held.payload,docxPayload);assert.deepEqual(held.first_request_at,submittedAt);
  await uid(client);await q("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]);await uid(admin);
  assert.equal(await v('SELECT status__a AS v FROM tenant.external_clients__a WHERE id=$1',[c.external_client_id]),'Suspended');
  const changed=await ready();await firstAge(changed,'31 days');await run(changed);await finalAge(changed,'11 days');await run(changed);
  await q("UPDATE tenant.renewal_clients__a SET email__a='changed@example.test' WHERE id=$1",[changed]);
  const next=await ready();await firstAge(next,'31 days');await run(next);await finalAge(next,'11 days');await run(next);
  await q('SELECT public.release_suspension_letter()');assert.equal((await notices(changed,'nonresponse_suspension'))[0].last_error,'suspension_letter_requires_review');
  await q('SELECT public.release_suspension_letter()');assert.equal((await notices(next,'nonresponse_suspension'))[0].state,'queued');
 });
 }finally{await db.close();}
});

test('new scheduler defaults disabled and only calls the service transition RPC',async()=>{
 const file='app/api/notifications/nonresponse-worker/route.ts',server='../../../server/notifications/server';let calls=0;
 const route=auth=>load(file,{'next/server':{NextResponse:Response},[server]:{workerAuthorised:()=>auth,notificationAdmin:()=>({rpc:async name=>{assert.equal(name,'process_nonresponse');calls++;return {data:{processed:true,outcome:'second_notice_issued'}};}})}});
 const previous=process.env.NONRESPONSE_AUTOMATION_ENABLED;try{
  delete process.env.NONRESPONSE_AUTOMATION_ENABLED;assert.equal((await route(false).POST(new Request('https://example.test'))).status,401);
  assert.equal((await route(true).POST(new Request('https://example.test'))).status,503);assert.equal(calls,0);
  process.env.NONRESPONSE_AUTOMATION_ENABLED='true';assert.equal((await route(true).POST(new Request('https://example.test'))).status,200);assert.equal(calls,1);
 }finally{if(previous===undefined)delete process.env.NONRESPONSE_AUTOMATION_ENABLED;else process.env.NONRESPONSE_AUTOMATION_ENABLED=previous;}
});

test('second notice uses escaped record values, attachment, fixed IST deadline and existing delivery idempotency',()=>{
 const delivery=load('app/server/notifications/delivery.ts'),config={from:'sender@example.test',appUrl:'https://portal.example.test'};
 const job={id:'local',object_name:'renewal_clients__a',notice_kind:'nonresponse_reminder',notice_round:2,recipient:'client@example.test',context:{company:'<Company>',response_due_at:'2026-11-28T00:00:00Z'}};
 const payload=delivery.buildNotice(job,config,{filename:'intimation.pdf',content:'mock'});assert.match(payload.html,/&lt;Company&gt;/);assert.match(payload.html,/IST/);assert.match(payload.html,/10-day/);assert.equal(payload.to,job.recipient);
 assert.throws(()=>delivery.buildNotice({...job,object_name:'recertification_clients__a'},config,{}),/invalid_second_notice/);
 assert.throws(()=>delivery.buildNotice({...job,notice_kind:'nonresponse_suspension'},config),/unsupported/);
});

test('active case UI distinguishes deadline, suspension, blocked letter and CRM response from delivery',async()=>{
 const React=require('react'),Renderer=require('react-test-renderer');
 const caseData={in_scope:true,automation_enabled:true,stage:'suspended',deadline_start_at:'2026-10-18T00:00:00Z',first_deadline_at:'2026-11-17T00:00:00Z',second_notice_issued_at:'2026-11-17T00:00:00Z',final_deadline_at:'2026-11-27T00:00:00Z',suspended_at:'2026-11-27T00:00:01Z',last_checked_at:'2026-11-27T00:00:01Z',evidence:{holds:['late_response_crm','suspension_letter_template_pending']}};
 const Panel=load('app/commonfiles/core/components/Application/NotificationDeliveryPanel.tsx',{'@supabase/auth-helpers-nextjs':{createClientComponentClient:()=>({rpc:async name=>({data:name==='get_record_nonresponse'?caseData:{notices:[{id:'letter',kind:'nonresponse_suspension',round:3,state:'blocked',error:'suspension_template_pending',queued_at:'2026-11-27T00:00:01Z'}],responses:[{action:'accept',acted_at:'2026-11-27T01:00:00Z'}]}})})}}).default;
 let tree;try{
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Panel,{objectName:'renewal_clients__a',recordId:client,refresh:0}));});
  const flatten=n=>typeof n==='string'?n:Array.isArray(n)?n.map(flatten).join(''):n?.children?flatten(n.children):'';
  const text=flatten(tree.toJSON());for(const label of ['Suspended — no software response','First deadline:','IST','this letter has not been sent','CRM review','Accepted at'])assert.ok(text.includes(label),label);
  assert.ok(!text.includes('First deadline: not started'));
 }finally{if(tree)Renderer.act(()=>tree.unmount());}
 const Display=load('app/commonfiles/core/components/ui/UniversalFieldDisplay.tsx').UniversalFieldDisplay;
 const badge=Renderer.create(React.createElement(Display,{record:{status__a:'Suspended'},fieldName:'status',tenantId:tenant}));
 assert.equal(badge.toJSON().children[0],'Suspended');badge.unmount();
});
