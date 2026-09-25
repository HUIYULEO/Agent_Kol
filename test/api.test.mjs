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
