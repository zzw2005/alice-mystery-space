import { defaultTuning, readTriggers, readTuning, TriggerConfig, Tuning } from './tuning';
import type { InteractionConfig } from './gestures';
export type Presence = 'idle' | 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error';
export type Entry = { clip: string; weight: number; loop?: boolean; provisional?: boolean };
export type Action = Readonly<{ clip: string; loop: boolean; kind: string; rate: number }>;
type WakeSource = 'pointer-wake' | 'chat-open' | 'chat-send' | 'chat-reply' | 'menu-wake';
type SimpleSource = WakeSource | 'startup' | 'resume' | 'media-fallback' | 'animation-end' | 'placement' |
  'config-reload' | 'hover-exit' | 'drag-release' | 'walk-end' | 'drag' | 'menu-sleep' | 'double-click' |
  'desktop-return' | 'landing' | 'hover-peek' | 'click-startle' | 'click-combo' | 'auto-sleep' | 'random-chain' |
  'long-press';
export type ActionRequest = { source: SimpleSource } |
  { source: 'presence'; state: Presence; valid: boolean } |
  { source: 'click'; dismissPeek?: boolean } |
  { source: 'long-press-release'; cancelled?: boolean } |
  { source: 'test'; action: Action | 'sleep' | 'wake' };
type Source = ActionRequest['source'];
type Context = { now: number; motion: Physics['mode']; chatOpen: boolean };
export type Decision = { outcome: 'played'; action: Action; source: Source } | { outcome: 'queued' | 'rejected' };

// Higher entries win within the same physics tick. Lifecycle requests are also
// accepted individually for renderer readiness, completion and error callbacks.
const priority: Record<Source, number> = {
  startup: 5, resume: 5, 'media-fallback': 5, 'animation-end': 5,
  drag: 4, 'drag-release': 4, 'double-click': 4, 'long-press': 4, 'long-press-release': 4,
  'pointer-wake': 4, 'chat-open': 4, 'chat-send': 4, 'chat-reply': 4, 'menu-wake': 4, 'menu-sleep': 4,
  placement: 4, 'config-reload': 4, 'desktop-return': 4, landing: 4, test: 4,
  presence: 3, click: 2, 'click-combo': 2, 'click-startle': 2, 'hover-peek': 2, 'hover-exit': 2,
  'walk-end': 1, 'auto-sleep': 1, 'random-chain': 0
};
const wakes = new Set<Source>(['pointer-wake', 'chat-open', 'chat-send', 'chat-reply', 'menu-wake']);
const reactionSources = new Set<Source>(['click', 'click-combo', 'click-startle', 'hover-peek']);
const presenceProtected = new Set(['drag', 'long-press', 'sitdown', 'startled', 'peek', 'wave']);
const idleAfter = new Set(['sitdown', 'peek', 'startled', 'wave']);
const rejected = { outcome: 'rejected' } as const;
function action(clip: string, loop: boolean, kind: string, rate = 1): Action { return { clip, loop, kind, rate }; }
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
  if (!c.clips.clicktsun) throw Error('Missing interaction clip: clicktsun');
  return { ...c, tuning: readTuning(c.tuning), triggers };
}
export class Director {
  private restState: 'awake' | 'entering' | 'asleep' | 'waking' = 'awake';
  private presenceState: Presence = 'idle';
  private active = action('', true, 'idle');
  private last = new Map<string, string>();
  private unavailable = new Set<string>();
  private lastInteraction?: number;
  private holdAt?: number;
  private wakePending = false;
  private wakeEndedAt = -Infinity;
  private lastChainAt: number;
  private chainInterval: number;
  private chainRound = 0;
  private lastWalkRound = -Infinity;
  constructor(public config: PetConfig, private random = Math.random, private startedAt = Date.now()) {
    this.lastChainAt = startedAt;
    this.chainInterval = config.tuning.firstRandomMs;
  }
  get rest() { return this.restState; }
  get presence() { return this.presenceState; }
  get current() { return this.active; }
  pickEntry(pool: Entry[], key: string): Entry {
    const candidates = pool.length > 1 ? pool.filter(e => e.clip !== this.last.get(key)) : pool;
    let ticket = this.random() * candidates.reduce((n, e) => n + e.weight, 0);
    let selected = candidates[candidates.length - 1];
    for (const e of candidates) { ticket -= e.weight; if (ticket < 0) { selected = e; break; } }
    this.last.set(key, selected.clip);
    return selected;
  }
  pick(pool: Entry[], key: string): string { return this.pickEntry(pool, key).clip; }
  interact(now: number): void { this.lastInteraction = now; }
  beginHold(now: number): void { this.holdAt = now; }
  endHold(): void { this.holdAt = undefined; }
  replaceConfig(config: PetConfig): void { this.config = config; this.unavailable.clear(); }
  private protectedDrag(now: number): boolean {
    return this.holdAt !== undefined && now - this.holdAt >= this.config.triggers.dragProtectionMs;
  }

  request(requests: readonly ActionRequest[], context: Context): Decision[] {
    const changedPresence = new Set<ActionRequest>();
    for (const request of requests) {
      if (request.source !== 'presence' || request.state === this.presence) continue;
      this.presenceState = request.state;
      if (request.valid) changedPresence.add(request);
    }
    const decisions: Decision[] = [];
    let switched = false;
    const order = requests.map((request, index) => ({ request, index }));
    order.sort((a, b) => priority[b.request.source] - priority[a.request.source]);
    for (const { request, index } of order) {
      if (switched || (request.source === 'presence' && !changedPresence.has(request))) {
        decisions[index] = rejected;
        continue;
      }
      const decision = this.resolve(request, context);
      decisions[index] = decision;
      switched = decision.outcome === 'played';
    }
    return decisions;
  }

  private resolve(request: ActionRequest, context: Context): Decision {
    const { source } = request, { now, motion, chatOpen } = context;
    if (source === 'resume') return { outcome: 'played', source, action: this.current };
    if (source === 'media-fallback') {
      this.unavailable.add(this.current.clip);
      return this.fallback();
    }
    if (source === 'animation-end') return this.commit(this.finish(now), source);
    if (source === 'startup') return this.commit(this.base(), source);
    const wake = wakes.has(source) || (source === 'test' && request.action === 'wake');
    if (this.rest === 'entering' && wake) {
      if (this.wakePending) return rejected;
      this.wakePending = true;
      return { outcome: 'queued' };
    }
    if (this.rest === 'entering' || this.rest === 'waking') return rejected;
    if (wake) return this.rest === 'asleep' ? this.commit(this.wake(), source) : rejected;
    if (source === 'placement') return this.commit(this.base(), source);
    if (source === 'config-reload')
      return this.current.kind === 'long-press' || this.current.kind === 'drag' ? rejected : this.commit(this.base(), source);
    if (source === 'desktop-return') {
      this.restState = 'awake';
      return this.commit(action('wave', false, 'wave'), source);
    }
    if (this.rest === 'asleep') return rejected;

    const kind = this.current.kind;
    if (reactionSources.has(source) && ['long-press', 'drag', 'success', 'error'].includes(kind)) return rejected;
    switch (request.source) {
      case 'presence':
        if (this.protectedDrag(now) || presenceProtected.has(kind)) return rejected;
        if (request.state === 'success' || request.state === 'error') {
          return this.commit(action(this.pick(this.config.animations.workStatus[request.state], request.state), false, request.state), source);
        }
        return this.commit(this.base(), source);
      case 'drag': return motion === 'drag' ? this.commit(this.reaction('drag'), source) : rejected;
      case 'long-press':
        return motion === 'drag' && this.holdAt !== undefined && kind !== 'drag' && kind !== 'long-press'
          ? this.commit(action('clicktsun', true, 'long-press', this.config.triggers.longPressRate), source) : rejected;
      case 'long-press-release':
        if (kind !== 'long-press') return rejected;
        return this.commit(!request.cancelled && this.random() < this.config.triggers.longPressReleaseChance
          ? action('clicktsun', false, 'clicks') : this.base(), source);
      case 'drag-release':
      case 'walk-end': return this.commit(this.base(), source);
      case 'hover-exit': return kind === 'peek' ? this.commit(this.base(), source) : rejected;
      case 'click': return this.commit(request.dismissPeek ? (kind === 'peek' ? this.base() : undefined) : this.reaction('clicks'), source);
      case 'click-combo':
        this.last.set('clicks', 'clicktsun');
        return this.commit(action('clicktsun', false, 'clicks'), source);
      case 'click-startle': return this.commit(action('startled', false, 'startled'), source);
      case 'hover-peek': return motion === 'idle' && kind === 'idle' ? this.commit(action('peek', false, 'peek'), source) : rejected;
      case 'double-click': return this.commit(action('wave', false, 'wave'), source);
      case 'landing': return this.commit(action('sitdown', false, 'sitdown'), source);
      case 'menu-sleep': return this.commit(this.sleep(), source);
      case 'auto-sleep':
        if (motion === 'idle' && !this.protectedDrag(now) && kind !== 'long-press' && kind !== 'drag' &&
            this.presence === 'idle' && !chatOpen && this.inactiveFor(now) >= this.config.tuning.idleSleepMs &&
            now - this.wakeEndedAt >= this.config.triggers.wakeProtectionMs)
          return this.commit(this.sleep(), source);
        return rejected;
      case 'random-chain': return this.commit(this.randomChain(context), source);
      case 'test':
        if (request.action === 'sleep') return this.commit(this.sleep(), source);
        if (request.action !== 'wake') return this.commit(request.action, source);
    }
    return rejected;
  }

  private commit(next: Action | undefined, source: Source): Decision {
    if (!next) return rejected;
    if (this.unavailable.has(next.clip)) return this.fallback();
    this.active = next;
    return { outcome: 'played', action: next, source };
  }
  private fallback(): Decision {
    const clip = ['idle', ...Object.keys(this.config.clips)].find(id => this.config.clips[id] && !this.unavailable.has(id));
    if (!clip) return rejected;
    this.restState = 'awake'; this.wakePending = false;
    if (this.current.clip === clip && this.current.kind === 'idle' && this.current.loop) return rejected;
    return this.commit(action(clip, true, 'idle'), 'media-fallback');
  }
  private base(): Action {
    if (this.rest === 'asleep') return action(this.pick(this.config.animations.sleep.loop, 'sleep.loop'), true, 'sleep.loop');
    const s = this.presence;
    if (s !== 'idle' && s !== 'success' && s !== 'error') return action(this.pick(this.config.animations.workStatus[s], s), true, 'work');
    const looping = this.config.animations.idle.filter(e => e.loop !== false);
    return action(this.pick(looping.length ? looping : this.config.animations.idle, 'idle.loop'), true, 'idle');
  }
  private reaction(kind: 'clicks' | 'drag' | 'turn' | 'moves'): Action {
    return action(this.pick(this.config.animations[kind], kind), kind === 'drag' || kind === 'moves', kind);
  }
  private inactiveFor(now: number): number { return now - (this.lastInteraction ?? this.startedAt); }
  private randomChain({ now, motion, chatOpen }: Context): Action | undefined {
    if (motion !== 'idle' || this.protectedDrag(now)) return;
    const { triggers, idleSeconds } = this.config;
    const inactiveFor = this.inactiveFor(now), waiting = this.presence === 'waiting';
    if (this.presence !== 'idle' && !waiting) return;
    if (this.lastInteraction !== undefined && inactiveFor < triggers.interactionCooldownMs) return;
    const { kind } = this.current;
    if (kind !== 'idle' && kind !== 'turn' && kind !== 'work') return;
    const intervalFactor = waiting ? triggers.waitingIntervalFactor :
      !chatOpen && inactiveFor >= triggers.drowsyAfterMs ? triggers.drowsyIntervalFactor : 1;
    if (now - this.lastChainAt < this.chainInterval * intervalFactor) return;

    const selected = this.drawChain();
    this.lastChainAt = now;
    const [min, max] = idleSeconds;
    this.chainInterval = 1000 * (min + this.random() * (max - min));
    return selected;
  }
  private drawChain(): Action | undefined {
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
      return once.length ? action(this.pick(once, 'idle.once'), false, 'idle.once') : undefined;
    }
    return this.reaction(kind);
  }
  private sleep(): Action {
    this.restState = 'entering';
    return action(this.pick(this.config.animations.sleep.start, 'sleep.start'), false, 'sleep.start');
  }
  private wake(): Action {
    this.restState = 'waking';
    return action(this.pick(this.config.animations.sleep.end, 'sleep.end'), false, 'sleep.end');
  }
  private finish(now: number): Action | undefined {
    if (this.current.loop) return;
    if (this.current.kind === 'sleep.start') {
      this.restState = 'asleep';
      if (this.wakePending) { this.wakePending = false; return this.wake(); }
    }
    if (this.current.kind === 'sleep.end') { this.restState = 'awake'; this.wakeEndedAt = now; }
    if (idleAfter.has(this.current.kind)) return action('idle', true, 'idle');
    return this.base();
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
