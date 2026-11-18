import { defaultTuning, readTriggers, readTuning, TriggerConfig, Tuning } from './tuning';
import type { InteractionConfig } from './gestures';
export type Presence = 'idle' | 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error';
export type Entry = { clip: string; weight: number; loop?: boolean; provisional?: boolean };
export type Action = { clip: string; loop: boolean; kind: string };
export interface PetConfig {
  tuning: Tuning;
  interaction: InteractionConfig;
  triggers: TriggerConfig;
  animations: {
    idle: Entry[]; turn: Entry[]; drag: Entry[]; clicks: Entry[]; moves: Entry[];
    sleep: { start: Entry[]; loop: Entry[]; end: Entry[] };
    workStatus: Record<Exclude<Presence, 'idle'>, Entry[]>;
  };
  animationWeights: { idle: number; turn: number; moves: number };
  idleSeconds: [number, number];
  clips: Record<string, { file: string; facing?: 'left' | 'right'; provisional?: boolean }>;
}
const states = ['thinking', 'working', 'result', 'waiting', 'success', 'error'] as const;
export function validateConfig(input: unknown): PetConfig {
  const c = input as PetConfig;
  if (!c || !c.clips || !c.animations || !c.animationWeights) throw Error('Missing animation config');
  for (const key of ['hoverMs', 'peekCooldownMs', 'gazeSpeed', 'approachSpeed', 'approachWindowMs',
    'startleLimit', 'startleWindowMs', 'landingHeight', 'landingSpeed', 'awayMs', 'dragTiltSpeed', 'dragTiltDegrees'] as const) {
    if (!Number.isFinite(c.interaction?.[key]) || c.interaction[key] <= 0) throw Error('Invalid interaction threshold: ' + key);
  }
  if (!Number.isInteger(c.interaction.startleLimit)) throw Error('Invalid startle limit');
  for (const [id, clip] of Object.entries(c.clips)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !/^[a-z][a-z0-9-]*\.webm$/.test(clip.file)) throw Error('Unsafe clip path');
  }
  const pools = [c.animations.idle, c.animations.turn, c.animations.drag, c.animations.clicks, c.animations.moves,
    c.animations.sleep?.start, c.animations.sleep?.loop, c.animations.sleep?.end,
    ...states.map(s => c.animations.workStatus?.[s])];
  for (const pool of pools) {
    if (!Array.isArray(pool) || !pool.length || pool.length > 100) throw Error('Empty or oversized pool');
    for (const entry of pool) if (!c.clips[entry.clip] || !Number.isFinite(entry.weight) || entry.weight <= 0 || entry.weight > 10000) throw Error('Invalid pool entry');
    if (new Set(pool.map(e => e.clip)).size !== pool.length) throw Error('Duplicate pool clip');
  }
  for (const key of ['idle', 'turn', 'moves'] as const) if (!Number.isFinite(c.animationWeights[key]) || c.animationWeights[key] <= 0) throw Error('Invalid chain weight');
  if (!Array.isArray(c.idleSeconds) || c.idleSeconds.length !== 2 || c.idleSeconds.some(v => !Number.isFinite(v)) || c.idleSeconds[0] < 10 || c.idleSeconds[1] < c.idleSeconds[0] || c.idleSeconds[1] > 600) throw Error('Invalid idle interval');
  const triggers = readTriggers(c.triggers);
  if (triggers.clickComboEnabled && !c.clips.clicktsun) throw Error('Missing click combo clip: clicktsun');
  return { ...c, tuning: readTuning(c.tuning), triggers };
}
export class Director {
  rest: 'awake' | 'entering' | 'asleep' | 'waking' = 'awake';
  presence: Presence = 'idle';
  current: Action = { clip: '', loop: true, kind: 'idle' };
  queue: Action[] = [];
  private last = new Map<string, string>();
  private lastInteraction?: number;
  private holdAt?: number;
  private wakeEndedAt = -Infinity;
  private lastChainAt: number;
  private chainInterval: number;
  private chainRound = 0;
  private lastWalkRound = -Infinity;
  constructor(public config: PetConfig, private random = Math.random, private startedAt = Date.now()) {
    this.lastChainAt = startedAt;
    this.chainInterval = config.tuning.firstRandomMs;
  }
  pickEntry(pool: Entry[], key: string): Entry {
    const candidates = pool.length > 1 ? pool.filter(e => e.clip !== this.last.get(key)) : pool;
    let ticket = this.random() * candidates.reduce((n, e) => n + e.weight, 0);
    let selected = candidates[candidates.length - 1];
    for (const e of candidates) { ticket -= e.weight; if (ticket < 0) { selected = e; break; } }
    this.last.set(key, selected.clip);
    return selected;
  }
  pick(pool: Entry[], key: string): string { return this.pickEntry(pool, key).clip; }
  play(clip: string, loop: boolean, kind: string): Action { return this.current = { clip, loop, kind }; }
  gesture(clip: 'sitdown' | 'peek' | 'startled' | 'wave'): Action {
    this.rest = 'awake'; this.wakePending = false;
    return this.play(clip, false, clip);
  }
  base(): Action {
    if (this.rest === 'asleep') return this.play(this.pick(this.config.animations.sleep.loop, 'sleep.loop'), true, 'sleep.loop');
    const s = this.presence;
    if (s !== 'idle' && s !== 'success' && s !== 'error') return this.play(this.pick(this.config.animations.workStatus[s], s), true, 'work');
    const looping = this.config.animations.idle.filter(e => e.loop !== false);
    return this.play(this.pick(looping.length ? looping : this.config.animations.idle, 'idle.loop'), true, 'idle');
  }
  react(kind: 'clicks' | 'drag' | 'turn' | 'moves'): Action | null {
    if (kind === 'drag') { this.rest = 'awake'; this.wakePending = false; }
    else if (this.rest !== 'awake') { this.wake(); return this.current; }
    return this.play(this.pick(this.config.animations[kind], kind), kind === 'drag' || kind === 'moves', kind);
  }
  click(combo: boolean): Action | null {
    if (!combo || this.rest !== 'awake') return this.react('clicks');
    this.last.set('clicks', 'clicktsun');
    return this.play('clicktsun', false, 'clicks');
  }
  interact(now: number): void { this.lastInteraction = now; }
  beginHold(now: number): void { this.holdAt = now; }
  endHold(): void { this.holdAt = undefined; }
  private protectedDrag(now: number): boolean {
    return this.holdAt !== undefined && now - this.holdAt >= this.config.triggers.dragProtectionMs;
  }
  automaticAction(now: number, chatOpen: boolean): Action | null {
    if (this.rest !== 'awake' || this.protectedDrag(now) || this.current.kind === 'drag') return null;
    const { triggers, tuning, idleSeconds } = this.config;
    const inactiveFor = now - (this.lastInteraction ?? this.startedAt);
    const canDoze = this.presence === 'idle' && !chatOpen;
    if (canDoze && inactiveFor >= tuning.idleSleepMs && now - this.wakeEndedAt >= triggers.wakeProtectionMs)
      return this.sleep();

    const waiting = this.presence === 'waiting';
    if (this.presence !== 'idle' && !waiting) return null;
    if (this.lastInteraction !== undefined && inactiveFor < triggers.interactionCooldownMs) return null;
    const { kind } = this.current;
    if (kind !== 'idle' && kind !== 'turn' && !(waiting && kind === 'work')) return null;
    const intervalFactor = waiting ? triggers.waitingIntervalFactor :
      canDoze && inactiveFor >= triggers.drowsyAfterMs ? triggers.drowsyIntervalFactor : 1;
    if (now - this.lastChainAt < this.chainInterval * intervalFactor) return null;

    const action = this.drawChain();
    this.lastChainAt = now;
    const [min, max] = idleSeconds;
    this.chainInterval = 1000 * (min + this.random() * (max - min));
    return action;
  }
  private drawChain(): Action | null {
    const { animationWeights, triggers } = this.config;
    const recentWalk = this.chainRound - this.lastWalkRound < triggers.recentWalkRounds;
    const pool = Object.entries(animationWeights).map(([clip, weight]) => ({
      clip, weight: clip === 'moves' && recentWalk ? weight * triggers.recentWalkWeightFactor : weight
    }));
    const kind = this.pick(pool, 'chain') as 'idle' | 'turn' | 'moves';
    this.chainRound++;
    if (kind === 'moves') this.lastWalkRound = this.chainRound;
    if (kind === 'idle') {
      const once = this.config.animations.idle.filter(e => e.loop === false);
      return once.length ? this.play(this.pick(once, 'idle.once'), false, 'idle.once') : null;
    }
    return this.react(kind);
  }
  sleep(): Action {
    this.rest = 'entering'; this.queue = [];
    return this.play(this.pick(this.config.animations.sleep.start, 'sleep.start'), false, 'sleep.start');
  }
  wake(): Action {
    if (this.rest === 'awake' || this.rest === 'waking') return this.current;
    // Finish the entry before waking so the sleeping anchor is reached first.
    if (this.rest === 'entering') { this.wakePending = true; return this.current; }
    this.rest = 'waking';
    return this.play(this.pick(this.config.animations.sleep.end, 'sleep.end'), false, 'sleep.end');
  }
  private wakePending = false;
  setPresence(state: Presence, now = Date.now()): Action {
    if (state === this.presence) return this.current;
    this.presence = state;
    if (this.rest !== 'awake' || this.protectedDrag(now) || ['drag', 'sitdown', 'startled', 'peek', 'wave'].includes(this.current.kind)) return this.current;
    if (state === 'success' || state === 'error') return this.play(this.pick(this.config.animations.workStatus[state], state), false, state);
    return this.base();
  }
  ended(now = Date.now()): Action {
    if (this.current.loop) return this.current;
    if (this.current.kind === 'sleep.start') {
      this.rest = 'asleep';
      if (this.wakePending) { this.wakePending = false; return this.wake(); }
      return this.base();
    }
    if (this.current.kind === 'sleep.end') { this.rest = 'awake'; this.wakeEndedAt = now; }
    if (['sitdown', 'peek', 'startled', 'wave'].includes(this.current.kind)) return this.play('idle', true, 'idle');
    const queued = this.queue.shift();
    return queued ? this.current = queued : this.base();
  }
}

export class Physics {
  x = 0; y = 0; vx = 0; vy = 0;
  mode: 'idle' | 'drag' | 'air' | 'walk' = 'idle';
  targetX = 0; targetY = 0; direction = 1; squash = 1;
  private peakHeight = 0;
  private impactAt = -1000;
  step(dt: number, area: { left: number; right: number; top: number; floor: number }, now: number, cfg?: InteractionConfig, tuning = defaultTuning): boolean {
    let hardLanding = false;
    if (this.mode !== 'air') this.peakHeight = 0;
    dt = Math.min(.05, Math.max(.001, dt));
    if (this.mode === 'drag') {
      // Exact critically damped spring: stable even after a slow frame, with a
      // shorter response than the old explicit-Euler 200/30 spring.
      const omega = 40, decay = Math.exp(-omega * dt);
      const dx = this.x - this.targetX, dy = this.y - this.targetY;
      const cx = this.vx + omega * dx, cy = this.vy + omega * dy;
      this.x = this.targetX + (dx + cx * dt) * decay;
      this.y = this.targetY + (dy + cy * dt) * decay;
      this.vx = (this.vx - omega * cx * dt) * decay;
      this.vy = (this.vy - omega * cy * dt) * decay;
    } else if (this.mode === 'air') {
      for (let i = 0; i < 3; i++) {
        this.peakHeight = Math.max(this.peakHeight, area.floor - this.y);
        this.vy += 1400 * dt / 3; this.x += this.vx * dt / 3; this.y += this.vy * dt / 3;
        if (this.x < area.left || this.x > area.right) { this.x = Math.max(area.left, Math.min(area.right, this.x)); this.vx = -this.vx * .78; }
        if (this.y < area.top) { this.y = area.top; this.vy = Math.abs(this.vy) * .78; }
        if (this.y >= area.floor) {
          hardLanding = !!cfg && (this.peakHeight > cfg.landingHeight || this.vy > cfg.landingSpeed);
          this.y = area.floor; this.vx = this.vy = 0; this.mode = 'idle';
          this.impactAt = hardLanding ? -Infinity : now; this.peakHeight = 0; break;
        }
      }
    } else if (this.mode === 'walk') {
      this.direction = this.targetX > this.x ? 1 : -1;
      const step = tuning.walkSpeed * dt;
      if (Math.abs(this.targetX - this.x) <= step) { this.x = this.targetX; this.mode = 'idle'; }
      else this.x += this.direction * step;
    }
    this.x = Math.max(area.left, Math.min(area.right, this.x)); this.y = Math.max(area.top, Math.min(area.floor, this.y));
    const u = (now - this.impactAt) / 220;
    this.squash = u >= 0 && u < 1 ? 1 - .25 * Math.sin(u * Math.PI) : 1;
    return hardLanding;
  }
  release(stale: boolean, tuning = defaultTuning): void {
    if (stale) this.vx = this.vy = 0;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed < tuning.throwMinSpeed) this.vx = this.vy = 0;
    else { const scale = 3600 * (1 - Math.exp(-speed / 3600)) / speed; this.vx *= scale; this.vy *= scale; }
    this.mode = 'air';
  }
}
