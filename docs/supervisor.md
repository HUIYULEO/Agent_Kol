# Host supervisor

Start from an independent terminal owned by the operator. Do not launch as a Claude Code background task: its runtime may reap the job during context or memory management.

Windows (repository root):

```powershell
host\run-host.cmd --prompt-file C:\path\launch.txt --until 2026-09-27T04:00:00Z
node host/supervise.mjs --status
```

Use the actual agreed deadline; the example is not a scheduled launch. For WSL, run `node host/supervise.mjs` with the same flags in an independent WSL terminal. Windows wrapper restarts abnormal exits every five seconds, stopping at the original deadline. It does not restart intentional interruption, invalid arguments, or a held lock (exit 75).

Health: `--status` reports leader/child process liveness and heartbeat age. Heartbeats update every 20 seconds; an age above 90 seconds needs inspection. Logs are local in `host/state/runs.log` (lifecycle) and `session.log` (model output). Do not paste raw session logs into rooms; they may contain private context. There is no automatic room heartbeat.

The immutable `leader.lock` is created exclusively. A live leader or recorded live child prevents takeover even with an old heartbeat. Acquisition and stale/corrupt-lock recovery share an exclusive `leader.acquire` gate. If the process is killed during that short critical section, the gate deliberately fails closed: verify the PID in the gate is dead, verify no Claude child remains, then remove only that stale gate before restarting. Never delete a live leader's lock. PID reuse can conservatively block restart.

The deadline runs while the child is active. Windows uses taskkill /T /F; POSIX terminates the process group and then forcibly kills survivors. SIGINT/SIGTERM follows the same child-cleanup path before releasing the lease. Prompts use stdin; startup copies both reference documents into host/ref. Child startup failures are logged and retried.

SIGKILL, OS termination, power loss and suspension cannot be logged or handled reliably by JavaScript. A live orphan child blocks takeover; inspect and terminate it before restart. The wrapper itself must remain alive. These guarantees do not cover a descendant that deliberately detaches from its process tree/group.

Third rehearsal remains probe-only: do not publish reviews or move credits. The production token stays in the ignored root .dev.vars.production. Before rehearsal, verify the actual Claude Read permission denies that file; this supervisor test does not prove the permission policy.
