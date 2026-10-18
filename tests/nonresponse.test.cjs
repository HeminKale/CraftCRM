const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const assert=require('node:assert/strict'),{test}=require('node:test'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
const tenant='10000000-0000-4000-8000-000000000010',other='20000000-0000-4000-8000-000000000010';
const admin='10000000-0000-4000-8000-000000000011',client='10000000-0000-4000-8000-000000000012',stranger='10000000-0000-4000-8000-000000000013';
const object='10000000-0000-4000-8000-000000000020',field='10000000-0000-4000-8000-000000000021',external='10000000-0000-4000-8000-000000000022';
function load(file,overrides={}) {
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.React},fileName:file}).outputText,
 {module:mod,exports:mod.exports,require:n=>overrides[n]||require(n),process,Response,Date,setInterval,clearInterval});
 return mod.exports;
}

test('Sprint 13 PostgreSQL evidence transactions and disabled-policy invariants',async t=>{
 const db=new PGlite();
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const v=async(sql,args=[])=> (await q(sql,args))[0]?.v;
 const uid=id=>q("SELECT set_config('test.uid',$1,false)",[id]);
 try {
 await db.exec(`CREATE SCHEMA tenant; CREATE SCHEMA system; CREATE SCHEMA auth;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE system.users(id uuid primary key,tenant_id uuid,role text,email text,custom_role_id uuid);
 CREATE TABLE tenant.roles(id uuid,name text);
 CREATE TABLE tenant.objects(id uuid primary key,name text,tenant_id uuid);
 CREATE FUNCTION public._check_permission(text,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.deny_'||$1,true),'')<>'true' $$;
 CREATE FUNCTION public._resolve_sharing_mode(uuid,uuid) RETURNS TABLE(effective_read_mode text) LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.sharing',true),''),'all') $$;
 CREATE TABLE tenant.fields(id uuid primary key,object_id uuid,name text,type text DEFAULT 'text');
 CREATE TABLE tenant.picklist_values(field_id uuid,value text,label text,is_active boolean,display_order integer);
 CREATE TABLE tenant.layout_blocks(object_id uuid,field_id uuid,label text);
 CREATE TABLE tenant.attachments(id uuid primary key,tenant_id uuid,record_id uuid,object_id uuid,field_id uuid,storage_bucket text,storage_path text,filename text,byte_size bigint,created_at timestamptz default now(),deleted_at timestamptz);
 CREATE TABLE tenant.bulk_summary_import_results(tenant_id uuid,result jsonb);
 CREATE TABLE system.user_invitations(id uuid primary key,tenant_id uuid,email text,invitation_token text,status text,expires_at timestamptz,role text);
 CREATE TABLE tenant.external_clients__a(id uuid primary key,tenant_id uuid,status__a text);
 CREATE TABLE tenant.renewal_clients__a(id uuid primary key default gen_random_uuid(),tenant_id uuid,email__a text,name text,company_name__a text,contact_person__a text,client_user_id__a uuid,external_client_id__a uuid,status__a text,surveillance_intimation_letter__a jsonb,intimation_accepted_date__a date,rejection_notes__a text);
 CREATE TABLE tenant.recertification_clients__a(LIKE tenant.renewal_clients__a INCLUDING ALL);
 ALTER TABLE tenant.recertification_clients__a ADD recert_intimation_letter__a jsonb;
 CREATE FUNCTION public.review_surveillance_intimation(p_record_id uuid,p_action text,p_notes text default null) RETURNS TABLE(success boolean,message text) LANGUAGE plpgsql AS $$ BEGIN UPDATE tenant.renewal_clients__a SET status__a=CASE WHEN p_action='accept' THEN 'Intimation_Accepted' ELSE null END WHERE id=p_record_id; RETURN QUERY SELECT true,'done'::text; END $$;
 INSERT INTO system.users VALUES('${admin}','${tenant}','admin','admin@example.test',null),('${client}','${tenant}','user','client@example.test',null),('${stranger}','${other}','admin','wrong@example.test',null);
 INSERT INTO tenant.objects VALUES('${object}','renewal_clients__a','${tenant}');
 INSERT INTO tenant.fields(id,object_id,name) VALUES('${field}','${object}','surveillance_intimation_letter');
 INSERT INTO tenant.external_clients__a VALUES('${external}','${tenant}','Certificate_Issued');
 GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('299_notification_outbox.sql'));
 await db.exec(migration('297_surveillance_ends_at_certificate.sql'));
 await uid(admin);
 const add=(table='renewal_clients__a')=>v(`INSERT INTO tenant.${table}(tenant_id,email__a,name,external_client_id__a) VALUES($1,'client@example.test','Company',$2) RETURNING id AS v`,[tenant,external]);
 const letter=async(id)=>{
  const att=await v("INSERT INTO tenant.attachments VALUES(gen_random_uuid(),$1,$2,$3,$4,'tenant-uploads','safe/path','letter.pdf',4,now(),null) RETURNING id AS v",[tenant,id,object,field]);
  await q("UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1,status__a='Intimation_Sent' WHERE id=$2",[{id:att},id]);return att;
 };
 const evidence=id=>v('SELECT evidence AS v FROM tenant.nonresponse_cases WHERE record_id=$1',[id]);
 const observe=id=>v("SELECT public._observe_nonresponse($1,$2,'local_test') AS v",[tenant,id]);
 const count=table=>v(`SELECT count(*)::int AS v FROM tenant.${table}`);
 const old=await add();await letter(old);
 const sql=migration('300_nonresponse_policy_hold.sql');await db.exec(sql);
 let id,first;
 await t.test('migration has no historical backfill; creation and Recert are excluded',async()=>{
  assert.equal(await count('nonresponse_cases'),0);
  id=await add();await add('recertification_clients__a');assert.equal(await count('nonresponse_cases'),0);
  first=await letter(id);assert.equal(await count('nonresponse_cases'),1);
  assert.equal((await evidence(id)).outcome,'policy_hold');
 });
 await t.test('notice, case and audit roll back together; duplicate finalisation is idempotent',async()=>{
  const cases=await count('nonresponse_cases'),audits=await count('nonresponse_audit'),notices=await count('notification_outbox');
  await db.exec('BEGIN');const rolled=await add();await letter(rolled);await db.exec('ROLLBACK');
  assert.equal(await count('nonresponse_cases'),cases);assert.equal(await count('nonresponse_audit'),audits);assert.equal(await count('notification_outbox'),notices);
  await q('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:first},id]);
  await observe(id);await observe(id);assert.equal(await count('nonresponse_audit'),audits);
 });
 await t.test('both 30/10-day boundaries remain disabled before, exactly at and after; all delivery outcomes hold',async()=>{
  for(const elapsed of ['29 days 23:59:59','30 days','30 days 00:00:01','39 days 23:59:59','40 days','40 days 00:00:01']) {
   await db.exec('BEGIN');
   await q("UPDATE tenant.notification_outbox SET upload_finalized_at=now()-$1::interval,accepted_at=now()-$1::interval,delivered_at=now()-$1::interval,state='delivered' WHERE record_id=$2 AND notice_kind='intimation'",[elapsed,id]);
   const e=await observe(id);assert.equal(e.automation_enabled,false);assert.equal(e.first_deadline_at,null);assert.equal(e.final_deadline_at,null);assert.equal(e.deadline_start_at,null);
   assert.equal(await v('SELECT max(notice_round) AS v FROM tenant.notification_outbox'),1);await db.exec('COMMIT');
  }
  for(const state of ['failed','bounced','delayed','suppressed','complained','review','blocked','accepted','delivered']) {
   await q("UPDATE tenant.notification_outbox SET state=$1 WHERE record_id=$2 AND notice_kind='intimation'",[state,id]);
   const e=await observe(id);assert.equal(e.outcome,'policy_hold');assert.equal(e.holds.includes('delivery_policy_pending'),!['accepted','delivered'].includes(state));
  }
  assert.equal(await v('SELECT status__a AS v FROM tenant.external_clients__a WHERE id=$1',[external]),'Certificate_Issued');
  assert.equal(await v('SELECT status__a AS v FROM tenant.renewal_clients__a WHERE id=$1',[id]),'Intimation_Sent');
 });
 await t.test('replacement preserves source; recipient correction and missing/foreign linked client are explicit holds',async()=>{
  const source=(await evidence(id)).source_notice_id;await letter(id);
  assert.equal((await evidence(id)).source_notice_id,source);assert.ok((await evidence(id)).holds.includes('replacement_policy_pending'));
  await q("UPDATE tenant.renewal_clients__a SET email__a='corrected@example.test' WHERE id=$1",[id]);assert.ok((await evidence(id)).holds.includes('recipient_changed'));
  await q("UPDATE tenant.renewal_clients__a SET email__a='',external_client_id__a=$2 WHERE id=$1",[id,stranger]);
  assert.ok((await evidence(id)).holds.includes('missing_record_email'));assert.ok((await evidence(id)).holds.includes('linked_client_unavailable'));
 });
 await t.test('Accept/Reject before and after review, late response and duplicate actions preserve software evidence',async()=>{
  for(const action of ['accept','reject']) for(const order of ['response_first','review_first']) {
   const r=await add();await letter(r);await uid(client);
   await q("UPDATE tenant.notification_outbox SET upload_finalized_at=now()-interval '41 days' WHERE record_id=$1 AND notice_kind='intimation'",[r]);
   if(order==='review_first') await observe(r);
   assert.equal((await q('SELECT * FROM public.review_surveillance_intimation($1,$2,null)',[r,action]))[0].success,true);
   const e=await observe(r);assert.equal(e.software_response.action,action);assert.ok(e.holds.includes('software_response_recorded'));assert.equal(e.automation_enabled,false);
   assert.equal((await q('SELECT * FROM public.review_surveillance_intimation($1,$2,null)',[r,action]))[0].success,false);
   assert.equal(await v('SELECT count(*)::int AS v FROM tenant.notice_responses WHERE record_id=$1',[r]),1);
  }
  await uid(admin);
 });
 await t.test('worker duplicate requests, rollback/crash recovery and unchanged reviews are idempotent',async()=>{
  await q("UPDATE tenant.nonresponse_cases SET next_check_at=now()+interval '1 day'");
  await q('UPDATE tenant.nonresponse_cases SET next_check_at=now() WHERE record_id=$1',[id]);
  const before=await count('nonresponse_audit');
  await db.exec('BEGIN');assert.equal((await v('SELECT public.review_nonresponse_evidence() AS v')).processed,true);await db.exec('ROLLBACK');
  assert.equal((await v('SELECT public.review_nonresponse_evidence() AS v')).processed,true);
  const duplicate=await Promise.all([v('SELECT public.review_nonresponse_evidence() AS v'),v('SELECT public.review_nonresponse_evidence() AS v')]);
  assert.ok(duplicate.every(r=>r.processed===false));assert.equal(await count('nonresponse_audit'),before);
 });
 await t.test('wrong tenant, unrelated client, field/sharing denial and private worker grants',async()=>{
  await uid(stranger);await assert.rejects(v('SELECT public.get_record_nonresponse($1,$2) AS v',['renewal_clients__a',id]),/Record not found/);
  await uid(client);await assert.rejects(v('SELECT public.get_record_nonresponse($1,$2) AS v',['renewal_clients__a',id]),/Access denied/);
  await q("UPDATE tenant.renewal_clients__a SET email__a='client@example.test' WHERE id=$1",[id]);
  await q("SELECT set_config('test.deny_field','true',false)");await assert.rejects(v('SELECT public.get_record_nonresponse($1,$2) AS v',['renewal_clients__a',id]),/Access denied/);
  await q("SELECT set_config('test.deny_field','',false)");await q("SELECT set_config('test.sharing','owner',false)");
  await assert.rejects(v('SELECT public.get_record_nonresponse($1,$2) AS v',['renewal_clients__a',id]),/Access denied/);
  await q("SELECT set_config('test.sharing','all',false)");
  await db.exec('SET ROLE authenticated');
  for(const query of ['SELECT * FROM tenant.nonresponse_cases','SELECT * FROM tenant.nonresponse_audit','SELECT public.review_nonresponse_evidence()',`SELECT public._observe_nonresponse('${tenant}','${id}','forged')`]) await assert.rejects(q(query),/permission denied/);
  await db.exec('RESET ROLE');await uid(admin);
 });
 await t.test('replayed/out-of-order webhooks never start deadlines or create responses',async()=>{
  const notice=await v("SELECT id AS v FROM tenant.notification_outbox WHERE record_id=$1 AND revision=$2",[id,first]);
  await q("UPDATE tenant.notification_outbox SET provider_id='s13-provider',state='accepted' WHERE id=$1",[notice]);
  const responses=await count('notice_responses');
  for(const [event,type] of [['s13-bounce','email.bounced'],['s13-old-delivery','email.delivered'],['s13-bounce','email.bounced']]) {
   await q("SELECT public.record_resend_event($1,'s13-provider',$2,now(),'[\"client@example.test\"]','{}')",[event,type]);
  }
  assert.equal(await v('SELECT state AS v FROM tenant.notification_outbox WHERE id=$1',[notice]),'bounced');
  assert.equal(await count('notice_responses'),responses);assert.equal((await observe(id)).deadline_start_at,null);
 });
 await t.test('summary imports remain mail/case silent; certificate guard and historical statuses survive replay',async()=>{
  const r=await add();const notices=await count('notification_outbox'),cases=await count('nonresponse_cases');
  await db.exec('BEGIN');await q("SELECT set_config('craft.summary_import_record',$1,true)",[r]);
  await q("UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1,status__a='Certificate_Issued' WHERE id=$2",[{id:client},r]);await db.exec('COMMIT');
  assert.equal(await count('notification_outbox'),notices);assert.equal(await count('nonresponse_cases'),cases);
  await assert.rejects(q("UPDATE tenant.renewal_clients__a SET status__a='Suspension_Intimation_Sent' WHERE id=$1",[r]),/complete/);
  const audits=await count('nonresponse_audit');await db.exec(sql);
  assert.equal(await count('nonresponse_audit'),audits);assert.equal(await count('nonresponse_cases'),cases);
  await assert.rejects(q('UPDATE tenant.nonresponse_cases SET automation_enabled=true'),/check constraint/);
  await assert.rejects(q('UPDATE tenant.nonresponse_cases SET first_deadline_at=now()'),/check constraint/);
  const history=await v('SELECT public.get_record_nonresponse($1,$2) AS v',['renewal_clients__a',id]);
  assert.equal(history.automation_enabled,false);assert.ok(history.audit.length<=20);assert.ok(history.audit.every(a=>a.outcome==='policy_hold'));
  // Synthetic legacy/manual status: observer must never clear or restore it.
  await q("UPDATE tenant.external_clients__a SET status__a='Legacy_Suspended' WHERE id=$1",[external]);await observe(id);
  assert.equal(await v('SELECT status__a AS v FROM tenant.external_clients__a WHERE id=$1',[external]),'Legacy_Suspended');
  const beforeAudit=await count('nonresponse_audit'),beforeNotices=await count('notification_outbox');
  await db.exec(fs.readFileSync(path.join(root,'UAF New Changes/New Help Doc/General/Sprint_13_Readiness_Audit.sql'),'utf8'));
  assert.equal(await count('nonresponse_audit'),beforeAudit);assert.equal(await count('notification_outbox'),beforeNotices);
 });
 } finally { await db.close(); }
});

test('evidence endpoint is authenticated, disabled by default and never invokes mail/status RPCs',async()=>{
 const file='app/api/notifications/nonresponse-review/route.ts',server='../../../server/notifications/server';
 let calls=0;const endpoint=authorised=>load(file,{'next/server':{NextResponse:Response},[server]:{workerAuthorised:()=>authorised,notificationAdmin:()=>({rpc:async name=>{calls++;assert.equal(name,'review_nonresponse_evidence');return {data:{processed:true,automation_enabled:false}};}})}});
 const previous=process.env.NONRESPONSE_REVIEW_ENABLED;
 try {
  delete process.env.NONRESPONSE_REVIEW_ENABLED;
  assert.equal((await endpoint(false).POST(new Request('https://portal.example.test'))).status,401);
  assert.equal((await endpoint(true).POST(new Request('https://portal.example.test'))).status,503);assert.equal(calls,0);
  process.env.NONRESPONSE_REVIEW_ENABLED='true';const response=await endpoint(true).POST(new Request('https://portal.example.test'));
  assert.equal(response.status,200);assert.equal((await response.json()).automation_enabled,false);assert.equal(calls,1);
 } finally {if(previous===undefined) delete process.env.NONRESPONSE_REVIEW_ENABLED;else process.env.NONRESPONSE_REVIEW_ENABLED=previous;}
});

test('record panel shows policy holds, explicit IST review, no deadlines and separate software response',async()=>{
 const React=require('react'),Renderer=require('react-test-renderer');
 const Panel=load('app/commonfiles/core/components/Application/NotificationDeliveryPanel.tsx',{'@supabase/auth-helpers-nextjs':{createClientComponentClient:()=>({rpc:async name=>({data:name==='get_record_notifications'?{notices:[],responses:[{action:'reject',acted_at:'2026-10-18T00:00:00Z'}]}:{in_scope:true,last_checked_at:'2026-10-18T00:00:00Z',evidence:{source_notice_id:'source',holds:['policy_unapproved','recipient_changed']},audit:[{id:1,observed_at:'2026-10-18T00:00:00Z',worker:'evidence_worker_v1',policy_version:'s13-unapproved-v1'}]}})})}}).default;
 let tree;try {
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Panel,{objectName:'renewal_clients__a',recordId:external,refresh:0}));});
  const flatten=node=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node?.children?flatten(node.children):'';
  const rendered=flatten(tree.toJSON());
  for(const text of ['Non-response automation: disabled','First deadline: not started','Automatic suspension: disabled','IST','Record email changed','Rejected at','Policy hold']) assert.ok(rendered.includes(text),text);
 } finally {if(tree) Renderer.act(()=>tree.unmount());}
});
