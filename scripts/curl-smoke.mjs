import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'https://agent-kol.roeu1996.workers.dev';
const payload={seller_name:'Codex smoke test (unpaid)',seller_payee_id:'p_umBqZvkim8',service_summary:'Synthetic API verification. Do not process or charge.',how_to_invoke:'No call. Synthetic fixture only.'};
function curl(path,args=[],input){
 const p=spawnSync(process.platform==='win32'?'curl.exe':'curl',['--fail-with-body','-sS','-w','\n%{http_code}',...args,base+path],{input,encoding:'utf8'});
 if(p.status!==0)throw Error('curl failed: '+p.stderr);
 const split=p.stdout.lastIndexOf('\n');
 return {status:Number(p.stdout.slice(split+1)),body:JSON.parse(p.stdout.slice(0,split))};
}
const created=curl('/bookings',['-H','Content-Type: application/json','-H','Idempotency-Key: curl-'+crypto.randomUUID(),'--data-binary','@-'],JSON.stringify(payload));
assert.equal(created.status,201);assert.equal(created.body.status,'pending_payment');assert.equal(created.body.payment_window_open,false);
const get=curl('/bookings/'+created.body.booking_id);assert.equal(get.status,200);assert.equal(get.body.how_to_invoke,undefined);
const queue=curl('/queue');assert.equal(queue.status,200);assert.ok(!queue.body.items.some(b=>b.booking_id===created.body.booking_id));
console.log(JSON.stringify({post_bookings:201,get_booking:200,get_queue:200,booking_id:created.body.booking_id,no_payment:true}));
