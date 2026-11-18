import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Physics, Director } from './engine';

type Trigger = { ts: string; source: string; clip: string; state: {
  kind: string; rest: Director['rest']; presence: Director['presence']; motion: Physics['mode']; chatOpen: boolean;
} };
type Day = { workingSetPeakMiB: number; privatePeakMiB: number | null; plays: Record<string, number>;
  crashes: number; recoveries: number; chatRoundTripMs: number[]; triggers?: Trigger[] };
export class RunStats {
  days: Record<string, Day> = {};
  recoveryPending = false;
  constructor(file: string) {
    let previous;
    try { previous = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    this.days = previous.days ?? {};
    if (!previous.sessionOpen) return;
    this.today().crashes++;
    try {
      const receipt = JSON.parse(readFileSync(path.join(path.dirname(file), 'pet-restart-request.json'), 'utf8'));
      this.recoveryPending = typeof previous.sessionId === 'string' && receipt.previousSession === previous.sessionId &&
        receipt.ts <= Date.now() && Date.now() <= receipt.expiresAt;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  today(now = new Date()): Day {
    const cutoff = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    for (const key of Object.keys(this.days)) if (key < cutoff) delete this.days[key];
    return this.days[now.toISOString().slice(0, 10)] ??= {
      workingSetPeakMiB: 0, privatePeakMiB: null, plays: {}, crashes: 0, recoveries: 0, chatRoundTripMs: [] };
  }
  recordMemory(workingSet: number, privateMiB: number | null): void {
    const day = this.today();
    day.workingSetPeakMiB = Math.max(day.workingSetPeakMiB, workingSet);
    if (privateMiB !== null) day.privatePeakMiB = Math.max(day.privatePeakMiB ?? 0, privateMiB);
  }
  recordTrigger(source: string, clip: string, state: Trigger['state'], now = new Date()): void {
    const day = this.today(now);
    (day.triggers ??= []).push({ ts: now.toISOString(), source, clip, state });
  }
}
