import { defaultTuning } from './tuning';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';

type Rect = { x: number; y: number; width: number; height: number };
type Monitor = { id: number; workArea: Rect };
export type Position = { display: number; x: number; y: number };
export type Saved = { desktop: Position; standing: boolean; position: Position };
export function atomicWrite(file: string, text: string): void {
  const temp = file + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temp, text); renameSync(temp, file); }
  finally { rmSync(temp, { force: true }); }
}
export function loadPosition(file: string): Saved | undefined {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof state?.standing !== 'boolean' || ![state.desktop, state.position].every(p =>
      p && Number.isInteger(p.display) && Number.isFinite(p.x) && Number.isFinite(p.y))) throw Error('Invalid saved pet position');
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(e);
    return undefined;
  }
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function limits(display: Monitor, standing: boolean) {
  const a = display.workArea;
  // The visible body occupies 30–70% horizontally and its feet sit at 85%.
  const floor = a.y + a.height - 255 - (standing ? 0 : 2);
  return { left: a.x - 533 * .3, right: a.x + a.width - 533 * .7, floor, top: a.y };
}
export function restore(pos: Position | undefined, displays: Monitor[], primary: Monitor, standing: boolean, tuning = defaultTuning): Position {
  const found = displays.find(d => d.id === pos?.display);
  const d = found ?? primary, a = limits(d, standing);
  return { display: d.id, x: found && pos ? clamp(pos.x, a.left, a.right) : a.right - tuning.homeInsetPx,
    y: found && pos && !standing ? clamp(pos.y, a.top, a.floor) : a.floor };
}
export function snap(x: number, y: number, a: ReturnType<typeof limits>, tuning = defaultTuning) {
  const threshold = tuning.snapDistancePx, gap = tuning.snapGapPx;
  const nx = x <= a.left + threshold ? a.left + gap : x >= a.right - threshold ? a.right - gap : x;
  const ny = y <= a.top + threshold ? a.top + gap : y >= a.floor - threshold ? a.floor - gap : y;
  return nx !== x || ny !== y ? { x: nx, y: ny } : undefined;
}
