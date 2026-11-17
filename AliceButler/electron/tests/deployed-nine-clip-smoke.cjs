const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const executable = process.env.ALICE_PET_EXECUTABLE || process.argv[2];
const output = process.env.ALICE_SMOKE_OUTPUT || process.argv[3];
if (!executable) throw new Error('Pass the packaged AlicePetNew.exe path');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-deployed-smoke-'));
  const app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' }
  });
  const errors = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    let pages = app.windows();
    for (let i = 0; pages.length < 2 && i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      pages = app.windows();
    }
    const pet = pages.find(page => page.url().endsWith('pet.html'));
    if (!pet) throw new Error('Pet window did not load');
    let testReady = false;
    for (let i = 0; i < 100; i++) {
      testReady = await app.evaluate(() => Boolean(global.aliceTest));
      if (testReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!testReady) throw new Error('Test interface did not initialize');
    const config = require('../config.json');
    const selected = process.env.ALICE_SMOKE_CLIPS
      ? process.env.ALICE_SMOKE_CLIPS.split(',').map(name => name.trim()).filter(Boolean)
      : Object.keys(config.clips);
    for (const clip of selected) {
      if (!config.clips[clip]) throw new Error(`Unknown smoke clip: ${clip}`);
    }
    const clips = {};
    for (const clip of selected) {
      const token = await app.evaluate((_electron, name) => global.aliceTest.play(name), clip);
      await pet.waitForFunction(value => {
        const actor = document.querySelector('#actor');
        return actor?.dataset.token === String(value) &&
          [...document.querySelectorAll('video')].some(video => video.style.opacity === '1' && video.currentTime > 0.12);
      }, token, { timeout: 15000 });
      const state = await app.evaluate(() => global.aliceTest.state());
      const frame = await pet.evaluate(() => {
        const video = [...document.querySelectorAll('video')].find(video => video.style.opacity === '1');
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, 640, 360);
        const pixels = context.getImageData(0, 0, 640, 360).data;
        let transparent = 0, opaqueBlack = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] === 0) transparent++;
          if (pixels[i + 3] > 250 && pixels[i] < 5 && pixels[i + 1] < 5 && pixels[i + 2] < 5) opaqueBlack++;
        }
        return { width: video.videoWidth, height: video.videoHeight, transparent,
          opaqueBlackRatio: opaqueBlack / (640 * 360) };
      });
      clips[clip] = {
        loaded: state.videoReady && state.action.clip === clip,
        currentTime: await pet.evaluate(() => [...document.querySelectorAll('video')]
          .find(video => video.style.opacity === '1').currentTime),
        ...frame
      };
    }
    const result = {
      runtime: 'Electron',
      executable,
      checkedAt: new Date().toISOString(),
      clips,
      pageErrors: errors,
      passed: Object.values(clips).every(clip =>
        clip.loaded && clip.width === 640 && clip.height === 360 &&
        clip.transparent > 100000 && clip.opaqueBlackRatio < 0.05) && errors.length === 0
    };
    const json = JSON.stringify(result, null, 2) + '\n';
    if (output) await fs.writeFile(output, json);
    process.stdout.write(json);
    if (!result.passed) process.exitCode = 1;
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
