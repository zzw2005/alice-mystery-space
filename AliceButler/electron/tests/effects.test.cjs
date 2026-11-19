const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { validateConfig } = require('../dist/main/engine');

test('effects config supports both atmospheres and preserves the five action mappings', () => {
  const { atmosphere, actions } = validateConfig(config).effects;
  assert.equal(atmosphere, 'off');
  assert.deepEqual(Object.fromEntries(Object.entries(actions).map(([clip, { type, anchor }]) => [clip, [type, anchor]])), {
    clickhappy: ['pixelfx', 'head'], laugh: ['pixelfx', 'front'], clickshy: ['petals', 'head'],
    rage: ['steam', 'sides'], knock: ['impact', 'front']
  });
  assert.equal(actions.clickhappy.fx, 'collect-burst');
  assert.equal(actions.laugh.fx, 'confetti');
  assert.equal(actions.rage.fx, undefined);
  for (const mode of ['off', 'snow', 'glow'])
    assert.equal(validateConfig({ ...config, effects: { atmosphere: mode } }).effects.atmosphere, mode);
  assert.equal(actions.wave, undefined);
  const legacy = { ...config };
  delete legacy.effects;
  assert.equal(validateConfig(legacy).effects.atmosphere, 'off');
  assert.deepEqual(Object.keys(validateConfig(legacy).effects.actions), []);
});

test('both shipped configs default to no atmosphere', () => {
  for (const preset of [config, require('../defaults.json')])
    assert.equal(validateConfig(preset).effects.atmosphere, 'off');
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

test('effects config validates pixelfx actions strictly', () => {
  const base = { type: 'pixelfx', anchor: 'head', intensity: 0.5 };
  assert.equal(validateConfig({ ...config, effects: { actions: { wave: { ...base, fx: 'confetti' } } } }).effects.actions.wave.fx, 'confetti');
  for (const action of [
    { ...base },
    { ...base, fx: 'nuke' },
    { type: 'stars', anchor: 'head', intensity: 0.5, fx: 'confetti' }
  ]) {
    assert.throws(() => validateConfig({ ...config, effects: { actions: { wave: action } } }), /Invalid action effect/);
  }
});
