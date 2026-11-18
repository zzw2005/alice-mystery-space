const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');
const source = path.resolve(__dirname, '..');
const outputArgument = process.argv.slice(3).find(argument => argument !== '--check');
const output = path.resolve(outputArgument || path.join(source, 'test-results', 'rendering'));
const command = (name, ...args) => execFileSync(name, args.map(String), { encoding: 'utf8' });
const xrandr = (...args) => command('xrandr', ...args);
const mouse = (...args) => command('xdotool', ...args);
const primaryMode = '1364x1024_60.00';
const secondaryMode = 'alice-1200x900-60';
const bubbleText = '艾莉丝 · 气泡清晰度检查';
const backgrounds = { light: '#f0f0f0', mid: '#808080', dark: '#202020' };

async function waitFor(check, label, timeout = 8000) {
  for (const end = Date.now() + timeout; Date.now() < end; await delay(35)) {
    const value = await check();
    if (value) return value;
  }
  throw Error('Timed out: ' + label);
}

async function withPet(scale, use, retimeIdle = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-rendering-'));
  let appPath = source;
  if (retimeIdle) {
    appPath = path.join(root, 'app');
    await fs.mkdir(appPath);
    await Promise.all(['config.json', 'defaults.json', 'package.json', 'dist', 'ui', 'media'].map(entry =>
      fs.cp(path.join(source, entry), path.join(appPath, entry), { recursive: true })));
    // Change only the packet timestamps in a temporary copy. VP9 and alpha
    // payloads stay identical, and production still uses the same 13 clips.
    command('ffmpeg', '-v', 'error', '-y', '-itsscale', .8, '-i', path.join(source, 'media/idle.webm'),
      '-map', '0:v:0', '-r', 30, '-c', 'copy', path.join(appPath, 'media/idle.webm'));
  }
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--force-device-scale-factor=' + scale, '--ozone-platform=x11',
      '--user-data-dir=' + path.join(root, 'profile'), appPath],
    env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' }
  });
  try {
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'idle');
    await waitFor(() => app.evaluate(() => !!global.aliceTest), 'app setup');
    await app.evaluate(() => global.aliceTest.show());
    await use(app, pet, root);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

function nativeBounds() {
  const [id] = mouse('search', '--onlyvisible', '--name', '^艾莉丝桌宠$').trim().split('\n');
  const geometry = command('xwininfo', '-id', id);
  return Object.fromEntries(['Absolute upper-left X', 'Absolute upper-left Y', 'Width', 'Height'].map((field, index) =>
    [['X', 'Y', 'WIDTH', 'HEIGHT'][index], Number(geometry.match(new RegExp(field + ':\\s+(-?\\d+)'))[1])]));
}
function moveInWindow(x, y, from = nativeBounds()) { mouse('mousemove', from.X + x, from.Y + y); }
function current(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    const display = screen.getDisplayMatching(bounds);
    return { bounds, display, count: screen.getAllDisplays().length, ...global.aliceTest.state() };
  });
}

async function dpiSample(app, pet, scale, label) {
  // Test a stable idle clip rather than the different artwork in the drag clip.
  const token = await app.evaluate(() => global.aliceTest.play('idle'));
  await pet.waitForFunction(value => document.querySelector('#actor').dataset.token === String(value), token);
  await pet.waitForFunction(() => {
    const video = [...document.querySelectorAll('video')].find(item => item.style.opacity === '1');
    return video && video.currentTime > 0.3 && video.currentTime < 8;
  });
  const desktop = await current(app), native = nativeBounds();
  const geometry = await pet.evaluate(() => {
    const actor = document.querySelector('#actor'), video = [...actor.querySelectorAll('video')]
      .find(video => video.style.opacity === '1');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    const rgba = ctx.getImageData(0, 0, 640, 360).data;
    let foot = -1;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] >= 128) foot = Math.floor((i - 3) / (4 * 640));
    }
    return { scale: devicePixelRatio, size: [innerWidth, innerHeight], foot,
      cssAnchor: parseFloat(getComputedStyle(actor).transformOrigin.split(' ')[1]) };
  });
  await app.evaluate(({ BrowserWindow }, text) => BrowserWindow.getAllWindows()[0].webContents.send('bubble', text), bubbleText);
  await pet.waitForFunction(text => {
    const bubble = document.querySelector('#bubble');
    return !bubble.hidden && bubble.textContent === text;
  }, bubbleText);
  const bubble = await pet.locator('#bubble').evaluate(element => ({
    content: element.textContent, font: parseFloat(getComputedStyle(element).fontSize),
    foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
    client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight]
  }));
  await pet.locator('#bubble').screenshot({ path: path.join(output, `bubble-${scale}-${label}.png`) });
  const outcomes = [];
  for (const [x, y, hit] of [[.50, .42, true], [.18, .40, false], [.48, .40, true],
    [.64, .15, false], [.53, .43, true], [.17, .72, false]]) {
    const started = Date.now();
    moveInWindow(Math.round(native.WIDTH * x), Math.round(native.HEIGHT * y));
    let matched = false;
    do {
      await delay(35);
      matched = (await current(app)).ignoringMouse === !hit;
    } while (!matched && Date.now() - started < 800);
    outcomes.push({ hit, matched, milliseconds: Date.now() - started });
  }
  const expectedY = (desktop.display.workArea.y + desktop.display.workArea.height - 2) * scale;
  assert.equal(geometry.scale, scale);
  assert.equal(desktop.display.scaleFactor, scale);
  return { scale, label, geometry, native, display: desktop.display.id, displayScale: desktop.display.scaleFactor,
    bounds: desktop.bounds, workArea: desktop.display.workArea, bubble, outcomes,
    anchorErrorPx: native.Y + Math.round(geometry.cssAnchor * scale) - Math.round(expectedY),
    footToAnchorPx: (geometry.foot + 1) * native.HEIGHT / 360 - geometry.cssAnchor * scale };
}

async function dpi() {
  xrandr('--output', 'DUMMY1', '--off', '--output', 'DUMMY0', '--mode', primaryMode);
  const results = [];
  for (const scale of [1, 1.5, 2]) {
    try {
      await withPet(scale, async (app, pet, root) => {
        const primary = (await current(app)).display.id;
        results.push(await dpiSample(app, pet, scale, 'single'));
        xrandr('--output', 'DUMMY1', '--mode', secondaryMode, '--right-of', 'DUMMY0');
        await waitFor(async () => (await current(app)).count === 2, 'second output added');
        const native = nativeBounds();
        moveInWindow(Math.round(native.WIDTH * .50), Math.round(native.HEIGHT * .42));
        await waitFor(async () => !(await current(app)).ignoringMouse, 'initial body hit');
        mouse('mousedown', 1);
        try {
          await waitFor(async () => (await current(app)).mode === 'drag', 'native pointer down');
          for (let x = native.X + native.WIDTH * .5; x < 1790; x += 45) {
            mouse('mousemove', Math.round(x), 520);
            await delay(32);
          }
          mouse('mousemove', 1790, 520);
          await waitFor(async () => (await current(app)).display.id !== primary, 'dragged to second output');
          await delay(500);
        } finally { mouse('mouseup', 1); }
        await waitFor(async () => (await current(app)).mode === 'idle', 'landed on secondary');
        results.push(await dpiSample(app, pet, scale, 'cross'));
        const secondary = (await current(app)).display.id;
        await waitFor(async () => {
          const saved = JSON.parse(await fs.readFile(path.join(root, 'pet-position.json'), 'utf8'));
          return saved.position.display === secondary;
        }, 'secondary position persisted');
        xrandr('--output', 'DUMMY1', '--off');
        await waitFor(async () => {
          const state = await current(app);
          return state.count === 1 && state.display.id === primary && state.bounds.x === Math.round(state.x);
        }, 'primary fallback');
        results.push(await dpiSample(app, pet, scale, 'removed'));
        xrandr('--output', 'DUMMY0', '--mode', '1024x768', '--rate', 60);
        await waitFor(async () => (await current(app)).display.size.width < 800 && scale > 1 ||
          (await current(app)).display.size.width === 1024 && scale === 1, 'display metrics changed');
        results.push(await dpiSample(app, pet, scale, 'metrics'));
      });
    } finally { xrandr('--output', 'DUMMY1', '--off', '--output', 'DUMMY0', '--mode', primaryMode); }
  }
  return results;
}

async function compositing() {
  return withPet(1, async (app, pet) => {
    await pet.evaluate(async () => {
      const actor = document.querySelector('#actor');
      // Use paused copies of the production video elements and styles. The
      // app player keeps running in its own slots, outside this measurement.
      document.body.replaceChildren(actor.cloneNode());
      const sample = document.querySelector('#actor');
      sample.style.transform = 'none';
      const videos = ['idle', 'wave'].map((clip, i) => {
        const video = document.createElement('video');
        video.muted = true; video.src = '../media/' + clip + '.webm';
        video.preload = 'auto'; video.style.zIndex = 2 + i;
        sample.append(video);
        return video;
      });
      await Promise.all(videos.map(video => new Promise((resolve, reject) => {
        video.onloadedmetadata = () => { video.currentTime = 1.02; };
        video.onseeked = resolve;
        video.onerror = reject;
      })));
    });
    for (const [name, slots] of Object.entries({ idle: [1, 0], wave: [0, 1], midpoint: [.5, .5] })) {
      for (const mode of ['plus', 'direct']) {
        for (const [bg, color] of Object.entries({ alpha: 'transparent', ...backgrounds })) {
          await pet.evaluate(({ slots, mode, color }) => {
            document.body.style.background = color;
            document.querySelectorAll('video').forEach((video, i) => {
              video.style.opacity = slots[i];
              video.style.mixBlendMode = mode === 'direct' ? 'normal' : 'plus-lighter';
            });
          }, { slots, mode, color });
          await pet.screenshot({ omitBackground: true, path: path.join(output, `${name}-${mode}-${bg}.png`) });
        }
      }
    }
  });
}

async function recordFrames(pet, length) {
  return pet.evaluate(length => new Promise(resolve => {
    const video = [...document.querySelectorAll('video')].find(item => item.style.opacity === '1');
    const frames = [], refresh = [];
    const initialQuality = video.getVideoPlaybackQuality();
    const time = performance.timeOrigin;
    let previous, frameId, rafId;
    const videoTick = (now, frame) => {
      previous = frame.presentedFrames;
      frames.push({ callback: time + now, display: time + frame.expectedDisplayTime,
        submit: time + frame.presentationTime, media: frame.mediaTime, count: previous });
      frameId = video.requestVideoFrameCallback(videoTick);
    };
    const refreshTick = now => {
      refresh.push({ at: time + now, presented: previous, transform: document.querySelector('#actor').style.transform });
      rafId = requestAnimationFrame(refreshTick);
    };
    frameId = video.requestVideoFrameCallback(videoTick);
    rafId = requestAnimationFrame(refreshTick);
    window.setTimeout(() => {
      video.cancelVideoFrameCallback(frameId); cancelAnimationFrame(rafId);
      const quality = video.getVideoPlaybackQuality();
      resolve({ frames, refresh, quality: { total: quality.totalVideoFrames - initialQuality.totalVideoFrames,
        dropped: quality.droppedVideoFrames - initialQuality.droppedVideoFrames } });
    }, length);
  }), length);
}

async function timing() {
  const results = {};
  for (const label of ['24', '30', 'walk', 'drag']) {
    await withPet(1, async (app, pet) => {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const send = window.webContents.send.bind(window.webContents);
        let frames = 0;
        global.renderProbe = { pose: [], reports: [] };
        window.webContents.send = (channel, ...args) => {
          if (channel === 'pose') {
            const state = global.aliceTest.state();
            global.renderProbe.pose.push({ at: performance.timeOrigin + performance.now(),
              x: state.x, y: state.y, mode: state.mode, tilt: args[0].tilt, squash: args[0].squash });
            if (state.decodedFrames !== frames) {
              global.renderProbe.reports.push({ at: performance.timeOrigin + performance.now(), count: state.decodedFrames - frames });
              frames = state.decodedFrames;
            }
          }
          return send(channel, ...args);
        };
      });
      if (label === 'walk') {
        // Start well away from the right limit so the natural walk has room.
        await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: 1100, y: 500 }); });
        await pet.evaluate(() => window.alice.pointer('down'));
        await waitFor(async () => (await current(app)).mode === 'drag', 'pointer down');
        await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: 450, y: 500 }); });
        await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'drag');
        await delay(650);
        await pet.evaluate(() => window.alice.pointer('up'));
        await waitFor(async () => (await current(app)).mode === 'idle', 'placed for walking');
        await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'idle');
        const token = await app.evaluate(() => global.aliceTest.playMove());
        await pet.waitForFunction(value => document.querySelector('#actor').dataset.token === String(value), token);
      } else if (label === 'drag') {
        await app.evaluate(({ screen }) => {
          global.probeCursor = { x: 1100, y: 850 };
          screen.getCursorScreenPoint = () => ({ ...global.probeCursor });
        });
        await pet.evaluate(() => window.alice.pointer('down'));
        await waitFor(async () => (await current(app)).mode === 'drag', 'pointer down');
        await app.evaluate(() => { global.probeCursor = { x: 850, y: 620 }; });
        await pet.waitForFunction(() => document.querySelector('#actor').dataset.kind === 'drag');
        await app.evaluate(() => {
          const started = performance.now();
          const interval = setInterval(() => { global.probeCursor.x = 850 - (performance.now() - started) * .12; }, 8);
          setTimeout(() => clearInterval(interval), 3600);
        });
      }
      // Measure steady following once the initial cursor jump has settled.
      if (label === 'drag') await delay(850);
      const observations = await recordFrames(pet, label === 'walk' ? 900 : label === 'drag' ? 2200 : 6500);
      const main = await app.evaluate(() => global.renderProbe);
      results[label] = { ...observations, ...main };
      if (label === 'drag') await pet.evaluate(() => window.alice.pointer('up'));
    }, label === '30');
  }
  return results;
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const phase = process.argv[2];
  switch (phase) {
    case 'dpi': {
      const rows = await dpi();
      await fs.writeFile(path.join(output, 'dpi.json'), JSON.stringify(rows, null, 2));
      // Omit --check when recording a baseline that is allowed to show regressions.
      if (process.argv.includes('--check')) {
        for (const row of rows) {
          const label = `${row.scale} ${row.label}`;
          assert.equal(row.native.WIDTH, Math.round(533 * row.scale), label);
          assert.equal(row.native.HEIGHT, 300 * row.scale, label);
          assert.ok(Math.abs(row.anchorErrorPx) <= 2, label);
          assert.ok(row.outcomes.every(item => item.matched), label);
          assert.deepEqual(row.bubble.scroll, row.bubble.client, label);
        }
      }
      break;
    }
    case 'compositing': await compositing(); break;
    case 'timing': await fs.writeFile(path.join(output, 'timing.json'), JSON.stringify(await timing(), null, 2)); break;
    default: throw Error('Usage: node tests/rendering.cjs dpi|compositing|timing [output]');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
