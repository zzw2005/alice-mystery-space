import type { ActionEffect, EffectsConfig } from '../shared/effects';

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid effects config');
  return input as Record<string, unknown>;
}

export function readEffects(input: unknown, clips: Record<string, unknown>): EffectsConfig {
  const config = input === undefined ? {} : object(input);
  const atmosphere = config.atmosphere === undefined ? 'off' : config.atmosphere;
  if (atmosphere !== 'off' && atmosphere !== 'snow' && atmosphere !== 'glow') throw Error('Invalid effects atmosphere');
  const actions: Record<string, ActionEffect> = Object.create(null);
  for (const [clip, entry] of Object.entries(config.actions === undefined ? {} : object(config.actions))) {
    const { type, anchor, intensity, fx } = object(entry);
    if (!Object.hasOwn(clips, clip) || !/^[a-z][a-z0-9-]*$/.test(clip) ||
        (type !== 'stars' && type !== 'petals' && type !== 'steam' && type !== 'impact' && type !== 'pixelfx') ||
        (anchor !== 'head' && anchor !== 'front' && anchor !== 'sides') ||
        typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1 ||
        (type === 'pixelfx' ? fx !== 'collect-burst' && fx !== 'confetti' : fx !== undefined))
      throw Error('Invalid action effect');
    actions[clip] = fx === undefined ? { type, anchor, intensity } : { type, anchor, intensity, fx: fx as string };
  }
  return { atmosphere, actions };
}
