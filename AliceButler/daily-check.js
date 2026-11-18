"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Keep diagnostic failures useful without copying native paths, stderr or JSON excerpts.
function diagnosticCode(error) {
  if (error instanceof SyntaxError) return "invalid-json";
  return typeof error?.code === "string" && /^E[A-Z0-9_]+$/.test(error.code) ? error.code : "check-failed";
}

function dailyCheck(root, config) {
  let finishedDay, request;
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  function optional(name) {
    try { return read(name); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  function write(name, value) {
    const target = path.join(root, name), temp = target + "." + randomUUID() + ".tmp";
    try { fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, target); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  function inspect(check) {
    try { return check(); }
    catch (error) { return { ok: false, error: diagnosticCode(error) }; }
  }
  function alive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Error("missing pid");
    process.kill(pid, 0);
    return pid;
  }
  function heartbeat(value, threshold) {
    const ageMs = Date.now() - Date.parse(value);
    return { ok: ageMs >= 0 && ageMs <= threshold * 1000, ageMs };
  }
  return function tick() {
    const ts = new Date().toISOString(), day = ts.slice(0, 10);
    if (day === finishedDay) return;
    if (request?.day !== day) {
      if (optional("pet-daily-check.json")?.day === day) { finishedDay = day; return; }
      request = optional("pet-check-request.json");
      if (request?.day !== day) { request = { day, ts }; write("pet-check-request.json", request); }
    }
    const probe = inspect(() => ({ ok: true, data: optional("pet-decode-check.json") }));
    const decode = probe.data;
    if (decode?.day !== day && Date.now() - Date.parse(request.ts) < config.dailyCheck.probeWaitMs) return;
    const media = decode?.day === day ? inspect(() => {
      const clips = Object.fromEntries(Object.entries(decode.clips).map(([name, result]) =>
        [name, result === "ok" || result === "decode-timeout" ? result : "decode-failed"]));
      return { ok: Object.keys(clips).length > 0 && Object.values(clips).every(v => v === "ok"), clips };
    }) : { ok: false, error: probe.error || "no decode response for " + day };
    const checks = {
      processes: inspect(() => ({ ok: true, runner: alive(read("status.json").runnerPid), pet: alive(read("pet-stats.json").pid) })),
      runnerHeartbeat: inspect(() => heartbeat(read("status.json").heartbeat, config.watchThresholds.runnerHeartbeatStaleSec)),
      petHeartbeat: inspect(() => heartbeat(fs.readFileSync(path.join(root, "pet-heartbeat.txt"), "utf8").trim(), config.watchThresholds.petHeartbeatStaleSec)),
      media,
      disk: inspect(() => {
        const stat = fs.statfsSync(root), freeMiB = Math.floor(stat.bavail * stat.bsize / 1048576);
        return { ok: freeMiB >= config.dailyCheck.diskMinMiB, freeMiB, minMiB: config.dailyCheck.diskMinMiB };
      })
    };
    write("pet-daily-check.json", { day, ts, ok: Object.values(checks).every(c => c.ok), checks });
    finishedDay = day;
  };
}
module.exports = { dailyCheck, diagnosticCode };
