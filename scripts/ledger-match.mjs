import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
function matchRows(booking,rows){
 if(!booking||!/^bk_[a-f0-9-]{36}$/.test(booking.booking_id??'')||!booking.seller_payee_id||!booking.pay_to||!Number.isSafeInteger(booking.price)||booking.price<=0||!Array.isArray(rows))return {match:'invalid_input'};
 const ids=new Set();
 for(const r of rows){
 if(!r||r.direction!=='incoming'&&r.direction!=='outgoing'||typeof r.transaction_id!=='string'||!r.transaction_id||ids.has(r.transaction_id)||!Number.isSafeInteger(r.amount)||r.amount<=0||![r.payer,r.payee,r.memo,r.observed_at].every(v=>typeof v==='string')||!Number.isFinite(Date.parse(r.observed_at)))return {match:'invalid_input'};
 ids.add(r.transaction_id);
 }
 const candidates=rows.filter(r=>r.direction==='incoming'&&r.payer===booking.seller_payee_id&&r.payee===booking.pay_to&&r.memo===booking.booking_id);
 if(candidates.length>1)return {match:'multiple'};
 if(!candidates.length)return {match:'none'};
 if(candidates[0].amount!==booking.price)return {match:'amount_mismatch'};
 const {direction,...evidence}=candidates[0];return {match:'unique',evidence:{method:'ledger_attested',...evidence}};
}
// Canonical FIXTURE format, deliberately not an adapter for an unverified live ledger.
export function matchFixture(booking,rows){
 const {evidence,...result}=matchRows(booking,rows);
 return {simulation_only:true,...result,...(evidence?{fixture_evidence:evidence}:{})};
}
// The transfer item schema has not been observed yet (the ledger was empty). Each field is
// read only when exactly one known name is present; anything else is schema_unknown, so an
// unrecognized ledger can never produce a match.
const FIELDS={
 transaction_id:['id','transfer_id','transaction_id'],amount:['amount','credits'],
 payer:['from','from_principal_id','from_id','sender','payer'],payee:['to','to_principal_id','to_id','recipient','payee'],
 memo:['memo','note'],observed_at:['created_at','timestamp','occurred_at','at']
};
const TXN=/^txn_[0-9A-Za-z]{10}$/;
function field(item,name){
 const present=FIELDS[name].filter(k=>Object.hasOwn(item,k));
 if(present.length===1)return {ok:true,value:item[present[0]]};
 return {ok:name==='memo'&&!present.length,value:null};
}
function principal(value){
 if(value===null||typeof value==='string')return value;
 if(value&&typeof value==='object'){const ids=['id','principal_id'].filter(k=>typeof value[k]==='string');if(ids.length===1)return value[ids[0]];}
 return undefined;
}
export function normalizeTransfer(item,payTo){
 if(!item||typeof item!=='object'||Array.isArray(item))return {error:'item'};
 const v={};
 for(const name of Object.keys(FIELDS)){const f=field(item,name);if(!f.ok)return {error:name};v[name]=f.value;}
 const payer=principal(v.payer),payee=principal(v.payee);
 if(typeof v.transaction_id!=='string'||!TXN.test(v.transaction_id))return {error:'transaction_id'};
 if(payer===undefined)return {error:'payer'};if(payee===undefined)return {error:'payee'};
 if(v.memo!==null&&typeof v.memo!=='string')return {error:'memo'};
 if(typeof v.observed_at!=='string'||!Number.isFinite(Date.parse(v.observed_at)))return {error:'observed_at'};
 const direction=payee===payTo?'incoming':payer===payTo?'outgoing':null;
 if(!direction)return {error:'parties'};
 // Incoming must be a positive integer; an outgoing amount may be signed.
 if(!Number.isSafeInteger(v.amount)||v.amount===0||direction==='incoming'&&v.amount<0)return {error:'amount'};
 return {row:{direction,transaction_id:v.transaction_id,amount:Math.abs(v.amount),payer:payer??'',payee:payee??'',memo:v.memo??'',observed_at:new Date(v.observed_at).toISOString()}};
}
const keysOf=item=>item&&typeof item==='object'?Object.keys(item).sort():[];
export function runSharednet(args){
 if(process.platform==='win32')return Promise.resolve({ok:false,code:'run_in_wsl'});
 return new Promise(resolve=>execFile('sharednet',['--json',...args],{timeout:20000,maxBuffer:4*1024*1024,windowsHide:true},(error,stdout)=>{
 if(error)return resolve({ok:false,code:error.code==='ENOENT'?'cli_not_found':'cli_failed'});
 try{resolve({ok:true,data:JSON.parse(stdout)});}catch{resolve({ok:false,code:'cli_invalid_output'});}
 }));
}
// Read pages until the ledger reaches transfers older than the booking; never guess past a page limit.
export async function readLive(booking,{run=runSharednet,maxPages=10}={}){
 const rows=[],created=Date.parse(booking?.created_at);
 if(!Number.isFinite(created))return {match:'invalid_input'};
 let before;
 for(let page=1;page<=maxPages;page++){
 const r=await run(['ledger','--last','100',...(before?['--before',before]:[])]);
 if(!r.ok)return {match:'ledger_unavailable',reason:r.code};
 const {items,has_more:more,next_cursor:cursor}=r.data??{};
 if(!Array.isArray(items)||typeof more!=='boolean')return {match:'schema_unknown',field:'page',item_keys:keysOf(r.data)};
 let older=items.length>0;
 for(const item of items){
 const n=normalizeTransfer(item,booking.pay_to);if(n.error)return {match:'schema_unknown',field:n.error,item_keys:keysOf(item)};
 rows.push(n.row);if(Date.parse(n.row.observed_at)>=created)older=false;
 }
 if(!more||older)return {rows,pages:page};
 if(typeof cursor!=='string'||!TXN.test(cursor))return {match:'schema_unknown',field:'next_cursor',item_keys:keysOf(r.data)};
 before=cursor;
 }
 return {match:'ledger_incomplete',pages:maxPages};
}
async function loadBooking(path){
 const raw=JSON.parse(await readFile(path,'utf8'));
 return raw?.ok===true&&raw.data?.booking?raw.data.booking:raw;
}
export async function main(args,{run=runSharednet,write=writeFile}={}){
 if(args[0]==='--fixture'){
 if(args.length!==5||args[1]!=='--booking-file'||args[3]!=='--ledger-file')return {simulation_only:true,match:'invalid_arguments'};
 try{return matchFixture(JSON.parse(await readFile(args[2],'utf8')),JSON.parse(await readFile(args[4],'utf8')));}catch{return {simulation_only:true,match:'invalid_input'};}
 }
 if(args[0]==='--check'){
 if(args.length!==3||args[1]!=='--pay-to'||!/^p_[A-Za-z0-9_-]+$/.test(args[2]))return {match:'invalid_arguments'};
 const r=await run(['ledger','--last','20']);
 if(!r.ok)return {schema:'ledger_unavailable',reason:r.code};
 const items=r.data?.items;
 if(!Array.isArray(items))return {schema:'schema_unknown',field:'page',item_keys:keysOf(r.data)};
 for(const item of items){const n=normalizeTransfer(item,args[2]);if(n.error)return {schema:'schema_unknown',field:n.error,item_keys:keysOf(item)};}
 return {schema:items.length?'recognized':'empty',items:items.length};
 }
 if(args[0]==='--live'){
 if(args.length!==3&&args.length!==5||args[1]!=='--booking-file'||args.length===5&&args[3]!=='--evidence-out')return {match:'invalid_arguments'};
 let booking;try{booking=await loadBooking(args[2]);}catch{return {match:'invalid_input'};}
 const live=await readLive(booking,{run});
 if(live.match)return live;
 const result=matchRows(booking,live.rows);
 if(result.match==='unique'&&args[4]){try{await write(args[4],JSON.stringify(result.evidence)+'\n');}catch{return {match:'evidence_write_failed'};}}
 return {...result,pages:live.pages};
 }
 return {match:'invalid_arguments'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(result.match!=='unique'&&result.schema!=='recognized'&&result.schema!=='empty')process.exitCode=1;}
