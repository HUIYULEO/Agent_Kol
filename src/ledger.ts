import {HttpError} from './http';
import type {Env} from './types';
export async function readLedger(env:Env,query:URL) {
 if(!env.SHAREDNET_API_KEY)throw new HttpError(503,'ledger_not_configured','SharedNet ledger credential is not configured.');
 const limit=Number(query.searchParams.get('limit')??'100'),before=query.searchParams.get('before');
 if(!Number.isInteger(limit)||limit<1||limit>100||(before!==null&&!/^txn_[A-Za-z0-9_-]{1,200}$/.test(before)))throw new HttpError(400,'invalid_input','Invalid ledger limit or before cursor.');
 const url=new URL('https://www.sharednet.ai/api/v1/credits/transfers');
 url.searchParams.set('limit',String(limit));if(before)url.searchParams.set('before',before);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try {
 const response=await fetch(url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+env.SHAREDNET_API_KEY,Accept:'application/json'}});
 if(!response.ok)throw new HttpError(502,'ledger_upstream_error','SharedNet ledger request failed.');
 reader=response.body?.getReader();if(!reader)throw new Error('empty');
 let size=0,body='';const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw new HttpError(502,'ledger_too_large','Ledger page exceeds the response limit.');body+=decoder.decode(value,{stream:true});}
 body+=decoder.decode();
 const page=JSON.parse(body.replaceAll(env.SHAREDNET_API_KEY,'[REDACTED]'));
 if(!page||!Array.isArray(page.items)||page.items.length>100||typeof page.has_more!=='boolean'||!(page.next_cursor===null||typeof page.next_cursor==='string')||(page.has_more&&!page.next_cursor))throw new HttpError(502,'invalid_ledger_response','Invalid ledger envelope.');
 return {...page,expected_payee:env.PAY_TO,expected_amount:Number(env.REVIEW_PRICE),verification:'raw_records_not_verified'};
 }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(502,'ledger_unavailable','Could not read the SharedNet ledger.');}
 finally{clearTimeout(timer);controller.abort();try{await reader?.cancel();}catch{}}
}
