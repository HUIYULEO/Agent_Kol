import {hash,HttpError,onlyKeys,text} from './http';
import {redact} from './probe';
import type {Env} from './types';
export async function issueResponseToken(env:Env,reviewId:string) {
 const review=await env.DB.prepare("SELECT booking_id FROM reviews WHERE review_id=? AND funding_source='seller_paid'").bind(reviewId).first<{booking_id:string}>();
 if(!review)throw new HttpError(409,'seller_booking_required','A published seller-paid booking is required.');
 const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const result=await env.DB.prepare('INSERT INTO seller_responses(review_id,token_hash,issued_at) VALUES(?,?,?) ON CONFLICT(review_id) DO NOTHING').bind(reviewId,await hash(token),new Date().toISOString()).run();
 if(!result.meta.changes)throw new HttpError(409,'token_already_issued','A response credential was already issued.');
 return {review_id:reviewId,booking_id:review.booking_id,response_token:token,instructions:'Privately deliver only after verifying the seller principal against the booking. Credential is shown once.'};
}
export async function sellerResponse(env:Env,id:string) {
 return await env.DB.prepare('SELECT response,created_at FROM seller_responses WHERE review_id=? AND response IS NOT NULL').bind(id).first<{response:string;created_at:string}>();
}
export async function submitResponse(env:Env,id:string,request:Request,input:Record<string,unknown>) {
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)throw new HttpError(401,'unauthorized','Valid seller response credential required.');
 const tokenHash=await hash(token);
 const row=await env.DB.prepare('SELECT response FROM seller_responses WHERE review_id=? AND token_hash=?').bind(id,tokenHash).first<{response:string|null}>();
 if(!row)throw new HttpError(401,'unauthorized','Valid seller response credential required.');
 onlyKeys(input,['response']);const response=text(input.response,'response',2000);
 if(redact(response)!==response)throw new HttpError(400,'sensitive_response','Remove suspected credentials or personal contact details before submitting.');
 if(row.response!==null&&row.response!==response)throw new HttpError(409,'response_exists','Seller response is immutable.');
 await env.DB.prepare('UPDATE seller_responses SET response=?,created_at=? WHERE review_id=? AND token_hash=? AND response IS NULL').bind(response,new Date().toISOString(),id,tokenHash).run();
 const stored=await sellerResponse(env,id);
 if(stored?.response!==response)throw new HttpError(409,'response_exists','Seller response is immutable.');
 return stored;
}
