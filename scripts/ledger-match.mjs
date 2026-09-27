import {main as hostMain} from './host.mjs';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
// Canonical FIXTURE format, deliberately not an adapter for an unverified live ledger.
export function matchFixture(booking,rows){
 const result=(match,extra={})=>({simulation_only:true,match,...extra});
 if(!booking||!/^bk_[a-f0-9-]{36}$/.test(booking.booking_id??'')||!booking.seller_payee_id||!booking.pay_to||!Number.isSafeInteger(booking.price)||booking.price<=0||!Array.isArray(rows))return result('invalid_input');
 const opened=Date.parse(booking.payment_opened_at), deadline=Date.parse(booking.payment_deadline);
 if(!Number.isFinite(opened)||!Number.isFinite(deadline)||opened>deadline)return result('invalid_input');
 const ids=new Set();
 for(const r of rows){
 if(!r||r.direction!=='incoming'&&r.direction!=='outgoing'||typeof r.transaction_id!=='string'||!r.transaction_id||ids.has(r.transaction_id)||!Number.isSafeInteger(r.amount)||r.amount<=0||![r.payer,r.payee,r.memo,r.observed_at].every(v=>typeof v==='string')||!Number.isFinite(Date.parse(r.observed_at)))return result('invalid_input');
 ids.add(r.transaction_id);
 }
 const candidates=rows.filter(r=>r.direction==='incoming'&&r.payer===booking.seller_payee_id&&r.payee===booking.pay_to&&Date.parse(r.observed_at)>=opened&&Date.parse(r.observed_at)<=deadline);
 if(candidates.length>1)return result('multiple');
 if(!candidates.length)return result('none');
 if(candidates[0].amount!==booking.price)return result('amount_mismatch');
 const {direction,...evidence}=candidates[0];return result('unique',{fixture_evidence:{method:'ledger_attested',...evidence}});
}

// Official OpenAPI names CreditTransfer but provides no field schema, so this does not
// map fields. It hands the raw records to the host, who reads them and decides.
export function matchLive(booking,payload){
 if(!payload||!Array.isArray(payload.items)||typeof payload.has_more!=='boolean'||!(payload.next_cursor===null||typeof payload.next_cursor==='string'))return {match:'unparseable'};
 if(!payload.items.length)return payload.has_more?{match:'unparseable',reason:'incomplete_page'}:{match:'none'};
 return {match:'read_records',records:payload.items,has_more:payload.has_more,next_cursor:payload.next_cursor,
  expect:{payee:booking?.pay_to??null,amount:booking?.price??null},
  note:'Field names are undocumented, so read each record yourself. These records are not verified evidence. Follow next_cursor using host.mjs ledger --before until relevant pages are read. Match recipient, amount, payer principal and the room request; do not infer missing fields or use balance deltas. Direct reviews use subject_id and payment_evidence; mark-paid is only for legacy bookings.'};
}
export async function readLiveLedger(last=100,run=hostMain){
 if(!Number.isSafeInteger(last)||last<1||last>100)throw Error('invalid_limit');
 const result=await run(['ledger','--limit',String(last)]);
 if(!result.ok)throw Error('ledger_read_failed');
 return result.data;
}
export async function main(args){
 if(args[0]==='--live'&&args[1]==='--booking-file'&&args[2]&&(args.length===3||args.length===5&&args[3]==='--last')){
 try{const booking=JSON.parse(await readFile(args[2],'utf8'));return matchLive(booking,await readLiveLedger(args[4]===undefined?100:Number(args[4])));}catch{return {match:'unparseable',reason:'ledger_read_failed'};}
 }
 if(args.length!==5||args[0]!=='--fixture'||args[1]!=='--booking-file'||args[3]!=='--ledger-file')return {simulation_only:true,match:'invalid_arguments'};
 try{return matchFixture(JSON.parse(await readFile(args[2],'utf8')),JSON.parse(await readFile(args[4],'utf8')));}catch{return {simulation_only:true,match:'invalid_input'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(!['unique','none','read_records'].includes(result.match))process.exitCode=1;}
