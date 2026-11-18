const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../test-results'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'electron-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), `--user-data-dir=${path.join(root, 'profile')}`, path.resolve(__dirname, '..')],
    env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' } });
  const errors = []; app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
  try {
    for (let i = 0; i < 100 && !await app.evaluate(() => Boolean(global.aliceTest)); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(app.windows().length, 1, 'chat renderer is lazy');
    await app.evaluate(async () => { await global.aliceTest.openChat(); });
    let pages = app.windows();
    for (let i = 0; pages.length < 2 && i < 100; i++) { await new Promise(r => setTimeout(r, 100)); pages = app.windows(); }
    const pet = pages.find(p => p.url().endsWith('pet.html')); const chat = pages.find(p => p.url().endsWith('chat.html'));
    assert.ok(pet && chat, 'two windows');
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip && [...document.querySelectorAll('video')].some(v => v.currentTime > .1));
    const alpha = await pet.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const x = c.getContext('2d'); x.drawImage(v, 0, 0, 640, 360); const d = x.getImageData(0, 0, 640, 360).data;
      let black = 0, transparent = 0, solid = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) transparent++; if (d[i + 3] > 250) solid++; if (d[i + 3] > 250 && d[i] < 5 && d[i + 1] < 5 && d[i + 2] < 5) black++; }
      return { black: black / (640 * 360), transparent, solid, width: v.videoWidth, height: v.videoHeight };
    });
    assert.ok(alpha.transparent > 100000 && alpha.solid > 10000 && alpha.black < .05, JSON.stringify(alpha));
    assert.equal(alpha.width, 640); assert.equal(alpha.height, 360);
    assert.equal(await pet.evaluate(async () => {
      const { bodyMask } = await import('../dist/renderer/hit-mask.js');
      const rgba = new Uint8ClampedArray(10 * 10 * 4), labels = new Int32Array(100), queue = new Int32Array(100);
      for (const p of [0, 44, 45, 54, 55]) rgba[p * 4 + 3] = 255;
      const body = bodyMask(rgba, 10, 10, labels, queue, 12);
      return labels[44] === body && labels[55] === body && labels[0] !== body && labels[99] !== body;
    }), true, 'only connected character body can be grabbed');
    const settings = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), background: w.getBackgroundColor(), prefs: w.webContents.getLastWebPreferences() })));
    assert.ok(settings.every(w => !w.visible && w.background.endsWith('00') && w.prefs.sandbox && w.prefs.contextIsolation && !w.prefs.nodeIntegration), JSON.stringify(settings));
    for (const clip of Object.keys(require('../config.json').clips)) {
      const token = await app.evaluate((_electron, clip) => global.aliceTest.play(clip), clip);
      await pet.waitForFunction(token => document.querySelector('#actor').dataset.token === String(token) && [...document.querySelectorAll('video')].some(v => v.style.opacity === '1' && v.currentTime > .12), token);
      await pet.waitForFunction(() => [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length === 1,
        null, { timeout: require('../config.json').tuning.fadeMs + 2000 });
      assert.equal(await pet.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.hasAttribute('src')).length), 1, 'outgoing source is detached');
      const a = await app.evaluate(() => global.aliceTest.state()); assert.equal(a.action.clip, clip); assert.ok(a.videoReady);
    }
    await app.evaluate(() => global.aliceTest.play('idle'));
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'idle');
    await pet.evaluate(() => {
      const video = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
      video.currentTime = video.duration - 0.05;
      return video.play();
    });
    await new Promise(r => setTimeout(r, 500));
    assert.ok(await pet.evaluate(() => {
      const video = [...document.querySelectorAll('video')].find(v => v.style.opacity === '1');
      return video.currentTime < 1 && !video.ended;
    }), 'idle video loop wraps without ending');
    await app.evaluate(() => global.aliceTest.playPeek());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'peek');
    await app.evaluate(() => global.aliceTest.pose(-1));
    await pet.waitForFunction(() => document.querySelector('#actor').style.transform.includes('-1'));
    await app.evaluate(() => global.aliceTest.pose(1));
    await pet.waitForFunction(() => !document.querySelector('#actor').style.transform.includes('-1'));
    await app.evaluate(() => global.aliceTest.sleep());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'doze', null, { timeout: 16000 });
    assert.equal((await app.evaluate(() => global.aliceTest.state())).rest, 'asleep');
    await app.evaluate(() => global.aliceTest.wake());
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'wakeup');
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'idle', null, { timeout: 16000 });
    assert.equal((await app.evaluate(() => global.aliceTest.state())).rest, 'awake');
    for (const state of ['thinking', 'working', 'result', 'waiting', 'success', 'error']) {
      await fs.writeFile(path.join(root, 'presence.json'), JSON.stringify({ state, note: state, ts: new Date().toISOString() }));
      await pet.waitForFunction(kind => document.querySelector('#actor').dataset.kind === kind, ['success', 'error'].includes(state) ? state : 'work', { timeout: 5000 });
      await new Promise(r => setTimeout(r, 2200));
      const action = (await app.evaluate(() => global.aliceTest.state())).action;
      assert.equal(action.loop, !['success', 'error'].includes(state));
    }
    const hostile = '<img src=x onerror=alert(1)> 好的';
    const id = await chat.evaluate(text => window.alice.send(text), hostile);
    assert.ok((await fs.readFile(path.join(root, 'inbox', id + '.json'), 'utf8')).includes(hostile));
    await fs.mkdir(path.join(root, 'outbox'), { recursive: true });
    const reply = path.join(root, 'outbox', 'reply-' + id + '.json');
    await fs.writeFile(reply + '.tmp', JSON.stringify({ id, text: '收到，主人。' })); await fs.rename(reply + '.tmp', reply);
    await chat.getByText('收到，主人。', { exact: true }).waitFor();
    assert.equal(await chat.locator('#messages img').count(), 0);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('chat.html'));
      w.webContents.send('chat-state', { tuning: global.aliceTest.tuning(), messages: [{ id: 'preview1', mine: true, text: '艾莉丝，今天也拜托你啦。' }, { id: 'preview1', mine: false, text: '嗯，我在。有事喊我就好。' }], note: '在岗', pending: [] });
    });
    await chat.getByText('嗯，我在。有事喊我就好。', { exact: true }).waitFor();
    await new Promise(r => setTimeout(r, 1200));
    const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('chat.html'));
      const image = await w.webContents.capturePage(undefined, { stayHidden: true });
      return image.toDataURL();
    });
    await fs.writeFile(path.join(root, 'chat.png'), Buffer.from(screenshot.split(',')[1], 'base64'));
    await chat.evaluate(() => window.alice.closeChat());
    await app.evaluate(() => global.aliceTest.stats());
    const stats = JSON.parse(await fs.readFile(path.join(root, 'pet-stats.json'), 'utf8'));
    assert.equal(stats.diskLoads, 0); assert.ok(stats.decodedFrames > 0);
    assert.deepEqual(errors, []);
    const result = { root, alpha, stats, checks: ['all configured clips', 'alpha video', 'idle loop wrap', 'peek mirroring', 'sandbox', 'sleep relay', 'six presence modes', 'atomic chat', 'text safety'], errors };
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
