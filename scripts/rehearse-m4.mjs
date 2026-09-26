import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
if(process.argv.length>2)throw Error('This rehearsal accepts no remote target or credentials.');
const token='local-rehearsal-only-not-a-live-token';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'api',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-25',d1Databases:['DB'],outboundService:'fixture',bindings:{ADMIN_TOKEN:token,REVIEW_PRICE:'5',PAY_TO:'p_synthetic_host',PROBE_ALLOWED_URLS:'https://fixture.example/demo'}},
 {name:'fixture',modules:true,script:"export default {fetch(request){if(new URL(request.url).hostname==='cloudflare-dns.com'){const u=new URL(request.url),name=u.searchParams.get('name');return Response.json({Status:name==='dnsfail.example'?2:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:name==='private.example'?'127.0.0.1':'93.184.216.34'}]:[]});}return Response.json({result:'synthetic success',token:'DO_NOT_PUBLISH',email:'private@example.com'})}}"}
]}));
try{
 const db=await mf.getD1Database('DB');
 for(const f of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())
 await db.batch(unstable_splitSqlQuery(await readFile('migrations/'+f,'utf8')).map(s=>db.prepare(s)));
 const send=async(path,data,credential=token)=>{
 const r=await mf.dispatchFetch('https://rehearsal.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify(data)});
 const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;
 };
 const booking=await send('/bookings',{seller_name:'M4 synthetic seller',seller_payee_id:'p_synthetic_seller',service_summary:'Local rehearsal only',how_to_invoke:'GET https://fixture.example/demo'});
 const id=booking.booking_id;
 const change=async(status,extra={})=>{
 const r=await mf.dispatchFetch('https://rehearsal.invalid/admin/bookings/'+id,{headers:{Authorization:'Bearer '+token}});
 const {booking}=await r.json();return send('/admin/bookings/'+id+'/status',{status,expected_version:booking.version,...extra});
 };
 await change('awaiting_payment',{received_baseline:0});
 await change('paid',{payment_evidence:{method:'ledger_attested',transaction_id:'synthetic-local-transaction',payer:'p_synthetic_seller',payee:'p_synthetic_host',amount:5,memo:id,observed_at:new Date().toISOString()}});
 await change('testing');
 const paidProbe=await send('/admin/probe',{subject_id:id,url:'https://fixture.example/demo'});
 const reviewInput={verdict:'inconclusive',tested_at:new Date().toISOString(),what_we_called:'Local fixture only',result_summary:'Simulated M4: no real service or payment was tested.',pros:[],cons:['Synthetic transport and ledger'],how_to_buy:'Not for sale'};
 const paid=await send('/admin/reviews',{...reviewInput,booking_id:id,funding_source:'seller_paid',probe_ids:[paidProbe.probe_id]});
 const grant=await send('/admin/reviews/'+paid.review_id+'/response-token',{});
 await send('/reviews/'+paid.review_id+'/response',{response:'This is a synthetic seller reply.'},grant.response_token);
 const freeProbe=await send('/admin/probe',{subject_id:'m4-demo',url:'https://fixture.example/demo'});
 const free=await send('/admin/reviews',{...reviewInput,tested_at:new Date().toISOString(),subject_id:'m4-demo',funding_source:'demo_example',probe_ids:[freeProbe.probe_id]});
 assert.equal(free.booking_id,null);
 assert.ok(!JSON.stringify([paid,free]).includes('DO_NOT_PUBLISH'));
 assert.ok(!JSON.stringify([paid,free]).includes('private@example.com'));
 const stats=await (await mf.dispatchFetch('https://rehearsal.invalid/reviews/stats')).json();
 assert.equal(stats.total,2);
 const report={mode:'isolated_simulation',at:new Date().toISOString(),real_payments:false,real_refunds:false,external_service_calls:false,passed:['booking','window','simulated_ledger_attestation','testing','server_probe_evidence','paid_review','seller_response','unpaid_review','redaction','statistics'],review_count:stats.total};
 await writeFile('docs/m4-rehearsal.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await mf.dispose();}
