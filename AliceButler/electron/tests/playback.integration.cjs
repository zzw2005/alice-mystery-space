const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const base = path.resolve(__dirname, '../test-results'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'playback-'));
  const effects = process.env.ALICE_TEST_EFFECTS_MODE;
  if (effects) {
    assert.ok(['on', 'off'].includes(effects));
    await fs.writeFile(path.join(root, 'pet-settings.json'), JSON.stringify({ effectsEnabled: effects === 'on', atmosphere: 'glow' }));
  }
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      ...(process.env.ALICE_TEST_SWIFTSHADER === '1' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      `--user-data-dir=${path.join(root, 'profile')}`, path.resolve(__dirname, '..')],
    env: { ...process.env, ALICE_PET_TEST: '1', ALICE_PET_ROOT: root } });
  const errors = []; app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
  try {
    let pet;
    for (let i = 0; i < 100 && !pet; i++) { pet = app.windows().find(p => p.url().endsWith('pet.html')); if (!pet) await delay(50); }
    assert.ok(pet);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('pet.html')).showInactive());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'idle');
    for (let i = 0; i < 100 && !await app.evaluate(() => Boolean(global.aliceTest)); i++) await delay(50);
    assert.equal(app.windows().length, 1);
    let steadyVideo;
    if (effects) {
      await pet.waitForFunction(mode => {
        const host = document.querySelector('#effects');
        return mode === 'on' ? host?.dataset.renderer === 'webgl2' && !host.hidden : !host?.querySelector('canvas');
      }, effects);
      await delay(400);
      steadyVideo = await pet.evaluate(async () => {
        const video = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
        const before = video.getVideoPlaybackQuality(), start = performance.now();
        await new Promise(resolve => setTimeout(resolve, 2200));
        const after = video.getVideoPlaybackQuality();
        const frames = after.totalVideoFrames - before.totalVideoFrames;
        const dropped = after.droppedVideoFrames - before.droppedVideoFrames;
        return { frames, fps: (frames - dropped) * 1000 / (performance.now() - start), dropped };
      });
      assert.ok(steadyVideo.frames > 0);
    }
    // Composite a downscaled actor every display frame, including the poster,
    // to detect transparent/black gaps without full-size readback test overhead.
    await pet.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      window.playbackCheck = { frames: 0, gaps: 0, gapSamples: [], black: 0, maxSources: 0, running: true };
      const check = () => {
        const r = window.playbackCheck; if (!r.running) return;
        ctx.clearRect(0, 0, 160, 90);
        const layers = [document.querySelector('#poster'), ...document.querySelectorAll('video')]
          .sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
        for (const element of layers) {
          const opacity = Number(getComputedStyle(element).opacity);
          if (opacity > 0 && (!(element instanceof HTMLVideoElement) || element.readyState >= 2)) {
            ctx.globalAlpha = opacity; ctx.drawImage(element, 0, 0, 160, 90);
          }
        }
        ctx.globalAlpha = 1;
        const pixels = ctx.getImageData(0, 0, 160, 90).data;
        let opaque = 0, black = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 100) opaque++;
          if (pixels[i + 3] > 250 && pixels[i] < 5 && pixels[i + 1] < 5 && pixels[i + 2] < 5) black++;
        }
        r.frames++; if (opaque < 500) { r.gaps++; r.gapSamples.push({ opaque, actor: { ...document.querySelector('#actor').dataset }, poster: getComputedStyle(document.querySelector('#poster')).opacity,
          videos: [...document.querySelectorAll('video')].map(v => ({ src: v.src, ready: v.readyState, opacity: getComputedStyle(v).opacity })) }); } if (black / (160 * 90) >= .05) r.black++;
        r.maxSources = Math.max(r.maxSources, [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length);
        requestAnimationFrame(check);
      }; requestAnimationFrame(check);
    });
    const play = async clip => {
      const token = await app.evaluate((_, c) => global.aliceTest.play(c), clip);
      await pet.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t), token);
      return token;
    };
    const selected = process.env.ALICE_SMOKE_CLIPS?.split(',') || Object.keys(require('../config.json').clips);
    for (const clip of selected) {
      await play(clip); await delay(250);
      if (['idle', 'walk', 'doze', 'dangle'].includes(clip)) {
        await pet.evaluate(() => {
          const video = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
          video.currentTime = video.duration - .08;
        });
        await delay(450);
        await pet.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.hasAttribute('src') && v.currentTime > .1 && v.currentTime < 1) && getComputedStyle(document.querySelector('#poster')).opacity === '0');
      }
    }
    // Supersede pending loads and fades; the last request alone must win.
    const token = await app.evaluate(() => {
      for (let i = 0; i < 30; i++) global.aliceTest.play(['dangle', 'doze', 'idle', 'clickhappy'][i % 4]);
      return global.aliceTest.play('idle');
    });
    await pet.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t), token);
    await delay(250);
    assert.equal(await pet.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length), 1);
    const sameSourceTime = await pet.evaluate(() => [...document.querySelectorAll('video')].find(v => v.style.opacity === '1').currentTime);
    await play('idle');
    assert.ok(await pet.evaluate(t => [...document.querySelectorAll('video')].find(v => v.style.opacity === '1').currentTime >= t, sameSourceTime), 'same loop request preserves decoder/timeline');
    await app.evaluate(() => global.aliceTest.park());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'true');
    assert.equal(await pet.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length), 0);
    await delay(300);
    await app.evaluate(() => global.aliceTest.resume());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'false');
    await app.evaluate(() => global.aliceTest.sleep());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'doze', null, { timeout: 16000 });
    await delay(1200);
    assert.equal((await app.evaluate(() => global.aliceTest.state())).suspended, false, 'fresh sleep stays animated');
    // Optional real-time soak; otherwise exercise the same production timer
    // after aging its eligibility timestamp, without shortening its threshold.
    if (process.env.ALICE_PLAYBACK_SOAK === '1') await delay(122000);
    else await app.evaluate(() => global.aliceTest.ageLowActivity(120001));
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'true', null, { timeout: 5000 });
    await app.evaluate(() => global.aliceTest.wake());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'wakeup');
    const wakeToken = await pet.locator('#actor').getAttribute('data-token');
    // After a long sleep an overdue random action can supersede the idle load
    // before its first frame. Wake succeeds when the next awake clip presents.
    await pet.waitForFunction(token => {
      const actor = document.querySelector('#actor');
      return Number(actor.dataset.token) > Number(token) && !actor.dataset.kind.startsWith('sleep.');
    }, wakeToken, { timeout: 16000 });
    assert.equal((await app.evaluate(() => global.aliceTest.state())).rest, 'awake');
    await app.evaluate(() => global.aliceTest.hide()); await delay(1200);
    await app.evaluate(() => global.aliceTest.ageLowActivity(120001));
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'true', null, { timeout: 5000 });
    await app.evaluate(() => global.aliceTest.show());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.suspended === 'false');
    const resumeToken = await app.evaluate(() => {
      global.aliceTest.hide(); global.aliceTest.park(); global.aliceTest.show();
      return global.aliceTest.state().token;
    });
    await pet.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t) && document.querySelector('#actor').dataset.suspended === 'false', resumeToken);
    await pet.screenshot({ path: path.join(root, 'pet.png'), omitBackground: true });
    const check = await pet.evaluate(() => { window.playbackCheck.running = false; return window.playbackCheck; });
    assert.equal(check.gaps, 0, JSON.stringify(check)); assert.equal(check.black, 0, JSON.stringify(check)); assert.ok(check.maxSources <= 2);
    assert.deepEqual(errors, []);
    const log = await fs.readFile(path.join(root, 'pet-error.log'), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
    assert.equal(log, '', log);
    const result = { checks: check, effects, steadyVideo, sleepSoak: process.env.ALICE_PLAYBACK_SOAK === '1', errors,
      state: await app.evaluate(() => global.aliceTest.state()) };
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ root, ...result }, null, 2));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
