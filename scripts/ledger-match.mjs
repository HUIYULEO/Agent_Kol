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
// Official OpenAPI names CreditTransfer but defines no fields, and the dev ledger was empty.
// Each field is read only when exactly one known name is present; anything else is
// unparseable, so an unrecognized ledger can never produce a match.
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
 const direction=payTo&&payee===payTo?'incoming':payTo&&payer===payTo?'outgoing':null;
 if(!direction)return {error:'parties'};
 // Incoming must be a positive integer; an outgoing amount may be signed.
 if(!Number.isSafeInteger(v.amount)||v.amount===0||direction==='incoming'&&v.amount<0)return {error:'amount'};
 return {row:{direction,transaction_id:v.transaction_id,amount:Math.abs(v.amount),payer:payer??'',payee:payee??'',memo:v.memo??'',observed_at:new Date(v.observed_at).toISOString()}};
}
const keysOf=item=>item&&typeof item==='object'?Object.keys(item).sort():[];
const unparseable=(reason,extra={})=>({match:'unparseable',reason,...extra});
function rowsOf(items,payTo){
 const rows=[];
 for(const item of items){const n=normalizeTransfer(item,payTo);if(n.error)return unparseable('credit_transfer_fields_unverified',{field:n.error,item_keys:keysOf(item)});rows.push(n.row);}
 return {rows};
}
// Evaluate one complete ledger payload ({items,next_cursor,has_more}).
export function matchLive(booking,payload){
 if(!payload||!Array.isArray(payload.items)||typeof payload.has_more!=='boolean'||!(payload.next_cursor===null||typeof payload.next_cursor==='string'))return unparseable('page_shape',{item_keys:keysOf(payload)});
 const r=rowsOf(payload.items,booking?.pay_to);if(r.match)return r;
 if(payload.has_more)return unparseable('incomplete_page');
 return r.rows.length?matchRows(booking,r.rows):{match:'none'};
}
// Windows cannot store SharedNet credentials, so it runs the pinned CLI inside WSL.
export function runSharednet(args,run=execFile){
 const cli=['-y','sharednet@0.1.8','--json',...args];
 const [cmd,argv]=process.platform==='win32'
 ?['wsl.exe',['-d','Ubuntu-20.04','--exec','env','PATH=/home/luhy/.local/share/agent-kol-node/node-v22.23.3-linux-x64/bin:/usr/bin:/bin','npx',...cli]]
 :['npx',cli];
 return new Promise(resolve=>run(cmd,argv,{timeout:45000,maxBuffer:4*1024*1024,windowsHide:true},(error,stdout)=>{
 if(error)return resolve({ok:false,code:error.code==='ENOENT'?'cli_not_found':'cli_failed'});
 try{resolve({ok:true,data:JSON.parse(stdout)});}catch{resolve({ok:false,code:'cli_invalid_output'});}
 }));
}
// Read pages until transfers predate the booking or the ledger ends; never guess past the page limit.
export async function readLive(booking,{run=runSharednet,maxPages=10,last=100}={}){
 const items=[],created=Date.parse(booking?.created_at);
 if(!Number.isFinite(created))return {match:'invalid_input'};
 let before;
 for(let page=1;page<=maxPages;page++){
 const r=await run(['ledger','--last',String(last),...(before?['--before',before]:[])]);
 if(!r.ok)return unparseable('ledger_read_failed',{cli:r.code});
 const p=r.data;
 if(!p||!Array.isArray(p.items)||typeof p.has_more!=='boolean')return unparseable('page_shape',{item_keys:keysOf(p)});
 const rows=rowsOf(p.items,booking.pay_to);if(rows.match)return rows;
 items.push(...p.items);
 const older=rows.rows.length>0&&rows.rows.every(row=>Date.parse(row.observed_at)<created);
 if(!p.has_more||older)return {payload:{items,next_cursor:null,has_more:false},pages:page};
 if(typeof p.next_cursor!=='string'||!TXN.test(p.next_cursor))return unparseable('next_cursor');
 before=p.next_cursor;
 }
 return unparseable('ledger_incomplete',{pages:maxPages});
}
function options(args,allowed){
 const o={};
 for(let i=0;i<args.length;i+=2){const k=args[i],v=args[i+1];if(!allowed.includes(k)||k in o||v===undefined)return null;o[k]=v;}
 return o;
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
 const o=options(args.slice(1),['--pay-to']);
 if(!o||!/^p_[A-Za-z0-9_-]+$/.test(o['--pay-to']??''))return {match:'invalid_arguments'};
 const r=await run(['ledger','--last','20']);
 if(!r.ok)return {schema:'ledger_unavailable',cli:r.code};
 if(!Array.isArray(r.data?.items))return {schema:'unparseable',item_keys:keysOf(r.data)};
 const rows=rowsOf(r.data.items,o['--pay-to']);
 if(rows.match)return {schema:'unparseable',field:rows.field,item_keys:rows.item_keys};
 return {schema:rows.rows.length?'recognized':'empty',items:rows.rows.length};
 }
 if(args[0]==='--live'){
 const o=options(args.slice(1),['--booking-file','--last','--evidence-out']);
 const last=o?.['--last']===undefined?100:Number(o['--last']);
 if(!o||!o['--booking-file']||!Number.isSafeInteger(last)||last<1||last>100)return {match:'invalid_arguments'};
 let booking;try{booking=await loadBooking(o['--booking-file']);}catch{return {match:'invalid_input'};}
 const live=await readLive(booking,{run,last});
 if(live.match)return live;
 const {evidence,...result}=matchLive(booking,live.payload);
 if(result.match==='unique'&&o['--evidence-out']){try{await write(o['--evidence-out'],JSON.stringify(evidence)+'\n');}catch{return {match:'evidence_write_failed'};}}
 return {...result,...(evidence?{evidence}:{}),pages:live.pages};
 }
 return {match:'invalid_arguments'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));
 if(!['unique','none'].includes(result.match)&&!['recognized','empty'].includes(result.schema))process.exitCode=1;
}
