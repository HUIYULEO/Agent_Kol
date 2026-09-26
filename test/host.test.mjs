import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runHost,main} from '../scripts/host.mjs';
import {matchFixture} from '../scripts/ledger-match.mjs';
import {probeBody} from '../src/probe-body.ts';
const token='test-only-admin-token-32-characters',id='bk_00000000-0000-0000-0000-000000000001';
test('host rejects secrets in argv, arbitrary hosts, and simulated evidence before network',async()=>{
 const noSend=()=>{throw Error('network must not run');};
 for(const args of [['stats','--token',token],['approve-target','--url','https://x.example/'],['set-status',id,'refunded']]){
 assert.equal((await runHost(args,{token,send:noSend})).ok,false);
 }
 assert.equal((await runHost(['stats'],{token,base:'https://evil.example',send:noSend})).error.code,'untrusted_base_url');
 assert.equal((await runHost(['mark-paid',id,'--evidence-file','e'],{token,send:noSend,load:async()=>JSON.stringify({method:'ledger_attested',simulation_only:true})})).error.code,'ledger_evidence_required');
 assert.equal((await main(['stats'],{})).error.code,'admin_token_file_required');
});
test('host 409 reads once more, never repeats mutation; strips headers and secret error messages',async()=>{
 const calls=[];
 const send=async(url,o)=>{calls.push(o.method);return o.method==='GET'?Response.json({booking:{version:calls.length,status:'pending_payment'}}):Response.json({error:{code:'version_conflict',message:token},headers:{Authorization:token}},{status:409});};
 const r=await runHost(['open-window',id],{token,send});
 assert.deepEqual(calls,['GET','POST','GET']);assert.equal(r.retried,false);assert.equal(r.latest.version,3);assert.ok(!JSON.stringify(r).includes(token));
 const s=await runHost(['stats'],{token,send:async()=>Response.json({value:token})});assert.equal(s.data.value,'[REDACTED_ADMIN_TOKEN]');
});
test('fixture ledger matching is explicit, exact and rejects duplicate/ambiguous evidence',()=>{
 const b={booking_id:id,seller_payee_id:'p_seller',pay_to:'p_host',price:5,payment_opened_at:'2026-09-26T00:00:00Z',payment_deadline:'2026-09-26T00:03:00Z'};
 const r={direction:'incoming',transaction_id:'txn_fixture',amount:5,payer:'p_seller',payee:'p_host',memo:id,observed_at:'2026-09-26T00:00:00Z'};
 assert.equal(matchFixture(b,[r]).match,'unique');assert.equal(matchFixture(b,[r]).simulation_only,true);
 assert.equal(matchFixture(b,[{...r,memo:'Another team'}]).match,'unique');
 assert.equal(matchFixture(b,[{...r,memo:''}]).match,'unique');
 assert.equal(matchFixture(b,[{...r,observed_at:'2026-09-25T23:59:59Z'}]).match,'none');
 assert.equal(matchFixture(b,[{...r,observed_at:'2026-09-26T00:03:01Z'}]).match,'none');
 assert.equal(matchFixture({...b,payment_opened_at:null},[r]).match,'invalid_input');
 assert.equal(matchFixture(b,[]).match,'none');
 assert.equal(matchFixture(b,[{...r,payer:'p_other'}]).match,'none');
 assert.equal(matchFixture(b,[{...r,direction:'outgoing'}]).match,'none');
 assert.equal(matchFixture(b,[{...r,amount:4}]).match,'amount_mismatch');
 assert.equal(matchFixture(b,[r,{...r,transaction_id:'txn_second'}]).match,'multiple');
 assert.equal(matchFixture(b,[r,r]).match,'invalid_input');
 assert.equal(matchFixture(b,[{...r,observed_at:'bad'}]).match,'invalid_input');
});
test('bounded SSE reads first event only, handles split UTF8 and multiline data, and cancels',async()=>{
 const bytes=new TextEncoder().encode(': comment\r\n\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\ndata: {"ignored":true}\n\n');
 let cancelled=false,i=0;
 const stream=new ReadableStream({pull(c){if(i<bytes.length)c.enqueue(bytes.slice(i,i+=1));else c.close();},cancel(){cancelled=true;}});
 const r=await probeBody(new Response(stream),true,new AbortController().signal);
 assert.deepEqual(JSON.parse(r.body),{text:'你好'});assert.equal(cancelled,true);
 const invalid=await probeBody(new Response('data: nope\n\ndata: {"ok":true}\n\n'),true,new AbortController().signal);assert.equal(invalid.body,'nope');
 const big=await probeBody(new Response('data: '+ 'x'.repeat(17000)+'\n\n'),true,new AbortController().signal);assert.equal(big.tooLarge,true);
 const first=await probeBody(new Response('data: {}\n\n'+'x'.repeat(20000)),true,new AbortController().signal);assert.equal(first.body,'{}');
 const abort=new AbortController();const pending=probeBody(new Response(new ReadableStream({pull(){}})),true,abort.signal);abort.abort();await assert.rejects(pending);
});

test('host help works without credentials and live ledger refuses unknown transfer shapes',async()=>{
 const {matchLive}=await import('../scripts/ledger-match.mjs');
 assert.equal((await main([],{})).ok,true);assert.equal((await main(['help'],{})).ok,true);
 assert.equal(matchLive({}, {items:[],next_cursor:null,has_more:false}).match,'none');
 assert.equal(matchLive({}, {items:[{amount:5}],next_cursor:null,has_more:false}).match,'unparseable');
 assert.equal(matchLive({}, {items:[],next_cursor:'txn_next',has_more:true}).match,'unparseable');
});
test('purchase planning enforces authorization, per-service/total limits, reserves and uncertain results',async()=>{
 const {purchasePlan,main:purchaseMain}=await import('../scripts/purchase.mjs');
 const f={authorization:{purchases_enabled:true,budget:90,expires_at:'2099-01-01T00:00:00Z'},request:{subject_id:'fixture',url:'https://public.example/data',amount:5,payee:'p_0123456789'},target:{url:'https://public.example/data',state:'active'},balance:100,unsettled_orders:2,events:[]};
 assert.equal(purchasePlan(f).ok,true);
 assert.equal(purchasePlan({...f,authorization:{...f.authorization,purchases_enabled:false}}).error.code,'purchase_not_authorized');
 assert.equal(purchasePlan({...f,request:{...f.request,amount:16}}).error.code,'single_purchase_limit');
 assert.equal(purchasePlan({...f,authorization:{...f.authorization,budget:4}}).error.code,'total_budget_limit');
 assert.equal(purchasePlan({...f,balance:24}).error.code,'reserve_violation');
 const e={operation_id:'a',state:'completed',amount:15,url:f.request.url,transaction_id:'txn_a'};
 assert.equal(purchasePlan({...f,events:[e]}).error.code,'service_purchase_limit');
 assert.equal(purchasePlan({...f,events:[{...e,state:'unknown'}]}).error.code,'unresolved_transfer');
 assert.equal(purchasePlan({...f,events:[e,{...e,operation_id:'b'}]}).error.code,'duplicate_transaction');
 assert.equal((await purchaseMain(['--execute'])).error.code,'live_transactions_disabled');
});
