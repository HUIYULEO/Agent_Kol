import {unstable_splitSqlQuery} from 'wrangler';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, db;
const body = { seller_name: 'Test seller', seller_payee_id: 'p_test', service_summary: 'A test-only service', how_to_invoke: 'PRIVATE https://example.com', contact_room_id: 'rom_private' };
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api', modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-09-25',
    outboundService:'fixture', d1Databases: ['DB'], bindings: { PROBE_ALLOWED_URLS:'https://public.example/data,https://public.example/redirect,https://public.example/large,https://public.example/html,https://public.example/slow,https://public.example/invalid,https://public.example/nested', REVIEW_PRICE: '5', PAY_TO: 'p_test_recipient', ADMIN_TOKEN: 'test-only-admin-token-32-characters' } },{name:'fixture',modules:true,script:`export default {async fetch(request){if(new URL(request.url).hostname==='cloudflare-dns.com'){const u=new URL(request.url),name=u.searchParams.get('name');return Response.json({Status:name==='dnsfail.example'?2:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:({'private.example':'127.0.0.1','link.example':'169.254.169.254','rfc1918.example':'10.0.0.1','shared.example':'100.64.0.1'})[name]||'93.184.216.34'}]:(name==='v6private.example'?[{type:28,data:'fd00::1'}]:name==='v6mapped.example'?[{type:28,data:'::ffff:127.0.0.1'}]:[])});}const p=new URL(request.url).pathname;if(p==='/echo')return Response.json({method:request.method,body:await request.json(),leaked:request.headers.has('Authorization'),content_type:request.headers.get('Content-Type'),query:new URL(request.url).search});if(p==='/slow'){await new Promise(r=>setTimeout(r,6000));return Response.json({ok:true});}if(p==='/invalid')return new Response('not-json-secret',{headers:{'content-type':'application/json'}});if(p==='/nested')return Response.json({items:Array.from({length:100},(_,i)=>i)});if(p==='/redirect')return new Response(null,{status:302,headers:{location:'https://127.0.0.1/'}});if(p==='/html')return new Response('<script>secret</script>',{headers:{'content-type':'text/html'}});return Response.json(p==='/large'?{body:'x'.repeat(20000)}:{title:'fixture',token:'private-token',nested:{email:'alice@example.com'},message:'Bearer privatecredential',value:'normal'});}}`}] }));
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const statements=unstable_splitSqlQuery(await readFile('migrations/'+file,'utf8'));
    await db.batch(statements.map(sql=>db.prepare(sql)));
  }
});
after(async () => { await mf?.dispose(); });
const request = (path, options = {}) => mf.dispatchFetch('https://test.local' + path, options);
const post = (path, data, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
test('atomic concurrent retries and public privacy', async () => {
  const key = crypto.randomUUID();
  const responses = await Promise.all(Array.from({length: 5}, () => post('/bookings', body, { 'Idempotency-Key': key })));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  const values = await Promise.all(responses.map(r => r.json()));
  assert.equal(new Set(values.map(v => v.booking_id)).size, 1);
  assert.equal(values[0].status, 'pending_payment');
  assert.equal(values[0].price, 5);
  assert.equal(values[0].pay_to, 'p_test_recipient');
  assert.equal((await post('/bookings', {...body, seller_name:'changed'}, {'Idempotency-Key':key})).status, 409);
  const publicValue = await (await request('/bookings/' + values[0].booking_id)).json();
  assert.equal(publicValue.how_to_invoke, undefined);
  assert.equal(publicValue.contact_room_id, undefined);
  const queue = await (await request('/queue')).json();
  assert.ok(!queue.items.some(b => b.booking_id === values[0].booking_id));
});
test('rejects invalid and oversized input', async () => {
  for (const extra of [{status:'paid'}, {price:1}, {how_to_invoke:'x'.repeat(8001)}, {seller_payee_id:'invalid'}]) {
    assert.equal((await post('/bookings', {...body, ...extra})).status,400);
  }
  assert.equal((await post('/bookings', {...body, service_summary:'x'.repeat(40000)})).status,413);
  assert.equal((await request('/bookings',{method:'POST',body:'{}'})).status,415);
  assert.equal((await request('/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await request('/queue?limit=100000')).status,400);
  assert.equal((await request('/bookings/bk_00000000-0000-0000-0000-000000000000')).status,404);
});
test('queue public fields are explicitly allowlisted', async () => {
  const created = await (await post('/bookings',body)).json();
  await db.prepare("UPDATE bookings SET status = 'paid' WHERE booking_id = ?").bind(created.booking_id).run();
  const result = await (await request('/queue')).json();
  assert.deepEqual(Object.keys(result.items.find(b=>b.booking_id===created.booking_id)).sort(), ['booking_id','seller_name','service_summary','status','created_at'].sort());
});

const auth={Authorization:'Bearer test-only-admin-token-32-characters'};
const detail=async id=>(await (await request('/admin/bookings/'+id,{headers:auth})).json()).booking;
const transition=async(id,status,extra={})=>post('/admin/bookings/'+id+'/status',{status,expected_version:(await detail(id)).version,...extra},auth);
const fresh=async()=>(await (await post('/bookings',body)).json()).booking_id;
const evidence=id=>({method:'transaction_reference',transaction_id:'txn_'+crypto.randomUUID(),amount:5,payer:'p_test',payee:'p_test_recipient',memo:id,observed_at:new Date().toISOString()});
test('admin authentication and status transitions fail closed',async()=>{
 assert.equal((await request('/admin/bookings')).status,401);
 assert.equal((await request('/admin/bookings',{headers:{Authorization:'Bearer wrong'}})).status,401);
 const id=await fresh();
 assert.equal((await transition(id,'paid',{payment_evidence:evidence(id)})).status,409);
 assert.equal((await transition(id,'published')).status,409);
 const a=await detail(id);
 const results=await Promise.all([1,2].map(()=>post('/admin/bookings/'+id+'/status',{status:'cancelled',expected_version:a.version},auth)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('single payment window, expiry queueing and ambiguous window hold',async()=>{
 const a=await fresh(),b=await fresh();
 const result=await Promise.all([a,b].map(id=>transition(id,'awaiting_payment',{received_baseline:0})));
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const active=(await detail(a)).status==='awaiting_payment'?a:b;
 const other=active===a?b:a;
 assert.equal((await transition(active,'pending_payment')).status,409);
 assert.equal((await transition(active,'paid',{payment_evidence:{method:'aggregate_window',received:5,observed_at:new Date().toISOString()}})).status,409);
 assert.equal((await transition(active,'payment_ambiguous',{reason:'unattributed arrival'})).status,200);
 assert.equal((await transition(other,'awaiting_payment',{received_baseline:5})).status,409);
 assert.equal((await transition(active,'cancelled',{reason:'test reconciled; no live funds involved'})).status,200);
 assert.equal((await transition(other,'awaiting_payment',{received_baseline:5})).status,200);
 await db.prepare('UPDATE bookings SET payment_deadline=? WHERE booking_id=?').bind('2020-01-01T00:00:00.000Z',other).run();
 assert.equal((await (await request('/bookings/'+other)).json()).payment_window_open,false);
 assert.equal((await transition(other,'pending_payment')).status,200);
 assert.equal((await detail(other)).received_baseline,null);
});
test('payment evidence match and replay protection; review publication is atomic and immutable',async()=>{
 const id=await fresh();
 assert.equal((await transition(id,'awaiting_payment',{received_baseline:0})).status,200);
 const e=evidence(id);
 assert.equal((await transition(id,'paid',{payment_evidence:{...e,amount:99}})).status,409);
 assert.equal((await transition(id,'paid',{payment_evidence:e})).status,200);
 assert.equal((await transition(id,'testing')).status,200);
 const probe=await (await post('/admin/probe',{subject_id:id,url:'https://public.example/data'},auth)).json();
 const review={funding_source:'seller_paid',probe_ids:[probe.probe_id],booking_id:id,verdict:'mixed',tested_at:new Date().toISOString(),what_we_called:'GET https://example.com (synthetic fixture)',result_summary:'Test fixture only',latency_ms:10,pros:['Clear interface'],cons:['Not a live service test'],how_to_buy:'Synthetic only'};
 const results=await Promise.all([1,2].map(()=>post('/admin/reviews',review,auth)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 const published=await results[0].json();
 assert.equal((await detail(id)).status,'published');
 assert.equal((await request('/reviews/'+published.review_id)).status,200);
 assert.equal((await post('/admin/reviews',{...review,result_summary:'changed'},auth)).status,409);
 assert.equal((await (await request('/reviews')).json()).items[0].content_hash,undefined);
 const second=await fresh();
 assert.equal((await transition(second,'awaiting_payment',{received_baseline:5})).status,200);
 assert.equal((await transition(second,'paid',{payment_evidence:{...e,memo:second}})).status,409);
 assert.equal((await detail(second)).status,'awaiting_payment');
 assert.equal((await transition(second,'cancelled',{reason:'test cleanup'})).status,200);
 const events=(await (await request('/admin/bookings/'+id,{headers:auth})).json()).events;
 assert.deepEqual(events.map(e=>e.to_status),['awaiting_payment','paid','testing','published']);
});

test('refund references cannot be reused, and original payment evidence is retained',async()=>{
 const id=await fresh(); await transition(id,'awaiting_payment',{received_baseline:0});
 const paid=evidence(id); assert.equal((await transition(id,'paid',{payment_evidence:paid})).status,200);
 const refund={transaction_id:'refund_'+crypto.randomUUID(),amount:5,payer:'p_test_recipient',payee:'p_test',observed_at:new Date().toISOString()};
 assert.equal((await transition(id,'refunded',{payment_evidence:{...refund,transaction_id:paid.transaction_id}})).status,409);
 assert.equal((await transition(id,'refunded',{payment_evidence:refund})).status,200);
 const row=await detail(id);assert.equal(row.payment_reference,paid.transaction_id);assert.equal(row.refund_reference,refund.transaction_id);
 assert.equal(JSON.parse(row.refund_evidence).transaction_id,refund.transaction_id);
 const second=await fresh();await transition(second,'awaiting_payment',{received_baseline:5});await transition(second,'paid',{payment_evidence:evidence(second)});
 assert.equal((await transition(second,'refunded',{payment_evidence:refund})).status,409);
 assert.equal((await detail(second)).status,'paid');
});
test('rejects reviews timestamped before booking',async()=>{
 const id=await fresh();await transition(id,'awaiting_payment',{received_baseline:10});await transition(id,'paid',{payment_evidence:evidence(id)});await transition(id,'testing');
 const probe=await (await post('/admin/probe',{subject_id:id,url:'https://public.example/data'},auth)).json();
 const r=await post('/admin/reviews',{funding_source:'seller_paid',probe_ids:[probe.probe_id],booking_id:id,verdict:'mixed',tested_at:'1970-01-01T00:00:00Z',what_we_called:'test',result_summary:'test',pros:[],cons:[],how_to_buy:'test'},auth);
 assert.equal(r.status,400);assert.equal((await detail(id)).status,'testing');
});
test('MCP official SDK client initializes, discovers tools and calls public APIs',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const client=new Client({name:'integration-test',version:'1'});
 const transport=new StreamableHTTPClientTransport(new URL('https://test.local/mcp'),{fetch:async(url,init)=>request('/mcp',init)});
 try{
  await client.connect(transport);
  const {tools}=await client.listTools();
  assert.deepEqual(tools.map(t=>t.name).sort(),['book_review','get_booking','get_review','list_reviews'].sort());
  const booking=await client.callTool({name:'book_review',arguments:{...body,idempotency_key:'mcp-'+crypto.randomUUID()}});
  assert.ok(!booking.isError);const id=JSON.parse(booking.content[0].text).booking_id;
  const found=await client.callTool({name:'get_booking',arguments:{booking_id:id}});
  assert.equal(JSON.parse(found.content[0].text).status,'pending_payment');
  assert.equal(JSON.parse(found.content[0].text).how_to_invoke,undefined);
  const reviews=await client.callTool({name:'list_reviews',arguments:{}});
  assert.ok(!reviews.isError);
  const invalid=await client.callTool({name:'book_review',arguments:{...body,status:'paid'}});
  assert.equal(invalid.isError,true);
 }finally{await client.close();}
 assert.equal((await request('/mcp',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await request('/mcp')).status,405);
});
test('landing page serves same-origin assets and a safe working curl example',async()=>{
 const r=await request('/');assert.equal(r.status,200);
 assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 const html=await r.text();assert.match(html,/id="curl"/);assert.match(html,/https:\/\/test.local\/bookings/);
 assert.equal((await request('/styles.css')).status,200);assert.equal((await request('/app.js')).status,200);
});

test('scheduled handler expires windows without releasing ambiguous holds',async()=>{
 const id=await fresh();await transition(id,'awaiting_payment',{received_baseline:0});
 await db.prepare('UPDATE bookings SET payment_deadline=? WHERE booking_id=?').bind('2020-01-01T00:00:00.000Z',id).run();
 const worker=await mf.getWorker();
 await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()});
 assert.equal((await detail(id)).status,'pending_payment');
 await transition(id,'awaiting_payment',{received_baseline:0});await transition(id,'payment_ambiguous',{reason:'unattributed funds'});
 await db.prepare('UPDATE bookings SET payment_deadline=? WHERE booking_id=?').bind('2020-01-01T00:00:00.000Z',id).run();
 await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()});
 assert.equal((await detail(id)).status,'payment_ambiguous');
 await transition(id,'cancelled',{reason:'test reconciled'});
});

test('public reviews never expose newly added internal columns',async()=>{
 await db.exec("ALTER TABLE reviews ADD COLUMN internal_note TEXT DEFAULT 'PRIVATE';");
 const result=await (await request('/reviews')).json();
 assert.ok(result.items.length>0);
 const fields=['review_id','booking_id','verdict','tested_at','what_we_called','result_summary','latency_ms','pros','cons','how_to_buy','created_at','subject_id','funding_source','evidence','reproduce_cmd','seller_response'].sort();
 assert.deepEqual(Object.keys(result.items[0]).sort(),fields);
 const one=await (await request('/reviews/'+result.items[0].review_id)).json();
 assert.deepEqual(Object.keys(one).sort(),fields);
});
test('validation errors distinguish JSON syntax, shape and status; HEAD health works',async()=>{
 const array=await post('/bookings',[]);assert.equal(array.status,400);assert.equal((await array.json()).error.code,'invalid_input');
 const malformed=await request('/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
 assert.equal((await malformed.json()).error.code,'invalid_json');
 assert.equal((await request('/admin/bookings?status=bogus',{headers:auth})).status,400);
 const head=await request('/health',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('ledger evidence is named as attestation rather than independent verification',async()=>{
 const id=await fresh();await transition(id,'awaiting_payment',{received_baseline:0});
 const e=evidence(id);
 assert.equal((await transition(id,'paid',{payment_evidence:{...e,method:'ledger_verified'}})).status,400);
 assert.equal((await transition(id,'paid',{payment_evidence:{...e,method:'ledger_attested'}})).status,200);
 const stored=JSON.parse((await detail(id)).payment_evidence);
 assert.equal(stored.method,'ledger_attested');assert.equal(stored.verification,'agent_attested_transaction');
});

test('unpaid evidence-backed reviews publish without creating payment records',async()=>{
 const subject='demo_'+crypto.randomUUID();
 const p=await post('/admin/probe',{subject_id:subject,url:'https://public.example/data'},auth);
 assert.equal(p.status,201);const probe=await p.json();
 assert.equal(probe.status,200);assert.equal(probe.outcome,'observed');
 assert.ok(!JSON.stringify(probe).includes('private-token'));
 assert.ok(!JSON.stringify(probe).includes('alice@example.com'));
 assert.ok(!JSON.stringify(probe).includes('privatecredential'));
 const review={subject_id:subject,funding_source:'demo_example',probe_ids:[probe.probe_id],verdict:'recommended',tested_at:new Date().toISOString(),what_we_called:'GET fixture',result_summary:'Synthetic evidence only',pros:[],cons:[],how_to_buy:'No purchase'};
 assert.equal((await post('/admin/reviews',{...review,probe_ids:[]},auth)).status,400);
 assert.equal((await post('/admin/reviews',{...review,subject_id:'other'},auth)).status,400);
 assert.equal((await post('/admin/reviews',{...review,reproduce_cmd:'malicious'},auth)).status,400);
 assert.equal((await post('/admin/reviews',{...review,funding_source:'host_purchased'},auth)).status,400);
 const results=await Promise.all([1,2].map(()=>post('/admin/reviews',review,auth)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 const published=await results[0].json();
 assert.equal(published.booking_id,null);assert.equal(published.evidence[0].probe_id,probe.probe_id);
 assert.equal(published.reproduce_cmd,probe.reproduce_cmd);
 assert.equal((await post('/admin/reviews',{...review,result_summary:'edited'},auth)).status,409);
 assert.equal((await post('/admin/probe',{subject_id:subject,url:'https://public.example/data'},auth)).status,409);
 assert.equal(await db.prepare('SELECT booking_id FROM bookings WHERE booking_id=?').bind(subject).first(),null);
 const stats=await (await request('/reviews/stats')).json();assert.ok(stats.funding_sources.demo_example>=1);assert.ok(stats.verdicts.recommended>=1);
});
test('probe denies unsafe targets and caller-controlled request settings',async()=>{
 assert.equal((await post('/admin/probe',{subject_id:'x',url:'https://public.example/data'})).status,401);
 for(const url of ['http://public.example/data','https://127.0.0.1/','https://[::1]/','https://2130706433/','https://user:pass@public.example/data','https://public.example/data?token=secret','https://public.example/data#x','https://public.example:444/data','https://unapproved.example/','https://public.example/data\';echo']){
  assert.ok([400,403].includes((await post('/admin/probe',{subject_id:'x',url},auth)).status));
 }
 for(const extra of [{headers:{Authorization:'secret'}},{method:'POST'},{body:'secret'}]){
  assert.equal((await post('/admin/probe',{subject_id:'x',url:'https://public.example/data',...extra},auth)).status,400);
 }
});
test('probe redirects, oversized and non-JSON responses are not exposed; quota is atomic',async()=>{
 for(const [path,outcome] of [['redirect','redirect_blocked'],['large','response_too_large'],['html','unsupported_content']]){
  const r=await post('/admin/probe',{subject_id:'case_'+path,url:'https://public.example/'+path},auth);
  assert.equal(r.status,201);const p=await r.json();assert.equal(p.outcome,outcome);assert.ok(p.response_excerpt.length<=2048);assert.ok(!p.response_excerpt.includes('<script>'));
 }
 const subject='quota_'+crypto.randomUUID();
 const responses=await Promise.all(Array.from({length:8},()=>post('/admin/probe',{subject_id:subject,url:'https://public.example/data'},auth)));
 assert.equal(responses.filter(r=>r.status===201).length,5);
 assert.equal(responses.filter(r=>r.status===409).length,3);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM probes WHERE subject_id=?').bind(subject).first()).n,5);
});

test('seller response credential is scoped, private, single-use and preserves original review',async()=>{
 const row=await db.prepare("SELECT review_id,result_summary FROM reviews WHERE funding_source='seller_paid' LIMIT 1").first();
 const path='/admin/reviews/'+row.review_id+'/response-token';
 assert.equal((await post(path,{})).status,401);
 const grantResponse=await post(path,{},auth);assert.equal(grantResponse.status,201);
 const grant=await grantResponse.json();assert.match(grant.response_token,/^[a-f0-9]{64}$/);
 assert.equal((await post(path,{},auth)).status,409);
 const endpoint='/reviews/'+row.review_id+'/response',credential={Authorization:'Bearer '+grant.response_token};
 assert.equal((await post(endpoint,{response:'hello'})).status,401);
 assert.equal((await post('/reviews/rev_00000000-0000-0000-0000-000000000000/response',{response:'hello'},credential)).status,401);
 assert.equal((await post(endpoint,{response:'contact alice@example.com'},credential)).status,400);
 const responses=await Promise.all(['Seller statement A','Seller statement B'].map(response=>post(endpoint,{response},credential)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const result=await (await request('/reviews/'+row.review_id)).json();
 assert.equal(result.result_summary,row.result_summary);assert.ok(result.seller_response.response.startsWith('Seller statement'));
 assert.equal((await post(endpoint,{response:result.seller_response.response},credential)).status,200);
 assert.ok(!JSON.stringify(result).includes(grant.response_token));assert.equal(result.token_hash,undefined);
 const demo=await db.prepare("SELECT review_id FROM reviews WHERE funding_source='demo_example' LIMIT 1").first();
 assert.equal((await post('/admin/reviews/'+demo.review_id+'/response-token',{},auth)).status,409);
});

test('probe bounds total time and omits invalid JSON; nested truncation is explicit',async()=>{
 const started=Date.now();
 const slow=await (await post('/admin/probe',{subject_id:'slow',url:'https://public.example/slow'},auth)).json();
 assert.equal(slow.outcome,'timeout');assert.ok(Date.now()-started<7500);assert.equal(slow.response_excerpt,'');
 const invalid=await (await post('/admin/probe',{subject_id:'invalid',url:'https://public.example/invalid'},auth)).json();
 assert.equal(invalid.outcome,'invalid_json');assert.ok(!invalid.response_excerpt.includes('not-json-secret'));
 const nested=await (await post('/admin/probe',{subject_id:'nested',url:'https://public.example/nested'},auth)).json();
 assert.equal(nested.truncated,true);assert.equal(JSON.parse(nested.response_excerpt).items.length,40);
});

test('runtime approval binds exact URL and provenance; POST transports JSON without admin credentials',async()=>{
 const url='https://runtime.example/echo?q=hello&n=1';
 const approval={url,source_kind:'room_message',source_ref:'msg_publicFixture',publicly_provided:true,reviewed_safe:true};
 assert.equal((await post('/admin/probe-targets',approval)).status,401);
 assert.equal((await post('/admin/probe',{subject_id:'runtime',url,method:'POST',body:{}},auth)).status,403);
 for(const extra of [{publicly_provided:false},{reviewed_safe:false},{source_ref:'not-a-reference'}])
 assert.equal((await post('/admin/probe-targets',{...approval,...extra},auth)).status,400);
 assert.equal((await post('/admin/probe-targets',approval,auth)).status,201);
 assert.equal((await post('/admin/probe-targets',approval,auth)).status,201);
 const payload={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:"test's $(echo harmless)",version:'1'}}};
 const response=await post('/admin/probe',{subject_id:'runtime',url,method:'POST',body:payload},auth);
 assert.equal(response.status,201);const record=await response.json();
 assert.equal(record.method,'POST');assert.deepEqual(record.request_body,payload);
 const echoed=JSON.parse(record.response_excerpt);assert.equal(echoed.leaked,false);assert.equal(echoed.content_type,'application/json');assert.deepEqual(echoed.body,payload);assert.equal(echoed.query,'?q=hello&n=1');
 assert.ok(record.reproduce_cmd.includes('--request POST'));assert.ok(record.reproduce_cmd.includes('--globoff'));
 // A literal apostrophe is broken out and escaped rather than opening a shell substitution.
 assert.ok(record.reproduce_cmd.includes(String.fromCharCode(39,92,39,39)));
 assert.equal((await post('/admin/probe',{subject_id:'runtime',url:url+'&extra=1'},auth)).status,403);
 for(const body of [{token:'hidden'},{nested:{email:'a@b.com'}},{message:'Bearer hidden'}])
 assert.equal((await post('/admin/probe',{subject_id:'runtime',url,method:'POST',body},auth)).status,400);
 assert.equal((await post('/admin/probe',{subject_id:'runtime',url,method:'POST',body:{data:'a'.repeat(4096)}},auth)).status,413);
 assert.equal((await post('/admin/probe',{subject_id:'runtime',url,method:'DELETE'},auth)).status,400);
 const subject='post_budget_'+crypto.randomUUID();
 const requests=await Promise.all(Array.from({length:7},()=>post('/admin/probe',{subject_id:subject,url,method:'POST',body:{ok:true}},auth)));
 assert.equal(requests.filter(r=>r.status===201).length,5);assert.equal(requests.filter(r=>r.status===409).length,2);
});
test('runtime targets reject literals, private DNS, resolver failure, secrets and DNS changes',async()=>{
 const a={source_kind:'room_message',source_ref:'msg_publicFixture',publicly_provided:true,reviewed_safe:true};
 for(const url of ['http://runtime.example/a','https://127.0.0.1/','https://0x7f000001/','https://[::ffff:127.0.0.1]/','https://169.254.169.254/','https://private.example/a','https://link.example/a','https://rfc1918.example/a','https://shared.example/a','https://v6private.example/a','https://v6mapped.example/a','https://dnsfail.example/a','https://runtime.example/a?api_key=secret','https://runtime.example/a?email=a%40b.com']){
 const r=await post('/admin/probe-targets',{...a,url},auth);assert.equal(r.status,400,url);
 }
 await db.prepare('INSERT INTO probe_targets(url,source_kind,source_ref,approved_at) VALUES(?,?,?,?)').bind('https://private.example/a','room_message','msg_oldApproval',new Date().toISOString()).run();
 assert.equal((await post('/admin/probe',{subject_id:'rebind',url:'https://private.example/a'},auth)).status,400);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM probes WHERE subject_id='rebind'").first()).n,0);
});
