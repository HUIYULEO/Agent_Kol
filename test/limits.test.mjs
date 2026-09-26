import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
const body=payee=>({seller_name:'Limit seller',seller_payee_id:payee,service_summary:'Limit test',how_to_invoke:'GET https://public.example/data'});
test('unpaid bookings are capped per payee and overall; retries and closed bookings do not count',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-25',d1Databases:['DB'],
  bindings:{REVIEW_PRICE:'5',PAY_TO:'p_test_recipient',MAX_OPEN_BOOKINGS_PER_PAYEE:'2',MAX_OPEN_BOOKINGS:'3'}}));
 try{
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())
   await db.batch(unstable_splitSqlQuery(await readFile('migrations/'+file,'utf8')).map(sql=>db.prepare(sql)));
  const post=(data,headers={})=>mf.dispatchFetch('https://test.local/bookings',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  const first=await (await post(body('p_a'),{'Idempotency-Key':'limit-key-1'})).json();
  assert.equal((await post(body('p_a'))).status,201);
  const blocked=await post(body('p_a'));
  assert.equal(blocked.status,429);assert.equal((await blocked.json()).error.code,'too_many_open_bookings');
  const retry=await post(body('p_a'),{'Idempotency-Key':'limit-key-1'});
  assert.equal(retry.status,200);assert.equal((await retry.json()).booking_id,first.booking_id);
  assert.equal((await post({...body('p_a'),seller_name:'changed'},{'Idempotency-Key':'limit-key-1'})).status,409);
  assert.equal((await post(body('p_b'))).status,201);
  const full=await post(body('p_c'));
  assert.equal(full.status,429);assert.equal((await full.json()).error.code,'booking_queue_full');
  await db.prepare("UPDATE bookings SET status='paid' WHERE booking_id=?").bind(first.booking_id).run();
  assert.equal((await post(body('p_a'))).status,201);
  await db.prepare("UPDATE bookings SET status='cancelled' WHERE seller_payee_id='p_a'").run();
  const racing=await Promise.all(Array.from({length:4},()=>post(body('p_d'))));
  assert.deepEqual(racing.map(r=>r.status).sort(),[201,201,429,429]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status='pending_payment'").first()).n,3);
 }finally{await mf.dispose();}
});
