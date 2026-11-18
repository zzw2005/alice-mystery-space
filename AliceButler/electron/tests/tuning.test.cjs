const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, Physics } = require('../dist/main/engine');
const { readTuning } = require('../dist/main/tuning');
const { snap } = require('../dist/main/placement');
const { Bridge } = require('../dist/main/bridge');
const config = require('../config.json');

test('partial and older configs keep their weights and fill missing tuning keys', () => {
  const legacy = structuredClone(config);
  delete legacy.tuning;
  delete legacy.triggers;
  legacy.animationWeights.turn = 17;
  assert.deepEqual(validateConfig(legacy).tuning, config.tuning);
  assert.deepEqual(validateConfig(legacy).triggers, config.triggers);
  assert.equal(validateConfig(legacy).animationWeights.turn, 17);
  assert.deepEqual(require('../defaults.json'), config);
  assert.throws(() => readTuning({ replyPollMs: -1 }));
  assert.throws(() => readTuning({ replyStaggerMs: 0 }));
  assert.throws(() => readTuning({ bubbleMs: 1000 }));
});

test('trigger configuration fills individual keys and validates the new inputs', () => {
  const triggers = { clickComboEnabled: false, recentWalkWeightFactor: .25, waitingIntervalFactor: 1.5,
    longPressMs: 700, longPressRate: .5, longPressReleaseChance: 0 };
  assert.deepEqual(validateConfig({ ...config, triggers }).triggers, { ...config.triggers, ...triggers });
  for (const triggers of [{ clickComboEnabled: 1 }, { clickComboCount: 1.5 }, { wakeProtectionMs: -1 },
    { drowsyIntervalFactor: .5 }, { recentWalkWeightFactor: 2 }, { longPressMs: -1 }, { longPressRate: 0 }, { longPressReleaseChance: 1.1 }]) {
    assert.throws(() => validateConfig({ ...config, triggers }), /trigger|walk weight|click combo|long press/);
  }
});

test('custom snap, walk, throw and message limits reach their consumers', async () => {
  const tuning = readTuning({ snapDistancePx: 7, snapGapPx: 2, walkSpeed: 80, throwMinSpeed: 850, maxMessageChars: 4 });
  const bounds = { left: 0, right: 100, floor: 100, top: 0 };
  assert.equal(snap(8, 50, bounds, tuning), undefined);
  assert.deepEqual(snap(7, 50, bounds, tuning), { x: 2, y: 50 });
  const physics = new Physics();
  physics.mode = 'walk'; physics.targetX = 90;
  physics.step(.05, bounds, 1000, config.interaction, tuning);
  assert.equal(physics.x, 4);
  physics.vx = 800; physics.release(false, tuning); assert.equal(physics.vx, 0);
  await assert.rejects(new Bridge('.', tuning).send('abcde'), /过长/);
});
