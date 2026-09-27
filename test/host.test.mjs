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

test('host help works without credentials and live ledger hands raw records to the host',async()=>{
 const {matchLive}=await import('../scripts/ledger-match.mjs');
 assert.equal((await main([],{})).ok,true);assert.equal((await main(['help'],{})).ok,true);
 assert.equal(matchLive({}, {items:[],next_cursor:null,has_more:false}).match,'none');
 assert.equal(matchLive({}, {items:[],next_cursor:'txn_next',has_more:true}).match,'unparseable');
 assert.equal(matchLive({}, {items:'not-an-array',next_cursor:null,has_more:false}).match,'unparseable');
 // Field names are undocumented, so records are surfaced verbatim rather than mapped.
 const record={id:'txn_9',from:'p_buyer0001',to:'p_umBqZvkim8',amount:5,memo:'TeamX'};
 const live=matchLive({pay_to:'p_umBqZvkim8',price:5},{items:[record],next_cursor:null,has_more:false});
 assert.equal(live.match,'read_records');
 assert.deepEqual(live.records,[record]);
 assert.deepEqual(live.expect,{payee:'p_umBqZvkim8',amount:5});
 // No mapping is invented, so nothing is reported as a confirmed match.
 assert.equal(live.fixture_evidence,undefined);
 assert.equal(matchLive(undefined,{items:[record],next_cursor:null,has_more:false}).expect.payee,null);
});


test('live ledger routes through the admin CLI without local WSL execution',async()=>{
 const {readLiveLedger}=await import('../scripts/ledger-match.mjs');let seen;
 const page={items:[],has_more:false,next_cursor:null};
 assert.deepEqual(await readLiveLedger(3,async args=>{seen=args;return {ok:true,data:page};}),page);
 assert.deepEqual(seen,['ledger','--limit','3']);
 await assert.rejects(readLiveLedger(101));
 const calls=[];
 const result=await runHost(['ledger','--limit','2','--before','txn_next'],{token,send:async(url,o)=>{calls.push({url,method:o.method});return Response.json(page);}});
 assert.equal(result.ok,true);assert.equal(calls[0].method,'GET');assert.match(calls[0].url,/admin\/ledger\?limit=2&before=txn_next/);
});
