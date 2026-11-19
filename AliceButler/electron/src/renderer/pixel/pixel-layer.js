// Live pixelfx layer: plays code-generated pixel effects (MIT, patch-gg/pixelfx,
// vendored under ./core and ./fx) on a plain 2D canvas over the pet.
// One instance per trigger; the rAF loop runs only while an effect is live.
import { createFrame, clearFrame, createFx, composite } from "./core/index.js";
import * as collectBurst from "./fx/pickups/collect-burst.js";
import * as confetti from "./fx/ui/confetti.js";

const EFFECTS = {
  "collect-burst": { mod: collectBurst, scale: 1.6 },
  "confetti": { mod: confetti, scale: 1.9 },
};
// Anchor points as fractions of the window (x from left, y from top),
// matching the GPU layer's head/front/sides semantics.
const ANCHORS = { head: [0.51, 0.2], front: [0.51, 0.52], sides: [0.51, 0.5] };

export class PixelEffects {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    host.append(this.canvas);
    this.live = [];
    this.frame = 0;
    this.last = 0;
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(innerWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(innerHeight * this.dpr));
  }

  play(id, anchor) {
    const def = EFFECTS[id];
    if (!def) return;
    const { mod } = def, [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin;
    const [fx, fy] = ANCHORS[anchor] ?? ANCHORS.front;
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    this.live.push({
      inst: createFx(mod, { x: ox, y: oy, seed: (Math.random() * 1e9) | 0 }),
      frame: createFrame(w, h, 0, 0),
      rgba: new Uint8ClampedArray(w * h * 4),
      off, offCtx: off.getContext("2d"),
      w, h, ox, oy, scale: def.scale,
      ax: fx * innerWidth, ay: fy * innerHeight,
    });
    this.host.hidden = false;
    this.schedule();
  }

  clear() {
    this.live = [];
    this.ctx.setTransform(1, 0, 0, 1);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.host.hidden = true;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  destroy() {
    this.clear();
    window.removeEventListener("resize", this.onResize);
    this.canvas.remove();
  }

  schedule() {
    if (this.live.length && !this.frame) { this.last = 0; this.frame = requestAnimationFrame(this.tick); }
  }

  tick = (ts) => {
    this.frame = 0;
    const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 1 / 30;
    this.last = ts;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.imageSmoothingEnabled = false;
    this.live = this.live.filter((it) => !it.inst.done());
    for (const it of this.live) {
      it.inst.update(dt);
      clearFrame(it.frame);
      it.inst.draw(it.frame);
      composite(it.frame, it.rgba, null);
      it.offCtx.putImageData(new ImageData(it.rgba, it.w, it.h), 0, 0);
      ctx.drawImage(it.off, it.ax - it.ox * it.scale, it.ay - it.oy * it.scale, it.w * it.scale, it.h * it.scale);
    }
    if (!this.live.length) { ctx.clearRect(0, 0, innerWidth, innerHeight); this.host.hidden = true; return; }
    this.schedule();
  };
}
