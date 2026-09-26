import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
// Canonical FIXTURE format, deliberately not an adapter for an unverified live ledger.
export function matchFixture(booking,rows){
 const result=(match,extra={})=>({simulation_only:true,match,...extra});
 if(!booking||!/^bk_[a-f0-9-]{36}$/.test(booking.booking_id??'')||!booking.seller_payee_id||!booking.pay_to||!Number.isSafeInteger(booking.price)||booking.price<=0||!Array.isArray(rows))return result('invalid_input');
 const ids=new Set();
 for(const r of rows){
 if(!r||r.direction!=='incoming'&&r.direction!=='outgoing'||typeof r.transaction_id!=='string'||!r.transaction_id||ids.has(r.transaction_id)||!Number.isSafeInteger(r.amount)||r.amount<=0||![r.payer,r.payee,r.memo,r.observed_at].every(v=>typeof v==='string')||!Number.isFinite(Date.parse(r.observed_at)))return result('invalid_input');
 ids.add(r.transaction_id);
 }
 const candidates=rows.filter(r=>r.direction==='incoming'&&r.payer===booking.seller_payee_id&&r.payee===booking.pay_to&&r.memo===booking.booking_id);
 if(candidates.length>1)return result('multiple');
 if(!candidates.length)return result('none');
 if(candidates[0].amount!==booking.price)return result('amount_mismatch');
 const {direction,...evidence}=candidates[0];return result('unique',{fixture_evidence:{method:'ledger_attested',...evidence}});
}
export async function main(args){
 if(args.length!==5||args[0]!=='--fixture'||args[1]!=='--booking-file'||args[3]!=='--ledger-file')return {simulation_only:true,match:'invalid_arguments'};
 try{return matchFixture(JSON.parse(await readFile(args[2],'utf8')),JSON.parse(await readFile(args[4],'utf8')));}catch{return {simulation_only:true,match:'invalid_input'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(result.match!=='unique')process.exitCode=1;}
