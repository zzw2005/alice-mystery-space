const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');
const config = require('../config.json');
const source = path.resolve(__dirname, '..');

async function waitFor(check, timeout = 8000) {
  for (const end = Date.now() + timeout; Date.now() < end; await delay(25)) {
    const result = await check();
    if (result) return result;
  }
  throw new Error(`Timed out: ${check}`);
}
async function withPet(t, use, prepare) {
  const results = path.join(source, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const root = await fs.mkdtemp(path.join(results, 'interaction-'));
  const appPath = prepare ? path.join(root, 'app') : source;
  if (prepare) {
    await fs.mkdir(appPath);
    for (const entry of ['config.json', 'defaults.json', 'package.json', 'dist', 'ui', 'media'])
      await fs.cp(path.join(source, entry), path.join(appPath, entry), { recursive: true });
    await prepare(appPath);
  }
  const app = await electron.launch({ executablePath: require('electron'),
    args: [...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), `--user-data-dir=${path.join(root, 'profile')}`, appPath],
    env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' } });
  try {
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.querySelector('#actor')?.dataset.clip === 'idle');
    await waitFor(() => app.evaluate(() => !!global.aliceTest));
    const state = () => app.evaluate(() => global.aliceTest.state());
    const stats = async () => {
      await app.evaluate(() => global.aliceTest.stats());
      return JSON.parse(await fs.readFile(path.join(root, 'pet-stats.json'), 'utf8'));
    };
    const triggers = async () => Object.values((await stats()).days).flatMap(day => day.triggers ?? []);
    await use({ app, pet, root, appPath, state, stats, triggers });
  } finally { await app.close(); }
  t.diagnostic(`results: ${root}`);
}
function pointer(pet, type) {
  return pet.evaluate(type => { window.alice.pointer(type); return Date.now(); }, type);
}
function waitClip(pet, clip, kind) {
  return pet.waitForFunction(({ clip, kind }) => {
    const actor = document.querySelector('#actor');
    return actor.dataset.clip === clip && (!kind || actor.dataset.kind === kind);
  }, { clip, kind });
}
async function presenceFile(root, state) {
  await fs.writeFile(path.join(root, 'presence.json'), JSON.stringify({ state, ts: new Date().toISOString() }));
}
async function startSample(pet, seek) {
  await pet.evaluate(seek => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const context = c.getContext('2d', { willReadFrequently: true });
    const videos = [...document.querySelectorAll('video')];
    const poster = document.querySelector('#poster');
    const active = () => videos.find(video => video.style.opacity === '1' && video.hasAttribute('src'));
    const sample = { running: true, frames: 0, bad: 0, badFrames: [], wrapped: false, lastTime: undefined, tail: undefined, head: undefined };
    window.transitionSample = sample;
    const check = () => {
      if (!sample.running) return;
      context.clearRect(0, 0, 160, 90);
      const layers = [poster, ...videos].sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
      for (const element of layers) {
        const opacity = Number(getComputedStyle(element).opacity);
        if (opacity && (!(element instanceof HTMLVideoElement) || element.readyState >= 2)) {
          context.globalAlpha = opacity;
          context.drawImage(element, 0, 0, 160, 90);
        }
      }
      const pixels = context.getImageData(0, 0, 160, 90).data;
      let opaque = 0, black = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 100) opaque++;
        if (pixels[i + 3] > 250 && pixels[i] < 5 && pixels[i + 1] < 5 && pixels[i + 2] < 5) black++;
      }
      sample.frames++;
      if (opaque < 500 || black >= .05 * 160 * 90) {
        sample.bad++;
        if (sample.badFrames.length < 8) sample.badFrames.push({ opaque, black, poster: getComputedStyle(poster).opacity,
          videos: videos.map(v => [v.src.split('/').at(-1), v.currentTime, v.readyState, getComputedStyle(v).opacity]) });
      }
      const video = active();
      if (seek && video) {
        if (!sample.wrapped && video.currentTime > video.duration - .2 && opaque >= 500) sample.tail = c.toDataURL();
        if (sample.lastTime > video.duration - .2 && video.currentTime < .25) sample.wrapped = true;
        if (sample.wrapped && !sample.head && video.currentTime > .05 && opaque >= 500) sample.head = c.toDataURL();
        sample.lastTime = video.currentTime;
      }
      requestAnimationFrame(check);
    };
    if (seek) active().currentTime = active().duration - .18;
    requestAnimationFrame(check);
  }, seek);
}
async function stopSample(pet) {
  const sample = await pet.evaluate(() => { window.transitionSample.running = false; return window.transitionSample; });
  assert.ok(sample.frames > 0);
  assert.equal(sample.bad, 0, JSON.stringify({ frames: sample.frames, bad: sample.bad, samples: sample.badFrames }));
  return sample;
}
function videoRate(pet) {
  return pet.evaluate(() => {
    const video = [...document.querySelectorAll('video')].find(item => item.style.opacity === '1' && item.hasAttribute('src'));
    return { rate: video.playbackRate, loop: video.loop };
  });
}

test('Electron closes eyes for wardrobe changes and a real click supersedes the pending action', async t => {
  await withPet(t, async ({ app, pet, root, stats }) => {
    await app.evaluate(({ BrowserWindow, screen }) => {
      screen.getCursorScreenPoint = () => ({ x: 100, y: 100 });
      BrowserWindow.getAllWindows()[0].showInactive();
    });
    await pet.evaluate(() => {
      const active = () => [...document.querySelectorAll('video')].find(v => v.style.opacity === '1' && v.hasAttribute('src'));
      window.activeVideo = active;
      window.closedFrames = [];
      window.blinkStarts = [];
      let previousSource;
      const observeBlink = new MutationObserver(() => {
        const video = active();
        const source = video?.src.split('/').at(-1);
        if (source?.startsWith('blink-') && source !== previousSource)
          window.blinkStarts.push({ source, time: video.currentTime });
        previousSource = source;
      });
      for (const video of document.querySelectorAll('video')) observeBlink.observe(video, { attributeFilter: ['style'] });
      const pause = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function () {
        const source = this.src.split('/').at(-1);
        if (source.startsWith('blink-') && !this.paused) window.closedFrames.push({ source, time: this.currentTime });
        return pause.call(this);
      };
      const play = HTMLMediaElement.prototype.play;
      window.duckPlays = [];
      HTMLMediaElement.prototype.play = function () {
        const result = play.call(this);
        if (this.src.endsWith('/click-duck.wav')) result.then(() => window.duckPlays.push(performance.now()), () => {});
        return result;
      };
    });
    await startSample(pet, false);
    const seekToEnd = () => pet.evaluate(() => { const v = window.activeVideo(); v.currentTime = v.duration - .05; });
    const observedBlinks = () => pet.evaluate(() => window.blinkStarts);
    const closed = time => time >= 2 && time < 3;
    await app.evaluate(() => global.aliceTest.play('sword'));
    await waitClip(pet, 'sword');
    await seekToEnd();
    await waitClip(pet, 'idle', 'idle');
    const blinks = await observedBlinks();
    assert.deepEqual(blinks.map(frame => frame.source), [
      'blink-uniform.webm', 'blink-wafuku.webm', 'blink-wafuku.webm', 'blink-uniform.webm'
    ]);
    assert.ok(blinks[0].time < 1 && blinks[2].time < 1);
    assert.ok(closed(blinks[1].time) && closed(blinks[3].time), JSON.stringify(blinks));
    const closingFrames = await pet.evaluate(() => window.closedFrames);
    assert.deepEqual(closingFrames.map(frame => frame.source), ['blink-uniform.webm', 'blink-wafuku.webm']);
    assert.ok(closingFrames.every(frame => closed(frame.time)), JSON.stringify(closingFrames));

    await app.evaluate(() => global.aliceTest.play('afterimage'));
    await waitClip(pet, 'afterimage');
    await seekToEnd();
    await waitClip(pet, 'idle', 'idle');
    const afterimageBlinks = (await observedBlinks()).slice(4);
    assert.deepEqual(afterimageBlinks.map(frame => frame.source), ['blink-uniform.webm', 'blink-wafuku.webm', 'blink-uniform.webm']);
    assert.ok(closed(afterimageBlinks.at(-1).time));

    await app.evaluate(() => global.aliceTest.play('sword'));
    await pet.waitForFunction(() => window.activeVideo()?.src.endsWith('/blink-uniform.webm'));
    await pet.evaluate(() => {
      for (let i = 0; i < 2; i++) { window.alice.pointer('down'); window.alice.pointer('up'); }
    });
    await pet.waitForFunction(() => window.duckPlays.length === 1);
    await delay(120);
    await pointer(pet, 'down');
    await pointer(pet, 'up');
    await pet.waitForFunction(() => window.duckPlays.length === 2);
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'clicks', null, { timeout: 2000 });
    const counts = Object.values((await stats()).days).map(day => day.cancelled?.superseded ?? 0);
    assert.equal(counts.at(-1), 1);
    await stopSample(pet);

    await app.evaluate(() => global.aliceTest.menu().items.find(i => i.label === '点击音效').click());
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'pet-settings.json'), 'utf8')), { clickSoundEnabled: false });
    await app.evaluate(() => global.aliceTest.play('sword'));
    await waitClip(pet, 'sword');
    const beforeActiveCancel = Object.values((await stats()).days).at(-1).cancelled.superseded;
    const beforeActiveBlinks = (await observedBlinks()).length;
    await pointer(pet, 'down');
    await pointer(pet, 'up');
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'clicks', null, { timeout: 2000 });
    const activeCancelBlinks = (await observedBlinks()).slice(beforeActiveBlinks);
    assert.deepEqual(activeCancelBlinks.map(frame => frame.source), ['blink-wafuku.webm', 'blink-uniform.webm']);
    assert.ok(closed(activeCancelBlinks.at(-1).time));
    assert.equal(await pet.evaluate(() => window.duckPlays.length), 2);
    assert.equal(Object.values((await stats()).days).at(-1).cancelled.superseded, beforeActiveCancel + 1);

    const outbox = path.join(root, 'outbox');
    await fs.mkdir(outbox, { recursive: true });
    await app.evaluate(() => global.aliceTest.play('idle'));
    await waitClip(pet, 'idle', 'test');
    const reply = path.join(outbox, 'reply-animation-category.json');
    await fs.writeFile(reply + '.tmp', JSON.stringify({ text: '测试开心动作', animationCategory: 'happy' }));
    await fs.rename(reply + '.tmp', reply);
    await pet.waitForFunction(() => {
      const { kind, clip } = document.querySelector('#actor').dataset;
      return kind === 'category' && ['laugh', 'meat'].includes(clip);
    });
    t.diagnostic(JSON.stringify({ blinks, closingFrames, afterimageBlinks, activeCancelBlinks }));
  });
});

test('Electron long press holds and loops, releases without chat or throw, and converts to drag', async t => {
  await withPet(t, async ({ app, pet, root, state, triggers }) => {
    await app.evaluate(({ BrowserWindow, screen }) => {
      global.testCursor = { x: 100, y: 100 };
      screen.getCursorScreenPoint = () => ({ ...global.testCursor });
      BrowserWindow.getAllWindows()[0].showInactive();
    });
    const downAt = await pointer(pet, 'down');
    await waitClip(pet, 'clicktsun', 'long-press');
    assert.deepEqual(await videoRate(pet), { rate: .75, loop: true });
    let events = await triggers();
    const entered = events.find(e => e.source === 'long-press');
    assert.ok(Date.parse(entered.ts) - downAt >= config.triggers.longPressMs - 1);
    await startSample(pet, true);
    await pet.waitForFunction(() => window.transitionSample.wrapped && window.transitionSample.head);
    const loop = await stopSample(pet);
    for (const side of ['tail', 'head']) await fs.writeFile(path.join(root, `loop-${side}.png`), Buffer.from(loop[side].split(',')[1], 'base64'));
    const heldToken = (await state()).token;
    await presenceFile(root, 'working');
    await waitFor(async () => (await state()).presence === 'working');
    assert.equal((await state()).token, heldToken);
    const upAt = await pointer(pet, 'up');
    await waitFor(async () => (await state()).token !== heldToken && (await state()).videoReady);
    assert.equal((await videoRate(pet)).rate, 1);
    assert.equal((await state()).mode, 'idle');
    assert.equal(app.windows().length, 1, 'long press did not open chat');
    events = await triggers();
    const released = events.find(e => e.source === 'long-press-release');
    assert.ok(Date.parse(released.ts) >= upAt - 1);
    t.diagnostic(JSON.stringify({ downAt: new Date(downAt).toISOString(), entered, upAt: new Date(upAt).toISOString(), released,
      loopFrames: loop.frames, blackOrTransparentFrames: loop.bad }));

    await pointer(pet, 'down');
    await waitClip(pet, 'clicktsun', 'long-press');
    await app.evaluate(() => { global.testCursor.x += 5; });
    await waitClip(pet, 'dangle', 'drag');
    assert.deepEqual(await videoRate(pet), { rate: 1, loop: true });
    await pointer(pet, 'up');
    await waitFor(async () => (await state()).action.kind !== 'drag');
    assert.equal((await triggers()).filter(e => e.source === 'long-press-release').length, 1);

    await pet.evaluate(() => {
      for (let i = 0; i < 2; i++) { window.alice.pointer('down'); window.alice.pointer('up'); }
      window.alice.pointer('double');
    });
    await waitClip(pet, 'wave', 'wave');
    await delay(config.tuning.doubleClickMs + 50);
    assert.equal(app.windows().length, 1);
    assert.ok((await triggers()).some(e => e.source === 'double-click' && e.clip === 'wave'));

    await app.evaluate(() => global.aliceTest.sleep());
    await waitClip(pet, 'sleepstart', 'sleep.start');
    const sleepingToken = (await state()).token;
    await pointer(pet, 'down');
    await delay(config.triggers.longPressMs + 80);
    assert.equal((await state()).token, sleepingToken, 'wake was queued during sleepstart');
    await waitClip(pet, 'wakeup', 'sleep.end');
    await pointer(pet, 'up');
    assert.equal((await triggers()).filter(e => e.source === 'long-press').length, 2);
    assert.equal(app.windows().length, 1);
  });
});

test('Electron replies are delivered one at a time in across-poll order', async t => {
  await withPet(t, async ({ app, root, stats }) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows()[0];
      const send = pet.webContents.send.bind(pet.webContents);
      global.delivered = [];
      pet.webContents.send = (channel, ...args) => {
        if (channel === 'bubble') global.delivered.push({ text: args[0], ts: new Date().toISOString(), monotonic: performance.now() });
        return send(channel, ...args);
      };
      await global.aliceTest.openChat();
    });
    const chat = app.windows().find(page => page.url().endsWith('chat.html'));
    const ids = await chat.evaluate(async () => {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await window.alice.send(`question ${i}`));
      return ids.sort();
    });
    const outbox = path.join(root, 'outbox'); await fs.mkdir(outbox, { recursive: true });
    const append = async (id, text) => {
      const file = path.join(outbox, `reply-${id}.json`);
      await fs.writeFile(file + '.tmp', JSON.stringify({ id, text }));
      await fs.rename(file + '.tmp', file);
    };
    const delivered = () => app.evaluate(() => global.delivered);
    // Stage one poll atomically by writing the fixture between two observed polls.
    const lastPollMarker = path.join(outbox, 'reply-batch-marker.json');
    await fs.writeFile(lastPollMarker, JSON.stringify({ text: 'marker' }));
    await waitFor(async () => (await delivered()).length === 1);
    await Promise.all(ids.slice(1).map((id, index) => append(id, `reply ${index + 1}`)));
    await waitFor(async () => (await delivered()).length === 2);
    await chat.getByText('reply 1', { exact: true }).waitFor();
    assert.equal(await chat.getByText('reply 2', { exact: true }).count(), 0);
    assert.equal(Object.values((await stats()).days).flatMap(day => day.chatRoundTripMs).length, 1);
    await append(ids[0], 'reply later batch');
    await chat.getByText('reply later batch', { exact: true }).waitFor();
    const observed = (await delivered()).slice(1);
    assert.deepEqual(observed.map(item => item.text), ['reply 1', 'reply 2', 'reply 3', 'reply 4', 'reply later batch']);
    for (let i = 1; i < observed.length; i++) assert.ok(observed[i].monotonic - observed[i - 1].monotonic >= config.tuning.replyStaggerMs);
    const rtt = Object.values((await stats()).days).flatMap(day => day.chatRoundTripMs);
    assert.equal(rtt.length, 5);
    t.diagnostic(JSON.stringify({ observed, rtt }));
  });
});

test('Electron missing, malformed and invalid presence uses idle without changing playback', async t => {
  await withPet(t, async ({ app, pet, root, state }) => {
    const file = path.join(root, 'presence.json');
    for (const invalid of [() => fs.unlink(file), () => fs.writeFile(file, '{'),
      () => presenceFile(root, 'made-up'), () => fs.writeFile(file, 'null')]) {
      await presenceFile(root, 'working');
      await waitFor(async () => (await state()).presence === 'working');
      const token = await app.evaluate(() => global.aliceTest.play('dangle'));
      await waitClip(pet, 'dangle', 'test');
      await invalid();
      await waitFor(async () => (await state()).presence === 'idle');
      assert.equal((await state()).token, token);
    }
    const errors = await fs.readFile(path.join(root, 'pet-error.log'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    assert.equal(errors, '');
  });
});

test('Electron skips damaged media and restores a broken config with one notification', async t => {
  await withPet(t, async ({ app, pet, root, appPath, state, triggers }) => {
    await app.evaluate(({ BrowserWindow, Tray }) => {
      global.configBalloons = 0;
      const display = Tray.prototype.displayBalloon;
      Tray.prototype.displayBalloon = function (...args) { global.configBalloons++; return display.apply(this, args); };
      BrowserWindow.getAllWindows()[0].showInactive();
    });
    await startSample(pet, false);
    const failedToken = await app.evaluate(() => global.aliceTest.play('wave'));
    await waitFor(async () => { const s = await state(); return s.token > failedToken && s.videoReady; });
    assert.equal((await state()).action.clip, 'idle');
    assert.ok((await triggers()).some(event => event.source === 'media-fallback' && event.clip === 'idle'));
    const recoveredToken = (await state()).token;
    assert.equal(await app.evaluate(() => global.aliceTest.play('wave')), recoveredToken, 'known bad segment is skipped');
    await stopSample(pet);

    const file = path.join(appPath, 'config.json');
    for (const [index, text] of ['{', '{"clips":{}}'].entries()) {
      await fs.writeFile(file, text);
      await waitFor(async () => (await fs.readdir(root)).filter(name => name.startsWith('config.json.bad-')).length === index + 1);
      await waitFor(async () => (await fs.readFile(file, 'utf8')) === await fs.readFile(path.join(appPath, 'defaults.json'), 'utf8'));
    }
    assert.equal((await state()).configNotified, true);
    assert.equal(await app.evaluate(() => global.configBalloons), 1);
    const copies = await Promise.all((await fs.readdir(root)).filter(name => name.startsWith('config.json.bad-')).map(name => fs.readFile(path.join(root, name), 'utf8')));
    assert.deepEqual(copies.map(copy => JSON.parse(copy).reason).sort(), ['failed', 'invalid-json']);

    await fs.copyFile(path.join(source, 'media/wave.webm'), path.join(appPath, 'media/wave.webm'));
    await app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '重载动作配置').click());
    await waitFor(async () => (await triggers()).filter(event => event.source === 'config-reload').length >= 3);
    await app.evaluate(() => global.aliceTest.play('wave'));
    await waitClip(pet, 'wave', 'test');
  }, appPath => fs.writeFile(path.join(appPath, 'media/wave.webm'), 'damaged video'));
});
