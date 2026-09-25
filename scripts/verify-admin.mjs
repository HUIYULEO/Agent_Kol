import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='https://agent-kol.roeu1996.workers.dev';
const secret=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(s=>s.startsWith('ADMIN_TOKEN=')).slice(12);
const headers={Authorization:'Bearer '+secret};
assert.equal((await fetch(base+'/admin/bookings')).status,401);
const r=await fetch(base+'/admin/bookings',{headers});assert.equal(r.status,200);
const data=await r.json();
let cancelled=0;
for(const b of data.items){
 if(b.seller_name==='Codex smoke test (unpaid)'&&b.status==='pending_payment'){
  const r=await fetch(base+'/admin/bookings/'+b.booking_id+'/status',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'cancelled',expected_version:b.version,reason:'Synthetic smoke test completed; no payment or service invocation.'})});
  assert.equal(r.status,200);cancelled++;
 }
}
assert.equal((await fetch(base+'/reviews')).status,200);
console.log(JSON.stringify({unauthenticated_admin:401,authenticated_admin:200,reviews:200,synthetic_bookings_cancelled:cancelled}));
