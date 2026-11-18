import type { TriggerConfig } from './tuning';

export interface InteractionConfig {
  hoverMs: number; peekCooldownMs: number; gazeSpeed: number;
  approachSpeed: number; approachWindowMs: number; startleLimit: number; startleWindowMs: number;
  landingHeight: number; landingSpeed: number; awayMs: number; dragTiltSpeed: number; dragTiltDegrees: number;
}
type Point = { x: number; y: number };
export class Gestures {
  private last?: Point;
  private sampleAt = 0;
  private approachAt = -Infinity;
  private enteredAt?: number;
  private usedVisit = false;
  private lastPeek = -Infinity;
  private startles: number[] = [];
  private lastClickAt = -Infinity;
  private clickCount = 0;
  direction = 1;

  leave(): void { this.enteredAt = undefined; this.usedVisit = false; }
  sample(point: Point, center: Point, hit: boolean, eligible: boolean, now: number, cfg: InteractionConfig): boolean {
    const previous = this.last, dt = now - this.sampleAt;
    this.last = point; this.sampleAt = now;
    let swipe = false;
    if (previous && dt > 0 && dt <= cfg.approachWindowMs) {
      const dx = point.x - previous.x, dy = point.y - previous.y;
      const distance = (p: Point) => Math.hypot(p.x - center.x, p.y - center.y);
      if (!this.usedVisit && this.enteredAt === undefined && (distance(previous) - distance(point)) * 1000 / dt >= cfg.approachSpeed)
        this.approachAt = now;
      swipe = hit && this.enteredAt !== undefined && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) * 1000 / dt >= cfg.gazeSpeed;
      if (swipe) this.direction = Math.sign(dx);
    }
    if (!hit) { this.leave(); return false; }
    if (this.enteredAt === undefined) { this.enteredAt = now; if (!swipe) this.direction = point.x < center.x ? -1 : 1; }
    if (!eligible || this.usedVisit || now - this.lastPeek < cfg.peekCooldownMs) return false;
    if (!swipe && now - this.enteredAt < cfg.hoverMs) return false;
    this.usedVisit = true; this.lastPeek = now; return true;
  }
  press(now: number, cfg: InteractionConfig): boolean {
    this.usedVisit = true;
    const fast = now - this.approachAt <= cfg.approachWindowMs;
    this.approachAt = -Infinity;
    return fast;
  }
  allowStartle(now: number, cfg: InteractionConfig): boolean {
    this.startles = this.startles.filter(at => now - at < cfg.startleWindowMs);
    if (this.startles.length >= cfg.startleLimit) return false;
    this.startles.push(now); return true;
  }
  singleClick(now: number, cfg: TriggerConfig): boolean {
    if (!cfg.clickComboEnabled) { this.resetClicks(); return false; }
    this.clickCount = now - this.lastClickAt < cfg.clickComboGapMs ? this.clickCount + 1 : 1;
    this.lastClickAt = now;
    if (this.clickCount < cfg.clickComboCount) return false;
    this.resetClicks();
    return true;
  }
  resetClicks(): void { this.lastClickAt = -Infinity; this.clickCount = 0; }
}
export class Absence {
  private reasons = new Set<string>();
  private since = 0;
  leave(reason: string, now: number): void {
    if (!this.reasons.size) this.since = now;
    this.reasons.add(reason);
  }
  back(reason: string, now: number, threshold: number): boolean {
    return this.reasons.delete(reason) && !this.reasons.size && now - this.since > threshold;
  }
}
