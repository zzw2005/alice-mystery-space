"use strict";
// AliceButler runner: watches jobs/, runs tasks as its own children so they
// survive any SSH session. Started by Task Scheduler (task "AliceButler").
// Home: C:\ProgramData\AliceButler (jobs/ running/ done/ logs/ status.json)
// Job file: jobs/<any>.json =
//   { id, name, type: "once"|"service", cmd, args: [], cwd, env: {}, shell: bool }
// Stop a job: drop jobs/stop-<id>.flag
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile, execFileSync } = require("node:child_process");

const HOME = __dirname;
const JOBS = path.join(HOME, "jobs");
const RUNNING = path.join(HOME, "running");
const DONE = path.join(HOME, "done");
const LOGS = path.join(HOME, "logs");
const STATUS = path.join(HOME, "status.json");
for (const d of [JOBS, RUNNING, DONE, LOGS]) fs.mkdirSync(d, { recursive: true });

const startedAt = new Date().toISOString();
const live = new Map(); // id -> {job, child|null, adopted, stopRequested, startedAt, pid}
let eventSeq = 0;
const events = [];
const badFiles = new Map(); // jobs/ filename -> consecutive parse/validation failures
const crashLog = new Map(); // service id -> recent crash timestamps (respawn budget)

// Single instance: a second runner would fight over jobs/ and services.
// Liveness is judged by the status heartbeat, not the pid alone: a recycled
// pid (or a wedged runner that stopped writing status) must not block a
// fresh runner forever while every surface still looks green.
const LOCK = path.join(HOME, "runner.lock");
function grabLock() {
  const fd = fs.openSync(LOCK, "wx");
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, since: now() }));
  fs.closeSync(fd);
}
try { grabLock(); } catch (e) {
  let other = 0;
  try {
    const raw = fs.readFileSync(LOCK, "utf8");
    try { other = JSON.parse(raw).pid || 0; } catch (x) { other = parseInt(raw, 10) || 0; }
  } catch (x) {}
  let otherAlive = false;
  if (other) { try { process.kill(other, 0); otherAlive = true; } catch (x) {} }
  let heartbeatFresh = false;
  if (otherAlive) {
    try {
      const s = JSON.parse(fs.readFileSync(STATUS, "utf8"));
      heartbeatFresh = s.runnerPid === other && (Date.now() - new Date(s.heartbeat).getTime() < 90000);
    } catch (x) {}
  }
  if (otherAlive && heartbeatFresh) { console.error("runner already running: " + other); process.exit(0); }
  try { fs.unlinkSync(LOCK); grabLock(); } catch (x) { process.exit(0); }
}

function noteBadFile(f, full) {
  const n = (badFiles.get(f) || 0) + 1;
  badFiles.set(f, n);
  // quarantine only a file that is both repeatedly unreadable AND old:
  // a file still being written by a slow delivery must get its chance
  let ageMs = 0;
  try { ageMs = Date.now() - fs.statSync(full).mtimeMs; } catch (e) {}
  if (n >= 5 && ageMs > 60000) {
    badFiles.delete(f);
    try { fs.renameSync(full, full + ".bad"); } catch (e) {}
    event("坏任务文件已隔离：" + f);
  }
}

function now() { return new Date().toISOString(); }

const CODE_SHA = (() => {
  try { return require("node:crypto").createHash("sha256").update(fs.readFileSync(__filename)).digest("hex").slice(0, 16); } catch (e) { return "unknown"; }
})();

function writeStatus() {
  const data = {
    runnerPid: process.pid,
    runnerSince: startedAt,
    codeSha256: CODE_SHA,
    memoryMB: (() => { const m = process.memoryUsage(); return { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) }; })(),
    heartbeat: now(),
    jobs: [...live.values()].map(v => ({
      id: v.job.id, name: v.job.name || v.job.id,
      type: v.job.type || "once", pid: v.pid, startedAt: v.startedAt
    })),
    events: events.slice(-8),
    lastEventSeq: eventSeq,
    lastConsumedJobId: lastConsumedJobId
  };
  const tmp = STATUS + ".tmp";
  try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, STATUS); } catch (e) {}
}

let lastConsumedJobId = null;
const EVENTS_LOG = path.join(HOME, "events.jsonl");
function event(msg) {
  const rec = { seq: ++eventSeq, ts: now(), msg };
  events.push(rec);
  if (events.length > 30) events.shift();
  // append-only audit trail (status.json only keeps the tail); one rotation
  try {
    if (fs.existsSync(EVENTS_LOG) && fs.statSync(EVENTS_LOG).size > 2 * 1024 * 1024) fs.renameSync(EVENTS_LOG, EVENTS_LOG + ".1");
    fs.appendFileSync(EVENTS_LOG, JSON.stringify({ runId: startedAt, ...rec }) + "\n");
  } catch (e) {}
  writeStatus();
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function startJob(job, jobFile) {
  const id = job.id;
  const logPath = path.join(LOGS, id + ".log");
  // the 20MB cap is per file, not per run: count what is already on disk
  let logBytes = 0, logCapped = false;
  try { logBytes = fs.statSync(logPath).size; } catch (e) {}
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write("\n=== " + now() + " start " + id + " ===\n");
  const child = spawn(job.cmd, job.args || [], {
    cwd: job.cwd || HOME,
    env: Object.assign({}, process.env, job.env || {}),
    shell: !!job.shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const pump = (chunk) => {
    logBytes += chunk.length;
    if (logBytes <= 20 * 1024 * 1024) { try { logStream.write(chunk); } catch (e) {} }
    else if (!logCapped) { logCapped = true; try { logStream.write("\n[log truncated at 20MB]\n"); } catch (e) {} }
  };
  child.stdout.on("data", pump);
  child.stderr.on("data", pump);
  const rec = { job, child, adopted: false, stopRequested: false, startedAt: now(), pid: child.pid, logStream };
  live.set(id, rec);
  lastConsumedJobId = id;
  try { fs.unlinkSync(path.join(RUNNING, id + ".stopped")); } catch (e) {} // a real start clears any stop tombstone
  fs.writeFileSync(path.join(RUNNING, id + ".json"),
    JSON.stringify({ id, name: job.name || id, type: job.type || "once", pid: child.pid, startedAt: rec.startedAt }, null, 2));
  fs.writeFileSync(path.join(RUNNING, id + ".job.json"), JSON.stringify(job, null, 2));
  if (jobFile) { try { fs.unlinkSync(jobFile); } catch (e) {} }
  event((job.type === "service" ? "服务已启动：" : "任务开始：") + (job.name || id));
  child.on("error", (e) => { try { logStream.write("spawn error: " + e.message + "\n"); } catch (x) {} finish(id, -1, "spawn-error"); });
  child.on("exit", (code, signal) => finish(id, code, signal ? "signal:" + signal : "exit"));
  writeStatus();
}

// A crashed service gets a bounded second chance: backoff 5s/20s/60s,
// at most 3 restarts inside 10 minutes, then the runner gives up loudly.
function scheduleRespawn(job) {
  const id = job.id;
  const nowMs = Date.now();
  const arr = (crashLog.get(id) || []).filter(t => nowMs - t < 10 * 60 * 1000);
  if (arr.length >= 3) { crashLog.set(id, arr); event("服务反复崩溃，已停手：" + (job.name || id)); return; }
  arr.push(nowMs); crashLog.set(id, arr);
  const delay = [5000, 20000, 60000][Math.min(arr.length - 1, 2)];
  event("服务将自动重启（" + Math.round(delay / 1000) + " 秒后）：" + (job.name || id));
  setTimeout(() => {
    if (live.has(id)) return;
    if (fs.existsSync(path.join(RUNNING, id + ".stopped"))) return;
    try { startJob(job, null); } catch (e) {}
  }, delay);
}

function finish(id, code, how) {
  const rec = live.get(id);
  if (!rec) return;
  live.delete(id);
  if (rec.logStream) { try { rec.logStream.end(); } catch (e) {} }
  const result = {
    id, name: rec.job.name || id, type: rec.job.type || "once",
    exitCode: code, how: how || "exit", stopped: !!rec.stopRequested,
    startedAt: rec.startedAt, endedAt: now()
  };
  try { fs.writeFileSync(path.join(DONE, id + ".result.json"), JSON.stringify(result, null, 2)); } catch (e) {}
  try { fs.unlinkSync(path.join(RUNNING, id + ".json")); } catch (e) {}
  try { fs.unlinkSync(path.join(RUNNING, id + ".job.json")); } catch (e) {}
  if (rec.job.type === "service") {
    event(rec.stopRequested ? "服务已停止：" + result.name : "服务退出（码 " + code + "）：" + result.name);
    if (!rec.stopRequested) scheduleRespawn(rec.job);
  } else {
    event("任务完成（码 " + code + "）：" + result.name);
  }
  writeStatus();
}

// On boot: adopt services still alive, relaunch services whose pid is gone.
function recover() {
  let files = [];
  try { files = fs.readdirSync(RUNNING).filter(f => f.endsWith(".job.json")); } catch (e) { return; }
  for (const f of files) {
    let job, meta;
    try {
      job = JSON.parse(fs.readFileSync(path.join(RUNNING, f), "utf8"));
      meta = JSON.parse(fs.readFileSync(path.join(RUNNING, job.id + ".json"), "utf8"));
    } catch (e) { continue; }
    if (!job) continue;
    if (job.type !== "service") {
      // a once-job was mid-run when the runner died: leave a record, don't vanish it
      try { fs.writeFileSync(path.join(DONE, job.id + ".result.json"), JSON.stringify({ id: job.id, name: job.name || job.id, type: "once", exitCode: null, how: "runner-died", startedAt: meta ? meta.startedAt : null, endedAt: now() }, null, 2)); } catch (e) {}
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".json")); } catch (e) {}
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".job.json")); } catch (e) {}
      continue;
    }
    if (fs.existsSync(path.join(RUNNING, job.id + ".stopped"))) {
      // stopped on purpose before the runner went down: honour the stop
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".json")); } catch (e) {}
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".job.json")); } catch (e) {}
      continue;
    }
    // adopt only if the pid is alive AND still belongs to the program the job
    // names: a recycled pid must never be adopted (a later stop would kill a
    // stranger's process tree). If the image name cannot be read, stay
    // conservative and adopt — restarting blind could double-run the service.
    let adoptable = isAlive(meta.pid);
    if (adoptable && job.cmd && /[\\/]/.test(job.cmd)) {
      let got = null;
      try {
        const out = execFileSync("tasklist", ["/FI", "PID eq " + meta.pid, "/FO", "CSV", "/NH"], { encoding: "utf8" });
        const m = out.match(/^"([^"]+)"/);
        if (m) got = m[1];
      } catch (e) {}
      if (got && got.toLowerCase() !== path.basename(job.cmd).toLowerCase()) adoptable = false;
    }
    if (adoptable) {
      live.set(job.id, { job, child: null, adopted: true, stopRequested: false, startedAt: meta.startedAt, pid: meta.pid });
      event("服务接管：" + (job.name || job.id));
    } else {
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".json")); } catch (e) {}
      try { fs.unlinkSync(path.join(RUNNING, job.id + ".job.json")); } catch (e) {}
      event("服务重启：" + (job.name || job.id));
      try { startJob(job, null); } catch (e) {}
    }
  }
}

function scanJobs() {
  // adopted services: poll liveness
  for (const [id, rec] of [...live.entries()]) {
    if (rec.adopted && !isAlive(rec.pid)) finish(id, null, "adopted-exit");
  }
  let files = [];
  try { files = fs.readdirSync(JOBS); } catch (e) { return; }
  for (const f of files) {
    const full = path.join(JOBS, f);
    if (f.startsWith("stop-") && f.endsWith(".flag")) {
      const id = f.slice(5, -5);
      try { fs.unlinkSync(full); } catch (e) {}
      // tombstone: this stop stays on record, so a stale job file left in jobs/
      // can never revive the service; only a file delivered after the stop can
      try { fs.writeFileSync(path.join(RUNNING, id + ".stopped"), now()); } catch (e) {}
      const rec = live.get(id);
      if (rec) {
        rec.stopRequested = true;
        execFile("taskkill", ["/PID", String(rec.pid), "/T", "/F"], (err) => {
          if (err) event("停止失败：" + id);
          if (rec.adopted) setTimeout(() => { if (live.has(id)) finish(id, null, "stopped"); }, 800);
        });
      }
      continue;
    }
    if (!f.endsWith(".json")) continue;
    let job;
    try { job = JSON.parse(fs.readFileSync(full, "utf8")); badFiles.delete(f); } catch (e) { noteBadFile(f, full); continue; } // mid-write counts too; quarantined after 5
    if (!job.id || !job.cmd) { noteBadFile(f, full); continue; }
    if (live.has(job.id)) continue;
    const tomb = path.join(RUNNING, job.id + ".stopped");
    if (fs.existsSync(tomb)) {
      let t = 0, m = 0;
      try { t = Date.parse(fs.readFileSync(tomb, "utf8")) || 0; } catch (e) {}
      try { m = fs.statSync(full).mtimeMs; } catch (e) {}
      if (m <= t) { try { fs.unlinkSync(full); } catch (e) {} continue; }
      try { fs.unlinkSync(tomb); } catch (e) {}
    }
    try { startJob(job, full); } catch (e) {
      try {
        fs.writeFileSync(path.join(DONE, (job.id || "bad") + ".result.json"), JSON.stringify({ id: job.id, error: String(e) }, null, 2));
        fs.unlinkSync(full);
      } catch (x) {}
    }
  }
}

// Housekeeping: per-id files (done results, logs, stop tombstones) and the
// crash log would otherwise grow forever, one new id at a time.
function housekeeping() {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const sweep = (dir, pred) => {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { return; }
    for (const f of files) {
      if (!pred(f)) continue;
      const full = path.join(dir, f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch (e) {}
    }
  };
  sweep(DONE, f => f.endsWith(".result.json"));
  sweep(LOGS, f => f.endsWith(".log"));
  sweep(RUNNING, f => f.endsWith(".stopped"));
  for (const [cid, arr] of [...crashLog.entries()]) {
    const kept = arr.filter(t => Date.now() - t < 10 * 60 * 1000);
    if (!kept.length && !live.has(cid)) crashLog.delete(cid); else crashLog.set(cid, kept);
  }
}

recover();
writeStatus();
event("管家已上线");
setInterval(scanJobs, 1000);
setInterval(writeStatus, 5000);
setTimeout(housekeeping, 60000);
setInterval(housekeeping, 24 * 3600 * 1000);
