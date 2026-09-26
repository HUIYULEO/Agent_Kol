import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const production='https://agent-kol.roeu1996.workers.dev';
class HostError extends Error {constructor(code,status=0,details={}){super(code);this.code=code;this.status=status;this.details=details;}}
function parse(args){
 const [command,...rest]=args,positionals=[],options={};
 const flags=new Set(['confirm-public','confirm-safe','accept-mcp']);
 const values=new Set(['status','reason','evidence-file','url','source-kind','source-ref','subject','post-body-file','file']);
 for(let i=0;i<rest.length;i++){const item=rest[i];if(!item.startsWith('--')){positionals.push(item);continue;}
 const key=item.slice(2);if(key in options||(!flags.has(key)&&!values.has(key)))throw new HostError('invalid_arguments');
 if(flags.has(key))options[key]=true;else{const v=rest[++i];if(!v||v.startsWith('--'))throw new HostError('invalid_arguments');options[key]=v;}}
 return {command,positionals,options};
}
export async function runHost(args,{token,base=production,send=fetch,load=readFile}={}){
 try{
 const {command:c,positionals:p,options:o}=parse(args);
 const contracts={bookings:[0,['status']],booking:[1,[]],'open-window':[1,[]],'mark-paid':[1,['evidence-file']],'set-status':[2,['reason']],
 'approve-target':[0,['url','source-kind','source-ref','confirm-public','confirm-safe']],'revoke-target':[0,['url','reason']],probe:[0,['subject','url','post-body-file','accept-mcp']],publish:[0,['file']],stats:[0,[]]};
 if(!contracts[c]||p.length!==contracts[c][0]||Object.keys(o).some(k=>!contracts[c][1].includes(k)))throw new HostError('invalid_arguments');
 const u=new URL(base);
 if(u.origin!==production&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new HostError('untrusted_base_url');
 if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new HostError('untrusted_base_url');
 if(typeof token!=='string'||token.length<32)throw new HostError('admin_token_required');
 const safe=v=>JSON.parse(JSON.stringify(v,(_k,value)=>typeof value==='string'?value.replaceAll(token,'[REDACTED_ADMIN_TOKEN]'):value));
 const call=async(path,data)=>{
 let r;try{r=await send(u.origin+path,{method:data===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});}catch{throw new HostError('network_error');}
 let body;try{body=await r.json();}catch{throw new HostError('invalid_response',r.status);}
 if(!r.ok){const code=body?.error?.code;throw new HostError(typeof code==='string'&&!code.includes(token)&&/^[a-z0-9_]{1,64}$/.test(code)?code:'http_error',r.status);}
 return safe(body);
 };
 const file=async name=>{if(!name)throw new HostError('file_required');try{const raw=await load(name,'utf8');if(Buffer.byteLength(raw)>32768)throw Error();const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new HostError('invalid_input_file');}};
 const required=(name)=>{if(!o[name])throw new HostError('missing_'+name.replaceAll('-','_'));return o[name];};
 let data;
 if(c==='bookings')data=await call('/admin/bookings'+(o.status?'?status='+encodeURIComponent(o.status):''));
 else if(c==='stats')data=await call('/reviews/stats');
 else if(['booking','open-window','mark-paid','set-status'].includes(c)){
 const id=p[0];if(!/^bk_[a-f0-9-]{36}$/.test(id))throw new HostError('invalid_booking_id');
 let evidence;
 if(c==='mark-paid'){evidence=await file(required('evidence-file'));if(evidence.method!=='ledger_attested'||evidence.simulation_only||evidence.match||Object.keys(evidence).some(k=>!['method','transaction_id','amount','payer','payee','memo','observed_at'].includes(k)))throw new HostError('ledger_evidence_required');}
 if(c==='set-status'&&!['testing','failed','cancelled','payment_ambiguous','pending_payment'].includes(p[1]))throw new HostError('status_not_supported');
 const current=await call('/admin/bookings/'+id);
 if(c==='booking')data=current;
 else{
 const update={expected_version:current.booking.version,status:c==='open-window'?'awaiting_payment':c==='mark-paid'?'paid':p[1],
 ...(c==='open-window'?{received_baseline:0}:{}),...(evidence?{payment_evidence:evidence}:{}),...(o.reason?{reason:o.reason}:{})};
 try{data=await call('/admin/bookings/'+id+'/status',update);}catch(e){
 if(e.status===409){let latest;try{const r=await call('/admin/bookings/'+id);latest={status:r.booking.status,version:r.booking.version};}catch{latest=null;}
 throw new HostError(e.code,409,{latest,retried:false});}throw e;}
 }
 }else if(c==='approve-target'){
 if(!o['confirm-public']||!o['confirm-safe'])throw new HostError('review_confirmation_required');
 data=await call('/admin/probe-targets',{url:required('url'),source_kind:required('source-kind'),source_ref:required('source-ref'),publicly_provided:true,reviewed_safe:true});
 }else if(c==='revoke-target')data=await call('/admin/probe-targets/revoke',{url:required('url'),reason:required('reason')});
 else if(c==='probe')data=await call('/admin/probe',{subject_id:required('subject'),url:required('url'),...(o['post-body-file']?{method:'POST',body:await file(o['post-body-file'])}:{}),...(o['accept-mcp']?{accept_mcp:true}:{})});
 else if(c==='publish')data=await call('/admin/reviews',await file(required('file')));
 return {ok:true,data};
 }catch(e){return {ok:false,status:e instanceof HostError?e.status:0,error:{code:e instanceof HostError?e.code:'local_error'},...(e instanceof HostError?e.details:{})};}
}
export async function main(args,env=process.env){
 try{
 if(!env.ADMIN_TOKEN_FILE)return {ok:false,status:0,error:{code:'admin_token_file_required'}};
 const raw=await readFile(env.ADMIN_TOKEN_FILE,'utf8');
 const token=raw.split(/\r?\n/).find(s=>s.startsWith('ADMIN_TOKEN='))?.slice(12);
 if(!token)return {ok:false,status:0,error:{code:'admin_token_file_invalid'}};
 return await runHost(args,{token,base:env.HOST_BASE_URL||production});
 }catch{return {ok:false,status:0,error:{code:'admin_token_file_unavailable'}};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
