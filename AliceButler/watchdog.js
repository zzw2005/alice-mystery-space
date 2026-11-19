"use strict";
// Watchdog: keep the butler runner and the desktop pet alive.
// - runner: judged by status.json heartbeat. A stale heartbeat means the
//   runner is dead OR wedged; /run alone is a no-op while its task is still
//   marked running, so a stale runner is ended first, then relaunched.
// - pet: judged by pet-heartbeat.txt. A missing/unreadable heartbeat counts
//   as stale (an old build or a crashed pet must not become invisible),
//   unless the pet was exited on purpose (pet-disabled.flag).
// Every run leaves one decision line in watchdog.log — silence is exactly
// how failures used to hide.
const config = require("./butler-config.json");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { diagnosticCode } = require("./daily-check");

const LOG = path.join(__dirname, "watchdog.log");
function logLine(msg) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > config.limits.watchdogLogMB * 1048576) fs.renameSync(LOG, LOG + ".1");
    fs.appendFileSync(LOG, new Date().toISOString() + " " + msg + "\n");
  } catch (e) {}
}
function schtasks(args, cb) { execFile("schtasks", args, (err) => { if (cb) cb(err); }); }

let runnerState = "stale";
try {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, "status.json"), "utf8"));
  if (Date.now() - new Date(s.heartbeat).getTime() < config.watchThresholds.runnerHeartbeatStaleSec * 1000) runnerState = "ok";
} catch (e) { runnerState = "unreadable"; }

let petState = "ok";
try {
  if (fs.existsSync(path.join(__dirname, "pet-disabled.flag"))) petState = "disabled";
  else {
    const hb = fs.readFileSync(path.join(__dirname, "pet-heartbeat.txt"), "utf8").trim();
    if (Date.now() - new Date(hb).getTime() <= config.watchThresholds.petHeartbeatStaleSec * 1000) petState = "ok"; else petState = "stale";
  }
} catch (e) { petState = "missing"; }

const actions = [];
if (runnerState !== "ok") {
  actions.push("runner:end+run");
  schtasks(["/end", "/tn", "AliceButler"], (err) => {
    if (err) logLine("end AliceButler failed: " + diagnosticCode(err));
    setTimeout(() => schtasks(["/run", "/tn", "AliceButler"], (e2) => {
      if (e2) logLine("run AliceButler failed: " + diagnosticCode(e2));
    }), config.watchdogRestartMs);
  });
}
if (petState === "stale" || petState === "missing") {
  actions.push("pet:run");
  // Tie a scheduler restart to the interrupted Electron session. Only a first
  // frame in the next process will count it as a successful recovery.
  const receipt = path.join(__dirname, "pet-restart-request.json");
  let previous;
  try { previous = JSON.parse(fs.readFileSync(path.join(__dirname, "pet-stats.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") logLine("read pet session: " + diagnosticCode(error)); }
  if (previous?.sessionOpen && previous.sessionId) {
    const temp = receipt + "." + process.pid + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify({ previousSession: previous.sessionId, ts: Date.now(),
        expiresAt: Date.now() + config.watchThresholds.petHeartbeatStaleSec * 1000 }));
      fs.renameSync(temp, receipt);
    } catch (error) { logLine("write pet recovery receipt: " + diagnosticCode(error)); }
  }
  schtasks(["/run", "/tn", "AlicePetLaunch"], (err) => {
    if (err) { logLine("run AlicePetLaunch failed: " + diagnosticCode(err)); fs.rmSync(receipt, { force: true }); }
  });
}
logLine("check runner=" + runnerState + " pet=" + petState + " action=" + (actions.length ? actions.join(",") : "none"));
