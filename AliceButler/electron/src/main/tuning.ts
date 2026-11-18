export interface Tuning {
  memoryHighMiB: number;
  memoryPollMs: number;
  reclaimCooldownMs: number;
  loopCoverMs: number;
  hitAlpha: number;
  tickMs: number;
  maintenanceMs: number;
  replyPollMs: number;
  statusPollMs: number;
  heartbeatMs: number;
  statsMs: number;
  decoderReleaseMs: number;
  idleSleepMs: number;
  firstRandomMs: number;
  pendingThinkMs: number;
  replyTimeoutMs: number;
  presenceValidMs: number;
  futureToleranceMs: number;
  chatRows: number;
  historyPairs: number;
  replyBadCount: number;
  replyBadAgeMs: number;
  maxReplyBytes: number;
  maxMessageChars: number;
  clickHoldMs: number;
  doubleClickMs: number;
  dragDistancePx: number;
  releaseStaleMs: number;
  walkMinPx: number;
  walkExtraPx: number;
  walkSpeed: number;
  throwMinSpeed: number;
  snapDistancePx: number;
  snapGapPx: number;
  homeInsetPx: number;
  frameReportMs: number;
  firstFrameMs: number;
  fadeMs: number;
  bubbleMs: number;
  chatScrollPx: number;
}

export const defaultTuning: Tuning = require('../../defaults.json').tuning;

export function readTuning(input: unknown): Tuning {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw Error('Invalid tuning section');
  const tuning = { ...defaultTuning, ...input as Partial<Tuning> };
  for (const key of Object.keys(defaultTuning) as (keyof Tuning)[]) {
    if (!Number.isSafeInteger(tuning[key]) || tuning[key] < (key === 'hitAlpha' ? 0 : 1) || tuning[key] > 2147483647)
      throw Error('Invalid tuning parameter: ' + key);
  }
  if (tuning.hitAlpha > 254) throw Error('Invalid hit alpha threshold');
  if (tuning.bubbleMs < 2000) throw Error('Bubbles must stay visible for at least two seconds');
  return tuning;
}

export interface TriggerConfig {
  interactionCooldownMs: number;
  recentWalkRounds: number;
  recentWalkWeightFactor: number;
  drowsyAfterMs: number;
  drowsyIntervalFactor: number;
  wakeProtectionMs: number;
  clickComboEnabled: boolean;
  clickComboGapMs: number;
  clickComboCount: number;
  dragProtectionMs: number;
  waitingIntervalFactor: number;
}

const defaultTriggers: TriggerConfig = require('../../defaults.json').triggers;

export function readTriggers(input: unknown): TriggerConfig {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw Error('Invalid triggers section');
  const triggers = { ...defaultTriggers, ...input as Partial<TriggerConfig> };
  for (const key of ['interactionCooldownMs', 'recentWalkRounds', 'drowsyAfterMs', 'wakeProtectionMs',
    'clickComboGapMs', 'clickComboCount', 'dragProtectionMs'] as const) {
    if (!Number.isSafeInteger(triggers[key]) || triggers[key] <= 0) throw Error('Invalid trigger parameter: ' + key);
  }
  for (const key of ['drowsyIntervalFactor', 'waitingIntervalFactor'] as const) {
    if (!Number.isFinite(triggers[key]) || triggers[key] < 1) throw Error('Invalid trigger parameter: ' + key);
  }
  if (!Number.isFinite(triggers.recentWalkWeightFactor) || triggers.recentWalkWeightFactor <= 0 || triggers.recentWalkWeightFactor > 1)
    throw Error('Invalid recent walk weight factor');
  if (typeof triggers.clickComboEnabled !== 'boolean') throw Error('Invalid click combo switch');
  return triggers;
}
