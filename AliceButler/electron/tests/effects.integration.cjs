const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');

const source = path.resolve(__dirname, '..');

test('WebGL effects cap simultaneous particles, stop when empty and persist the switch across restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-effects-'));
  const localApp = path.join(root, 'app');
  await fs.mkdir(localApp);
  for (const entry of ['config.json', 'defaults.json', 'package.json', 'dist', 'ui', 'media'])
    await fs.cp(path.join(source, entry), path.join(localApp, entry), { recursive: true });
  const configPath = path.join(localApp, 'config.json');
  const settingsPath = path.join(root, 'pet-settings.json');
  const config = JSON.parse(await fs.readFile(configPath));
  config.effects.atmosphere = 'snow';
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.writeFile(settingsPath, JSON.stringify({ clickSoundEnabled: false }));
  const launch = () => _electron.launch({
    executablePath: require('electron'),
    args: [
      ...(process.env.ALICE_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      ...(process.env.ALICE_TEST_SWIFTSHADER === '1' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      '--force-device-scale-factor=2', '--user-data-dir=' + path.join(root, 'profile'), localApp
    ],
    env: { ...process.env, ALICE_PET_TEST: '1', ALICE_PET_ROOT: root }
  });
  const find = async app => {
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.querySelector('#actor').dataset.clip === 'idle');
    for (let i = 0; i < 100 && !await app.evaluate(() => Boolean(global.aliceTest)); i++) await delay(20);
    return pet;
  };
  const enabled = app => app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '特效').checked);
  const show = app => app.evaluate(() => global.aliceTest.show());
  let app;
  try {
    app = await launch();
    const pet = await find(app);
    const errors = [];
    pet.on('pageerror', error => errors.push(error.message));
    assert.equal(await enabled(app), true, 'legacy settings default to effects on');
    assert.equal(await pet.locator('#effects canvas').count(), 0, 'hidden launch is lazy');
    await pet.evaluate(() => {
      const proto = WebGL2RenderingContext.prototype;
      const draw = proto.drawElementsInstanced;
      const probe = { alphaPixels: 0, draws: 0, maxInstances: 0 };
      window.effectProbe = probe;
      proto.drawElementsInstanced = function (...args) {
        draw.apply(this, args);
        if (this.canvas.parentElement?.id !== 'effects') return;
        probe.draws++;
        probe.maxInstances = Math.max(probe.maxInstances, args.at(-1));
        if (probe.draws === 1) {
          const rgba = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
          this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, rgba);
          for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) probe.alphaPixels++;
        }
      };
    });
    await show(app);
    await pet.waitForFunction(() => window.effectProbe.draws > 0);
    const layer = () => pet.evaluate(() => {
      const host = document.querySelector('#effects'), canvas = host.querySelector('canvas');
      return { ...host.dataset, hidden: host.hidden, width: canvas?.width, logicalWidth: innerWidth, dpr: devicePixelRatio,
        ...window.effectProbe };
    });
    const snow = await layer();
    assert.equal(snow.renderer, 'webgl2');
    assert.equal(snow.ambient, 'snow');
    assert.equal(Number(snow.particles), 48);
    assert.ok(snow.alphaPixels > 0 && snow.alphaPixels < 5000, JSON.stringify(snow));
    assert.ok(snow.dpr > 1.5 && snow.width <= Math.floor(snow.logicalWidth * 1.5));
    const play = async clip => {
      const token = await app.evaluate((_, c) => global.aliceTest.play(c), clip);
      await pet.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t), token);
    };
    await play('doze');
    assert.equal((await layer()).ambient, 'dream');
    assert.equal(Number((await layer()).particles), 10);
    await play('idle');
    assert.equal((await layer()).ambient, 'snow');
    await pet.evaluate(() => {
      const host = document.querySelector('#effects');
      window.peakParticles = 0;
      new MutationObserver(records => {
        for (const record of records)
          window.peakParticles = Math.max(window.peakParticles, Number(record.oldValue ?? 0), Number(host.dataset.particles));
      }).observe(host, { attributeFilter: ['data-particles'], attributeOldValue: true });
    });
    for (let i = 0; i < 8; i++) await play('rage');
    assert.equal(await pet.evaluate(() => window.peakParticles), 120);
    assert.equal((await layer()).maxInstances, 120);

    config.effects.atmosphere = 'off';
    await fs.writeFile(configPath, JSON.stringify(config));
    await app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '重载动作配置').click());
    await pet.waitForFunction(() => document.querySelector('#effects').dataset.particles === '0');
    const empty = await layer();
    await play('doze');
    assert.equal((await layer()).ambient, 'off');
    assert.equal(Number((await layer()).particles), 0, 'off also disables dream particles');
    await delay(220);
    assert.equal((await layer()).draws, empty.draws, 'empty effects layer stops GPU draws');
    await play('clickshy');
    assert.ok(Number((await layer()).particles) > 0, 'an action renews drawing with atmosphere off');

    await app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '氛围粒子')
      .submenu.items.find(item => item.label === '浮光').click());
    await pet.waitForFunction(() => document.querySelector('#effects').dataset.ambient === 'glow');
    await app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '特效').click());
    assert.equal(await enabled(app), false);
    assert.deepEqual(JSON.parse(await fs.readFile(settingsPath)), { clickSoundEnabled: false, effectsEnabled: false, atmosphere: 'glow' });
    await pet.waitForFunction(() => !document.querySelector('#effects canvas'));
    assert.deepEqual(errors, []);
    await app.close();
    app = undefined;
    config.effects.atmosphere = 'snow';
    await fs.writeFile(configPath, JSON.stringify(config));
    app = await launch();
    const restarted = await find(app);
    await show(app);
    assert.equal(await enabled(app), false);
    const token = await app.evaluate(() => global.aliceTest.play('rage'));
    await restarted.waitForFunction(t => document.querySelector('#actor').dataset.token === String(t), token);
    await delay(200);
    assert.equal(await restarted.locator('#effects canvas').count(), 0);
    await app.evaluate(() => global.aliceTest.menu().items.find(item => item.label === '特效').click());
    await restarted.waitForFunction(() => document.querySelector('#effects').dataset.renderer === 'webgl2');
    assert.equal(await restarted.locator('#effects').getAttribute('data-ambient'), 'glow');
    assert.deepEqual(JSON.parse(await fs.readFile(settingsPath)), { clickSoundEnabled: false, effectsEnabled: true, atmosphere: 'glow' });
    t.diagnostic(JSON.stringify({ maxParticles: 120, snow: 48, dream: 10, dpr: snow.dpr,
      renderResolution: snow.width / snow.logicalWidth, gpuPixels: snow.alphaPixels, persisted: true }));
  } finally {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
