const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function smoke({ executable, source, clips: requested, checkUi = false }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-deployed-smoke-'));
  const app = await electron.launch({
    executablePath: executable,
    args: [...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--user-data-dir=' + path.join(root, 'profile'), ...(source ? [source] : [])],
    env: { ...process.env, ALICE_PET_ROOT: root, ALICE_PET_TEST: '1' }
  });
  const errors = [];
  const watch = page => page.on('pageerror', error => errors.push(error.message));
  app.windows().forEach(watch); app.on('window', watch);
  try {
    let pages = app.windows();
    for (let i = 0; !pages.some(p => p.url().endsWith('pet.html')) && i < 100; i++) {
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
    const appPath = await app.evaluate(({ app }) => app.getAppPath());
    const config = JSON.parse(await fs.readFile(path.join(appPath, 'config.json'), 'utf8'));
    const selected = requested || Object.keys(config.clips);
    const expected = Object.keys(require('../config.json').clips);
    if (checkUi && !requested && (selected.length !== expected.length || expected.some(id => !config.clips[id])))
      throw Error('Expected all registered clips');
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
    if (checkUi) {
      const opened = app.waitForEvent('window');
      await app.evaluate(() => global.aliceTest.menu().items.find(i => i.label === '和艾莉丝说话').click());
      const chat = await opened;
      await chat.locator('textarea').fill('安装包自检');
      await chat.locator('#send').click();
      await chat.getByText('安装包自检', { exact: true }).waitFor();
      const [name] = (await fs.readdir(path.join(root, 'inbox'))).filter(n => n.endsWith('.json'));
      const { id } = JSON.parse(await fs.readFile(path.join(root, 'inbox', name), 'utf8'));
      const outbox = path.join(root, 'outbox'); await fs.mkdir(outbox, { recursive: true });
      const reply = path.join(outbox, 'reply-' + id + '.json');
      await fs.writeFile(reply + '.tmp', JSON.stringify({ id, text: '回执已读' }));
      await fs.rename(reply + '.tmp', reply);
      await chat.getByText('回执已读', { exact: true }).waitFor();
      if (!await app.evaluate(() => {
        const toggle = () => global.aliceTest.menu().items.find(i => i.label === '任务栏站立').click();
        const initial = global.aliceTest.state().standing;
        toggle(); const changed = global.aliceTest.state().standing !== initial;
        toggle(); return changed && global.aliceTest.state().standing === initial;
      })) throw Error('Tray toggle failed');
    }
    const result = {
      runtime: 'Electron',
      executable, appPath, checkUi,
      checkedAt: new Date().toISOString(),
      clips,
      pageErrors: errors,
      passed: Object.values(clips).every(clip =>
        clip.loaded && clip.width === 640 && clip.height === 360 &&
        clip.transparent > 100000 && clip.opaqueBlackRatio < 0.05) && errors.length === 0
    };
    return result;
  } finally { await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); }
}
module.exports = { smoke };
if (require.main === module) (async () => {
  const executable = process.env.ALICE_PET_EXECUTABLE || process.argv[2];
  if (!executable) throw Error('Pass the packaged AlicePetNew executable path');
  const output = process.env.ALICE_SMOKE_OUTPUT || process.argv[3];
  const clips = process.env.ALICE_SMOKE_CLIPS?.split(',').map(name => name.trim()).filter(Boolean);
  const result = await smoke({ executable, clips });
  const json = JSON.stringify(result, null, 2) + '\n';
  if (output) await fs.writeFile(output, json);
  process.stdout.write(json);
  if (!result.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
