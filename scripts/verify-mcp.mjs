import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'https://agent-kol.roeu1996.workers.dev';
const client=new Client({name:'agent-kol-production-smoke',version:'1'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
 const {tools}=await client.listTools();
 assert.deepEqual(tools.map(t=>t.name).sort(),['book_review','get_booking','get_review','list_reviews'].sort());
 const result=await client.callTool({name:'list_reviews',arguments:{limit:1}});
 assert.ok(!result.isError);
 console.log(JSON.stringify({mcp_initialize:'ok',tools:tools.map(t=>t.name),list_reviews:'ok'}));
}finally{await client.close();}
