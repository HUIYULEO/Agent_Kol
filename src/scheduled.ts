import { changeStatus } from './admin';
import type {Env,Booking} from './types';
export async function expireWindows(env:Env){
 const {results}=await env.DB.prepare("SELECT * FROM bookings WHERE status='awaiting_payment' AND payment_deadline<=?").bind(new Date().toISOString()).all<Booking>();
 for(const row of results){
  try{await changeStatus(env,row.booking_id,{status:'pending_payment',expected_version:row.version});}
  catch(error){if((error as {status?:number}).status!==409)throw error;}
 }
}
