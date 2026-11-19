const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { Director, Physics, validateConfig } = require('../dist/main/engine');

test('click offsets are present in both shipped configs and optional in older configs', () => {
  for (const preset of [config, require('../defaults.json')]) {
    const parsed = validateConfig(preset);
    for (const { clip } of parsed.animations.clicks) assert.ok(parsed.clips[clip].startOffset > 0, clip);
  }
  const legacy = structuredClone(config);
  delete legacy.clips.clickhappy.startOffset;
  assert.equal(validateConfig(legacy).clips.clickhappy.startOffset, undefined);
  for (const startOffset of [-1, Infinity, '0.5']) {
    legacy.clips.clickhappy.startOffset = startOffset;
    assert.throws(() => validateConfig(legacy), /Invalid clip start offset/);
  }
});
const context = (now = 0, motion = 'idle', chatOpen = false) => ({ now, motion, chatOpen });
function play(director, source, now, motion) {
  return director.request([{ source }], context(now, motion))[0].action ?? null;
}
function auto(director, now, chatOpen, motion) {
  const decisions = director.request([{ source: 'auto-sleep' }, { source: 'random-chain' }], context(now, motion, chatOpen));
  return decisions.find(item => item.outcome === 'played')?.action ?? null;
}
function presence(director, state, now, motion) {
  return director.request([{ source: 'presence', state, valid: true }], context(now, motion))[0].action ?? null;
}

test('manual selection plays configured one-shots and respects sleep, drag and media availability', () => {
  const d = new Director(validateConfig(config), () => 0, 0);
  const select = (clip, motion) => d.request([{ source: 'menu-action', clip }], context(0, motion))[0];
  play(d, 'startup');
  assert.equal(d.manualClips.length, 16);
  assert.equal(new Set(d.manualClips).size, d.manualClips.length);
  for (const clip of ['idle', 'dangle', 'doze', 'sleepstart', 'wakeup', 'blink-wafuku', 'sword', 'unknown'])
    assert.equal(select(clip).outcome, 'rejected', clip);
  assert.equal(select('laugh', 'drag').outcome, 'rejected');
  assert.deepEqual(select('laugh').action, { clip: 'laugh', loop: false, kind: 'manual', rate: 1 });
  assert.equal(play(d, 'auto-sleep', config.tuning.idleSleepMs + 1), null);
  assert.equal(presence(d, 'working'), null, 'work status does not interrupt manual playback');
  assert.equal(play(d, 'animation-end').clip, 'coding');
  select('laugh');
  play(d, 'media-fallback');
  assert.equal(select('laugh').outcome, 'rejected');
  assert.ok(!d.manualClips.includes('laugh'));

  play(d, 'menu-sleep');
  assert.equal(select('wave').outcome, 'rejected');
  play(d, 'animation-end');
  assert.equal(select('wave').outcome, 'rejected');
  play(d, 'menu-wake');
  assert.equal(select('wave').outcome, 'rejected');
  play(d, 'animation-end');
  assert.equal(select('wave').outcome, 'played');
});

test('config validates all referenced clips and rejects unsafe paths/weights', () => {
  validateConfig(config);
  const broken = structuredClone(config); broken.clips.idle.file = '../secrets.webm';
  assert.throws(() => validateConfig(broken));
  broken.clips.idle.file = 'idle.webm'; broken.animations.idle[0].weight = NaN;
  assert.throws(() => validateConfig(broken));
});
test('final config has no skin transition; a legacy one is dropped, not validated', () => {
  assert.equal(config.skinTransition, undefined);
  assert.equal(validateConfig(config).skinTransition, undefined);
  const legacy = { ...config, skinTransition: { file: 'blink-uniform.webm', closedAtSec: 2.5 } };
  assert.equal(validateConfig(legacy).skinTransition, undefined);
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
  assert.equal(play(d, 'startup').clip, 'idle');
  assert.equal(d.current.loop, true);
  const wave = auto(d, 50000, false);
  assert.equal(wave.clip, 'wave');
  assert.equal(wave.loop, false);
  assert.equal(play(d, 'animation-end').clip, 'idle');
  assert.equal(d.current.loop, true);
});
test('interactive cooldown blocks all chain draws until 60 seconds have elapsed', () => {
  let draws = 0;
  const d = new Director(config, () => { draws++; return 0; }, 0);
  play(d, 'startup'); d.interact(40000);
  const before = draws;
  for (const now of [50000, 60000, 99999]) assert.equal(auto(d, now, false), null);
  assert.equal(draws, before);
  assert.equal(auto(d, 100000, false).kind, 'idle.once');
});
test('moves weight halves during the two draws after a walk, then returns to full weight', () => {
  let ticket = .99;
  const legacy = structuredClone(config);
  legacy.clips.walk = { file: 'walk.webm' };
  legacy.animations.moves = [{ clip: 'walk', weight: 1 }];
  legacy.animationWeights.moves = 3;
  legacy.idleSeconds = [45, 45];
  const d = new Director(validateConfig(legacy), () => ticket, 0);
  play(d, 'startup');
  assert.equal(auto(d, 50000, true).kind, 'moves');
  play(d, 'walk-end'); ticket = .9;
  assert.equal(auto(d, 95000, true).kind, 'turn', 'chain still excludes its previous category');
  play(d, 'animation-end'); ticket = .8;
  assert.equal(auto(d, 140000, true).kind, 'idle.once', 'reduced moves weight leaves this ticket in idle');
  play(d, 'animation-end'); ticket = .5;
  assert.equal(auto(d, 185000, true).kind, 'moves', 'the full moves weight now wins this ticket');
});
test('drowsiness doubles the pending interval without a clip, and chat defers drowsiness and sleep', () => {
  const setup = () => {
    const d = new Director({ ...config, idleSeconds: [40, 40], tuning: { ...config.tuning, firstRandomMs: 90000 } }, () => 0, 0);
    play(d, 'startup'); auto(d, 90000, false); play(d, 'animation-end');
    return d;
  };
  const quiet = setup(), idle = quiet.current;
  for (const now of [119999, 120000, 130000, 169999]) assert.equal(auto(quiet, now, false), null);
  assert.equal(quiet.current, idle);
  assert.ok(auto(quiet, 170000, false));
  play(quiet, 'animation-end');
  assert.equal(auto(quiet, 179999, false), null);
  assert.equal(auto(quiet, 180000, false).clip, 'sleepstart');
  assert.equal(play(quiet, 'animation-end').clip, 'doze');
  assert.equal(play(quiet, 'menu-wake').clip, 'wakeup');
  const chat = setup();
  assert.ok(auto(chat, 130000, true));
  play(chat, 'animation-end');
  assert.notEqual(auto(chat, 180000, true)?.kind, 'sleep.start');
  presence(chat, 'working', 180000);
  assert.equal(auto(chat, 300000, false), null);
  presence(chat, 'idle', 300000);
  assert.equal(auto(chat, 300000, false).kind, 'sleep.start');
});
test('wake protection begins at the end of wakeup and leaves manual actions available', () => {
  const setup = () => {
    const d = new Director(config, () => 0, 0);
    play(d, 'startup'); play(d, 'menu-sleep'); play(d, 'animation-end'); play(d, 'menu-wake');
    play(d, 'animation-end', 200000);
    return d;
  };
  const d = setup();
  assert.notEqual(auto(d, 229999, false)?.kind, 'sleep.start');
  assert.equal(auto(d, 230000, false).clip, 'sleepstart');
  const manual = setup();
  assert.match(play(manual, 'click').clip, /^click/);
  assert.equal(play(manual, 'drag', 205000, 'drag').clip, 'dangle');
  play(manual, 'menu-sleep'); play(manual, 'animation-end');
  assert.equal(play(manual, 'chat-open').clip, 'wakeup');
});
test('long-held drags defer presence and random actions until released', () => {
  const d = new Director(config, () => 0, 0);
  play(d, 'startup'); d.beginHold(50000);
  assert.equal(presence(d, 'working', 51999, 'drag').kind, 'work');
  const work = d.current;
  assert.equal(presence(d, 'success', 52000, 'drag'), null);
  assert.equal(d.current, work);
  assert.equal(d.presence, 'success');
  assert.equal(presence(d, 'idle', 53000, 'drag'), null);
  assert.equal(d.current, work);
  assert.equal(auto(d, 120000, true), null);
  assert.equal(play(d, 'drag', 120001, 'drag').clip, 'dangle');
  assert.equal(presence(d, 'waiting', 130000, 'drag'), null);
  assert.equal(d.current.clip, 'dangle');
  assert.equal(auto(d, 130000, true), null);
  d.endHold();
  assert.equal(play(d, 'drag-release').kind, 'work');
  assert.ok(auto(d, 130000, true));
  assert.equal(play(d, 'animation-end').kind, 'work');
});
test('waiting draws at double interval while thinking, working and result never draw', () => {
  for (const state of ['thinking', 'working', 'result']) {
    const d = new Director(config, () => { throw Error('Unexpected draw'); }, 0);
    d.beginHold(0); presence(d, state, 2000, 'drag'); d.endHold();
    assert.equal(auto(d, 300000, false), null);
  }
  const d = new Director({ ...config, idleSeconds: [45, 45] }, () => 0, 0);
  assert.equal(presence(d, 'waiting', 0).kind, 'work');
  assert.equal(auto(d, 99999, false), null);
  assert.equal(auto(d, 100000, false).kind, 'idle.once');
  assert.equal(play(d, 'animation-end').kind, 'work');
  assert.equal(auto(d, 189999, false), null);
  assert.equal(auto(d, 190000, false).kind, 'turn');
  for (const [state, clip] of [['success', 'sweat'], ['error', 'wave']]) {
    assert.deepEqual(presence(d, state), { clip, loop: false, kind: state, rate: 1 });
    play(d, 'animation-end');
    assert.equal(auto(d, 300000, false), null);
  }
});
test('six click responses are one-shot and never repeat consecutively', () => {
  let ticket = 0;
  const d = new Director(config, () => ticket);
  let previous = '';
  const selected = new Set();
  for (let i = 0; i < 101; i++) {
    ticket = (i * 37 % 101) / 101;
    const action = play(d, 'click');
    assert.equal(action.loop, false);
    assert.notEqual(action.clip, previous);
    selected.add(action.clip);
    previous = action.clip;
  }
  assert.deepEqual(selected, new Set(config.animations.clicks.map(entry => entry.clip)));
});
test('sleep enters, loops, wakes; a wake during entry waits for the sleeping pose', () => {
  const d = new Director(config); play(d, 'startup'); play(d, 'menu-sleep');
  assert.equal(d.current.kind, 'sleep.start'); play(d, 'animation-end');
  assert.equal(d.rest, 'asleep'); assert.equal(d.current.loop, true);
  assert.equal(play(d, 'animation-end'), null); assert.equal(d.current.kind, 'sleep.loop'); play(d, 'menu-wake');
  assert.equal(d.current.kind, 'sleep.end'); play(d, 'animation-end'); assert.equal(d.rest, 'awake');
  play(d, 'menu-sleep'); play(d, 'menu-wake'); assert.equal(d.current.kind, 'sleep.start'); play(d, 'animation-end');
  assert.equal(d.current.kind, 'sleep.end');
});
test('presence loops four work states, success/error once per edge; sleep suppresses presence', () => {
  const d = new Director(config); play(d, 'startup');
  for (const s of ['thinking', 'working', 'result', 'waiting']) { presence(d, s); assert.equal(d.current.loop, true); assert.equal(d.current.kind, 'work'); }
  for (const s of ['success', 'error']) { presence(d, s); assert.equal(d.current.loop, false); play(d, 'animation-end'); const action = d.current; presence(d, s); assert.equal(d.current, action); assert.equal(d.current.kind, 'idle'); }
  play(d, 'menu-sleep'); const entry = d.current; presence(d, 'thinking'); assert.equal(d.current, entry); play(d, 'animation-end'); play(d, 'menu-wake'); play(d, 'animation-end'); assert.equal(d.current.kind, 'work');
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

test('same-tick arbitration: direct > click > presence > random; clicks supersede active presence one-shots', () => {
  const d = new Director(config, () => 0, 0);
  play(d, 'startup');
  const random = { source: 'random-chain' }, click = { source: 'click' };
  const success = { source: 'presence', state: 'success', valid: true };
  const error = { ...success, state: 'error' };
  const [lostRandom, wonClick, lostSuccess] = d.request([random, click, success], context(50000));
  assert.equal(lostRandom.outcome, 'rejected');
  assert.equal(lostSuccess.outcome, 'rejected');
  assert.equal(wonClick.action.clip, 'clickhappy');
  presence(d, 'idle', 50016);
  assert.equal(presence(d, 'success', 50032).clip, 'sweat');
  assert.equal(d.request([click], context(50048))[0].outcome, 'played');
  play(d, 'animation-end');
  assert.equal(d.request([success], context(60000))[0].outcome, 'rejected');
  const [lostPresence, wonDirect] = d.request([error, { source: 'double-click' }], context(60000));
  assert.equal(lostPresence.outcome, 'rejected');
  assert.equal(wonDirect.source, 'double-click');
  assert.equal(wonDirect.action.clip, 'wave');
  assert.equal(d.presence, 'error');
  play(d, 'animation-end');
  presence(d, 'idle', 60001);
  const [lostChain, wonLaterClick] = d.request([random, click], context(70000));
  assert.equal(lostChain.outcome, 'rejected');
  assert.equal(wonLaterClick.source, 'click');
  assert.equal(presence(d, 'working', 71000).kind, 'work');
  assert.equal(play(d, 'click', 71001).kind, 'clicks', 'work loop allows a later click');
});

test('manifest routes work, replies, alert and landing without a production move', () => {
  const d = new Director(validateConfig(config), () => .99, 0);
  play(d, 'startup');
  assert.equal(auto(d, 50000, true).kind, 'turn');
  play(d, 'animation-end');
  assert.equal(auto(d, 150000, true).kind, 'idle.once');
  assert.equal(presence(d, 'working', 150001).clip, 'coding');
  for (const [category, clip] of [['work', 'coding'], ['happy', 'laugh']]) {
    assert.equal(d.request([{ source: 'reply-category', category }], context())[0].action.clip, clip);
  }
  assert.equal(d.request([{ source: 'reply-category', category: 'battle' }], context())[0].outcome, 'rejected');
  assert.equal(d.request([{ source: 'reply-category', category: 'constructor' }], context())[0].outcome, 'rejected');
  assert.equal(play(d, 'click-startle').clip, 'startled');
  assert.equal(play(d, 'landing').clip, 'sitdown');
});

test('sleep relay rejects each interrupt source and queues one wake during entry', () => {
  const d = new Director(config, () => 0, 0);
  play(d, 'startup');
  play(d, 'menu-sleep');
  for (const [kind, state] of [['sleep.start', 'thinking'], ['sleep.end', 'waiting']]) {
    assert.equal(d.current.kind, kind);
    d.beginHold(0);
    for (const request of [{ source: 'presence', state, valid: true }, { source: 'click' }, { source: 'click-combo' },
      { source: 'click-startle' }, { source: 'random-chain' }, { source: 'long-press' }, { source: 'drag' },
      { source: 'double-click' }, { source: 'config-reload' }, { source: 'placement' }]) {
      const active = d.current;
      assert.equal(d.request([request], context(50000, 'drag'))[0].outcome, 'rejected', `${kind} blocks ${request.source}`);
      assert.equal(d.current, active);
    }
    d.endHold();
    assert.equal(d.presence, state);
    const [wake] = d.request([{ source: 'pointer-wake' }], context(50100));
    assert.equal(wake.outcome, kind === 'sleep.start' ? 'queued' : 'rejected');
    assert.equal(d.request([{ source: 'chat-reply' }], context(50101))[0].outcome, 'rejected');
    play(d, 'animation-end', 51000);
  }
  assert.equal(d.rest, 'awake');
  assert.equal(d.current.kind, 'work');
});

test('long press blocks presence immediately and both release outcomes restore normal rate', () => {
  for (const [ticket, clip] of [[.499, 'clicktsun'], [.5, 'idle']]) {
    const d = new Director(config, () => ticket, 0);
    play(d, 'startup');
    d.beginHold(0);
    assert.deepEqual(play(d, 'long-press', 500, 'drag'), { clip: 'clicktsun', loop: true, kind: 'long-press', rate: .75 });
    assert.equal(presence(d, 'success', 501, 'drag'), null);
    assert.equal(play(d, 'random-chain', 100000, 'drag'), null);
    assert.equal(play(d, 'click', 510, 'drag'), null);
    d.endHold();
    assert.deepEqual(play(d, 'long-press-release', 999), { clip, loop: clip === 'idle', kind: clip === 'idle' ? 'idle' : 'clicks', rate: 1 });
    assert.equal(presence(d, 'error', 1010).kind, 'error');
  }
  const d = new Director(config, () => 0, 0);
  play(d, 'startup'); d.beginHold(0); play(d, 'long-press', 500, 'drag');
  assert.equal(play(d, 'drag', 501, 'drag').clip, 'dangle');
  assert.equal(play(d, 'long-press-release', 502), null);
  d.endHold();
  assert.equal(play(d, 'drag-release', 503).rate, 1);
});

test('air and walk block auto actions; landing and walk completion return to baseline', () => {
  const d = new Director(config, () => 0, 0);
  play(d, 'startup');
  for (const mode of ['air', 'walk']) assert.equal(auto(d, 200000, false, mode), null);
  assert.equal(play(d, 'landing', 200001).clip, 'sitdown');
  assert.equal(presence(d, 'thinking', 200002), null);
  assert.equal(play(d, 'animation-end', 200003).kind, 'idle');
  assert.equal(play(d, 'walk-end', 200004).kind, 'work');
});

test('desktop return greets from doze while both sleep transitions remain protected', () => {
  const d = new Director(config, () => 0, 0);
  play(d, 'startup'); play(d, 'menu-sleep');
  assert.equal(play(d, 'desktop-return'), null);
  play(d, 'animation-end');
  assert.equal(play(d, 'desktop-return').clip, 'wave');
  assert.equal(d.rest, 'awake');
  play(d, 'menu-sleep'); play(d, 'animation-end'); play(d, 'chat-open');
  assert.equal(play(d, 'desktop-return'), null);
  assert.equal(d.rest, 'waking');
});
