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
  const d = new Director(config, () => 0.1, 0);
  assert.equal(d.base().clip, 'idle');
  assert.equal(d.current.loop, true);
  const wave = d.automaticAction(50000, false);
  assert.equal(wave.clip, 'wave');
  assert.equal(wave.loop, false);
  assert.equal(d.ended().clip, 'idle');
  assert.equal(d.current.loop, true);
});
test('interactive cooldown blocks all chain draws until 60 seconds have elapsed', () => {
  let draws = 0;
  const d = new Director(config, () => { draws++; return 0; }, 0);
  d.base(); d.interact(40000);
  const before = draws;
  for (const now of [50000, 60000, 99999]) assert.equal(d.automaticAction(now, false), null);
  assert.equal(draws, before);
  assert.equal(d.automaticAction(100000, false).kind, 'idle.once');
});
test('moves weight halves during the two draws after a walk, then returns to full weight', () => {
  let ticket = .99;
  const d = new Director({ ...config, idleSeconds: [45, 45] }, () => ticket, 0);
  d.base();
  assert.equal(d.automaticAction(50000, true).kind, 'moves');
  d.base(); ticket = .9;
  assert.equal(d.automaticAction(95000, true).kind, 'turn', 'chain still excludes its previous category');
  d.ended(); ticket = .8;
  assert.equal(d.automaticAction(140000, true).kind, 'idle.once', 'reduced moves weight leaves this ticket in idle');
  d.ended(); ticket = .5;
  assert.equal(d.automaticAction(185000, true).kind, 'moves', 'the full moves weight now wins this ticket');
});
test('drowsiness doubles the pending interval without a clip, and chat defers drowsiness and sleep', () => {
  const setup = () => {
    const d = new Director({ ...config, idleSeconds: [40, 40], tuning: { ...config.tuning, firstRandomMs: 90000 } }, () => 0, 0);
    d.base(); d.automaticAction(90000, false); d.ended();
    return d;
  };
  const quiet = setup(), idle = quiet.current;
  for (const now of [119999, 120000, 130000, 169999]) assert.equal(quiet.automaticAction(now, false), null);
  assert.equal(quiet.current, idle);
  assert.ok(quiet.automaticAction(170000, false));
  quiet.ended();
  assert.equal(quiet.automaticAction(179999, false), null);
  assert.equal(quiet.automaticAction(180000, false).clip, 'sleepstart');
  assert.equal(quiet.ended().clip, 'doze');
  assert.equal(quiet.wake().clip, 'wakeup');
  const chat = setup();
  assert.ok(chat.automaticAction(130000, true));
  chat.ended();
  assert.notEqual(chat.automaticAction(180000, true)?.kind, 'sleep.start');
  chat.setPresence('working', 180000);
  assert.equal(chat.automaticAction(300000, false), null);
  chat.setPresence('idle', 300000);
  assert.equal(chat.automaticAction(300000, false).kind, 'sleep.start');
});
test('wake protection begins at the end of wakeup and leaves manual actions available', () => {
  const setup = () => {
    const d = new Director(config, () => 0, 0);
    d.base(); d.sleep(); d.ended(); d.wake();
    d.ended(200000);
    return d;
  };
  const d = setup();
  assert.notEqual(d.automaticAction(229999, false)?.kind, 'sleep.start');
  assert.equal(d.automaticAction(230000, false).clip, 'sleepstart');
  const manual = setup();
  assert.match(manual.click(false).clip, /^click/);
  assert.equal(manual.react('drag').clip, 'dangle');
  manual.sleep(); manual.ended();
  assert.equal(manual.wake().clip, 'wakeup');
});
test('long-held drags defer presence and random actions until released', () => {
  const d = new Director(config, () => 0, 0);
  d.base(); d.beginHold(50000);
  assert.equal(d.setPresence('working', 51999).kind, 'work');
  const work = d.current;
  assert.equal(d.setPresence('success', 52000), work);
  assert.equal(d.presence, 'success');
  assert.equal(d.setPresence('idle', 53000), work);
  d.base();
  assert.equal(d.automaticAction(120000, true), null);
  assert.equal(d.react('drag').clip, 'dangle');
  assert.equal(d.setPresence('waiting', 130000).clip, 'dangle');
  assert.equal(d.automaticAction(130000, true), null);
  d.endHold();
  assert.equal(d.base().kind, 'work');
  assert.ok(d.automaticAction(130000, true));
  assert.equal(d.ended().kind, 'work');
});
test('waiting draws at double interval while thinking, working and result never draw', () => {
  for (const state of ['thinking', 'working', 'result']) {
    const d = new Director(config, () => { throw Error('Unexpected draw'); }, 0);
    d.presence = state;
    assert.equal(d.automaticAction(300000, false), null);
  }
  const d = new Director({ ...config, idleSeconds: [45, 45] }, () => 0, 0);
  assert.equal(d.setPresence('waiting', 0).kind, 'work');
  assert.equal(d.automaticAction(99999, false), null);
  assert.equal(d.automaticAction(100000, false).kind, 'idle.once');
  assert.equal(d.ended().kind, 'work');
  assert.equal(d.automaticAction(189999, false), null);
  assert.equal(d.automaticAction(190000, false).kind, 'turn');
  for (const state of ['success', 'error']) {
    assert.deepEqual(d.setPresence(state), { clip: 'wave', loop: false, kind: state });
    d.ended();
    assert.equal(d.automaticAction(300000, false), null);
  }
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
