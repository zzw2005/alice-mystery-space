export type Atmosphere = 'off' | 'snow' | 'glow';
export type EffectType = 'stars' | 'petals' | 'steam' | 'impact' | 'pixelfx';
export type EffectAnchor = 'head' | 'front' | 'sides';
export interface ActionEffect {
  type: EffectType;
  anchor: EffectAnchor;
  intensity: number;
  /** Bundled pixelfx effect id; required when type is 'pixelfx', absent otherwise. */
  fx?: string;
}
export interface EffectsConfig {
  atmosphere: Atmosphere;
  actions: Record<string, ActionEffect>;
}
export interface EffectsState {
  enabled: boolean;
  visible: boolean;
  config: EffectsConfig;
}
