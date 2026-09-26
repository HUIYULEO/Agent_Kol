import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {alive} from '../host/supervise.mjs';
const moduleUrl = new URL('../host/supervise.mjs', import.meta.url).href;
function fixture() {
 const root = mkdtempSync(join(tmpdir(),'kol-supervisor-'));
 const dir = join(root,'host'); mkdirSync(join(dir,'state'),{recursive:true}); mkdirSync(join(root,'docs'));
 for (const f of ['host-playbook.md','host-cli.md']) writeFileSync(join(root,'docs',f),'reference');
 const promptFile = join(root,'prompt.txt'); writeFileSync(promptFile,'private prompt sentinel');
 const runner = join(root,'run.mjs');
 writeFileSync(runner, `import {supervise} from ${JSON.stringify(moduleUrl)}; process.exitCode = await supervise(JSON.parse(process.argv[2]));`);
 return {root, dir, runner, promptFile};
}
function launch(f, extra={}) {
 const options = {dir:f.dir,promptFile:f.promptFile,until:Date.now()+1800,retryMs:100,heartbeatMs:50,command:process.execPath,args:['-e','process.stdin.resume();setInterval(()=>{},1000)'],...extra};
 const p=spawn(process.execPath,[f.runner,JSON.stringify(options)],{stdio:['ignore','pipe','pipe']});
 let output=''; p.stderr.on('data',d=>output+=d);
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal,output}));});
 return {p,done};
}
async function heartbeat(f) {
 for(let i=0;i<100;i++) {
  try {const b=JSON.parse(readFileSync(join(f.dir,'state','leader.heartbeat'),'utf8')); if(b.childPid) return b;} catch{}
  await sleep(30);
 }
 throw new Error('No child heartbeat');
}
test('concurrent starts have one leader; deadline removes live child and lease',async()=>{
 const f=fixture();
 try {
  const a=launch(f), b=launch(f);
  const h=await heartbeat(f);
  const results=await Promise.all([a.done,b.done]);
  assert.deepEqual(results.map(r=>r.code).sort((a,b)=>a-b),[0,75]);
  assert.equal(alive(h.childPid),false);
  assert.equal(existsSync(join(f.dir,'state','leader.lock')),false);
  assert.equal(readFileSync(join(f.dir,'ref','host-cli.md'),'utf8'),'reference');
 } finally {rmSync(f.root,{recursive:true,force:true});}
});
test('corrupt lease recovers; spawn failures retry until deadline',async()=>{
 const f=fixture();
 try {
  writeFileSync(join(f.dir,'state','leader.lock'),'{corrupt');
  const result=await launch(f,{command:join(f.root,'does-not-exist'),until:Date.now()+800}).done;
  assert.equal(result.code,0,result.output);
  const log=readFileSync(join(f.dir,'state','runs.log'),'utf8');
  assert.ok((log.match(/child spawn error/g)??[]).length>=2);
  assert.match(log,/deadline/);
  assert.equal(existsSync(join(f.dir,'state','leader.lock')),false);
 } finally {rmSync(f.root,{recursive:true,force:true});}
});
test('live leader is not stolen even with corrupt heartbeat',async()=>{
 const f=fixture();
 try {
  writeFileSync(join(f.dir,'state','leader.lock'),JSON.stringify({pid:process.pid,token:'existing'}));
  writeFileSync(join(f.dir,'state','leader.heartbeat'),'{corrupt');
  assert.equal((await launch(f).done).code,75);
  assert.equal(JSON.parse(readFileSync(join(f.dir,'state','leader.lock'))).token,'existing');
 } finally {rmSync(f.root,{recursive:true,force:true});}
});
test('SIGINT kills child before releasing lease', {skip:process.platform==='win32' ? 'Windows Node kill does not deliver console Ctrl+C; run on WSL or verify in terminal' : false},async()=>{
 const f=fixture();
 try {
  const run=launch(f,{until:Date.now()+20000}); const h=await heartbeat(f);
  run.p.kill('SIGINT');
  assert.equal((await run.done).code,130);
  assert.equal(alive(h.childPid),false);
  assert.equal(existsSync(join(f.dir,'state','leader.lock')),false);
 } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('deadline kills a child process tree',async()=>{
 const f=fixture();
 try {
  const pidFile=join(f.root,'grandchild.pid');
  const program = "const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));process.stdin.resume();setInterval(()=>{},1000);";
  const run=launch(f,{until:Date.now()+2500,args:['-e',program,pidFile]});
  await heartbeat(f);
  const result=await run.done;
  assert.equal(result.code,0,result.output);
  const pid=Number(readFileSync(pidFile,'utf8'));
  // Linux can leave a killed grandchild zombie until init reaps it.
  let running=alive(pid);
  if(process.platform==='linux' && running) {
    try {running=!/\) Z /.test(readFileSync('/proc/'+pid+'/stat','utf8'));} catch {running=false;}
  }
  assert.equal(running,false);
 } finally {rmSync(f.root,{recursive:true,force:true});}
});
