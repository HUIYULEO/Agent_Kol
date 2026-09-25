import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
test('Wrangler-split migrations preserve existing bookings and handle comments and quoted semicolons',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB');
  const apply=async sql=>db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  const files=(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort();
  await apply(await readFile('migrations/'+files[0],'utf8'));
  await db.prepare("INSERT INTO bookings(booking_id,seller_name,seller_payee_id,service_summary,how_to_invoke,price,pay_to,request_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .bind('bk_fixture','existing','p_seller','retain me','private',5,'p_receiver','hash','2026-09-25T00:00:00.000Z','2026-09-25T00:00:00.000Z').run();
  for(const file of files.slice(1))await apply(await readFile('migrations/'+file,'utf8'));
  const row=await db.prepare('SELECT * FROM bookings WHERE booking_id=?').bind('bk_fixture').first();
  assert.equal(row.seller_name,'existing');assert.equal(row.how_to_invoke,'private');assert.equal(row.queue_at,row.created_at);assert.equal(row.version,0);
  await apply("-- leading comment\nCREATE TABLE parser_probe(value TEXT);\n-- next statement\nINSERT INTO parser_probe VALUES('quoted;semicolon');");
  assert.equal((await db.prepare('SELECT value FROM parser_probe').first()).value,'quoted;semicolon');
 }finally{await mf.dispose();}
});
