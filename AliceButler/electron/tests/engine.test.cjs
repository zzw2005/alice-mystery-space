const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { Director, Physics, validateConfig } = require('../dist/main/engine');

test('config validates all referenced clips and rejects unsafe paths/weights', () => {
  validateConfig(config);
  const broken = structuredClone(config); broken.clips.idle.file = '../secrets.webm';
  assert.throws(() => validateConfig(broken));
  broken.clips.idle.file = 'idle.webm'; broken.animations.idle[0].weight = NaN;
  assert.throws(() => validateConfig(broken));
});
test('weighted picker excludes last item, including with deterministic randomness', () => {
  const director = new Director(config, () => 0);
  const pool = [{ clip: 'a', weight: 1 }, { clip: 'b', weight: 4 }, { clip: 'c', weight: 2 }];
  let last = '';
  for (let i = 0; i < 1000; i++) { const value = director.pick(pool, 'sample'); assert.notEqual(value, last); last = value; }
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 700; i++) { const d = new Director(config, () => (i + .5) / 700); counts[d.pick(pool, 'new')]++; }
  assert.deepEqual(counts, { a: 100, b: 400, c: 200 });
  assert.equal(director.pick([{ clip: 'a', weight: 1 }], 'single'), 'a');
});
test('idle base loops idle while the idle chain plays wave one-shot', () => {
  const d = new Director(config, () => 0.1);
  assert.equal(d.base().clip, 'idle');
  assert.equal(d.current.loop, true);
  const wave = d.randomAction();
  assert.equal(wave.clip, 'wave');
  assert.equal(wave.loop, false);
  assert.equal(d.ended().clip, 'idle');
  assert.equal(d.current.loop, true);
});
test('three click responses are one-shot and never repeat consecutively', () => {
  const values = [0, .2, .7, .1, .9, .4, .8, .3];
  let index = 0;
  const d = new Director(config, () => values[index++ % values.length]);
  let previous = '';
  for (let i = 0; i < 40; i++) {
    const action = d.react('clicks');
    assert.equal(action.loop, false);
    assert.notEqual(action.clip, previous);
    assert.match(action.clip, /^click(?:happy|shy|tsun)$/);
    previous = action.clip;
  }
});
test('sleep enters, loops, wakes; a wake during entry waits for the sleeping pose', () => {
  const d = new Director(config); d.base(); d.sleep();
  assert.equal(d.current.kind, 'sleep.start'); d.ended();
  assert.equal(d.rest, 'asleep'); assert.equal(d.current.loop, true);
  assert.equal(d.ended().kind, 'sleep.loop'); d.wake();
  assert.equal(d.current.kind, 'sleep.end'); d.ended(); assert.equal(d.rest, 'awake');
  d.sleep(); d.wake(); assert.equal(d.current.kind, 'sleep.start'); d.ended();
  assert.equal(d.current.kind, 'sleep.end');
});
test('presence loops four work states, success/error once per edge; sleep suppresses presence', () => {
  const d = new Director(config); d.base();
  for (const s of ['thinking', 'working', 'result', 'waiting']) { d.setPresence(s); assert.equal(d.current.loop, true); assert.equal(d.current.kind, 'work'); }
  for (const s of ['success', 'error']) { d.setPresence(s); assert.equal(d.current.loop, false); d.ended(); const action = d.current; d.setPresence(s); assert.equal(d.current, action); assert.equal(d.current.kind, 'idle'); }
  d.sleep(); const entry = d.current; d.setPresence('thinking'); assert.equal(d.current, entry); d.ended(); d.wake(); d.ended(); assert.equal(d.current.kind, 'work');
});
test('spring converges, gravity lands and wall collisions settle; walk alone translates', () => {
  const p = new Physics(), a = { left: 0, right: 1000, top: 0, floor: 600 };
  p.mode = 'drag'; p.targetX = 500; p.targetY = 300;
  for (let i = 0; i < 240; i++) p.step(1 / 60, a, i * 1000 / 60);
  assert.ok(Math.abs(p.x - 500) < .1); assert.ok(Math.abs(p.y - 300) < .1);
  for (const vx of [-2000, 2000]) {
    p.mode = 'air'; p.x = vx < 0 ? 1 : 999; p.y = 300; p.vx = vx; p.vy = 0;
    for (let i = 0; i < 240; i++) p.step(1 / 60, a, i * 1000 / 60);
    assert.equal(p.mode, 'idle'); assert.equal(p.y, 600); assert.equal(p.vx, 0); assert.equal(p.vy, 0);
    assert.ok(p.x >= 0 && p.x <= 1000);
  }
  const x = p.x; p.step(.016, a, 10000); assert.equal(p.x, x);
});
test('drag reaches 95% in 150 ms at fast, normal and delayed tick rates without overshoot', () => {
  for (const dt of [.008, .016, .05]) {
    const p = new Physics(); p.mode = 'drag'; p.targetX = 500; p.targetY = 300;
    const a = { left: 0, right: 1000, top: 0, floor: 600 };
    for (let t = 0; t < .15; t += dt) {
      p.step(dt, a, t * 1000); assert.ok(p.x <= 500 && p.y <= 300);
    }
    assert.ok(p.x > 475 && p.y > 285, `dt=${dt} x=${p.x} y=${p.y}`);
    p.release(true); assert.equal(p.vx, 0); assert.equal(p.vy, 0);
  }
});
