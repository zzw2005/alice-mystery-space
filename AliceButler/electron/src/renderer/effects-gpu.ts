import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader, UniformGroup, WebGLRenderer } from 'pixi.js';
import 'pixi.js/unsafe-eval';
import type { ActionEffect, Atmosphere, EffectAnchor } from '../shared/effects';

export type Ambient = Atmosphere | 'dream';
const PARTICLE_LIMIT = 120;
const AMBIENT_LIMIT = 48;
const COMPONENTS = 8;
const AMBIENT_FRAME_MS = 1000 / 12;
const BURST_FRAME_MS = 1000 / 20;
const atmosphere = {
  off: { mode: 0, count: 0 }, snow: { mode: 1, count: AMBIENT_LIMIT },
  glow: { mode: 2, count: 32 }, dream: { mode: 3, count: 10 }
} as const;
const bursts = {
  stars: { kind: 3, count: 24, seconds: 1.05 }, petals: { kind: 4, count: 17, seconds: 1.65 },
  steam: { kind: 5, count: 26, seconds: 1.1 }, impact: { kind: 7, count: 14, seconds: .65 }
} as const;
const CENTER = .51, FOOT = .85;

function anchor(position: EffectAnchor, index: number): [number, number] {
  if (position === 'head') return [CENTER, FOOT - .65];
  if (position === 'front') return [CENTER, FOOT - .33];
  return [CENTER + (index % 2 ? .16 : -.16), FOOT - .35];
}

// A single instanced draw. Each burst uploads its initial conditions once.
// Clock, movement, wrapping, fading, rotation and silhouettes are shader inputs.
const vertex = `#version 300 es
in vec2 aPosition;
in vec4 aBurst;
in vec4 aAnchor;
uniform vec2 uViewport;
uniform float uTime;
uniform float uAmbientMode;
uniform float uAmbientCount;
out vec2 vPoint;
out vec4 vColor;
out float vKind;

float randomValue(float seed) {
  return fract(sin(seed * 127.1 + 31.7) * 43758.5453);
}

void main() {
  float id = float(gl_InstanceID);
  vec2 center;
  float size;
  float angle = 0.0;
  float opacity;
  vec3 color;
  float kind;
  if (id < ${AMBIENT_LIMIT}.0) {
    if (id >= uAmbientCount) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }
    vec2 start = vec2(randomValue(id + 4.0), randomValue(id + 17.0));
    float speed = randomValue(id + 37.0);
    if (uAmbientMode < 1.5) {
      center = fract(start + vec2(sin(uTime * 0.45 + id) * 0.017, uTime * (0.025 + speed * 0.035)));
      size = 1.1 + 2.5 * speed;
      kind = 1.0;
      color = vec3(0.87, 0.95, 1.0);
      opacity = 0.32 + 0.32 * speed;
    } else {
      bool dream = uAmbientMode > 2.5;
      center = fract(start + vec2(sin(uTime * 0.32 + id) * 0.03, -uTime * (0.012 + speed * 0.022)));
      size = 1.7 + 3.2 * speed;
      kind = 2.0;
      color = dream ? vec3(0.77, 0.68, 1.0) : mix(vec3(1.0, 0.83, 0.55), vec3(0.65, 1.0, 0.88), speed);
      opacity = (dream ? 0.24 : 0.43) * (0.65 + 0.35 * sin(id + uTime * 1.3));
    }
  } else {
    kind = aBurst.x;
    float t = (uTime - aBurst.y) / max(aBurst.z, 0.001);
    if (kind < 0.5 || t < 0.0 || t >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }
    float power = aBurst.w;
    float seed = aAnchor.z;
    float rand = randomValue(seed);
    float rand2 = randomValue(seed + 4.0);
    center = aAnchor.xy;
    opacity = (1.0 - smoothstep(0.24, 1.0, t)) * (0.55 + 0.45 * power);
    if (kind < 3.5 || kind > 6.5) {
      bool impact = kind > 6.5;
      float theta = rand * 6.283185;
      float travel = impact ? 0.13 : 0.26;
      center += vec2(cos(theta) * travel * 0.58, sin(theta) * travel - 0.075) * (0.3 + rand2) * t;
      size = (impact ? 3.6 : 3.1) + rand2 * 4.8 * power;
      angle = theta + t * 2.2;
      color = mix(vec3(1.0, 0.66, 0.19), vec3(1.0, 0.95, 0.72), rand2);
    } else if (kind < 4.5) {
      center += vec2((rand - 0.5) * 0.23 + sin(6.0 * t + seed) * 0.026, rand2 * 0.048 + t * 0.31);
      size = 3.3 + rand2 * 3.8 * power;
      angle = seed + t * 5.0;
      color = mix(vec3(0.97, 0.42, 0.65), vec3(1.0, 0.85, 0.90), rand2);
    } else if (kind < 5.5) {
      center += vec2(aAnchor.w * t * (0.034 + rand * 0.054), (rand - 0.5) * 0.11 - t * (0.12 + rand2 * 0.07));
      size = 5.0 + t * (8.0 + rand2 * 7.0);
      color = vec3(0.94, 0.91, 0.89);
      opacity *= (0.14 + rand * 0.22) * smoothstep(0.0, 0.16, t);
    } else {
      size = uViewport.y * 0.36;
      color = vec3(1.0, 0.22, 0.18);
      opacity = 0.32 * power * (1.0 - t) * (1.0 - t);
    }
  }
  float c = cos(angle), s = sin(angle);
  vec2 offset = mat2(c, s, -s, c) * aPosition * size / uViewport;
  gl_Position = vec4((center + offset) * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vPoint = aPosition;
  vColor = vec4(color, opacity);
  vKind = kind;
}`;

const fragment = `#version 300 es
in vec2 vPoint;
in vec4 vColor;
in float vKind;
out vec4 finalColor;

void main() {
  float distanceFromCenter = length(vPoint);
  float shape;
  if (vKind < 1.5) {
    shape = 1.0 - smoothstep(0.15, 0.93, distanceFromCenter);
  } else if (vKind < 2.5 || (vKind > 4.5 && vKind < 6.5)) {
    shape = pow(max(0.0, 1.0 - distanceFromCenter), 2.1);
  } else if (vKind > 3.5 && vKind < 4.5) {
    vec2 petal = vec2(vPoint.x + 0.22 * vPoint.y * vPoint.y, vPoint.y);
    shape = 1.0 - smoothstep(0.85, 1.0, length(petal * vec2(1.65, 1.0)));
  } else {
    vec2 point = abs(vPoint);
    float star = max(point.x, point.y) + 2.5 * min(point.x, point.y);
    shape = 1.0 - smoothstep(0.75, 1.04, star);
  }
  float alpha = shape * vColor.a;
  finalColor = vec4(vColor.rgb * alpha, alpha);
}`;

function resolution(): number {
  const cap = Math.min((window.devicePixelRatio || 1) * .8, 1.5);
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
  return Math.min(Math.floor(width * cap) / width, Math.floor(height * cap) / height);
}

export class GpuEffects {
  private readonly payload = new Float32Array(PARTICLE_LIMIT * COMPONENTS);
  private readonly expiry = new Float64Array(PARTICLE_LIMIT - AMBIENT_LIMIT);
  private readonly buffer = new Buffer({ data: this.payload, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  private readonly geometry = new Geometry({
    instanceCount: PARTICLE_LIMIT,
    attributes: {
      aPosition: { buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), format: 'float32x2' },
      aBurst: { buffer: this.buffer, format: 'float32x4', stride: COMPONENTS * 4, instance: true },
      aAnchor: { buffer: this.buffer, format: 'float32x4', stride: COMPONENTS * 4, offset: 16, instance: true }
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3])
  });
  private readonly uniforms = new UniformGroup({
    uViewport: { value: new Float32Array([innerWidth, innerHeight]), type: 'vec2<f32>' },
    uTime: { value: 0, type: 'f32' },
    uAmbientMode: { value: 0, type: 'f32' },
    uAmbientCount: { value: 0, type: 'f32' }
  });
  private readonly shader = new Shader({
    glProgram: GlProgram.from({ name: 'alice-effects', vertex, fragment }),
    resources: { effects: this.uniforms }
  });
  private readonly stage = new Container();
  private readonly createdAt = performance.now();
  private mode: Ambient = 'off';
  private cursor = 0;
  private nextExpiry = Infinity;
  private live = 0;
  private frame = 0;
  private lastRender = -Infinity;
  private displayedCount = -1;

  private constructor(private host: HTMLElement, private renderer: WebGLRenderer, private canvas: HTMLCanvasElement) {
    this.stage.addChild(new Mesh({ geometry: this.geometry, shader: this.shader }));
    host.append(canvas);
    host.dataset.renderer = 'webgl2';
  }

  static async open(host: HTMLElement): Promise<GpuEffects> {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: true, powerPreference: 'low-power'
    });
    if (!context) throw Error('WebGL2 unavailable');
    const renderer = new WebGLRenderer();
    try {
      await renderer.init({
        canvas, context, width: innerWidth, height: innerHeight, resolution: resolution(),
        backgroundAlpha: 0, antialias: false, clearBeforeRender: true
      });
      return new GpuEffects(host, renderer, canvas);
    } catch (error) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
      throw error;
    }
  }

  setAmbient(mode: Ambient): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const { count, mode: shaderMode } = atmosphere[mode];
    this.host.dataset.ambient = mode;
    this.uniforms.uniforms.uAmbientMode = shaderMode;
    this.uniforms.uniforms.uAmbientCount = count;
    this.schedule();
  }

  emit(effect: ActionEffect): void {
    if (effect.intensity <= 0) return;
    const { type, intensity } = effect;
    const burst = bursts[type];
    const seconds = (performance.now() - this.createdAt) / 1000;
    if (type === 'steam') {
      const [x, y] = effect.anchor === 'sides' ? [CENTER, FOOT - .35] : anchor(effect.anchor, 0);
      this.add(6, seconds, .40, intensity, x, y, 0);
    }
    const count = Math.ceil(burst.count * intensity);
    for (let i = 0; i < count; i++) {
      const [x, y] = anchor(effect.anchor, i);
      this.add(burst.kind, seconds, burst.seconds, intensity, x, y, i % 2 ? 1 : -1);
    }
    this.buffer.update();
    this.refreshCount(seconds);
    this.schedule();
  }

  private add(kind: number, now: number, life: number, power: number, x: number, y: number, side: number): void {
    const slot = this.cursor;
    this.cursor = (slot + 1) % this.expiry.length;
    this.expiry[slot] = now + life;
    this.payload.set([kind, now, life, power, x, y, Math.random() * 100, side], (AMBIENT_LIMIT + slot) * COMPONENTS);
  }

  private refreshCount(now: number): void {
    this.live = 0;
    this.nextExpiry = Infinity;
    for (const end of this.expiry) {
      if (end <= now) continue;
      this.live++;
      this.nextExpiry = Math.min(this.nextExpiry, end);
    }
  }

  private schedule(): void {
    const count = atmosphere[this.mode].count + this.live;
    if (count !== this.displayedCount) {
      this.displayedCount = count;
      this.host.dataset.particles = String(count);
      this.host.hidden = count === 0;
    }
    if (count > 0 && !this.frame) this.frame = requestAnimationFrame(this.tick);
    if (!count && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  private tick = (timestamp: number): void => {
    this.frame = 0;
    const seconds = (timestamp - this.createdAt) / 1000;
    if (this.nextExpiry <= seconds) this.refreshCount(seconds);
    const interval = this.live ? BURST_FRAME_MS : AMBIENT_FRAME_MS;
    if (atmosphere[this.mode].count + this.live > 0 && timestamp - this.lastRender >= interval - 1) {
      const { uViewport } = this.uniforms.uniforms;
      const scale = resolution();
      if (uViewport[0] !== innerWidth || uViewport[1] !== innerHeight || scale !== this.renderer.resolution) {
        uViewport[0] = innerWidth; uViewport[1] = innerHeight;
        this.renderer.resize(innerWidth, innerHeight, scale);
      }
      this.uniforms.uniforms.uTime = seconds;
      this.renderer.render(this.stage);
      this.lastRender = timestamp;
    }
    this.schedule();
  };

  clear(): void {
    this.expiry.fill(0);
    this.payload.fill(0);
    this.buffer.update();
    this.refreshCount(0);
    this.setAmbient('off');
    this.schedule();
  }

  destroy(): void {
    this.clear();
    this.stage.destroy({ children: true });
    this.geometry.destroy(true);
    this.shader.destroy();
    this.renderer.destroy();
    this.canvas.remove();
    delete this.host.dataset.renderer;
  }
}
