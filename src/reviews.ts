import {sellerResponse} from './seller-response';
import {getBooking} from './bookings';
import {hash,HttpError,onlyKeys,page,text} from './http';
import {probeEvidence,redact} from './probe';
import type {Env} from './types';
interface Review {review_id:string;booking_id:string|null;subject_id:string;funding_source:string;verdict:string;tested_at:string;what_we_called:string;result_summary:string;latency_ms:number|null;pros:string;cons:string;how_to_buy:string;evidence:string;reproduce_cmd:string;content_hash:string;created_at:string;}
const columns='review_id,booking_id,subject_id,funding_source,verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,evidence,reproduce_cmd,created_at';
function publicReview(row:Review) {
 const {review_id,booking_id,subject_id,funding_source,verdict,tested_at,what_we_called,result_summary,latency_ms,how_to_buy,reproduce_cmd,created_at}=row;
 return {review_id,booking_id,subject_id,funding_source,verdict,tested_at,what_we_called,result_summary,latency_ms,how_to_buy,reproduce_cmd,created_at,pros:JSON.parse(row.pros),cons:JSON.parse(row.cons),evidence:JSON.parse(row.evidence)};
}
function list(value:unknown,field:string) {
 if(!Array.isArray(value)||value.length>10)throw new HttpError(400,'invalid_input',field+' must be an array of up to 10 strings.');
 return value.map(item=>redact(text(item,field,500)));
}
export async function getReview(env:Env,id:string) {
 const row=await env.DB.prepare('SELECT '+columns+' FROM reviews WHERE review_id=?').bind(id).first<Review>();
 if(!row)throw new HttpError(404,'not_found','Review not found.');
 return {...publicReview(row),seller_response:await sellerResponse(env,id)};
}
export async function listReviews(env:Env,url:URL) {
 const {limit,offset}=page(url);
 const {results}=await env.DB.prepare('SELECT '+columns+' FROM reviews ORDER BY created_at DESC,review_id DESC LIMIT ? OFFSET ?').bind(limit+1,offset).all<Review>();
 return {items:await Promise.all(results.slice(0,limit).map(async row=>({...publicReview(row),seller_response:await sellerResponse(env,row.review_id)}))),next_offset:results.length>limit?offset+limit:null};
}
export async function reviewStats(env:Env) {
 const verdicts={recommended:0,mixed:0,not_recommended:0,inconclusive:0};
 const funding={seller_paid:0,host_initiated:0,host_purchased:0,demo_example:0};
 const {results}=await env.DB.prepare('SELECT verdict,funding_source,COUNT(*) AS count FROM reviews GROUP BY verdict,funding_source').all<{verdict:keyof typeof verdicts;funding_source:keyof typeof funding;count:number}>();
 for(const r of results){verdicts[r.verdict]+=r.count;funding[r.funding_source]+=r.count;}
 return {total:Object.values(verdicts).reduce((a,b)=>a+b,0),verdicts,funding_sources:funding};
}
export async function publishReview(env:Env,input:Record<string,unknown>) {
 onlyKeys(input,['booking_id','subject_id','funding_source','probe_ids','verdict','tested_at','what_we_called','result_summary','latency_ms','pros','cons','how_to_buy']);
 const funding=text(input.funding_source,'funding_source',32);
 if(!['seller_paid','host_initiated','demo_example'].includes(funding))
 throw new HttpError(400,'invalid_funding','Supported: seller_paid, host_initiated, demo_example. Purchases are not enabled.');
 const bookingId=funding==='seller_paid'?text(input.booking_id,'booking_id',100):null;
 if(!bookingId&&input.booking_id!=null)throw new HttpError(400,'invalid_input','Unpaid reviews must not use a booking.');
 const subject=bookingId??text(input.subject_id,'subject_id',100);
 if(input.subject_id!=null&&input.subject_id!==subject)throw new HttpError(400,'invalid_input','Subject must match the booking.');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(subject))throw new HttpError(400,'invalid_input','Invalid subject_id.');
 const data={
 booking_id:bookingId,subject_id:subject,funding_source:funding,
 verdict:text(input.verdict,'verdict',32),tested_at:text(input.tested_at,'tested_at',40),
 what_we_called:redact(text(input.what_we_called,'what_we_called',4000)),
 result_summary:redact(text(input.result_summary,'result_summary',8000)),
 latency_ms:input.latency_ms==null?null:input.latency_ms,
 pros:list(input.pros,'pros'),cons:list(input.cons,'cons'),how_to_buy:redact(text(input.how_to_buy,'how_to_buy',2000))
 };
 if(!['recommended','mixed','not_recommended','inconclusive'].includes(data.verdict))throw new HttpError(400,'invalid_input','Invalid verdict.');
 if(!Number.isFinite(Date.parse(data.tested_at))||Date.parse(data.tested_at)>Date.now()+60000)throw new HttpError(400,'invalid_input','Invalid tested_at.');
 data.tested_at=new Date(data.tested_at).toISOString();
 if(data.latency_ms!==null&&(typeof data.latency_ms!=='number'||!Number.isFinite(data.latency_ms)||data.latency_ms<0||data.latency_ms>3600000))throw new HttpError(400,'invalid_input','Invalid latency_ms.');
 const evidence=await probeEvidence(env,subject,input.probe_ids);
 if(evidence.some(p=>Date.parse(p.at)>Date.parse(data.tested_at)))throw new HttpError(400,'invalid_input','tested_at must follow the probes.');
 const reproduce=evidence.map(p=>p.reproduce_cmd).join('\n');
 const contentHash=await hash(JSON.stringify({...data,evidence,reproduce_cmd:reproduce}));
 const existing=await env.DB.prepare('SELECT * FROM reviews WHERE subject_id=?').bind(subject).first<Review>();
 if(existing){
 if(existing.content_hash!==contentHash)throw new HttpError(409,'review_exists','Published reviews are immutable.');
 return {data:publicReview(existing),created:false};
 }
 const booking=bookingId?await getBooking(env,bookingId):null;
 if(booking&&(booking.status!=='testing'||!booking.payment_reference))throw new HttpError(409,'invalid_transition','A paid testing booking is required.');
 if(booking&&Date.parse(data.tested_at)<Date.parse(booking.created_at))throw new HttpError(400,'invalid_input','tested_at cannot precede the booking.');
 const id='rev_'+crypto.randomUUID(),eventId='evt_'+crypto.randomUUID(),now=new Date().toISOString();
 const values=[id,bookingId,subject,funding,data.verdict,data.tested_at,data.what_we_called,data.result_summary,data.latency_ms as number|null,JSON.stringify(data.pros),JSON.stringify(data.cons),data.how_to_buy,JSON.stringify(evidence),reproduce,contentHash,now];
 const insert='INSERT INTO reviews(review_id,booking_id,subject_id,funding_source,verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,evidence,reproduce_cmd,content_hash,created_at) ';
 const placeholders=values.map(()=>'?').join(',');
 if(booking){
 await env.DB.batch([
 env.DB.prepare(insert+'SELECT '+placeholders+" FROM bookings WHERE booking_id=? AND status='testing' AND version=? ON CONFLICT(subject_id) DO NOTHING").bind(...values,bookingId,booking.version),
 env.DB.prepare("UPDATE bookings SET status='published',updated_at=?,version=version+1,last_event_id=? WHERE booking_id=? AND status='testing' AND version=? AND EXISTS(SELECT 1 FROM reviews WHERE review_id=?)").bind(now,eventId,bookingId,booking.version,id),
 env.DB.prepare("INSERT INTO booking_events(event_id,booking_id,from_status,to_status,evidence,created_at) SELECT ?,?,'testing','published',?,? FROM bookings WHERE booking_id=? AND last_event_id=?").bind(eventId,bookingId,JSON.stringify({review_id:id}),now,bookingId,eventId)
 ]);
 }else await env.DB.prepare(insert+'VALUES('+placeholders+') ON CONFLICT(subject_id) DO NOTHING').bind(...values).run();
 const stored=await env.DB.prepare('SELECT * FROM reviews WHERE subject_id=?').bind(subject).first<Review>();
 if(!stored||stored.content_hash!==contentHash)throw new HttpError(409,'state_conflict','Subject changed or another review was published.');
 return {data:publicReview(stored),created:stored.review_id===id};
}
