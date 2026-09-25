import { getBooking, publicBooking } from './bookings';
import { hash, HttpError, onlyKeys, page, text, object } from './http';
import type { Booking, Env, Status } from './types';

export async function authenticate(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw new HttpError(503,'admin_unavailable','Admin secret is not configured.');
  const actual = request.headers.get('Authorization') ?? '';
  const a = await hash(actual), b = await hash('Bearer ' + env.ADMIN_TOKEN);
  let mismatch = 0;
  for (let i=0;i<a.length;i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (mismatch !== 0) throw new HttpError(401,'unauthorized','Valid admin Bearer token required.');
}
function integer(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number)<0) throw new HttpError(400,'invalid_input',field+' must be a nonnegative safe integer.');
  return value as number;
}
function timestamp(value: unknown, field: string) {
  const input=text(value,field,40);
  if (!Number.isFinite(Date.parse(input))) throw new HttpError(400,'invalid_input',field+' must be an ISO date.');
  const date = new Date(input);
  if(date.getTime()>Date.now()+60000) throw new HttpError(400,'invalid_input',field+' cannot be in the future.');
  return date.toISOString();
}
export async function adminBookings(env: Env,url: URL) {
  const {limit,offset}=page(url), status=url.searchParams.get('status');
  const statement=status
    ? env.DB.prepare('SELECT * FROM bookings WHERE status=? ORDER BY queue_at,booking_id LIMIT ? OFFSET ?').bind(status,limit+1,offset)
    : env.DB.prepare('SELECT * FROM bookings ORDER BY queue_at,booking_id LIMIT ? OFFSET ?').bind(limit+1,offset);
  const {results}=await statement.all<Booking>();
  return {items:results.slice(0,limit),next_offset:results.length>limit?offset+limit:null};
}
export async function adminBooking(env:Env,id:string) {
  const booking=await getBooking(env,id);
  const events=await env.DB.prepare('SELECT * FROM booking_events WHERE booking_id=? ORDER BY created_at,event_id').bind(id).all();
  return {booking,events:events.results};
}
export async function changeStatus(env:Env,id:string,input:Record<string,unknown>) {
  onlyKeys(input,['status','expected_version','received_baseline','payment_evidence','reason']);
  const row=await getBooking(env,id);
  const version=integer(input.expected_version,'expected_version');
  if(version!==row.version) throw new HttpError(409,'stale_version','Reload the booking before updating.');
  const target=text(input.status,'status',32) as Status;
  const now=new Date().toISOString();
  let baseline=row.received_baseline, opened=row.payment_opened_at, deadline=row.payment_deadline;
  let evidence:Record<string,unknown>={reason:input.reason==null?null:text(input.reason,'reason',2000)};
  let paymentReference=row.payment_reference;
  let queueAt=row.queue_at;
  const allowed:Partial<Record<Status,Status[]>>={
    pending_payment:['awaiting_payment','cancelled'],
    awaiting_payment:['paid','pending_payment','payment_ambiguous','cancelled'],
    payment_ambiguous:['paid','cancelled'],
    paid:['testing','failed','refunded'],
    testing:['failed'], failed:['refunded'], published:['refunded']
  };
  if(!allowed[row.status]?.includes(target)) throw new HttpError(409,'invalid_transition','Transition not allowed; publish through /admin/reviews.');
  if(target==='awaiting_payment') {
    baseline=integer(input.received_baseline,'received_baseline');
    const seconds=Number(env.PAYMENT_WINDOW_SECONDS ?? '180');
    if(!Number.isInteger(seconds)||seconds<30||seconds>900) throw new HttpError(503,'not_configured','Invalid payment window configuration.');
    const active=await env.DB.prepare("SELECT booking_id FROM bookings WHERE status IN ('awaiting_payment','payment_ambiguous')").first();
    if(active) throw new HttpError(409,'payment_window_busy','Another payment window is active or ambiguous.');
    opened=now;deadline=new Date(Date.now()+seconds*1000).toISOString();
    evidence={received_baseline:baseline,opened_at:opened,deadline};
  }
  if(target==='pending_payment') {
    if(!deadline||Date.parse(deadline)>Date.now()) throw new HttpError(409,'window_not_expired','Payment window has not expired.');
    queueAt=now;
    evidence={reason:'window_expired',previous_baseline:baseline,previous_deadline:deadline};
    baseline=null; opened=null; deadline=null;
  }
  if(target==='payment_ambiguous' && !evidence.reason) throw new HttpError(400,'invalid_input','reason is required.');
  if(row.status==='payment_ambiguous' && target==='cancelled' && !evidence.reason) throw new HttpError(400,'invalid_input','Document reconciliation before releasing an ambiguous window.');
  if(target==='paid') {
    const supplied=object(input.payment_evidence);
    const method=text(supplied.method,'payment_evidence.method',40);
    if(method==='aggregate_window') {
      if(env.ALLOW_AGGREGATE_PAYMENTS!=='true') throw new HttpError(409,'aggregate_verification_disabled','Aggregate balance changes cannot prove which booking was paid.');
      onlyKeys(supplied,['method','received','observed_at']);
      const received=integer(supplied.received,'received');
      const observedAt=timestamp(supplied.observed_at,'observed_at');
      if(row.status!=='awaiting_payment'||baseline==null||!opened||!deadline||Date.now()>Date.parse(deadline)||Date.parse(observedAt)<Date.parse(opened)||Date.parse(observedAt)>Date.parse(deadline)) {
        throw new HttpError(409,'invalid_window','Observation must be inside the active payment window.');
      }
      if(received-baseline!==row.price) throw new HttpError(409,'payment_ambiguous','Received delta does not match price; mark payment_ambiguous explicitly.');
      evidence={method,baseline,received,observed_at:observedAt,verification:'heuristic_not_transaction_verified'};
    } else if(method==='transaction_reference') {
      onlyKeys(supplied,['method','transaction_id','amount','payee','memo','observed_at']);
      paymentReference=text(supplied.transaction_id,'transaction_id',200);
      if(integer(supplied.amount,'amount')!==row.price || supplied.payee!==row.pay_to || supplied.memo!==row.booking_id) {
        throw new HttpError(409,'payment_mismatch','Amount, payee and memo must match this booking.');
      }
      evidence={...supplied,observed_at:timestamp(supplied.observed_at,'observed_at'),verification:'agent_attested_transaction'};
      // This API records the trusted operator's attestation; it does not query SharedNet.
    } else throw new HttpError(400,'invalid_input','Unsupported payment evidence method.');
  }
  if(target==='refunded') {
    const supplied=object(input.payment_evidence);
    const reference=text(supplied.transaction_id,'transaction_id',200);
    if(integer(supplied.amount,'amount')!==row.price||supplied.payee!==row.seller_payee_id) throw new HttpError(409,'refund_mismatch','Refund must match seller and price.');
    evidence={...supplied,transaction_id:reference,kind:'agent_attested_refund'};
  }
  const eventId='evt_'+crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE bookings SET status=?,version=version+1,updated_at=?,queue_at=?,received_baseline=?,payment_opened_at=?,payment_deadline=?,payment_evidence=?,payment_reference=?,last_event_id=?
        WHERE booking_id=? AND version=?`).bind(target,now,queueAt,baseline,opened,deadline,
          target==='paid'?JSON.stringify(evidence):row.payment_evidence,paymentReference,eventId,id,version),
      env.DB.prepare(`INSERT INTO booking_events(event_id,booking_id,from_status,to_status,evidence,created_at)
        SELECT ?,?,?,?,?,? FROM bookings WHERE booking_id=? AND last_event_id=?`)
        .bind(eventId,id,row.status,target,JSON.stringify(evidence),now,id,eventId)
    ]);
  } catch(error) {
    if(String(error).includes('UNIQUE constraint')) throw new HttpError(409,'state_conflict','Payment window or transaction reference is already used.');
    throw error;
  }
  const updated=await getBooking(env,id);
  if(updated.last_event_id!==eventId) throw new HttpError(409,'stale_version','Concurrent update; reload booking.');
  return {booking:publicBooking(updated),version:updated.version};
}
