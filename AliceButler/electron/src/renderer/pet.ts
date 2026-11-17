import { bodyMask } from './hit-mask.js';
const videos = Array.from(document.querySelectorAll('video'));
const actor = document.querySelector<HTMLElement>('#actor')!;
const shadow = document.querySelector<HTMLElement>('#shadow')!;
const mask = document.createElement('canvas'); mask.width = 640; mask.height = 360;
const context = mask.getContext('2d', { willReadFrequently: true })!;
let active = 0, token = 0, first = true, lastHit = false, facing = 'right', direction = 1, squash = 1;
let alpha: Uint8ClampedArray | null = null;
const labels = new Int32Array(640 * 360), floodQueue = new Int32Array(640 * 360);
let body = 0;
let frameCount = 0, callbackId = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function capture(video: HTMLVideoElement): void {
  if (video !== videos[active] || video.readyState < 2) return;
  context.clearRect(0, 0, 640, 360); context.drawImage(video, 0, 0, 640, 360);
  alpha = context.getImageData(0, 0, 640, 360).data;
  body = bodyMask(alpha, 640, 360, labels, floodQueue);
}
function followFrames(video: HTMLVideoElement): void {
  callbackId = video.requestVideoFrameCallback(() => {
    if (video !== videos[active]) return;
    capture(video); frameCount++; followFrames(video);
  });
}
window.alice.onPlay(async data => {
  const requested = data.token; token = requested;
  const previous = videos[active];
  const incoming = videos[1 - active];
  incoming.pause(); incoming.onended = null; incoming.onloadeddata = null; incoming.onerror = null;
  incoming.loop = data.loop; incoming.src = data.url;
  incoming.onerror = () => window.alice.videoError(data.clip + ': ' + incoming.error?.message);
  incoming.onloadeddata = async () => {
    if (requested !== token) return;
    try {
      await incoming.play();
      if (requested !== token) { incoming.pause(); return; }
      previous.cancelVideoFrameCallback(callbackId);
      active = 1 - active; facing = data.facing; direction = data.direction;
      actor.dataset.clip = data.clip; actor.dataset.kind = data.kind;
      actor.dataset.token = String(requested);
      incoming.style.transition = first || reducedMotion.matches ? 'none' : 'opacity 180ms ease-out';
      incoming.style.zIndex = '2'; previous.style.zIndex = '1'; incoming.style.opacity = '1';
      incoming.onended = () => { capture(incoming); window.alice.ended(requested); };
      capture(incoming); followFrames(incoming); first = false;
      window.alice.videoReady(requested);
      setTimeout(() => { if (requested === token) { previous.style.opacity = '0'; previous.pause(); } }, 190);
    } catch (e) { window.alice.videoError(String(e)); }
  };
  incoming.load();
});
function mirrored(): boolean { return actor.dataset.kind === 'moves' && ((facing === 'right' && direction < 0) || (facing === 'left' && direction > 0)); }
window.alice.onPose(pose => {
  direction = pose.direction; squash = reducedMotion.matches ? 1 : pose.squash;
  const sx = 1 + (1 - squash) * .55;
  const mirror = mirrored();
  actor.style.transform = `scale(${(mirror ? -1 : 1) * sx},${squash})`;
  shadow.style.transform = `translateX(-50%) scale(${Math.max(.45, 1 - pose.heightAbove / 500)})`;
  const px = (pose.x / innerWidth - .5) / sx + .5;
  const py = (pose.y / innerHeight - .85) / squash + .85;
  const x = Math.floor((mirror ? 1 - px : px) * 640), y = Math.floor(py * 360);
  const hit = !!body && x >= 0 && y >= 0 && x < 640 && y < 360 && labels[y * 640 + x] === body;
  lastHit = hit; window.alice.hit(hit);
});
actor.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !lastHit) return;
  actor.setPointerCapture(event.pointerId); window.alice.pointer('down');
});
actor.addEventListener('pointerup', event => { if (event.button === 0) { window.alice.pointer('up'); if (actor.hasPointerCapture(event.pointerId)) actor.releasePointerCapture(event.pointerId); } });
actor.addEventListener('pointercancel', () => window.alice.pointer('up'));
actor.addEventListener('dblclick', () => window.alice.pointer('double'));
actor.addEventListener('contextmenu', event => { event.preventDefault(); if (lastHit) window.alice.pointer('menu'); });
setInterval(() => { if (frameCount) { window.alice.frames(frameCount); frameCount = 0; } }, 1000);
window.alice.ready('pet');
