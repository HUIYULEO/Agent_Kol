import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='https://agent-kol.roeu1996.workers.dev';
if(process.argv.length>2)throw Error('No arbitrary target supported.');
const file=process.env.ADMIN_TOKEN_FILE;if(!file)throw Error('Set ADMIN_TOKEN_FILE explicitly.');
const token=(await readFile(file,'utf8')).split(/\r?\n/).find(s=>s.startsWith('ADMIN_TOKEN='))?.slice(12);
if(!token)throw Error('Missing credential.');
const post=async(path,data)=>{
 const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw Error('API failed: '+r.status+' '+value.error?.code);return value;
};
const existing=await (await fetch(base+'/reviews?limit=100')).json(),published=[];
for(const [kind,path] of [['todo','todos/1'],['post','posts/1']]){
 const subject='demo-jsonplaceholder-'+kind+'-v1',prior=existing.items.find(r=>r.subject_id===subject);
 if(prior){published.push({review_id:prior.review_id,url:base+'/reviews/'+prior.review_id,reused:true});continue;}
 const url='https://jsonplaceholder.typicode.com/'+path;
 const probe=await post('/admin/probe',{subject_id:subject,url});
 const observed=probe.status===200&&probe.outcome==='observed';
 const review=await post('/admin/reviews',{subject_id:subject,funding_source:'demo_example',probe_ids:[probe.probe_id],tested_at:new Date().toISOString(),
 verdict:observed?'mixed':'inconclusive',what_we_called:'One public unauthenticated GET to '+url,
 result_summary:observed?'Demo example: JSONPlaceholder returned HTTP 200 JSON for a sample '+kind+'. This is a synthetic-data API, not an evaluated seller or a paid transaction.':'Demo example: the bounded probe did not establish a successful JSON response; outcome '+probe.outcome+'. No seller or payment was involved.',
 latency_ms:probe.latency_ms,pros:observed?['Public GET returned JSON in this observation.']:[],
 cons:['Only one request; no reliability, authentication or production-readiness claim.','JSONPlaceholder provides placeholder data, not a real task or publishing service.'],
 how_to_buy:'Free public demonstration API: https://jsonplaceholder.typicode.com/'});
 assert.equal(review.funding_source,'demo_example');assert.equal(review.booking_id,null);
 published.push({review_id:review.review_id,url:base+'/reviews/'+review.review_id,status:probe.status,outcome:probe.outcome,latency_ms:probe.latency_ms});
}
await writeFile('docs/demo-reviews.json',JSON.stringify({at:new Date().toISOString(),funding_source:'demo_example',real_payments:false,reviews:published},null,2)+'\n');
console.log(JSON.stringify(published,null,2));
