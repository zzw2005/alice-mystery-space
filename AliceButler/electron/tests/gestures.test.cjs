const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { Gestures, Absence, PointerPress } = require('../dist/main/gestures');
const { Director, Physics } = require('../dist/main/engine');
const cfg = config.interaction;
const play = (director, source, motion = 'idle') => director.request([{ source }], { now: 0, motion, chatOpen: false })[0].action;

test('hover fires once per visit, after dwell and cooldown; swipes choose facing', () => {
  const g = new Gestures(), center = { x: 0, y: 0 };
  const sample = (x, hit, now) => g.sample({ x, y: 0 }, center, hit, true, now, cfg);
  assert.equal(sample(0, true, 0), false);
  assert.equal(sample(0, true, 799), false);
  assert.equal(sample(0, true, 800), true);
  assert.equal(sample(0, true, 10800), false);
  g.leave();
  sample(0, true, 10801);
  assert.equal(sample(-24, true, 10817), true);
  assert.equal(g.direction, -1);
  assert.equal(sample(8, true, 10833), false);
  assert.equal(g.direction, 1);
  g.leave(); sample(0, true, 10900);
  assert.equal(sample(0, true, 11700), false);
  assert.equal(sample(0, true, 20817), true);
});
test('approach must be inward, fast and recent; three starts per rolling minute', () => {
  const g = new Gestures(), center = { x: 0, y: 0 };
  const sample = (x, t) => g.sample({ x, y: 0 }, center, false, true, t, cfg);
  sample(50, 0); sample(100, 16); assert.equal(g.press(17, cfg), false);
  sample(100, 40); sample(0, 56); assert.equal(g.press(66, cfg), true);
  sample(100, 80); sample(0, 96); assert.equal(g.press(317, cfg), false);
  for (const t of [0, 1000, 59000]) assert.equal(g.allowStartle(t, cfg), true);
  assert.equal(g.allowStartle(59999, cfg), false);
  assert.equal(g.allowStartle(60000, cfg), true);
});
test('hard impact selects sitdown and suppresses squash; small drop still squashes', () => {
  const area = { left: 0, right: 100, top: 0, floor: 500 };
  for (const [height, speed, hard] of [[15, 0, false], [100, 0, true], [5, 610, true]]) {
    const p = new Physics(); p.mode = 'air'; p.y = area.floor - height; p.vy = speed;
    let landed = false, now = 0;
    while (p.mode === 'air') landed = p.step(.016, area, now += 16, cfg);
    assert.equal(landed, hard);
    p.step(.016, area, now + 16, cfg); assert.equal(p.squash === 1, hard);
  }
});
test('lock plus minimize greet once when both clear and only after ten minutes', () => {
  const a = new Absence();
  a.leave('lock', 0); assert.equal(a.back('lock', 600000, cfg.awayMs), false);
  a.leave('minimize', 700000); a.leave('lock', 750000); a.leave('lock', 780000);
  assert.equal(a.back('lock', 1300001, cfg.awayMs), false);
  assert.equal(a.back('minimize', 1300002, cfg.awayMs), true);
  assert.equal(a.back('minimize', 1400000, cfg.awayMs), false);
});
test('one-shots return to idle and dragging supersedes any one-shot immediately', () => {
  for (const source of ['landing', 'click-startle', 'hover-peek', 'double-click']) {
    const d = new Director(config);
    play(d, 'startup');
    const active = play(d, source);
    assert.ok(active);
    const [status] = d.request([{ source: 'presence', state: 'working', valid: true }], { now: 1, motion: 'idle', chatOpen: false });
    assert.equal(status.outcome, 'rejected');
    assert.equal(d.current, active);
    assert.equal(play(d, 'animation-end').clip, 'idle');
    assert.ok(play(d, source));
    assert.deepEqual(play(d, 'drag', 'drag'), { clip: 'dangle', loop: true, kind: 'drag', rate: 1 });
  }
});

test('third confirmed single below 600 ms forces clicktsun and resets, including after a previous clicktsun', () => {
  const g = new Gestures();
  let ticket = 0;
  const d = new Director(config, () => ticket);
  const click = now => play(d, g.singleClick(now, config.triggers) ? 'click-combo' : 'click').clip;
  assert.equal(click(0), 'clickhappy');
  ticket = .5;
  assert.equal(click(599), 'clicktsun');
  assert.equal(click(1198), 'clicktsun', 'combo has priority over the same-pool exclusion');
  ticket = 0;
  assert.equal(click(1700), 'clickhappy');
  assert.equal(click(2300), 'clickshy', 'an exact 600 ms gap starts a fresh sequence');
  assert.equal(click(2800), 'clickhappy');
  assert.equal(click(3300), 'clicktsun');
});

test('disabling the combo restores weighted picks and a double-click clears a partial streak', () => {
  const g = new Gestures(), d = new Director(config, () => 0);
  const disabled = { ...config.triggers, clickComboEnabled: false };
  const clips = [0, 300, 600].map(now => play(d, g.singleClick(now, disabled) ? 'click-combo' : 'click').clip);
  assert.deepEqual(clips, ['clickhappy', 'clickshy', 'clickhappy']);
  const click = now => g.singleClick(now, config.triggers);
  assert.equal(click(900), false);
  assert.equal(click(1200), false);
  g.resetClicks();
  assert.deepEqual(play(d, 'double-click'), { clip: 'wave', loop: false, kind: 'wave', rate: 1 });
  assert.equal(click(1500), false);
});

test('long press starts at 500 ms while held, then yields to movement beyond 4 px', () => {
  const zero = { x: 0, y: 0 }, near = { x: 2, y: 2 }, far = { x: 3, y: 2 };
  const { tuning, triggers } = config;
  const press = new PointerPress(zero, 0, false);
  assert.equal(press.sample(near, 499, tuning, triggers), undefined);
  assert.equal(press.sample(near, 500, tuning, triggers), 'long-press');
  assert.equal(press.sample(near, 501, tuning, triggers), undefined);
  assert.equal(press.release(near, 510, tuning), 'long-press');
  assert.equal(press.sample(far, 502, tuning, triggers), 'drag');
  assert.equal(press.release(near, 520, tuning), 'drag');
  assert.equal(new PointerPress(zero, 0, false).release(near, 399, tuning), 'click');
  assert.equal(new PointerPress(zero, 0, false).release(near, 400, tuning), 'none');
  assert.equal(new PointerPress(zero, 0, false).release(near, 499, tuning), 'none');
});

test('sleep-origin press can only wake regardless of duration and pointer distance', () => {
  const press = new PointerPress({ x: 0, y: 0 }, 0, true);
  assert.equal(press.sample({ x: 5, y: 0 }, 3000, config.tuning, config.triggers), undefined);
  assert.equal(press.release({ x: 5, y: 0 }, 4000, config.tuning), 'wake');
});
