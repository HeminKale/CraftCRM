const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {test}=require('node:test'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
function load(file,overrides={}) { const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.React},fileName:file}).outputText,{module:mod,exports:mod.exports,require:n=>overrides[n]||require(n),Buffer,URL,Date,Set,process,AbortSignal,fetch,Response,setInterval,clearInterval});return mod.exports; }
const delivery=load('app/server/notifications/delivery.ts');
const cfg={key:'test-key',from:'sender@example.test',appUrl:'https://portal.example.test',mode:'test',testRecipients:['client@example.test']};
const job={id:'10000000-0000-4000-8000-000000000001',lease_token:'lease',notice_kind:'record_created',object_name:'renewal_clients__a',recipient:'client@example.test',context:{company:'<script>bad</script>',contact:'A&B'}};
function fakeDB(j=job){const calls=[];return {calls,rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_notification'?j:name==='prepare_notification'?args.p_payload:null,error:null};}};}
test('worker defaults closed and validates sender, origin and approved test recipients',()=>{
 assert.throws(()=>delivery.deliveryConfig({}),/disabled/);
 assert.throws(()=>delivery.deliveryConfig({EMAIL_DELIVERY_ENABLED:'true'}),/sender/);
 const env={EMAIL_DELIVERY_ENABLED:'true',RESEND_API_KEY:'mock',RESEND_FROM_ADDRESS:'sender@example.test',EMAIL_APP_URL:'https://portal.example.test'};
 assert.throws(()=>delivery.deliveryConfig(env),/mode/);
 assert.equal(delivery.deliveryConfig({...env,EMAIL_TEST_RECIPIENTS:'client@example.test'}).mode,'test');
 assert.throws(()=>delivery.deliveryConfig({...env,EMAIL_APP_URL:'http://unsafe.test',EMAIL_DELIVERY_MODE:'live'}),/https/);
 assert.throws(()=>delivery.buildNotice({...job,recipient:'a@example.test,b@example.test'},cfg),/recipient/);
 const notice=delivery.buildNotice(job,cfg);assert.ok(notice.html.includes('&lt;script&gt;'));assert.ok(notice.html.includes('A&amp;B'));
 assert.throws(()=>delivery.buildNotice({...job,notice_kind:'intimation'},cfg),/attachment/);
 assert.throws(()=>delivery.buildNotice({...job,notice_kind:'surveillance_suspension_letter'},cfg),/unsupported/);
});
test('worker persists before submission and records provider acceptance with stable idempotency',async()=>{
 const db=fakeDB();await delivery.deliverOne(db,cfg,async(url,options)=>{assert.equal(db.calls.at(-1).name,'prepare_notification');assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],`craft-notice/${job.id}`);assert.equal(JSON.parse(options.body).to,job.recipient);return Response.json({id:'provider-1'});});
 assert.equal(db.calls.at(-1).args.p_provider,'provider-1');
 const pinned={...job,payload:{to:job.recipient,from:'old@example.test',html:'immutable'}};const retry=fakeDB(pinned);
 await delivery.deliverOne(retry,cfg,async(_url,o)=>{assert.deepEqual(JSON.parse(o.body),pinned.payload);return Response.json({id:'provider-1'});});
});
test('worker classifies rate limits, transient failure, timeout, malformed acceptance and permanent errors',async()=>{
 for(const [status,body,retry] of [[429,{},true],[500,{},true],[408,{},true],[409,{name:'concurrent_idempotent_requests'},true],[409,{name:'invalid_idempotent_request'},false],[422,{},false],[401,{},false],[200,{},true]]){
  const db=fakeDB();await delivery.deliverOne(db,cfg,async()=>Response.json(body,{status,headers:{'retry-after':'120'}}));assert.equal(db.calls.at(-1).args.p_retry,retry,`status ${status}`);assert.equal(db.calls.at(-1).args.p_retry_after,120);
 }
 const db=fakeDB();await delivery.deliverOne(db,cfg,async()=>{throw new Error('timeout');});assert.equal(db.calls.at(-1).args.p_error,'provider_outcome_unknown');
});
test('worker never sends to unapproved test recipient, missing attachment, or after persistence failure',async()=>{
 let sends=0;const send=async()=>{sends++;return Response.json({id:'x'});};
 await delivery.deliverOne(fakeDB({...job,recipient:'customer@example.test'}),cfg,send);
 await delivery.deliverOne(fakeDB({...job,notice_kind:'intimation',attachment_id:'missing'}),cfg,send);
 const db=fakeDB();const original=db.rpc;db.rpc=async(n,p)=>n==='prepare_notification'?{error:{message:'db down'}}:original(n,p);
 await assert.rejects(delivery.deliverOne(db,cfg,send),/persistence/);assert.equal(sends,0);
});

test('real PostgreSQL outbox transactions, leases, access, replacement, events and responses',async t=>{
 const db=new PGlite();
 const tenant='10000000-0000-4000-8000-000000000010',other='20000000-0000-4000-8000-000000000010',admin='10000000-0000-4000-8000-000000000011',client='10000000-0000-4000-8000-000000000012',stranger='10000000-0000-4000-8000-000000000013';
 await db.exec(`CREATE SCHEMA tenant;CREATE SCHEMA system;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE system.users(id uuid primary key,tenant_id uuid,role text,email text,custom_role_id uuid);
 CREATE TABLE tenant.roles(id uuid,name text);
 CREATE TABLE tenant.objects(id uuid primary key,name text,tenant_id uuid);
 CREATE FUNCTION public._check_permission(text,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.deny_'||$1,true),'')<>'true' $$;
 CREATE FUNCTION public._resolve_sharing_mode(uuid,uuid) RETURNS TABLE(effective_read_mode text) LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.sharing',true),''),'all') $$;
 CREATE TABLE tenant.fields(id uuid primary key,object_id uuid,name text);
 CREATE TABLE tenant.attachments(id uuid primary key,tenant_id uuid,record_id uuid,object_id uuid,field_id uuid,storage_bucket text,storage_path text,filename text,byte_size bigint,created_at timestamptz default now(),deleted_at timestamptz);
 CREATE TABLE tenant.bulk_summary_import_results(tenant_id uuid,result jsonb);
 CREATE TABLE system.user_invitations(id uuid primary key,tenant_id uuid,email text,invitation_token text,status text,expires_at timestamptz,role text);
 CREATE TABLE tenant.renewal_clients__a(id uuid primary key default gen_random_uuid(),tenant_id uuid,email__a text,name text,company_name__a text,contact_person__a text,client_user_id__a uuid,status__a text,surveillance_intimation_letter__a jsonb,intimation_accepted_date__a date,rejection_notes__a text);
 CREATE TABLE tenant.recertification_clients__a(LIKE tenant.renewal_clients__a INCLUDING ALL);
 ALTER TABLE tenant.recertification_clients__a ADD recert_intimation_letter__a jsonb;
 CREATE FUNCTION public.review_surveillance_intimation(p_record_id uuid,p_action text,p_notes text default null) RETURNS TABLE(success boolean,message text) LANGUAGE plpgsql AS $$ BEGIN UPDATE tenant.renewal_clients__a SET status__a=CASE WHEN p_action='accept' THEN 'Intimation_Accepted' ELSE null END WHERE id=p_record_id;RETURN QUERY SELECT true,'done'::text;END $$;
 INSERT INTO system.users VALUES('${admin}','${tenant}','admin','admin@example.test',null),('${client}','${tenant}','user','client@example.test',null),('${stranger}','${other}','admin','wrong@example.test',null);
 GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/299_notification_outbox.sql'),'utf8');await db.exec(migration);
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=> (await query(sql,args))[0]?.v;
 const uid=async(id)=>query("SELECT set_config('test.uid',$1,false)",[id]);await uid(admin);
 const add=async(table='renewal_clients__a',email='client@example.test')=>scalar(`INSERT INTO tenant.${table}(tenant_id,email__a,name) VALUES($1,$2,'Company') RETURNING id AS v`,[tenant,email]);
 const rows=async(id)=>query('SELECT * FROM tenant.notification_outbox WHERE record_id=$1 ORDER BY created_at,id',[id]);
 const force=async()=>db.exec("UPDATE tenant.notification_outbox SET next_attempt_at=now()-interval '1 second' WHERE state IN ('queued','retry')");
 const claim=async()=>{await force();return scalar('SELECT public.claim_notification() AS v');};
 const finish=async(n,provider=null,error=null,retry=false)=>query('SELECT public.finish_notification($1,$2,$3,$4,$5,0)',[n.id,n.lease_token,provider,error,retry]);
 let id,n,attachment1,attachment2;
 await t.test('creation commits a notice; rollback and bulk import create no mail; missing email is explicit',async()=>{
  id=await add();assert.equal((await rows(id)).length,1);assert.equal((await rows(id))[0].notice_kind,'record_created');
  await db.exec('BEGIN');const rolled=await add();await db.exec('ROLLBACK');assert.equal((await rows(rolled)).length,0);
  await db.exec('BEGIN');const bulk=await add();await query('INSERT INTO tenant.bulk_summary_import_results VALUES($1,$2)',[tenant,{record_id:bulk}]);await db.exec('COMMIT');assert.equal((await rows(bulk)).length,0);
  const blank=await add('renewal_clients__a','');assert.equal((await rows(blank))[0].state,'blocked');
  const recert=await add('recertification_clients__a');assert.equal((await rows(recert))[0].object_name,'recertification_clients__a');
  await query("UPDATE tenant.notification_outbox SET state='cancelled' WHERE record_id<>$1",[id]);
 });
 await t.test('tenant checks, private tables and service-only worker deny anonymous and wrong tenant',async()=>{
  await uid(stranger);assert.equal((await scalar('SELECT public.check_record_notification($1,$2) AS v',['renewal_clients__a',id])).success,false);
  await assert.rejects(scalar('SELECT public.get_record_notifications($1,$2) AS v',['renewal_clients__a',id]),/Record not found/);
  await db.exec('SET ROLE authenticated');await assert.rejects(query('SELECT * FROM tenant.notification_outbox'),/permission denied/);await assert.rejects(scalar('SELECT public.claim_notification() AS v'),/permission denied/);await db.exec('RESET ROLE');await uid(admin);
 });
 const obj='10000000-0000-4000-8000-000000000020',field='10000000-0000-4000-8000-000000000021';
 await query("INSERT INTO tenant.objects VALUES($1,'renewal_clients__a',$2)",[obj,tenant]);await query("INSERT INTO tenant.fields VALUES($1,$2,'surveillance_intimation_letter')",[field,obj]);
 const letter=async(record=id,whichTenant=tenant)=>{const att=await scalar('INSERT INTO tenant.attachments(id,tenant_id,record_id,object_id,field_id,storage_bucket,storage_path,filename,byte_size) VALUES(gen_random_uuid(),$1,$2,$3,$4,\'tenant-uploads\',\'safe/path\',\'letter.pdf\',4) RETURNING id AS v',[whichTenant,record,obj,field]);return att;};
 await t.test('finalisation queues one logical round; repeated callback/status updates dedupe; replacement supersedes unsent revision',async()=>{
  attachment1=await letter();await query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:attachment1},id]);
  await query("UPDATE tenant.renewal_clients__a SET status__a='Intimation_Sent' WHERE id=$1",[id]);
  await query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:attachment1},id]);
  let notices=await rows(id);assert.equal(notices.length,2);assert.equal(notices.find(n=>n.notice_kind==='record_created').state,'cancelled');
  attachment2=await letter();await query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:attachment2},id]);notices=await rows(id);
  assert.equal(notices.find(n=>n.revision===attachment1).state,'cancelled');assert.equal(notices.filter(n=>n.state==='queued').length,1);assert.ok(notices.every(n=>n.notice_round===1));
  const wrong=await letter(id,other);await assert.rejects(query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:wrong},id]),/not owned/);
 });
 await t.test('leases fence workers, payload stays immutable, retries back off, wrong recipient is rejected',async()=>{
  n=await claim();assert.equal(n.revision,attachment2);assert.equal(await scalar('SELECT public.claim_notification() AS v'),null);
  await assert.rejects(query('SELECT public.prepare_notification($1,$2,$3)',[n.id,n.lease_token,{to:'wrong@example.test'}]),/Recipient mismatch/);
  const payload={to:'client@example.test',html:'original'};assert.deepEqual(await scalar('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,payload]),payload);
  assert.deepEqual(await scalar('SELECT public.prepare_notification($1,$2,$3) AS v',[n.id,n.lease_token,{...payload,html:'changed'}]),payload);
  await finish(n,null,'provider_http_429',true);assert.equal((await rows(id)).find(r=>r.id===n.id).state,'retry');
  assert.equal(await scalar('SELECT public.claim_notification() AS v'),null);
  const previous=n;n=await claim();await assert.rejects(finish(previous,'stale-provider'),/Stale lease/);
  assert.equal(n.attempts,2);
  const crashed=n;await query("UPDATE tenant.notification_outbox SET lease_until=now()-interval '1 minute' WHERE id=$1",[n.id]);
  n=await claim();assert.notEqual(n.lease_token,crashed.lease_token);assert.equal(n.payload.html,'original');await assert.rejects(finish(crashed,'stale-provider'),/Stale lease/);
 });
 const event=async(eid,type='email.delivered',to='client@example.test',provider='provider-1',at='2026-10-18T10:00:00Z')=>query('SELECT public.record_resend_event($1,$2,$3,$4,$5,$6)',[eid,provider,type,at,[to],{type}]);
 await t.test('webhook before send response, duplicate replay, reordered delivery and bounce preserve evidence without a deadline',async()=>{
  await event('evt-delivered');await event('evt-delivered');assert.equal(await scalar("SELECT count(*)::int AS v FROM tenant.notification_events WHERE event_id='evt-delivered'"),1);
  await finish(n,'provider-1');let result=(await rows(id)).find(r=>r.id===n.id);assert.equal(result.state,'delivered');assert.ok(result.delivered_at);assert.equal(result.deadline_start_at,null);
  await event('evt-sent','email.sent',undefined,undefined,'2026-10-18T09:00:00Z');assert.equal((await rows(id)).find(r=>r.id===n.id).state,'delivered');
  await event('evt-bad-recipient','email.bounced','wrong@example.test');assert.equal((await rows(id)).find(r=>r.id===n.id).state,'delivered');
  await event('evt-bounce','email.bounced');await event('evt-old-delivery','email.delivered');result=(await rows(id)).find(r=>r.id===n.id);assert.equal(result.state,'bounced');assert.ok(result.failed_at);assert.ok(result.delivered_at);
  assert.equal(await scalar('SELECT count(*)::int AS v FROM tenant.notice_responses'),0);
 });
 await t.test('software acceptance is tenant/client-bound, auditable and distinct from mail events',async()=>{
  await uid(stranger);assert.equal((await query("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]))[0].success,false);
  await uid(client);assert.equal((await query("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]))[0].success,true);
  assert.equal(await scalar('SELECT count(*)::int AS v FROM tenant.notice_responses WHERE record_id=$1',[id]),1);
  assert.equal((await query("SELECT * FROM public.review_surveillance_intimation($1,'accept',null)",[id]))[0].success,false);
  const history=await scalar('SELECT public.get_record_notifications($1,$2) AS v',['renewal_clients__a',id]);assert.equal(history.responses[0].action,'accept');
  await query("SELECT set_config('test.deny_field','true',false)");await assert.rejects(scalar('SELECT public.get_record_notifications($1,$2) AS v',['renewal_clients__a',id]),/Access denied/);
  await query("SELECT set_config('test.deny_field','',false)");await query("SELECT set_config('test.sharing','owner',false)");await assert.rejects(scalar('SELECT public.get_record_notifications($1,$2) AS v',['renewal_clients__a',id]),/Access denied/);
  await query("SELECT set_config('test.sharing','all',false)");await uid(admin);
 });
 await t.test('recipient changes block queued notices and ambiguous requests stop before provider idempotency expires',async()=>{
  const changed=await add();await query('UPDATE tenant.renewal_clients__a SET email__a=$1 WHERE id=$2',['new@example.test',changed]);assert.equal((await claim()).skipped,true);assert.equal((await rows(changed))[0].state,'blocked');
  const expired=await add();let current=await claim();await query("UPDATE tenant.notification_outbox SET first_request_at=now()-interval '24 hours',lease_until=now()-interval '1 minute' WHERE id=$1",[current.id]);assert.equal((await claim()).skipped,true);assert.equal((await rows(expired))[0].state,'review');
 });
 await t.test('recipient edits and replacement during preparation stop submission; exhausted retries require review',async()=>{
  const changed=await add();let current=await claim();await query('UPDATE tenant.renewal_clients__a SET email__a=$1 WHERE id=$2',['new@example.test',changed]);
  assert.equal(await scalar('SELECT public.prepare_notification($1,$2,$3) AS v',[current.id,current.lease_token,{to:'client@example.test'}]),null);
  assert.equal((await rows(changed))[0].state,'blocked');
  const replaced=await add(),first=await letter(replaced);await query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:first},replaced]);current=await claim();
  const next=await letter(replaced);await query('UPDATE tenant.renewal_clients__a SET surveillance_intimation_letter__a=$1 WHERE id=$2',[{id:next},replaced]);
  assert.equal(await scalar('SELECT public.prepare_notification($1,$2,$3) AS v',[current.id,current.lease_token,{to:'client@example.test'}]),null);
  assert.equal((await rows(replaced)).find(r=>r.id===current.id).state,'cancelled');
  await query("UPDATE tenant.notification_outbox SET attempts=7 WHERE record_id=$1 AND state='queued'",[replaced]);current=await claim();await finish(current,null,'attachment_unavailable',true);assert.equal((await rows(replaced)).find(r=>r.id===current.id).state,'review');
 });
 await t.test('invitation enqueue, rotation, expiry/cancellation and migration replay preserve audit without duplicate sends',async()=>{
  const invite='10000000-0000-4000-8000-000000000030';
  await query("INSERT INTO system.user_invitations VALUES($1,$2,'client@example.test','token1','pending',now()+interval '7 days','user')",[invite,tenant]);
  assert.equal((await rows(invite)).length,1);await query("UPDATE system.user_invitations SET invitation_token='token2' WHERE id=$1",[invite]);assert.equal((await rows(invite)).filter(n=>n.state==='queued').length,1);
  await query("UPDATE system.user_invitations SET status='cancelled' WHERE id=$1",[invite]);assert.ok((await rows(invite)).every(n=>n.state==='cancelled'));
  const count=await scalar('SELECT count(*)::int AS v FROM tenant.notification_outbox');await db.exec(migration);assert.equal(await scalar('SELECT count(*)::int AS v FROM tenant.notification_outbox'),count);
 });
 await db.close();
});

test('HTTP acknowledgement endpoints require auth and ignore browser recipient/template/URL',async()=>{
 const response={NextResponse:Response};let params;
 const user={rpc:async(name,args)=>{params={name,args};return {data:{success:true,state:'queued'},error:null};}};
 for(const file of ['app/api/notifications/send/route.ts','app/api/auth/send-invitation/route.ts']){
  const unauth=load(file,{'next/server':response,'../../../server/notifications/server':{notificationUser:async()=>null}});
  assert.equal((await unauth.POST(new Request('https://portal.example.test',{method:'POST',body:'{}'}))).status,401);
 }
 const route=load('app/api/notifications/send/route.ts',{'next/server':response,'../../../server/notifications/server':{notificationUser:async()=>user}});
 const body={objectName:'renewal_clients__a',recordId:job.id,to:'wrong@example.test',template:'surveillance_suspension_letter',attachmentUrl:'http://127.0.0.1/private'};
 assert.equal((await route.POST(new Request('https://portal.example.test',{method:'POST',body:JSON.stringify(body)}))).status,202);
 assert.deepEqual(JSON.parse(JSON.stringify(params.args)),{p_object:body.objectName,p_record:body.recordId});
 assert.equal((await route.POST(new Request('https://portal.example.test',{method:'POST',body:JSON.stringify({to:'wrong@example.test',template:'bad'})}))).status,400);
 const invite=load('app/api/auth/send-invitation/route.ts',{'next/server':response,'../../../server/notifications/server':{notificationUser:async()=>user}});
 assert.equal((await invite.POST(new Request('https://portal.example.test',{method:'POST',body:JSON.stringify({token:'token',email:'wrong@example.test'})}))).status,202);
 assert.deepEqual(JSON.parse(JSON.stringify(params.args)),{p_token:'token'});
});

test('worker HTTP authentication is constant-time and disabled configuration cannot claim work',async()=>{
 const server=load('app/server/notifications/server.ts',{'next/headers':{cookies:()=>({})}});
 assert.equal(server.workerAuthorised(null,'a'.repeat(32)),false);
 assert.equal(server.workerAuthorised('Bearer short','a'.repeat(32)),false);
 assert.equal(server.workerAuthorised('Bearer '+'a'.repeat(32),'a'.repeat(32)),true);
 let claims=0;
 const route=load('app/api/notifications/worker/route.ts',{'next/server':{NextResponse:Response},'../../../server/notifications/server':{workerAuthorised:()=>false},'../../../server/notifications/delivery':delivery});
 assert.equal((await route.POST(new Request('https://portal.example.test',{method:'POST'}))).status,401);
 const disabled=load('app/api/notifications/worker/route.ts',{'next/server':{NextResponse:Response},'../../../server/notifications/server':{workerAuthorised:()=>true,notificationAdmin:()=>{claims++;}},'../../../server/notifications/delivery':{deliveryConfig:()=>{throw new Error('disabled');}}});
 assert.equal((await disabled.POST(new Request('https://portal.example.test',{method:'POST'}))).status,503);assert.equal(claims,0);
});

test('webhook uses real Svix raw-body verification, rejects forgery/stale replay and retries failed persistence',async()=>{
 const {Webhook}=require('svix'),secret='whsec_'+Buffer.from('unit-test-secret-for-local-mocks-only').toString('base64');
 const previous=process.env.RESEND_WEBHOOK_SECRET;process.env.RESEND_WEBHOOK_SECRET=secret;
 let stored=0,fail=false;const db={rpc:async(name,args)=>{assert.equal(name,'record_resend_event');assert.equal(args.p_event_id,'msg_local');if(fail)return {error:{}};stored++;return {data:null};}};
 const route=load('app/api/notifications/webhook/route.ts',{'next/server':{NextResponse:Response},'../../../server/notifications/server':{notificationAdmin:()=>db},'../../../server/notifications/delivery':delivery});
 const raw=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'provider-1',to:['client@example.test']}});
 const request=(payload=raw,date=new Date(),bad=false)=>new Request('https://portal.example.test',{method:'POST',headers:{'svix-id':'msg_local','svix-timestamp':String(Math.floor(date.getTime()/1000)),'svix-signature':bad?'v1,bad':new Webhook(secret).sign('msg_local',date,raw)},body:payload});
 try {
  assert.equal((await route.POST(request())).status,200);assert.equal(stored,1);
  assert.equal((await route.POST(request())).status,200);assert.equal(stored,2); // DB unique svix-id handles replay.
  assert.equal((await route.POST(request(raw+' '))).status,400);
  assert.equal((await route.POST(request(raw,new Date(),true))).status,400);
  assert.equal((await route.POST(request(raw,new Date(Date.now()-10*60000)))).status,400);
  fail=true;assert.equal((await route.POST(request())).status,503);
 } finally {if(previous===undefined)delete process.env.RESEND_WEBHOOK_SECRET;else process.env.RESEND_WEBHOOK_SECRET=previous;}
});

test('record panel shows upload, provider delivery and software response as separate evidence',async()=>{
 const React=require('react'),Renderer=require('react-test-renderer');
 const data={notices:[{id:'notice',kind:'intimation',round:1,state:'delivered',queued_at:'2026-10-18T01:00:00Z',upload_finalized_at:'2026-10-18T01:00:00Z',accepted_at:'2026-10-18T01:01:00Z',delivered_at:'2026-10-18T01:02:00Z',provider_id:'provider-test',attempts:1}],responses:[{action:'reject',acted_at:'2026-10-18T02:00:00Z'}]};
 const Panel=load('app/commonfiles/core/components/Application/NotificationDeliveryPanel.tsx',{'@supabase/auth-helpers-nextjs':{createClientComponentClient:()=>({rpc:async()=>({data,error:null})})}}).default;
 let tree;await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Panel,{objectName:'renewal_clients__a',recordId:job.id,refresh:0}));});
 const rendered=JSON.stringify(tree.toJSON());assert.ok(rendered.includes('Letter finalised'));assert.ok(rendered.includes('Provider accepted'));assert.ok(rendered.includes('Recipient mail server delivery'));assert.ok(rendered.includes('Rejected at'));assert.ok(rendered.includes('deadline has not been started'));
 Renderer.act(()=>tree.unmount());
});
