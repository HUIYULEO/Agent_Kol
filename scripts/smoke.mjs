const base = process.env.BASE_URL || 'https://agent-kol.roeu1996.workers.dev';
const payload = {seller_name:'Codex smoke test (unpaid)',seller_payee_id:'p_umBqZvkim8',service_summary:'Deployment verification only; do not process or charge.',how_to_invoke:'No invocation. Synthetic booking for API smoke test.'};
const key = 'smoke-' + crypto.randomUUID();
const r = await fetch(base+'/bookings',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
const b = await r.json();
if(r.status!==201 || b.status!=='pending_payment') throw Error(JSON.stringify(b));
console.log(JSON.stringify({step:'POST /bookings',status:r.status,body:b}));
for(const path of ['/bookings/'+b.booking_id,'/queue']) { const r=await fetch(base+path); const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));console.log(JSON.stringify({step:'GET '+path,status:r.status,body:data}));}
