const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

test('trigger events live in the seven-day stats and appear independently in the weekly report', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-triggers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'pet-stats.json');
  const stats = new RunStats(file);
  const now = new Date(), week = new Date(now - 6 * 86400000), expired = new Date(now - 7 * 86400000);
  const state = { kind: 'clicks', rest: 'awake', presence: 'idle', motion: 'idle', chatOpen: false };
  stats.recordTrigger('expired', 'walk', state, expired);
  stats.recordTrigger('click-combo', 'clicktsun', state, week);
  const day = stats.today(now);
  day.plays.clicktsun = 5;
  day.crashes = 2; day.recoveries = 1; day.chatRoundTripMs.push(200);
  fs.writeFileSync(file, JSON.stringify({ days: stats.days }));
  const reloaded = new RunStats(file);
  reloaded.recordTrigger('click-combo', 'clicktsun', state, now);
  reloaded.recordTrigger('presence', 'wave', { ...state, kind: 'success', presence: 'success' }, now);
  const recorded = reloaded.today(now);
  assert.deepEqual(recorded.triggers[0], { ts: now.toISOString(), source: 'click-combo', clip: 'clicktsun', state });
  assert.deepEqual(recorded.plays, { clicktsun: 5 });
  assert.equal(reloaded.days[expired.toISOString().slice(0, 10)], undefined);
  fs.writeFileSync(file, JSON.stringify({ days: reloaded.days }));
  const weekly = execFileSync(process.execPath, [path.join(__dirname, '../../pet-weekly.js'), root], { encoding: 'utf8' });
  assert.match(weekly, /动作播放　clicktsun × 5/);
  assert.match(weekly, /触发来源　click-combo × 2，presence × 1/);
  assert.match(weekly, /异常结束 2 次　看门狗自愈 1 次/);
  assert.match(weekly, /聊天往返　1 个样本　P50 200 ms/);
  assert.doesNotMatch(weekly, /expired/);
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
