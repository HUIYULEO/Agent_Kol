import { getBooking } from './bookings';
import { hash, HttpError, onlyKeys, page, text } from './http';
import type { Env } from './types';
interface Review {review_id:string;booking_id:string;verdict:string;tested_at:string;what_we_called:string;result_summary:string;latency_ms:number|null;pros:string;cons:string;how_to_buy:string;content_hash:string;created_at:string;}
function publicReview(row:Review) {
  const {review_id,booking_id,verdict,tested_at,what_we_called,result_summary,latency_ms,how_to_buy,created_at}=row;
  return {review_id,booking_id,verdict,tested_at,what_we_called,result_summary,latency_ms,how_to_buy,created_at,pros:JSON.parse(row.pros),cons:JSON.parse(row.cons)};
}
function list(value:unknown,field:string) {
  if(!Array.isArray(value)||value.length>10) throw new HttpError(400,'invalid_input',field+' must be an array of up to 10 strings.');
  return value.map(item=>text(item,field,500));
}
export async function getReview(env:Env,id:string) {
  const row=await env.DB.prepare('SELECT review_id,booking_id,verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,created_at FROM reviews WHERE review_id=?').bind(id).first<Review>();
  if(!row)throw new HttpError(404,'not_found','Review not found.');
  return publicReview(row);
}
export async function listReviews(env:Env,url:URL) {
  const {limit,offset}=page(url);
  const {results}=await env.DB.prepare('SELECT review_id,booking_id,verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,created_at FROM reviews ORDER BY created_at DESC,review_id DESC LIMIT ? OFFSET ?').bind(limit+1,offset).all<Review>();
  return {items:results.slice(0,limit).map(publicReview),next_offset:results.length>limit?offset+limit:null};
}
export async function publishReview(env:Env,input:Record<string,unknown>) {
  onlyKeys(input,['booking_id','verdict','tested_at','what_we_called','result_summary','latency_ms','pros','cons','how_to_buy']);
  const data={
    booking_id:text(input.booking_id,'booking_id',100),
    verdict:text(input.verdict,'verdict',32),
    tested_at:text(input.tested_at,'tested_at',40),
    what_we_called:text(input.what_we_called,'what_we_called',4000),
    result_summary:text(input.result_summary,'result_summary',8000),
    latency_ms:input.latency_ms==null?null:input.latency_ms,
    pros:list(input.pros,'pros'),cons:list(input.cons,'cons'),
    how_to_buy:text(input.how_to_buy,'how_to_buy',2000)
  };
  if(!['recommended','mixed','not_recommended','inconclusive'].includes(data.verdict))throw new HttpError(400,'invalid_input','Invalid verdict.');
  if(!Number.isFinite(Date.parse(data.tested_at))||Date.parse(data.tested_at)>Date.now()+60000)throw new HttpError(400,'invalid_input','tested_at must be a valid date, not in the future.');
  data.tested_at=new Date(data.tested_at).toISOString();
  if(data.latency_ms!==null&&(typeof data.latency_ms!=='number'||!Number.isFinite(data.latency_ms)||data.latency_ms<0||data.latency_ms>3600000))throw new HttpError(400,'invalid_input','Invalid latency_ms.');
  const contentHash=await hash(JSON.stringify(data));
  const existing=await env.DB.prepare('SELECT * FROM reviews WHERE booking_id=?').bind(data.booking_id).first<Review>();
  if(existing){
    if(existing.content_hash!==contentHash)throw new HttpError(409,'review_exists','Published reviews are immutable.');
    return {data:publicReview(existing),created:false};
  }
  const booking=await getBooking(env,data.booking_id);
  if(Date.parse(data.tested_at)<Date.parse(booking.created_at))throw new HttpError(400,'invalid_input','tested_at cannot precede the booking.');
  if(booking.status!=='testing')throw new HttpError(409,'invalid_transition','Only a testing booking can publish a review.');
  const id='rev_'+crypto.randomUUID(), eventId='evt_'+crypto.randomUUID(), now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO reviews(review_id,booking_id,verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,content_hash,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? FROM bookings WHERE booking_id=? AND status='testing' AND version=?
      ON CONFLICT(booking_id) DO NOTHING`).bind(id,data.booking_id,data.verdict,data.tested_at,data.what_we_called,data.result_summary,data.latency_ms as number|null,JSON.stringify(data.pros),JSON.stringify(data.cons),data.how_to_buy,contentHash,now,data.booking_id,booking.version),
    env.DB.prepare(`UPDATE bookings SET status='published',updated_at=?,version=version+1,last_event_id=?
      WHERE booking_id=? AND status='testing' AND version=? AND EXISTS(SELECT 1 FROM reviews WHERE review_id=?)`).bind(now,eventId,data.booking_id,booking.version,id),
    env.DB.prepare(`INSERT INTO booking_events(event_id,booking_id,from_status,to_status,evidence,created_at)
      SELECT ?,?,'testing','published',?,? FROM bookings WHERE booking_id=? AND last_event_id=?`).bind(eventId,data.booking_id,JSON.stringify({review_id:id}),now,data.booking_id,eventId)
  ]);
  const stored=await env.DB.prepare('SELECT * FROM reviews WHERE booking_id=?').bind(data.booking_id).first<Review>();
  if(!stored||stored.content_hash!==contentHash)throw new HttpError(409,'state_conflict','Booking changed or another review was published.');
  return {data:publicReview(stored),created:stored.review_id===id};
}
