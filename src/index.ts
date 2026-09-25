import { diagnostic, routeLabel } from './diagnostics';
import { expireWindows } from './scheduled';
import { mcp } from './mcp';
import { landing, styles, appScript } from './landing';
import { createBooking, getBooking, publicBooking, queue } from './bookings';
import { authenticate, adminBooking, adminBookings, changeStatus } from './admin';
import { getReview, listReviews, publishReview } from './reviews';
import { HttpError, json, readJson, secure } from './http';
import type { Env } from './types';
async function route(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url), path=url.pathname, method=request.method;
 if(path==='/mcp')return mcp(request,env);
 if(method==='GET'&&path==='/')return new Response(landing(url.origin,env),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache'}});
 if(method==='GET'&&path==='/styles.css')return new Response(styles,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=300'}});
 if(method==='GET'&&path==='/app.js')return new Response(appScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}});
 if((method==='GET'||method==='HEAD')&&path==='/health')return method==='HEAD'?new Response(null,{headers:{'Cache-Control':'no-store'}}):json({ok:true});
 if(method==='POST'&&path==='/bookings'){
  const result=await createBooking(env,await readJson(request),request.headers.get('Idempotency-Key'));
  return json(result.data,result.created?201:200,{Location:'/bookings/'+result.data.booking_id});
 }
 const booking=/^\/bookings\/(bk_[a-f0-9-]+)$/.exec(path);
 if(method==='GET'&&booking)return json(publicBooking(await getBooking(env,booking[1])));
 if(method==='GET'&&path==='/queue')return json(await queue(env,url));
 if(method==='GET'&&path==='/reviews')return json(await listReviews(env,url));
 const review=/^\/reviews\/(rev_[a-f0-9-]+)$/.exec(path);
 if(method==='GET'&&review)return json(await getReview(env,review[1]));
 if(path.startsWith('/admin/')){
  await authenticate(request,env);
  if(method==='GET'&&path==='/admin/bookings')return json(await adminBookings(env,url));
  const admin=/^\/admin\/bookings\/(bk_[a-f0-9-]+)(\/status)?$/.exec(path);
  if(admin&&method==='GET'&&!admin[2])return json(await adminBooking(env,admin[1]));
  if(admin&&method==='POST'&&admin[2])return json(await changeStatus(env,admin[1],await readJson(request)));
  if(method==='POST'&&path==='/admin/reviews'){
   const result=await publishReview(env,await readJson(request));
   return json(result.data,result.created?201:200);
  }
 }
 throw new HttpError(404,'not_found','Route not found.');
}
export default { scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(expireWindows(env));},
 async fetch(request:Request,env:Env):Promise<Response>{
  try{return secure(await route(request,env));}
  catch(error){
   if(error instanceof HttpError)return secure(json({error:{code:error.code,message:error.message}},error.status));
   const ray=request.headers.get('cf-ray');
   const requestId=ray && /^[a-f0-9]{16}-[A-Z]{3}$/i.test(ray)?ray:crypto.randomUUID();
   console.error(JSON.stringify(diagnostic(error,'request_failure',routeLabel(new URL(request.url).pathname),requestId)));
   return secure(json({error:{code:'internal_error',message:'Request failed.',request_id:requestId}},500));
  }
 }
};
