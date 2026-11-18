// Capture Chromium compositor output, including the compositor's alpha plane.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
(async () => {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results/switch-'));
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [...(process.env.ALICE_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), '--user-data-dir=' + path.join(root, 'profile'), process.cwd()],
    env: { ...process.env, ALICE_PET_TEST: '1', ALICE_PET_ROOT: root } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('#actor')?.dataset.clip === 'idle');
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.showInactive();
      const sample = global.switchSample = { start: performance.now(), token: 0, samples: [], frames: [], strip: [] };
      ipcMain.on('video-ready', (_e, token) => {
        if (token === sample.token) sample.samples.push({ token, clip: global.aliceTest.state().action.clip, ms: performance.now() - sample.start });
      });
      w.webContents.beginFrameSubscription((image) => {
        const thumb = image.resize({ width: 160, height: 90 }), pixels = thumb.toBitmap();
        let opaque = 0, black = 0, brightness = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i+3];
          if (alpha > 100) opaque++;
          if (alpha > 250 && Math.max(pixels[i], pixels[i+1], pixels[i+2]) < 5) black++;
          brightness += (pixels[i]+pixels[i+1]+pixels[i+2])/3;
        }
        sample.frames.push([sample.token, performance.now(), opaque, black, Math.round(brightness)]);
        if (sample.samples.length < 3) sample.strip.push(thumb.toPNG().toString('base64'));
      });
    });
    const ids = process.env.ALICE_SMOKE_CLIPS?.split(',') || Object.keys(require('../config.json').clips);
    // An Euler tour visits every directed pair once, including reverse transitions.
    const edges = new Map(ids.map(a => [a, ids.filter(b => b !== a)]));
    const stack = [ids[0]], tour = [];
    while (stack.length) {
      const next = edges.get(stack.at(-1)).pop();
      if (next) stack.push(next); else tour.push(stack.pop());
    }
    for (const id of tour.reverse()) {
      if (await page.locator('#actor').getAttribute('data-clip') === id) continue;
      const token = await app.evaluate((_, clip) => {
        const s = global.switchSample; s.start = performance.now(); s.token = global.aliceTest.play(clip); return s.token;
      }, id);
      await page.waitForFunction(t => +document.querySelector('#actor').dataset.token === t, token);
      await delay(300);
    }
    const { samples, frames, strip } = await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.endFrameSubscription(); return global.switchSample;
    });
    await fs.writeFile(path.join(root, 'frames.csv'), 'token,tMs,opaque,black,lumaSum\n' + frames.map(f => f.join(',')).join('\n')+'\n');
    for (const [i, data] of strip.entries()) await fs.writeFile(path.join(root, `frame-${String(i).padStart(3,'0')}.png`), Buffer.from(data, 'base64'));
    const times = samples.map(s => s.ms).sort((a,b) => a-b);
    const gaps = frames.filter(f => f[2] < 500).length, black = frames.filter(f => f[3] >= 720).length;
    // A one-frame brightness excursion relative to BOTH neighbours catches flashes
    // while allowing continuous motion or a monotonic change between poses.
    const flashes = frames.slice(1,-1).filter((f,i) => {
      const low = Math.min(frames[i][4],frames[i+2][4]), high = Math.max(frames[i][4],frames[i+2][4]);
      return f[4] < low * .75 || f[4] > high * 1.25;
    }).length;
    const result = { root, samples, medianMs: (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2,
      maxMs: times.at(-1), frames: frames.length, strips: strip.length, gaps, black, flashes };
    console.log(JSON.stringify(result));
    assert.ok(times.length >= ids.length * (ids.length - 1) && times.length && frames.length >= times.length * 3);
    for (const s of samples) assert.ok(frames.some(f => f[0] === s.token), 'no compositor frame for token ' + s.token);
    assert.equal(gaps + black + flashes, 0);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
