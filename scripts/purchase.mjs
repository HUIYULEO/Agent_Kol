import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
// Planning only. No transfer transport is wired until separately authorized live testing.
export function purchasePlan({authorization:a,request:r,balance,unsettled_orders:orders,events=[],target}={}){
 const fail=code=>({ok:false,simulation_only:true,error:{code}});
 if(!a||a.purchases_enabled!==true)return fail('purchase_not_authorized');
 if(!Number.isFinite(Date.parse(a.expires_at))||Date.parse(a.expires_at)<=Date.now())return fail('authorization_expired');
 if(!Number.isSafeInteger(a.budget)||a.budget<1||a.budget>90)return fail('invalid_budget');
 if(!r||!Number.isSafeInteger(r.amount)||r.amount<1||r.amount>15)return fail('single_purchase_limit');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(r.subject_id??''))return fail('invalid_subject');
 let url;try{url=new URL(r.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error();}catch{return fail('invalid_url');}
 if(!target||target.url!==url.href||target.state!=='active')return fail('target_not_approved');
 const payee=r.payee??target.seller_principal;
 if(!/^p_[a-zA-Z0-9]{10}$/.test(payee??''))return fail('invalid_payee');
 if(!Number.isSafeInteger(balance)||balance<0||!Number.isSafeInteger(orders)||orders<0||!Array.isArray(events))return fail('invalid_financial_snapshot');
 let spent=0,serviceSpent=0;const operations=new Set(),transactions=new Set();
 for(const e of events){
 if(!e||!Number.isSafeInteger(e.amount)||e.amount<1||!e.operation_id||operations.has(e.operation_id)||!['completed','pending','unknown'].includes(e.state)||typeof e.url!=='string')return fail('invalid_journal');
 operations.add(e.operation_id);
 if(e.transaction_id){if(transactions.has(e.transaction_id))return fail('duplicate_transaction');transactions.add(e.transaction_id);}
 spent+=e.amount;if(e.url===url.href)serviceSpent+=e.amount;
 if(e.state!=='completed')return fail('unresolved_transfer');
 }
 if(!Number.isSafeInteger(spent))return fail('invalid_journal');
 if(serviceSpent+r.amount>15)return fail('service_purchase_limit');
 if(spent+r.amount>a.budget)return fail('total_budget_limit');
 const reserve=10+orders*5;
 if(balance-r.amount<reserve)return fail('reserve_violation');
 return {ok:true,simulation_only:true,plan:{subject_id:r.subject_id,url:url.href,payee,payee_source:r.payee?'explicit':'approved_target',amount:r.amount,memo:'purchase:'+r.subject_id,reserve,spent_after:spent+r.amount},live_execution:'disabled'};
}
export async function main(args){
 if(args.length!==3||args[0]!=='--dry-run'||args[1]!=='--fixture-file')return {ok:false,simulation_only:true,error:{code:'live_transactions_disabled'},usage:'purchase.mjs --dry-run --fixture-file scenario.json'};
 try{return purchasePlan(JSON.parse(await readFile(args[2],'utf8')));}catch{return {ok:false,simulation_only:true,error:{code:'invalid_fixture'}};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
