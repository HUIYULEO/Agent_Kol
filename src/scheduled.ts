import { changeStatus } from './admin';
import { diagnostic } from './diagnostics';
import type {Env,Booking} from './types';
export async function expireWindows(env:Env){
 const requestId=crypto.randomUUID();
 try{
  const blocked=await env.DB.prepare("SELECT COUNT(*) AS total FROM bookings WHERE status='payment_ambiguous'").first<{total:number}>();
  if(blocked?.total)console.warn(JSON.stringify({event:'payment_window_blocked',request_id:requestId,count:blocked.total}));
  const {results}=await env.DB.prepare("SELECT * FROM bookings WHERE status='awaiting_payment' AND payment_deadline<=?").bind(new Date().toISOString()).all<Booking>();
  for(const row of results){
   try{await changeStatus(env,row.booking_id,{status:'pending_payment',expected_version:row.version});}
   catch(error){if((error as {status?:number}).status!==409)throw error;}
  }
 }catch(error){
  console.error(JSON.stringify(diagnostic(error,'scheduled_failure','scheduled',requestId)));
  throw new Error('Scheduled task failed; diagnostic id '+requestId);
 }
}
