import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runVerification} from '../scripts/verify-admin.mjs';
import {diagnostic,routeLabel} from '../src/diagnostics.ts';
test('admin verification defaults to read-only and cancellation requires exact IDs plus apply',async()=>{
 const id='bk_00000000-0000-0000-0000-000000000001',calls=[];
 const send=async(url,options={})=>{
  calls.push({url,options});
  if(url.includes('/admin/bookings?'))return Response.json({items:[{booking_id:'unrelated',seller_name:'Codex smoke test (unpaid)'}]},{status:options.headers?200:401});
  if(url.endsWith('/status'))return Response.json({ok:true});
  if(url.endsWith('/'+id))return Response.json({booking:{booking_id:id,status:'pending_payment',version:7}});
  return Response.json({items:[]});
 };
 const settings={base:'https://test.invalid',token:'fixture'};
 await runVerification(settings,send);assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
 await runVerification({...settings,cancelIds:[id]},send);assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
 await assert.rejects(runVerification({...settings,apply:true},send),/explicit/);
 await runVerification({...settings,cancelIds:[id,id],apply:true},send);
 const writes=calls.filter(c=>c.options.method==='POST');assert.equal(writes.length,1);
 assert.equal(writes[0].url,settings.base+'/admin/bookings/'+id+'/status');
 assert.equal(JSON.parse(writes[0].options.body).expected_version,7);
});
test('diagnostics retain safe classification without leaking exception text or unknown paths',()=>{
 const error=new Error('D1_ERROR secret=DO_NOT_LOG');
 error.stack='Error: DO_NOT_LOG\n at query (index.js:30:4)\n at DO_NOT_LOG (https://private/DO_NOT_LOG:1:2)';
 const data=diagnostic(error,'request_failure',routeLabel('/DO_NOT_LOG'),'fixture');
 assert.equal(data.category,'storage');assert.deepEqual(data.frames,['index.js:30:4']);
 assert.equal(JSON.stringify(data).includes('DO_NOT_LOG'),false);
});
