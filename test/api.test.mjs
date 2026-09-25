import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, db;
const body = { seller_name: 'Test seller', seller_payee_id: 'p_test', service_summary: 'A test-only service', how_to_invoke: 'PRIVATE https://example.com', contact_room_id: 'rom_private' };
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api', modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-09-25',
    d1Databases: ['DB'], bindings: { REVIEW_PRICE: '5', PAY_TO: 'p_test_recipient', ADMIN_TOKEN: 'test-only-admin-token-32-characters' } }] }));
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec((await readFile('migrations/' + file, 'utf8')).replace(/\n/g, ' '));
  }
});
after(async () => { await mf?.dispose(); });
const request = (path, options = {}) => mf.dispatchFetch('https://test.local' + path, options);
const post = (path, data, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
test('atomic concurrent retries and public privacy', async () => {
  const key = crypto.randomUUID();
  const responses = await Promise.all(Array.from({length: 5}, () => post('/bookings', body, { 'Idempotency-Key': key })));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  const values = await Promise.all(responses.map(r => r.json()));
  assert.equal(new Set(values.map(v => v.booking_id)).size, 1);
  assert.equal(values[0].status, 'pending_payment');
  assert.equal(values[0].price, 5);
  assert.equal(values[0].pay_to, 'p_test_recipient');
  assert.equal((await post('/bookings', {...body, seller_name:'changed'}, {'Idempotency-Key':key})).status, 409);
  const publicValue = await (await request('/bookings/' + values[0].booking_id)).json();
  assert.equal(publicValue.how_to_invoke, undefined);
  assert.equal(publicValue.contact_room_id, undefined);
  const queue = await (await request('/queue')).json();
  assert.ok(!queue.items.some(b => b.booking_id === values[0].booking_id));
});
test('rejects invalid and oversized input', async () => {
  for (const extra of [{status:'paid'}, {price:1}, {how_to_invoke:'x'.repeat(8001)}, {seller_payee_id:'invalid'}]) {
    assert.equal((await post('/bookings', {...body, ...extra})).status,400);
  }
  assert.equal((await post('/bookings', {...body, service_summary:'x'.repeat(40000)})).status,413);
  assert.equal((await request('/bookings',{method:'POST',body:'{}'})).status,415);
  assert.equal((await request('/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await request('/queue?limit=100000')).status,400);
  assert.equal((await request('/bookings/bk_00000000-0000-0000-0000-000000000000')).status,404);
});
test('queue public fields are explicitly allowlisted', async () => {
  const created = await (await post('/bookings',body)).json();
  await db.prepare("UPDATE bookings SET status = 'paid' WHERE booking_id = ?").bind(created.booking_id).run();
  const result = await (await request('/queue')).json();
  assert.deepEqual(Object.keys(result.items.find(b=>b.booking_id===created.booking_id)).sort(), ['booking_id','seller_name','service_summary','status','created_at'].sort());
});

const auth={Authorization:'Bearer test-only-admin-token-32-characters'};
const detail=async id=>(await (await request('/admin/bookings/'+id,{headers:auth})).json()).booking;
const transition=async(id,status,extra={})=>post('/admin/bookings/'+id+'/status',{status,expected_version:(await detail(id)).version,...extra},auth);
const fresh=async()=>(await (await post('/bookings',body)).json()).booking_id;
const evidence=id=>({method:'transaction_reference',transaction_id:'txn_'+crypto.randomUUID(),amount:5,payee:'p_test_recipient',memo:id,observed_at:new Date().toISOString()});
test('admin authentication and status transitions fail closed',async()=>{
 assert.equal((await request('/admin/bookings')).status,401);
 assert.equal((await request('/admin/bookings',{headers:{Authorization:'Bearer wrong'}})).status,401);
 const id=await fresh();
 assert.equal((await transition(id,'paid',{payment_evidence:evidence(id)})).status,409);
 assert.equal((await transition(id,'published')).status,409);
 const a=await detail(id);
 const results=await Promise.all([1,2].map(()=>post('/admin/bookings/'+id+'/status',{status:'cancelled',expected_version:a.version},auth)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('single payment window, expiry queueing and ambiguous window hold',async()=>{
 const a=await fresh(),b=await fresh();
 const result=await Promise.all([a,b].map(id=>transition(id,'awaiting_payment',{received_baseline:0})));
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const active=(await detail(a)).status==='awaiting_payment'?a:b;
 const other=active===a?b:a;
 assert.equal((await transition(active,'pending_payment')).status,409);
 assert.equal((await transition(active,'paid',{payment_evidence:{method:'aggregate_window',received:5,observed_at:new Date().toISOString()}})).status,409);
 assert.equal((await transition(active,'payment_ambiguous',{reason:'unattributed arrival'})).status,200);
 assert.equal((await transition(other,'awaiting_payment',{received_baseline:5})).status,409);
 assert.equal((await transition(active,'cancelled',{reason:'test reconciled; no live funds involved'})).status,200);
 assert.equal((await transition(other,'awaiting_payment',{received_baseline:5})).status,200);
 await db.prepare('UPDATE bookings SET payment_deadline=? WHERE booking_id=?').bind('2020-01-01T00:00:00.000Z',other).run();
 assert.equal((await (await request('/bookings/'+other)).json()).payment_window_open,false);
 assert.equal((await transition(other,'pending_payment')).status,200);
 assert.equal((await detail(other)).received_baseline,null);
});
test('payment evidence match and replay protection; review publication is atomic and immutable',async()=>{
 const id=await fresh();
 assert.equal((await transition(id,'awaiting_payment',{received_baseline:0})).status,200);
 const e=evidence(id);
 assert.equal((await transition(id,'paid',{payment_evidence:{...e,amount:99}})).status,409);
 assert.equal((await transition(id,'paid',{payment_evidence:e})).status,200);
 assert.equal((await transition(id,'testing')).status,200);
 const review={booking_id:id,verdict:'mixed',tested_at:new Date().toISOString(),what_we_called:'GET https://example.com (synthetic fixture)',result_summary:'Test fixture only',latency_ms:10,pros:['Clear interface'],cons:['Not a live service test'],how_to_buy:'Synthetic only'};
 const results=await Promise.all([1,2].map(()=>post('/admin/reviews',review,auth)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 const published=await results[0].json();
 assert.equal((await detail(id)).status,'published');
 assert.equal((await request('/reviews/'+published.review_id)).status,200);
 assert.equal((await post('/admin/reviews',{...review,result_summary:'changed'},auth)).status,409);
 assert.equal((await (await request('/reviews')).json()).items[0].content_hash,undefined);
 const second=await fresh();
 assert.equal((await transition(second,'awaiting_payment',{received_baseline:5})).status,200);
 assert.equal((await transition(second,'paid',{payment_evidence:{...e,memo:second}})).status,409);
 assert.equal((await detail(second)).status,'awaiting_payment');
 assert.equal((await transition(second,'cancelled',{reason:'test cleanup'})).status,200);
 const events=(await (await request('/admin/bookings/'+id,{headers:auth})).json()).events;
 assert.deepEqual(events.map(e=>e.to_status),['awaiting_payment','paid','testing','published']);
});
