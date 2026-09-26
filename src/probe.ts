import {HttpError,onlyKeys,text} from './http';
import type {Env} from './types';

// Exact administrator-configured public URLs. No arbitrary origins, credentials,
// query strings, ports, fragments, redirects, headers, or request bodies.
export function allowedUrl(value:unknown,env:Env):string {
 const raw=text(value,'url',1000);
 let u:URL;try{u=new URL(raw);}catch{throw new HttpError(400,'invalid_url','Invalid URL.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||
 !/^[a-z0-9.-]+$/.test(u.hostname)||!u.hostname.includes('.')||
 /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||/^[\d.]+$/.test(u.hostname)||
 !/^[a-zA-Z0-9/_.~-]*$/.test(u.pathname))
 throw new HttpError(400,'unsafe_url','Only approved public HTTPS URLs are supported.');
 const allow=(env.PROBE_ALLOWED_URLS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!allow.includes(u.href))throw new HttpError(403,'probe_not_allowed','URL is not in the deployment allowlist.');
 return u.href;
}
export function redact(value:string):string {
 return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[REDACTED_EMAIL]')
 .replace(/\b(?:Bearer|Basic)\s+[^\s"<>]+/gi,'[REDACTED_AUTH]')
 .replace(/((?:api[_-]?key|token|secret|password|authorization|cookie)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,'$1[REDACTED]')
 .replace(/\b[A-Za-z0-9_\/-]{24,}(?:\.[A-Za-z0-9_-]+){0,2}\b/g,'[REDACTED_VALUE]');
}
function cleanJson(value:unknown,state:{truncated:boolean},depth=0):unknown {
 if(depth>12){state.truncated=true;return '[TRUNCATED_DEPTH]';}
 if(typeof value==='string'){const safe=redact(value);if(safe.length>2048)state.truncated=true;return safe.slice(0,2048);}
 if(Array.isArray(value)){if(value.length>40)state.truncated=true;return value.slice(0,40).map(v=>cleanJson(v,state,depth+1));}
 if(value&&typeof value==='object'){if(Object.keys(value).length>40)state.truncated=true;return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[
 redact(k),/token|secret|password|auth|cookie|key|email|address|phone|ip/i.test(k)?'[REDACTED]':cleanJson(v,state,depth+1)]));}
 return value;
}
export interface ProbeRecord {probe_id:string;subject_id:string;method:string;url:string;status:number|null;latency_ms:number;response_excerpt:string;at:string;outcome:string;truncated:boolean;reproduce_cmd:string;}
export async function runProbe(env:Env,input:Record<string,unknown>,fetcher:typeof fetch=fetch) {
 onlyKeys(input,['subject_id','url']);
 const subject=text(input.subject_id,'subject_id',100);
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(subject))throw new HttpError(400,'invalid_input','Invalid subject_id.');
 const url=allowedUrl(input.url,env),id='prb_'+crypto.randomUUID(),at=new Date().toISOString();
 if(await env.DB.prepare('SELECT review_id FROM reviews WHERE subject_id=?').bind(subject).first())
 throw new HttpError(409,'review_exists','This subject is already published.');
 try{
 const r=await env.DB.prepare(`INSERT INTO probes(probe_id,subject_id,slot,state,created_at)
 SELECT ?,?,COUNT(*)+1,'pending',? FROM probes WHERE subject_id=? HAVING COUNT(*)<5`).bind(id,subject,at,subject).run();
 if(!r.meta.changes)throw new HttpError(409,'probe_limit','At most five probes per subject.');
 }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(409,'probe_conflict','Probe reservation conflict. Retry.');}
 const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 let status:number|null=null,outcome='network_error',excerpt='',truncated=false;
 try{
 const response=await fetcher(url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json'}});
 status=response.status;
 if(status>=300&&status<400){outcome='redirect_blocked';await response.body?.cancel();}
 else if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){
 outcome='unsupported_content';await response.body?.cancel();
 }else{
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
 if(size>16384){truncated=true;await reader.cancel();break;}chunks.push(value);}}finally{reader.releaseLock();}
 if(truncated){outcome='response_too_large';excerpt='[Response exceeded 16 KiB; body omitted]';}
 else{
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const state={truncated:false};const safe=JSON.stringify(cleanJson(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)),state));
 truncated=state.truncated||safe.length>2048;excerpt=safe.slice(0,2048);outcome='observed';}
 catch{outcome='invalid_json';excerpt='[Invalid JSON body omitted]';}
 }
 }
 }catch{outcome=controller.signal.aborted?'timeout':'network_error';}
 finally{clearTimeout(timer);}
 const record:ProbeRecord={probe_id:id,subject_id:subject,method:'GET',url,status,latency_ms:Date.now()-started,response_excerpt:excerpt,at,outcome,truncated,reproduce_cmd:"curl --proto '=https' --max-time 5 --max-redirs 0 '"+url+"'"};
 await env.DB.prepare("UPDATE probes SET state='complete',record=? WHERE probe_id=?").bind(JSON.stringify(record),id).run();
 return record;
}
export async function probeEvidence(env:Env,subject:string,ids:unknown) {
 if(!Array.isArray(ids)||!ids.length||ids.length>5||new Set(ids).size!==ids.length)
 throw new HttpError(400,'invalid_evidence','Provide 1–5 unique probe_ids.');
 const records:ProbeRecord[]=[];
 for(const id of ids){
 const row=await env.DB.prepare("SELECT record FROM probes WHERE probe_id=? AND subject_id=? AND state='complete'").bind(text(id,'probe_id',100),subject).first<{record:string}>();
 if(!row)throw new HttpError(400,'invalid_evidence','Probe is incomplete or belongs to another subject.');
 records.push(JSON.parse(row.record));
 }
 return records;
}
