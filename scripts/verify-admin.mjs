import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export async function runVerification({base,token,cancelIds=[],apply=false},send=fetch){
 if(!token)throw Error('Explicit ADMIN_TOKEN or ADMIN_TOKEN_FILE is required.');
 if(apply&&!cancelIds.length)throw Error('--apply requires explicit --cancel booking IDs.');
 for(const id of cancelIds)if(!/^bk_[a-f0-9-]{36}$/.test(id))throw Error('Invalid cancellation booking ID.');
 const headers={Authorization:'Bearer '+token};
 assert.equal((await send(base+'/admin/bookings?limit=1')).status,401);
 assert.equal((await send(base+'/admin/bookings?limit=1',{headers})).status,200);
 const actions=[];
 for(const id of new Set(cancelIds)){
  const response=await send(base+'/admin/bookings/'+id,{headers});assert.equal(response.status,200);
  const {booking}=await response.json();
  if(booking.booking_id!==id||booking.status!=='pending_payment')throw Error('Refusing to cancel a mismatched or non-pending booking.');
  if(apply){
   const result=await send(base+'/admin/bookings/'+id+'/status',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'cancelled',expected_version:booking.version,reason:'Explicitly selected synthetic smoke booking cleanup; no payment.'})});
   assert.equal(result.status,200);
  }
  actions.push({booking_id:id,action:apply?'cancelled':'would_cancel'});
 }
 assert.equal((await send(base+'/reviews')).status,200);
 return {unauthenticated_admin:401,authenticated_admin:200,reviews:200,dry_run:!apply,actions};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),cancelIds=[];let apply=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply')apply=true;
  else if(args[i]==='--cancel'&&args[i+1])cancelIds.push(args[++i]);
  else throw Error('Usage: verify-admin.mjs [--cancel bk_UUID] [--apply]');
 }
 let token=process.env.ADMIN_TOKEN;
 if(!token&&process.env.ADMIN_TOKEN_FILE){
  token=(await readFile(process.env.ADMIN_TOKEN_FILE,'utf8')).split(/\r?\n/).find(s=>s.startsWith('ADMIN_TOKEN='))?.slice(12);
 }
 console.log(JSON.stringify(await runVerification({base:process.env.BASE_URL||'https://agent-kol.roeu1996.workers.dev',token,cancelIds,apply})));
}
