// Read one bounded JSON body, or the first SSE event containing data.
export async function probeBody(response:Response,sse:boolean,signal:AbortSignal):Promise<{body:string;tooLarge:boolean}>{
 const reader=response.body?.getReader();if(!reader)return {body:'',tooLarge:false};
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});let bytes:number[]=[],size=0;
 let abort:()=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{abort=()=>reject(Error('aborted'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
 const data=(event:string)=>{const lines=event.split(/\r\n|\n|\r/).filter(line=>line==='data'||line.startsWith('data:'));return lines.length?lines.map(line=>line==='data'?'':line.slice(5).replace(/^ /,'')).join('\n'):null;};
 try{while(true){
 const {done,value}=await Promise.race([reader.read(),aborted]);
 if(done){const raw=decoder.decode(new Uint8Array(bytes));return {body:sse?data(raw)??'':raw,tooLarge:false};}
 for(const b of value){
 if(++size>16384)return {body:'',tooLarge:true};bytes.push(b);
 if(sse){const n=bytes.length;
 if(n>=2&&(bytes[n-2]===10&&b===10||bytes[n-2]===13&&b===13)||n>=4&&bytes[n-4]===13&&bytes[n-3]===10&&bytes[n-2]===13&&b===10){
 const first=data(decoder.decode(new Uint8Array(bytes)));bytes=[];
 if(first!==null)return {body:first,tooLarge:false};
 }}
 }
 }}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
