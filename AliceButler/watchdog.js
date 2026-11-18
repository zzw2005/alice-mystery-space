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
    if (err) logLine("end AliceButler failed: " + err.message);
    setTimeout(() => schtasks(["/run", "/tn", "AliceButler"], (e2) => {
      if (e2) logLine("run AliceButler failed: " + e2.message);
    }), config.watchdogRestartMs);
  });
}
if (petState === "stale" || petState === "missing") {
  actions.push("pet:run");
  schtasks(["/run", "/tn", "AlicePetLaunch"], (err) => { if (err) logLine("run AlicePetLaunch failed: " + err.message); });
}
logLine("check runner=" + runnerState + " pet=" + petState + " action=" + (actions.length ? actions.join(",") : "none"));
