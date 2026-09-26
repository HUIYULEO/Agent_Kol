import { diagnostic } from './diagnostics';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createBooking, getBooking, publicBooking } from './bookings';
import { getReview, listReviews } from './reviews';
import { HttpError, json } from './http';
import type { Env } from './types';
export async function mcp(request:Request,env:Env):Promise<Response>{
 const origin=request.headers.get('Origin');
 if(origin && origin!==new URL(request.url).origin) throw new HttpError(403,'forbidden_origin','Origin not allowed.');
 if(request.method!=='POST')return json({error:'Use POST for this stateless MCP endpoint.'},405,{Allow:'POST'});
 const server=new McpServer({name:'agent-kol',version:'0.1.0'});
 const run=async(fn:()=>Promise<unknown>)=>{
  try {const value=await fn();return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value as Record<string,unknown>};}
  catch(error){if(!(error instanceof HttpError))console.error(JSON.stringify(diagnostic(error,'mcp_failure','/mcp',crypto.randomUUID())));const safe=error instanceof HttpError?{code:error.code,message:error.message}:{code:'internal_error',message:'Request failed.'};return {isError:true,content:[{type:'text' as const,text:JSON.stringify(safe)}]};}
 };
 server.registerTool('book_review',{
  description:'Submit an optional structured service review request. This does not charge or call your service. After submitting, pay the returned price directly to pay_to with your own team name as memo; no invitation is needed. The host matches your ledger payer to your arena request principal. At most 2 open requests per payee. Never submit secrets. What we can test: public HTTPS without credentials; GET or POST JSON up to 4 KiB; at most 5 calls, 5 seconds each. No login, installs, downloads or streaming sessions. MCP servers: single stateless JSON-RPC call. Include exact URL, method, sample JSON and expected result in how_to_invoke.',
  inputSchema:z.object({seller_name:z.string().min(1).max(100),seller_payee_id:z.string().min(1).max(100),service_summary:z.string().min(1).max(1000),how_to_invoke:z.string().min(1).max(8000),contact_room_id:z.string().max(100).optional(),idempotency_key:z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/).optional()}).strict(),
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
 },async({idempotency_key,...input})=>run(async()=> (await createBooking(env,input,idempotency_key)).data));
 server.registerTool('get_booking',{
  description:'Read optional request status, price, payee and direct payment instructions. No private invocation data is returned.',
  inputSchema:z.object({booking_id:z.string().max(100)}).strict(),
  annotations:{readOnlyHint:true,openWorldHint:false}
 },async({booking_id})=>run(async()=>publicBooking(await getBooking(env,booking_id))));
 server.registerTool('list_reviews',{
  description:'List published evidence-based service reviews, newest first.',
  inputSchema:z.object({limit:z.number().int().min(1).max(100).default(20),offset:z.number().int().min(0).max(10000).default(0)}).strict(),
  annotations:{readOnlyHint:true,openWorldHint:false}
 },async({limit,offset})=>run(()=>listReviews(env,new URL('https://local/reviews?limit='+limit+'&offset='+offset))));
 server.registerTool('get_review',{
  description:'Read one published review including what was called, results and limitations.',
  inputSchema:z.object({review_id:z.string().max(100)}).strict(),
  annotations:{readOnlyHint:true,openWorldHint:false}
 },async({review_id})=>run(()=>getReview(env,review_id)));
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:32768});
 await server.connect(transport);
 try {return await transport.handleRequest(request);}
 finally {await server.close();}
}
