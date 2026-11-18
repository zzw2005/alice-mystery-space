const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dailyCheck } = require('../../daily-check');
const { RunStats } = require('../dist/main/run-stats');

test('weekly buckets migrate legacy stats, expire old dates and retain an interrupted session', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-week-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'pet-stats.json');
  fs.writeFileSync(file, '{"runtime":"electron"}');
  const stats = new RunStats(file);
  stats.today(new Date(Date.now() - 7 * 86400000)).plays.walk = 4;
  stats.recordMemory(300, 150); stats.recordMemory(200, null);
  assert.equal(Object.keys(stats.days).length, 1);
  assert.equal(stats.today().privatePeakMiB, 150);
  fs.writeFileSync(file, JSON.stringify({ sessionOpen: true, sessionId: 'previous', days: stats.days }));
  const next = new RunStats(file);
  assert.equal(next.today().crashes, 1); assert.equal(next.today().recoveries, 0);
  assert.equal(next.recoveryPending, false);
  fs.writeFileSync(path.join(root, 'pet-restart-request.json'), JSON.stringify({
    previousSession: 'previous', ts: Date.now(), expiresAt: Date.now()+10000 }));
  assert.equal(new RunStats(file).recoveryPending, true);
});

test('runner reports missing pet, stale heartbeat and decode timeout once per UTC day', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = require('../../butler-config.json');
  const day = new Date().toISOString().slice(0, 10);
  const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value));
  write('pet-check-request.json', { day, ts: new Date(Date.now() - config.dailyCheck.probeWaitMs - 1).toISOString() });
  write('status.json', { runnerPid: process.pid, heartbeat: '2000-01-01T00:00:00Z' });
  const result = path.join(root, 'pet-daily-check.json');
  dailyCheck(root, config)();
  const sample = fs.readFileSync(result, 'utf8'), data = JSON.parse(sample);
  assert.equal(data.ok, false);
  for (const name of ['processes', 'runnerHeartbeat', 'petHeartbeat', 'media']) assert.equal(data.checks[name].ok, false);
  dailyCheck(root, config)();
  assert.equal(fs.readFileSync(result, 'utf8'), sample);
});
