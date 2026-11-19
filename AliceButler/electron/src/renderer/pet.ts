import { probeClips } from "./decode-probe.js";
import { bodyMask } from './hit-mask.js';
import { Player } from './player.js';
import { EffectsLayer } from './effects.js';
const videos = Array.from(document.querySelectorAll('video'));
const actor = document.querySelector<HTMLElement>('#actor')!;
const shadow = document.querySelector<HTMLElement>('#shadow')!;
const effects = new EffectsLayer(document.querySelector<HTMLElement>('#effects')!);
const mask = document.createElement('canvas'); mask.width = 640; mask.height = 360;
const context = mask.getContext('2d', { willReadFrequently: true })!;
let lastHit = false, facing = 'right', direction = 1, squash = 1, maskDirty = true;
const labels = new Int32Array(640 * 360), floodQueue = new Int32Array(640 * 360);
let body = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let pressStart: PointerEvent | undefined, rebound: Animation | undefined;
function capture(): void {
  const video = player.video;
  if (!video || video.readyState < 2 || !maskDirty) return;
  context.clearRect(0, 0, 640, 360); context.drawImage(video, 0, 0, 640, 360);
  const alpha = context.getImageData(0, 0, 640, 360).data;
  body = bodyMask(alpha, 640, 360, labels, floodQueue, display.hitAlpha);
  maskDirty = false;
}
const player = new Player(videos, document.querySelector<HTMLCanvasElement>('#poster')!, actor, reducedMotion,
  data => {
    facing = data.facing; direction = data.direction; maskDirty = true;
    effects.present(data.clip, data.token);
  }, () => { maskDirty = true; });
let display: DisplayTuning;
let clickMedia = new Map<string, string>();
window.alice.onClickMedia(files => {
  const next = new Map(files.map(([url, bytes]) => [url, URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))]));
  for (const url of clickMedia.values()) URL.revokeObjectURL(url);
  clickMedia = next;
});
window.alice.onPlay(data => {
  display = data.tuning;
  const preloaded = data.kind === 'clicks' && clickMedia.get(data.url);
  void player.play(preloaded ? { ...data, url: preloaded } : data);
});
window.alice.onEffectsState(state => effects.configure(state));
const clickSound = new Audio('../media/click-duck.wav');
window.alice.onClickSound(() => {
  clickSound.currentTime = 0;
  void clickSound.play().catch(() => {});
});
window.alice.onSuspend(() => { capture(); player.suspend(); effects.suspend(); });
function mirrored(): boolean { return ['moves', 'peek'].includes(actor.dataset.kind ?? '') && ((facing === 'right' && direction < 0) || (facing === 'left' && direction > 0)); }
window.alice.onPose(pose => {
  direction = pose.direction; squash = reducedMotion.matches ? 1 : pose.squash;
  const sx = 1 + (1 - squash) * .55;
  const mirror = mirrored();
  const rotation = pose.tilt && !reducedMotion.matches ? `rotate(${pose.tilt}deg) ` : '';
  const transform = `${rotation}scale(${(mirror ? -1 : 1) * sx},${squash})`;
  if (actor.style.transform !== transform) actor.style.transform = transform;
  const shadowTransform = `translateX(-50%) scale(${Math.max(.45, 1 - pose.heightAbove / 500)})`;
  if (shadow.style.transform !== shadowTransform) shadow.style.transform = shadowTransform;
  const px = (pose.x / innerWidth - .5) / sx + .5;
  const py = (pose.y / innerHeight - .85) / squash + .85;
  const x = Math.floor((mirror ? 1 - px : px) * 640), y = Math.floor(py * 360);
  if (pose.dragging) return;
  const inside = x >= 0 && y >= 0 && x < 640 && y < 360;
  if (inside) capture();
  const hit = inside && !!body && labels[y * 640 + x] === body;
  if (lastHit !== hit) { lastHit = hit; window.alice.hit(hit); }
});
actor.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !lastHit) return;
  pressStart = event;
  rebound?.cancel();
  if (!reducedMotion.matches)
    rebound = actor.animate([{ scale: '1.06 .82' }, { scale: '1' }],
      { duration: 200, easing: 'cubic-bezier(.175, .885, .32, 1.275)' });
  actor.setPointerCapture(event.pointerId);
  window.alice.pointer('down');
});
actor.addEventListener('pointermove', event => {
  if (pressStart?.pointerId === event.pointerId &&
      Math.abs(event.screenX - pressStart.screenX) + Math.abs(event.screenY - pressStart.screenY) > display.dragDistancePx) {
    rebound?.cancel();
    pressStart = undefined;
  }
});
actor.addEventListener('pointerup', event => {
  if (event.button !== 0) return;
  pressStart = undefined;
  window.alice.pointer('up');
  if (actor.hasPointerCapture(event.pointerId)) actor.releasePointerCapture(event.pointerId);
});
actor.addEventListener('lostpointercapture', () => {
  if (pressStart) rebound?.cancel();
  pressStart = undefined;
});
actor.addEventListener('pointercancel', () => {
  pressStart = undefined;
  rebound?.cancel();
  window.alice.pointer('cancel');
});
actor.addEventListener('dblclick', () => window.alice.pointer('double'));
actor.addEventListener('contextmenu', event => { event.preventDefault(); if (lastHit) window.alice.pointer('menu'); });
const bubble = document.querySelector<HTMLElement>('#bubble')!;
const queue: string[] = [];
function nextBubble(): void {
  const text = queue.shift();
  bubble.hidden = text === undefined;
  if (text !== undefined) { bubble.textContent = text; setTimeout(nextBubble, display.bubbleMs); }
}
window.alice.onBubble(text => { queue.push(text); if (bubble.hidden) nextBubble(); });
window.alice.ready('pet');
window.alice.onReclaim(async () => { player.coverReclaim(); await player.reclaim(); window.alice.reclaimed(); });
window.alice.onProbe(async ({ day, clips, timeoutMs }) => {
  window.alice.probed(day, await probeClips(clips, timeoutMs));
});
window.alice.onReclaimDone(() => player.finishReclaim());
