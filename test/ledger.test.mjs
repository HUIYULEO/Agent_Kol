import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main,normalizeTransfer} from '../scripts/ledger-match.mjs';
let file;
const id='bk_00000000-0000-0000-0000-000000000001';
const booking={booking_id:id,seller_payee_id:'p_seller',pay_to:'p_host',price:5,created_at:'2026-09-27T13:00:00.000Z'};
const item=(extra={})=>({id:'txn_AbCdEfGh01',amount:5,from:'p_seller',to:'p_host',memo:id,created_at:'2026-09-27T13:01:00.000Z',...extra});
const page=(items,more=false,cursor=null)=>({ok:true,data:{items,has_more:more,next_cursor:cursor}});
const live=async(pages,extra=[])=>{const calls=[],written={};let i=0;
 const result=await main(['--live','--booking-file',file,...extra],{run:async args=>{calls.push(args);return pages[i++]??{ok:false,code:'cli_failed'};},write:async(p,v)=>{written[p]=v;}});
 return {result,calls,written};};
// main reads the booking file from disk, so each test writes one to a temporary directory.
const withBooking=async(fn,b=booking)=>{const dir=await mkdtemp(join(tmpdir(),'ledger-'));file=join(dir,'booking.json');await writeFile(file,JSON.stringify(b));try{return await fn();}finally{await rm(dir,{recursive:true,force:true});}};
test('live ledger: unique match writes evidence accepted by host mark-paid, without simulation flag',()=>withBooking(async()=>{
 const {result,calls,written}=await live([page([item()])],['--evidence-out','e.json']);
 assert.equal(result.match,'unique');assert.equal(result.simulation_only,undefined);
 assert.deepEqual(calls[0],['ledger','--last','100']);
 const evidence=JSON.parse(written['e.json']);
 assert.deepEqual(Object.keys(evidence).sort(),['amount','memo','method','observed_at','payee','payer','transaction_id']);
 assert.equal(evidence.method,'ledger_attested');assert.equal(evidence.transaction_id,'txn_AbCdEfGh01');
}));
test('live ledger: accepts host.mjs booking output and nested principal objects',()=>withBooking(async()=>{
 const {result}=await live([page([item({from:{id:'p_seller'},to:{principal_id:'p_host'}})])]);
 assert.equal(result.match,'unique');
},{ok:true,data:{booking}}));
test('live ledger returns unparseable on unknown or ambiguous schemas',()=>withBooking(async()=>{
 for(const [bad,fieldName] of [[{sender_account:'p_seller',from:undefined},'payer'],[{transfer_id:'txn_AbCdEfGh02'},'transaction_id'],[{amount:'5'},'amount'],[{amount:-5},'amount'],[{id:'5'},'transaction_id'],[{created_at:'yesterday'},'observed_at'],[{to:'p_someone_else'},'parties']]){
  const i=item(bad);for(const k of Object.keys(i))if(i[k]===undefined)delete i[k];
  const {result}=await live([page([i])]);
  assert.equal(result.match,'unparseable',JSON.stringify(bad));assert.equal(result.field,fieldName);
  assert.ok(result.item_keys.every(k=>typeof k==='string'));assert.ok(!JSON.stringify(result).includes('p_seller'));
 }
 assert.equal((await live([{ok:true,data:{transfers:[]}}])).result.reason,'page_shape');
}));
test('live ledger: grants, outgoing and signed amounts are tolerated but never match',()=>withBooking(async()=>{
 const grant=item({id:'txn_Grant00001',amount:100,from:null,memo:null});
 const spend=item({id:'txn_Spend00001',amount:-15,from:'p_host',to:'p_other',memo:'buy'});
 assert.equal((await live([page([grant,spend])])).result.match,'none');
 assert.equal((await live([page([grant,spend,item()])])).result.match,'unique');
 assert.equal((await live([page([item(),item({id:'txn_AbCdEfGh02'})])])).result.match,'multiple');
 assert.equal((await live([page([item({amount:4})])])).result.match,'amount_mismatch');
}));
test('live ledger paginates with --before, stops at older transfers and never guesses past the limit',()=>withBooking(async()=>{
 const old=item({id:'txn_Old0000001',from:'p_x',memo:'x',created_at:'2026-09-27T12:00:00.000Z'});
 const {result,calls}=await live([page([item({id:'txn_New0000001',from:'p_x',memo:'x'})],true,'txn_New0000001'),page([item()],true,'txn_AbCdEfGh01'),page([old],true,'txn_Old0000001')]);
 assert.equal(result.match,'unique');assert.equal(result.pages,3);assert.deepEqual(calls[1],['ledger','--last','100','--before','txn_New0000001']);
 assert.equal((await live([page([item({from:'p_x'})],true,'bad-cursor')])).result.reason,'next_cursor');
 const endless=Array.from({length:12},(_,n)=>page([item({id:'txn_Loop'+String(n).padStart(6,'0'),from:'p_x'})],true,'txn_Loop'+String(n).padStart(6,'0')));
 assert.equal((await live(endless)).result.reason,'ledger_incomplete');
 assert.equal((await live([{ok:false,code:'cli_not_found'}])).result.cli,'cli_not_found');
}));
test('check mode reports schema recognition without matching',async()=>{
 assert.equal((await main(['--check','--pay-to','p_host'],{run:async()=>page([])})).schema,'empty');
 assert.equal((await main(['--check','--pay-to','p_host'],{run:async()=>page([item()])})).schema,'recognized');
 assert.equal((await main(['--check','--pay-to','p_host'],{run:async()=>page([{weird:1}])})).schema,'unparseable');
 assert.equal((await main(['--check'])).match,'invalid_arguments');
 assert.equal(normalizeTransfer(item(),'p_host').row.direction,'incoming');
});
test('runner pins sharednet@0.1.8 with --json and reports CLI failures without output',async()=>{
 const {runSharednet}=await import('../scripts/ledger-match.mjs');
 let seen;
 const ok=await runSharednet(['ledger','--last','5'],(cmd,argv,opts,cb)=>{seen={cmd,argv,opts};cb(null,'{"items":[],"next_cursor":null,"has_more":false}');});
 assert.equal(ok.ok,true);assert.equal(seen.cmd,process.platform==='win32'?'wsl.exe':'npx');
 assert.deepEqual(seen.argv.slice(-6),['-y','sharednet@0.1.8','--json','ledger','--last','5']);
 assert.equal((await runSharednet([],(c,a,o,cb)=>cb(Object.assign(Error('x'),{code:'ENOENT'}),''))).code,'cli_not_found');
 assert.equal((await runSharednet([],(c,a,o,cb)=>cb(null,'not json'))).code,'cli_invalid_output');
});
