const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),JSZip=require('jszip');
const assert=require('node:assert/strict'),{test}=require('node:test'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
function load(file,overrides={}){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},fileName:file}).outputText,{module:mod,exports:mod.exports,require:n=>overrides[n]||require(n),process,Response,Date,Buffer,URL,AbortSignal,fetch});return mod.exports;}
const renderer=load('app/server/notifications/suspensionDocx.ts');
const pdfRenderer=load('app/server/notifications/suspensionPdf.ts');
const {PDFDocument}=require('pdf-lib');
async function pdfFixture(pages=1){const pdf=await PDFDocument.create();for(let i=0;i<pages;i++)pdf.addPage();return Buffer.from(await pdf.save({addDefaultPage:false}));}
const values={company_name:'A&B <Industries>',contact_name:'A "Person"',record_id:'record',letter_reference:'letter',suspension_date:'28 Nov 2026 05:30 IST',intimation_upload_date:'18 Oct 2026 05:30 IST',response_deadline:'28 Nov 2026 05:30 IST'};
const wrap=text=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text}</w:body></w:document>`;
const p=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
async function fixture(body=p('{{company_name}}'),extra={}){
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml',wrap(body));
 zip.file('word/styles.xml','<styles>original formatting</styles>');zip.file('word/media/logo.png',Buffer.from([1,2,3]));
 for(const [key,value] of Object.entries(extra))zip.file(key,value);
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
test('DOCX personalisation handles split runs, headers, multiple tokens and XML escaping without changing style/media',async()=>{
 const source=await fixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{company_</w:t></w:r><w:r><w:t>name}} and {{contact_name}}</w:t></w:r></w:p>'+p('{{record_id}} {{letter_reference}}'),{
  'word/header1.xml':`<w:hdr>${p('Header {{company_name}}')}</w:hdr>`,'word/footer1.xml':`<w:ftr>${p('{{suspension_date}}')}</w:ftr>`,
 });
 const before=Buffer.from(source);const output=await renderer.personalizeSuspensionDocx(source,values);assert.deepEqual(source,before);
 const zip=await JSZip.loadAsync(output),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/A&amp;B &lt;Industries&gt;/);assert.match(xml,/A &quot;Person&quot;/);assert.match(xml,/<w:b\/>/);assert.ok(!xml.includes('{{'));
 assert.match(await zip.file('word/header1.xml').async('string'),/A&amp;B/);assert.match(await zip.file('word/footer1.xml').async('string'),/IST/);
 assert.equal(await zip.file('word/styles.xml').async('string'),'<styles>original formatting</styles>');assert.deepEqual(await zip.file('word/media/logo.png').async('nodebuffer'),Buffer.from([1,2,3]));
});
test('DOCX requires approved company tokens and rejects missing, unknown or broken placeholders',async()=>{
 for(const text of ['No company placeholder','{{company_name}} {{unapproved}}','{{company_name}'])await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(p(text)),values),/placeholder|token/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(),{...values,company_name:''}),/company_placeholder/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(),{...values,company_name:'bad\u0000'}),/invalid_letter_value/);
});
test('DOCX rejects non-docx, macros, external references, unsafe paths and oversized expanded parts',async()=>{
 await assert.rejects(renderer.personalizeSuspensionDocx(Buffer.from('not docx'),values),/invalid_docx/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(p('{{company_name}}'),{'word/vbaProject.bin':'bad'}),values),/unsupported/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(p('{{company_name}}'),{'word/_rels/document.xml.rels':'<Relationship TargetMode="External" Target="https://invalid.test"/>'}),values),/unsupported/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(p('{{company_name}}'),{'../escape.xml':'bad'}),values),/unsafe/);
 await assert.rejects(renderer.personalizeSuspensionDocx(await fixture(p('{{company_name}}'),{'word/huge.xml':'x'.repeat(5*1024*1024+1)}),values),/too_large|length mismatch/);
});
test('DOCX worker verifies pinned hash, saves rendered attachment before sending, then reuses immutable payload',async()=>{
 const pdf=await pdfFixture();let conversions=0;
 const delivery=load('app/server/notifications/delivery.ts',{'./suspensionDocx':renderer,'./suspensionPdf':{...pdfRenderer,convertSuspensionDocxToPdf:async bytes=>{
  conversions++;const letter=await JSZip.loadAsync(bytes);assert.match(await letter.file('word/document.xml').async('string'),/A&amp;B/);return pdf;
 }}});const source=await fixture();let saved,providerPayload,downloads=0;
 const job={id:'notice',record_id:'record',object_name:'renewal_clients__a',notice_kind:'nonresponse_suspension',notice_round:3,recipient:'client@example.test',lease_token:'lease',context:{case_id:'case',company:'Company'}};
 const cfg={key:'mock',from:'sender@example.test',appUrl:'https://portal.example.test',mode:'test',testRecipients:[job.recipient]};
 let hash=createHash('sha256').update(source).digest('hex'),finished;
 const client={rpc:async(name,args)=>({data:name==='claim_notification'?job:name==='suspension_docx_for_notice'?{bucket:'notification-templates',path:'tenant/suspension/v1.docx',sha256:hash,values}:name==='prepare_notification'?(saved=args.p_payload):name==='finish_notification'?(finished=args):null}),storage:{from:bucket=>({download:async()=>{assert.equal(bucket,'notification-templates');downloads++;return {data:new Blob([source])};}})}};
 const send=async(_url,options)=>{assert.ok(saved);providerPayload=JSON.parse(options.body);assert.equal(options.headers['Idempotency-Key'],'craft-notice/notice');return Response.json({id:'provider'});};
 await delivery.deliverOne(client,cfg,send);assert.equal(finished.p_provider,'provider');assert.equal(providerPayload.attachments[0].filename,'suspension-record.pdf');assert.equal(providerPayload.attachments[0].content_type,'application/pdf');
 assert.deepEqual(Buffer.from(providerPayload.attachments[0].content,'base64'),pdf);
 job.payload=saved;hash='bad';await delivery.deliverOne(client,cfg,send);assert.equal(downloads,1);assert.equal(conversions,1);assert.deepEqual(providerPayload,JSON.parse(JSON.stringify(saved)));
});
test('DOCX worker sends nothing when source hash or required placeholders are wrong',async()=>{
 const delivery=load('app/server/notifications/delivery.ts',{'./suspensionDocx':renderer});let sends=0,finished;
 for(const validHash of [false,true]){
  const source=await fixture(p('unprepared template'));
  const job={id:'notice',record_id:'record',object_name:'renewal_clients__a',notice_kind:'nonresponse_suspension',notice_round:3,recipient:'client@example.test',lease_token:'lease',context:{case_id:'case'}};
  const client={rpc:async(name,args)=>({data:name==='claim_notification'?job:name==='suspension_docx_for_notice'?{bucket:'notification-templates',path:'tenant/suspension/v1.docx',sha256:validHash?createHash('sha256').update(source).digest('hex'):'bad',values}:name==='finish_notification'?(finished=args):null}),storage:{from:()=>({download:async()=>({data:new Blob([source])})})}};
  await delivery.deliverOne(client,{mode:'test',testRecipients:[job.recipient]},async()=>{sends++;return Response.json({id:'unexpected'});});assert.equal(finished.p_error,'required_docx_template_unavailable');
 }assert.equal(sends,0);
});

test('PDF conversion uses isolated local files/profiles and removes them after success or renderer failure',async()=>{
 const fsp=require('node:fs/promises'),{fileURLToPath}=require('node:url');const source=await fixture(),pdf=await pdfFixture();const directories=[],profiles=[];
 const run=async(exe,args)=>{
  assert.equal(exe,'trusted-office');assert.ok(args.includes('pdf:writer_pdf_Export'));assert.ok(args.includes('--headless'));
  const input=args.at(-1),directory=path.dirname(input);directories.push(directory);profiles.push(fileURLToPath(args[0].slice(args[0].indexOf('=')+1)));
  assert.deepEqual(await fsp.readFile(input),source);
  await fsp.writeFile(path.join(args[args.indexOf('--outdir')+1],'letter.pdf'),pdf);
 };
 const outputs=await Promise.all([1,2].map(()=>pdfRenderer.convertSuspensionDocxToPdf(source,run,{SUSPENSION_LIBREOFFICE_PATH:'trusted-office'})));
 outputs.forEach(output=>assert.deepEqual(output,pdf));assert.notEqual(directories[0],directories[1]);assert.notEqual(profiles[0],profiles[1]);
 for(const directory of directories)await assert.rejects(fsp.stat(directory),{code:'ENOENT'});
 let failedDirectory;await assert.rejects(pdfRenderer.convertSuspensionDocxToPdf(source,async(_exe,args)=>{failedDirectory=path.dirname(args.at(-1));throw Error('timeout');}),/timeout/);
 await assert.rejects(fsp.stat(failedDirectory),{code:'ENOENT'});
});
test('PDF conversion rejects missing, malformed, empty and oversized output and bounds the process',async()=>{
 const fsp=require('node:fs/promises'),source=await fixture();
 for(const output of [null,Buffer.from('not pdf'),await pdfFixture(0),Buffer.alloc(10*1024*1024+1)]){
  let directory;await assert.rejects(pdfRenderer.convertSuspensionDocxToPdf(source,async(_exe,args)=>{directory=path.dirname(args.at(-1));if(output)await fsp.writeFile(path.join(args[args.indexOf('--outdir')+1],'letter.pdf'),output);}));
  await assert.rejects(fsp.stat(directory),{code:'ENOENT'});
 }
 const bounded=load('app/server/notifications/suspensionPdf.ts',{'node:child_process':{execFile:(_exe,_args,options,callback)=>{
  assert.equal(options.timeout,60000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.maxBuffer,65536);assert.equal(options.windowsHide,true);assert.ok(!options.shell);callback(Error('missing executable'));
 }}});
 await assert.rejects(bounded.convertSuspensionDocxToPdf(source),/conversion_failed/);
});
test('PDF worker sends nothing on conversion failure or invalid cached/prepared attachments',async()=>{
 const source=await fixture(),pdf=await pdfFixture();let sends=0,prepared=0,finished;
 const config={mode:'test',testRecipients:['client@example.test']};
 const job={id:'notice',record_id:'record',object_name:'renewal_clients__a',notice_kind:'nonresponse_suspension',notice_round:3,recipient:'client@example.test',lease_token:'lease',context:{case_id:'case'}};
 const docxPayload={attachments:[{filename:'suspension-record.docx',content:source.toString('base64')}]};
 let returnedPayload;
 const client={rpc:async(name,args)=>({data:name==='claim_notification'?job:name==='suspension_docx_for_notice'?{bucket:'notification-templates',sha256:createHash('sha256').update(source).digest('hex'),values}:name==='prepare_notification'?(prepared++,returnedPayload||args.p_payload):name==='finish_notification'?(finished=args):null}),storage:{from:()=>({download:async()=>({data:new Blob([source])})})}};
 const send=async()=>{sends++;return Response.json({id:'unexpected'});};
 let fail=true;const delivery=load('app/server/notifications/delivery.ts',{'./suspensionDocx':renderer,'./suspensionPdf':{...pdfRenderer,convertSuspensionDocxToPdf:async()=>{if(fail)throw Error('office unavailable');return pdf;}}});
 await delivery.deliverOne(client,config,send);assert.equal(finished.p_error,'suspension_pdf_conversion_failed');assert.equal(finished.p_retry,true);assert.equal(prepared,0);
 fail=false;job.payload=docxPayload;await delivery.deliverOne(client,config,send);assert.equal(finished.p_error,'suspension_pdf_required');assert.equal(prepared,0);assert.deepEqual(job.payload,docxPayload);
 delete job.payload;returnedPayload=docxPayload;await delivery.deliverOne(client,config,send);assert.equal(finished.p_error,'suspension_pdf_required');assert.equal(prepared,1);assert.equal(sends,0);
 const valid={attachments:[{filename:'suspension-record.pdf',content_type:'application/pdf',content:pdf.toString('base64')}]};
 for(const invalid of [{attachments:[]},{attachments:[...valid.attachments,...valid.attachments]},{attachments:[{...valid.attachments[0],filename:'wrong.pdf'}]},{attachments:[{...valid.attachments[0],content_type:undefined}]},{attachments:[{...valid.attachments[0],content:source.toString('base64')}]}])await assert.rejects(pdfRenderer.validateSuspensionPdfPayload(invalid,'record'));
});
