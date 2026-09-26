import {spawn} from 'node:child_process';
import {openSync, closeSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, copyFileSync, appendFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
export const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const remove = path => { try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } };

export async function supervise({dir = here, until, promptFile, command, args, retryMs = 5000, heartbeatMs = 20000}) {
  if (!Number.isFinite(until)) throw new Error('Invalid deadline');
  const state = join(dir, 'state');
  mkdirSync(state, {recursive:true});
  const lock = join(state, 'leader.lock'), gate = join(state, 'leader.acquire');
  const pulse = join(state, 'leader.heartbeat');
  const note = line => appendFileSync(join(state, 'runs.log'), new Date().toISOString() + ' ' + line + '\n');
  if (Date.now() >= until) { note('deadline already reached'); return 0; }
  // Serialize acquisition and stale recovery. A crashed acquisition gate fails closed.
  let fd;
  try { fd = openSync(gate, 'wx'); } catch (e) {
    if (e.code === 'EEXIST') { note('acquisition busy; inspect leader.acquire if persistent'); return 75; }
    throw e;
  }
  const owner = {pid:process.pid, token:randomUUID()};
  try {
    writeFileSync(fd, JSON.stringify(owner));
    const held = read(lock), beat = read(pulse);
    if (alive(held?.pid) || alive(beat?.childPid) || alive(beat?.pid)) {
      note('leader or child still alive; refusing takeover'); return 75;
    }
    remove(lock); remove(pulse);
    const lease = openSync(lock, 'wx');
    try { writeFileSync(lease, JSON.stringify(owner)); } finally { closeSync(lease); }
  } finally { closeSync(fd); remove(gate); }

  let child = null, stopping = false, exitCode = 0, wake, terminating;
  const beat = () => writeFileSync(pulse, JSON.stringify({...owner, heartbeat:Date.now(), childPid:child?.pid ?? null}));
  const stopTree = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (terminating) return terminating;
    const target = child;
    terminating = new Promise(resolveKill => {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(target.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'});
        killer.on('error', () => { note('taskkill error; retaining lease until child closes'); });
        killer.on('close', () => resolveKill());
      } else {
        try { process.kill(-target.pid, 'SIGTERM'); } catch {}
        const force = setTimeout(() => { try { process.kill(-target.pid, 'SIGKILL'); } catch {} resolveKill(); }, 1500);
        // Still kill the group after the parent closes, to remove surviving descendants.
        force.unref();
        setTimeout(resolveKill, 1600);
      }
    });
    return terminating;
  };
  const stop = (reason, code = 0) => {
    if (stopping) return;
    stopping = true; exitCode = code; note(reason); wake?.(); void stopTree();
  };
  const interrupt = () => stop('SIGINT', 130);
  const terminate = () => stop('SIGTERM', 143);
  const fatal = e => stop('uncaught failure code=' + (e?.code ?? e?.name ?? 'unknown'), 1);
  const onExit = code => { try { note('process exit code=' + code); } catch {} };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  process.on('uncaughtException', fatal); process.on('unhandledRejection', fatal); process.on('exit', onExit);
  const timer = setInterval(beat, heartbeatMs);
  const deadline = setTimeout(() => stop('deadline reached'), Math.min(until-Date.now(), 2147483647));
  try {
    beat();
    mkdirSync(join(dir, 'ref'), {recursive:true});
    for (const name of ['host-playbook.md', 'host-cli.md'])
      copyFileSync(join(dir, '..', 'docs', name), join(dir, 'ref', name));
    const initial = readFileSync(promptFile, 'utf8');
    let continued = false;
    while (!stopping && Date.now() < until) {
      const prompt = continued ? '继续主循环。先读 state/loop.json 与 state/authorization.json 恢复状态，勿重复回复。截止时间：' + new Date(until).toISOString() : initial;
      const cliArgs = [...(continued ? ['--continue'] : []), '-p', '--output-format', 'stream-json', '--verbose'];
      note(continued ? 'resume' : 'start');
      await new Promise(done => {
        terminating = null;
        child = command ? spawn(command, args ?? [], {cwd:dir, detached:process.platform !== 'win32', windowsHide:true, stdio:['pipe','pipe','pipe']})
          : process.platform === 'win32'
            ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d','/s','/c', 'claude ' + cliArgs.join(' ')], {cwd:dir, windowsHide:true, stdio:['pipe','pipe','pipe']})
            : spawn('claude', cliArgs, {cwd:dir, detached:true, stdio:['pipe','pipe','pipe']});
        beat();
        child.on('error', e => note('child spawn error code=' + e.code));
        child.stdin.on('error', e => note('child stdin error code=' + e.code));
        child.stdout.on('data', d => appendFileSync(join(state,'session.log'), d));
        child.stderr.on('data', d => appendFileSync(join(state,'session.log'), d));
        child.on('close', async (code, signal) => {
          note('child exit code=' + code + ' signal=' + signal);
          if (terminating) await terminating;
          child = null; beat(); done();
        });
        child.stdin.end(prompt); // Prompts and tokens never enter argv.
      });
      continued = true;
      if (!stopping) await new Promise(r => {
        const t = setTimeout(() => { wake = undefined; r(); }, retryMs);
        wake = () => { clearTimeout(t); wake = undefined; r(); };
      });
    }
  } catch (e) {
    stop('supervisor failure code=' + (e.code ?? e.name), 1);
    if (child && child.exitCode === null && child.signalCode === null)
      await new Promise(r => child.once('close', r));
    if (terminating) await terminating;
  } finally {
    clearTimeout(deadline); clearInterval(timer);
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    process.off('uncaughtException', fatal); process.off('unhandledRejection', fatal);
    if (!child && read(lock)?.token === owner.token) { remove(pulse); remove(lock); note('lease released'); }
    note('supervisor finished code=' + exitCode);
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--status')) {
    const held = read(join(here,'state','leader.lock')), beat = read(join(here,'state','leader.heartbeat'));
    console.log(JSON.stringify({leaderAlive:alive(held?.pid), childAlive:alive(beat?.childPid), heartbeatAgeMs:beat?.heartbeat ? Date.now()-beat.heartbeat : null}));
  } else {
    const value = flag => argv[argv.indexOf(flag)+1];
    if (!argv.includes('--prompt-file') || !argv.includes('--until') || !Number.isFinite(Date.parse(value('--until')))) {
      console.error('Usage: node supervise.mjs --prompt-file FILE --until ISO_DATE | --status'); process.exitCode = 2;
    } else {
      try { process.exitCode = await supervise({promptFile:value('--prompt-file'), until:Date.parse(value('--until'))}); }
      catch (e) { console.error('Supervisor failed:', e.code ?? e.name); process.exitCode = 1; }
    }
  }
}
