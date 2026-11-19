const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { validateConfig } = require('../dist/main/engine');

test('effects config supports both atmospheres and preserves the five action mappings', () => {
  const { atmosphere, actions } = validateConfig(config).effects;
  assert.equal(atmosphere, 'glow');
  assert.deepEqual(Object.fromEntries(Object.entries(actions).map(([clip, { type, anchor }]) => [clip, [type, anchor]])), {
    clickhappy: ['stars', 'head'], laugh: ['stars', 'head'], clickshy: ['petals', 'head'],
    rage: ['steam', 'sides'], knock: ['impact', 'front']
  });
  for (const mode of ['off', 'snow', 'glow'])
    assert.equal(validateConfig({ ...config, effects: { atmosphere: mode } }).effects.atmosphere, mode);
  assert.equal(actions.wave, undefined);
  const legacy = { ...config };
  delete legacy.effects;
  assert.equal(validateConfig(legacy).effects.atmosphere, 'off');
  assert.deepEqual(Object.keys(validateConfig(legacy).effects.actions), []);
});

test('effects config rejects unknown anchors, clips, types and unsafe intensity', () => {
  const original = config.effects.actions.rage;
  for (const action of [
    { ...original, type: 'explode' },
    { ...original, anchor: 'left' },
    { ...original, intensity: Infinity },
    { ...original, intensity: 1.01 },
    { ...original, intensity: -.1 }
  ]) {
    assert.throws(() => validateConfig({ ...config, effects: { actions: { rage: action } } }), /Invalid action effect/);
  }
  assert.throws(() => validateConfig({ ...config, effects: { actions: { missing: original } } }), /Invalid action effect/);
  assert.throws(() => validateConfig({ ...config, effects: { atmosphere: 'rain' } }), /Invalid effects atmosphere/);
});
