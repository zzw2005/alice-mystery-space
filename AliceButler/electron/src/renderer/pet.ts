import { bodyMask } from './hit-mask.js';
import { Player } from './player.js';
const videos = Array.from(document.querySelectorAll('video'));
const actor = document.querySelector<HTMLElement>('#actor')!;
const shadow = document.querySelector<HTMLElement>('#shadow')!;
const mask = document.createElement('canvas'); mask.width = 640; mask.height = 360;
const context = mask.getContext('2d', { willReadFrequently: true })!;
let lastHit = false, facing = 'right', direction = 1, squash = 1, maskDirty = true;
const labels = new Int32Array(640 * 360), floodQueue = new Int32Array(640 * 360);
let body = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function capture(): void {
  const video = player.video;
  if (!video || video.readyState < 2 || !maskDirty) return;
  context.clearRect(0, 0, 640, 360); context.drawImage(video, 0, 0, 640, 360);
  const alpha = context.getImageData(0, 0, 640, 360).data;
  body = bodyMask(alpha, 640, 360, labels, floodQueue);
  maskDirty = false;
}
const player = new Player(videos, document.querySelector<HTMLCanvasElement>('#poster')!, actor, reducedMotion,
  data => { facing = data.facing; direction = data.direction; maskDirty = true; }, () => { maskDirty = true; });
window.alice.onPlay(data => { void player.play(data); });
window.alice.onSuspend(() => { capture(); player.suspend(); });
function mirrored(): boolean { return actor.dataset.kind === 'moves' && ((facing === 'right' && direction < 0) || (facing === 'left' && direction > 0)); }
window.alice.onPose(pose => {
  direction = pose.direction; squash = reducedMotion.matches ? 1 : pose.squash;
  const sx = 1 + (1 - squash) * .55;
  const mirror = mirrored();
  const transform = `scale(${(mirror ? -1 : 1) * sx},${squash})`;
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
  actor.setPointerCapture(event.pointerId); window.alice.pointer('down');
});
actor.addEventListener('pointerup', event => { if (event.button === 0) { window.alice.pointer('up'); if (actor.hasPointerCapture(event.pointerId)) actor.releasePointerCapture(event.pointerId); } });
actor.addEventListener('pointercancel', () => window.alice.pointer('up'));
actor.addEventListener('dblclick', () => window.alice.pointer('double'));
actor.addEventListener('contextmenu', event => { event.preventDefault(); if (lastHit) window.alice.pointer('menu'); });
window.alice.ready('pet');
