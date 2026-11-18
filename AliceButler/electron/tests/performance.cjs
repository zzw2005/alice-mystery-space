// Isolated, repeatable samples. Run on Windows for the acceptance memory counters.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const dir = path.resolve(process.env.ALICE_BENCH_APP || path.join(__dirname, '..'));
const output = path.resolve(process.env.ALICE_BENCH_OUTPUT || path.join(__dirname, '../test-results/performance.json'));
const delay = ms => new Promise(r => setTimeout(r, ms));
async function run(mode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-bench-'));
  const start = performance.now();
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [...(process.env.ALICE_HEADLESS === '1' ? ['--ozone-platform=headless'] : []), ...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), ...(mode === 'off' ? ['--disable-gpu'] : []), `--user-data-dir=${path.join(root, "profile")}`, dir],
    env: { ...process.env, ALICE_PET_TEST: '1', ALICE_PET_ROOT: root, ALICE_PET_ACCELERATION: mode } });
  const errors = [];
  app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
  try {
    let pet;
    for (let i = 0; i < 100 && !pet; i++) { pet = app.windows().find(p => p.url().endsWith('pet.html')); if (!pet) await delay(50); }
    if (!pet) throw Error('pet did not load');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('pet.html')).showInactive());
    await pet.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.readyState >= 2 && v.currentTime > 0 && v.style.opacity === '1'));
    const launchToFrameMs = performance.now() - start;
    await app.evaluate(() => Boolean(global.aliceTest));
    const sample = async () => {
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
      let privateResidentMB = null;
      if (process.platform === 'linux') {
        privateResidentMB = 0;
        for (const p of metrics) {
          const rollup = await fs.readFile(`/proc/${p.pid}/smaps_rollup`, 'utf8');
          privateResidentMB += [...rollup.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+)/gm)].reduce((n, m) => n + Number(m[1]), 0) / 1024;
        }
      }
      return { processes: metrics.length,
        workingSetMB: metrics.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024,
        privateMB: metrics.every(p => typeof p.memory.privateBytes === 'number') ? metrics.reduce((n, p) => n + p.memory.privateBytes, 0) / 1024 : null,
        privateResidentMB, cpuPercent: metrics.reduce((n, p) => n + p.cpu.percentCPUUsage, 0) };
    };
    await delay(1500); await sample();
    const idle = [];
    for (let i = 0; i < 5; i++) { await delay(1000); idle.push(await sample()); }
    const clips = {};
    for (const clip of Object.keys(require(path.join(dir, 'config.json')).clips)) {
      const token = await app.evaluate((_, c) => global.aliceTest.play(c), clip);
      await pet.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t), token);
      await delay(250);
      const quality = () => pet.evaluate(() => {
        const v = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
        const q = v.getVideoPlaybackQuality(); return { total: q.totalVideoFrames, dropped: q.droppedVideoFrames, time: v.currentTime };
      });
      const before = await quality(); const at = performance.now(); await delay(1000); const after = await quality();
      clips[clip] = { sources: await pet.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length),
        totalFrames: after.total, droppedFrames: after.dropped, stableDropped: after.dropped - before.dropped,
        stableFps: (after.total - before.total - after.dropped + before.dropped) * 1000 / (performance.now() - at) };
    }
    await app.evaluate(() => global.aliceTest.play('idle')); await delay(1000);
    const afterClips = await sample();
    const features = await app.evaluate(() => ({ park: typeof global.aliceTest.park === 'function', startup: global.aliceTest.state().startupMs ?? null }));
    let parked = null, resumed = null;
    if (features.park) {
      await app.evaluate(() => global.aliceTest.park());
      await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'true');
      await delay(1000); await sample(); await delay(1000); parked = await sample();
      await app.evaluate(() => global.aliceTest.resume());
      await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'false');
      await delay(500); resumed = await sample();
    }
    const errorLog = await fs.readFile(path.join(root, 'pet-error.log'), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
    if (errors.length || errorLog) throw Error(JSON.stringify({ errors, errorLog }));
    return { mode, launchToFrameMs, internalStartupMs: features.startup, idle, afterClips, parked, resumed, clips, errors,
      gpu: await app.evaluate(({ app }) => app.getGPUFeatureStatus()) };
  } finally { await app.close(); await fs.rm(root, { recursive: true, force: true }); }
}
(async () => {
  const runs = [];
  for (let i = 0; i < Number(process.env.ALICE_BENCH_RUNS || 3); i++) for (const mode of ['on', 'off']) { runs.push(await run(mode)); console.log(`sample ${i + 1} ${mode} complete`); }
  const result = { platform: process.platform, arch: process.arch, electron: require('electron/package.json').version,
    headless: process.env.ALICE_HEADLESS === '1', memoryUnit: 'MiB; Windows privateBytes only; Linux privateResidentMB is a separate /proc counter', runs };
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(output);
})().catch(e => { console.error(e); process.exitCode = 1; });
