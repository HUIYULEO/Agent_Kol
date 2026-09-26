import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
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
 return {match:'read_records',records:payload.items,has_more:payload.has_more,
  expect:{payee:booking?.pay_to??null,amount:booking?.price??null},
  note:'Field names are undocumented, so read each record yourself. Mark paid only when exactly one record shows our principal as the recipient for the expected amount, then write that record into an evidence file for host.mjs mark-paid. If no record or more than one fits, do not mark paid.'};
}
export async function readLiveLedger(last=100,run=promisify(execFile)){
 if(!Number.isSafeInteger(last)||last<1||last>100)throw Error('invalid_limit');
 const args=['ledger','--last',String(last)];
 const result=process.platform==='win32'
 ?await run('wsl.exe',['-d','Ubuntu-20.04','--exec','env','PATH=/home/luhy/.local/share/agent-kol-node/node-v22.23.3-linux-x64/bin:/usr/bin:/bin','npx','-y','sharednet@0.1.8',...args],{timeout:45000,maxBuffer:262144,windowsHide:true})
 :await run('npx',['-y','sharednet@0.1.8',...args],{timeout:45000,maxBuffer:262144});
 return JSON.parse(result.stdout);
}
export async function main(args){
 if(args[0]==='--live'&&args[1]==='--booking-file'&&args[2]&&(args.length===3||args.length===5&&args[3]==='--last')){
 try{const booking=JSON.parse(await readFile(args[2],'utf8'));return matchLive(booking,await readLiveLedger(args[4]===undefined?100:Number(args[4])));}catch{return {match:'unparseable',reason:'ledger_read_failed'};}
 }
 if(args.length!==5||args[0]!=='--fixture'||args[1]!=='--booking-file'||args[3]!=='--ledger-file')return {simulation_only:true,match:'invalid_arguments'};
 try{return matchFixture(JSON.parse(await readFile(args[2],'utf8')),JSON.parse(await readFile(args[4],'utf8')));}catch{return {simulation_only:true,match:'invalid_input'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(!['unique','none','read_records'].includes(result.match))process.exitCode=1;}
