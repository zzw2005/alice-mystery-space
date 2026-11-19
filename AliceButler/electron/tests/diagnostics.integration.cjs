const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');
const { dailyCheck } = require('../../daily-check');
const config = require('../../butler-config.json');
const { loadPosition } = require('../dist/main/placement');
const source = path.resolve(__dirname, '..');

test('chat, malformed config and failed probes leave no seed in diagnostics', async t => {
  const seeds = {
    chat: 'fictional chat about a violet mailbox',
    key: 'sk-test-alice-diagnostics-0123456789abcdef',
    path: 'AlicePrivate-7c2f',
    contact: 'alice-probe@example.invalid'
  };
  const payload = Object.values(seeds).join(' | ') + ' | C:/Users/' + seeds.path + '/notes';
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-diagnostics-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, seeds.path), appPath = path.join(base, 'app');
  await fs.mkdir(root);
  await fs.mkdir(appPath);
  await Promise.all(['defaults.json', 'package.json', 'dist', 'ui', 'media'].map(entry =>
    fs.cp(path.join(source, entry), path.join(appPath, entry), { recursive: true })));
  // JSON.parse errors include the rejected token/text on supported Node versions.
  await fs.writeFile(path.join(appPath, 'config.json'), '{invalid: ' + payload);
  const write = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value));
  const read = name => fs.readFile(path.join(root, name), 'utf8');
  await write('presence.json', { state: 'working', ts: new Date().toISOString(), note: payload });

  const app = await electron.launch({ executablePath: require('electron'), args: [
    ...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    `--user-data-dir=${path.join(base, 'profile')}`, appPath
  ], env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' } });
  try {
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'idle');
    for (const end = Date.now() + 5000; Date.now() < end && !await app.evaluate(() => !!global.aliceTest); )
      await delay(50);
    assert.ok(await app.evaluate(() => !!global.aliceTest), 'main-process test hooks are ready');
    await app.evaluate(async () => { await global.aliceTest.openChat(); });
    const chat = app.windows().find(page => page.url().endsWith('chat.html'));
    const id = await chat.evaluate(text => window.alice.send(text), payload);
    assert.equal(JSON.parse(await read(`inbox/${id}.json`)).text, payload);
    await fs.mkdir(path.join(root, 'outbox'), { recursive: true });
    await write(`outbox/reply-${id}.json.tmp`, { id, text: payload });
    await fs.rename(path.join(root, `outbox/reply-${id}.json.tmp`), path.join(root, `outbox/reply-${id}.json`));
    await pet.waitForFunction(text => document.querySelector('#bubble').textContent === text, payload);
    assert.equal(JSON.parse(await read(`outbox/seen/reply-${id}.json`)).text, payload);

    const day = new Date().toISOString().slice(0, 10);
    const mediaIds = Object.keys(require('../defaults.json').clips);
    await write('status.json', { runnerPid: process.pid, heartbeat: new Date().toISOString() });
    const checkToday = dailyCheck(root, config);
    checkToday();
    let probe;
    for (const end = Date.now() + 20000; !probe && Date.now() < end; ) {
      await delay(100);
      probe = await read('pet-decode-check.json').then(JSON.parse, error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    assert.equal(probe?.day, day);
    assert.deepEqual(probe.clips, Object.fromEntries(mediaIds.map(id => [id, 'ok'])));
    checkToday();
    const successfulDaily = await read('pet-daily-check.json');
    assert.equal(JSON.parse(successfulDaily).checks.media.ok, true);
    await fs.rm(path.join(root, 'status.json'));
    await fs.rm(path.join(root, 'pet-daily-check.json'));

    // Polling a regular file where the seen directory should be records
    // a native filesystem error containing the private path on the baseline.
    const seen = path.join(root, 'outbox', 'seen');
    await fs.rename(seen, seen + '.saved');
    await fs.writeFile(seen, payload);
    const backupName = (await fs.readdir(root)).find(name => name.startsWith('config.json.bad-'));
    assert.ok(backupName, 'config recovery recorded');
    const originalLog = await read('pet-error.log');
    let log = originalLog;
    for (const end = Date.now() + 8000; log === originalLog && Date.now() < end; ) {
      await delay(100);
      log = await read('pet-error.log');
    }
    assert.notEqual(log, originalLog, 'outbox directory failure was logged');

    await write('pet-check-request.json', { day, ts: new Date(Date.now() - config.dailyCheck.probeWaitMs - 1000).toISOString() });
    await fs.writeFile(path.join(root, 'pet-decode-check.json'), '!' + payload);
    // Reuse the same day after the app probe to exercise the runner's timeout path.
    dailyCheck(root, config)();
    const failedDaily = await read('pet-daily-check.json');
    assert.equal(JSON.parse(failedDaily).checks.media.ok, false);
    assert.equal(JSON.parse(failedDaily).checks.processes.ok, false);

    // Exercise a same-day decode response containing legacy free-form errors.
    await fs.rm(path.join(root, 'pet-daily-check.json'));
    await write('pet-decode-check.json', { day, clips: { idle: 'ok', walk: payload } });
    dailyCheck(root, config)();
    const daily = await read('pet-daily-check.json');
    assert.equal(JSON.parse(daily).checks.media.ok, false);
    const stats = await read('pet-stats.json');
    const rtt = Object.values(JSON.parse(stats).days).flatMap(day => day.chatRoundTripMs);
    assert.equal(rtt.length, 1);
    const weekly = execFileSync(process.execPath, [path.resolve(source, '../pet-weekly.js'), root], { encoding: 'utf8' });
    assert.match(weekly, /聊天往返　1 个样本/);
    const surfaces = { stats, weekly, successfulDaily, daily, failedDaily, log, backup: await read(backupName) };
    const leaks = Object.entries(surfaces).flatMap(([name, output]) =>
      Object.entries(seeds).filter(([, seed]) => output.includes(seed)).map(([kind]) => name + '/' + kind));
    assert.deepEqual(leaks, []);
  } finally { await app.close(); }
});

test('runner, watchdog and failed weekly reads do not echo private input', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-butler-diagnostics-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const privatePath = 'AlicePrivate-7c2f', contact = 'seed@x.invalid';
  const root = path.join(base, privatePath);
  await fs.mkdir(root);
  const target = name => path.join(root, name);
  await Promise.all(['runner.js', 'watchdog.js', 'daily-check.js', 'pet-weekly.js'].map(file =>
    fs.copyFile(path.resolve(source, '..', file), target(file))));
  await fs.writeFile(target('butler-config.json'), JSON.stringify({
    ...config, runner: { ...config.runner, initialSweepMs: 50 }, watchdogRestartMs: 5
  }));
  await fs.writeFile(target('pet-position.json'), contact);
  const positionLogs = [];
  const restoreConsole = t.mock.method(console, 'error', message => positionLogs.push(String(message)));
  try { assert.equal(loadPosition(target('pet-position.json')), undefined); }
  finally { restoreConsole.mock.restore(); }
  assert.deepEqual(positionLogs, ['pet-position-read: invalid or unreadable']);
  await fs.writeFile(target('pet-stats.json'), contact);
  await fs.writeFile(target('pet-check-request.json'), contact);
  await fs.writeFile(target('status.json'), JSON.stringify({ heartbeat: new Date().toISOString() }));
  // A process-local scheduler stub keeps this test independent of Windows tasks.
  const stub = path.join(base, 'scheduler.cjs');
  await fs.writeFile(stub, "require('node:child_process').execFile = (_file, _args, done) => done(null);");
  execFileSync(process.execPath, ['--require', stub, target('watchdog.js')]);
  const weekly = spawnSync(process.execPath, [target('pet-weekly.js'), root], { encoding: 'utf8' });
  assert.equal(weekly.status, 1);
  const runner = spawn(process.execPath, [target('runner.js')], { stdio: 'ignore' });
  const exited = once(runner, 'exit');
  let events = '';
  try {
    for (const end = Date.now() + 5000; !events.includes('每日自检失败') && Date.now() < end; ) {
      await delay(50);
      events = await fs.readFile(target('events.jsonl'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
    }
    assert.match(events, /每日自检失败：invalid-json/);
  } finally {
    runner.kill();
    await exited;
  }
  const watchdog = await fs.readFile(target('watchdog.log'), 'utf8');
  assert.match(watchdog, /read pet session: invalid-json/);
  assert.match(weekly.stderr, /周报失败　invalid-json/);
  for (const [label, output] of Object.entries({ events, watchdog, weekly: weekly.stdout + weekly.stderr })) {
    assert.equal(output.includes(contact), false, label + ' contact');
    assert.equal(output.includes(privatePath), false, label + ' path');
  }
});
