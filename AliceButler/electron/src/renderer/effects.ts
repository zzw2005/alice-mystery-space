import type { ActionEffect, EffectsState } from '../shared/effects';
import type { Ambient, GpuEffects } from './effects-gpu.js';
import type { PixelEffects } from './effects-pixel.js';

export class EffectsLayer {
  private state?: EffectsState;
  private gpu?: GpuEffects;
  private opening = false;
  private failed = false;
  private pixel?: PixelEffects;
  private pixelOpening = false;
  private pixelFailed = false;
  private clip = '';
  private token?: number;
  private suspended = false;
  private pending?: ActionEffect;
  private pendingPixel?: ActionEffect;

  constructor(private host: HTMLElement, private pixelHost: HTMLElement) {}

  configure(state: EffectsState): void {
    this.state = state;
    if (!state.enabled) {
      this.failed = false;
      this.gpu?.destroy();
      this.gpu = undefined;
      this.pixelFailed = false;
      this.pixel?.destroy();
      this.pixel = undefined;
    }
    this.update();
  }

  present(clip: string, token: number): void {
    this.clip = clip;
    this.suspended = false;
    if (token !== this.token) {
      this.token = token;
      const actions = this.state?.config.actions;
      this.pending = actions && Object.hasOwn(actions, clip) ? actions[clip] : undefined;
    }
    this.update();
  }

  suspend(): void {
    this.suspended = true;
    this.update();
  }

  private get active(): boolean {
    return Boolean(this.state?.enabled && this.state.visible && !this.suspended);
  }

  private update(): void {
    if (!this.active) {
      this.pending = undefined;
      this.pendingPixel = undefined;
      this.gpu?.clear();
      this.pixel?.clear();
      return;
    }
    if (this.pending?.type === 'pixelfx') {
      this.pendingPixel = this.pending;
      this.pending = undefined;
    }
    const mode = this.state!.config.atmosphere;
    const ambient: Ambient = mode !== 'off' && this.clip === 'doze' ? 'dream' : mode;
    if (this.gpu) {
      this.gpu.setAmbient(ambient);
      if (this.pending) this.gpu.emit(this.pending);
      this.pending = undefined;
    } else if ((ambient !== 'off' || (this.pending && this.pending.intensity > 0)) && !this.opening && !this.failed) {
      void this.open();
    }
    if (this.pixel) {
      if (this.pendingPixel) this.pixel.play(this.pendingPixel.fx ?? '', this.pendingPixel.anchor);
      this.pendingPixel = undefined;
    } else if (this.pendingPixel && !this.pixelOpening && !this.pixelFailed) {
      void this.openPixel();
    }
  }

  private async open(): Promise<void> {
    this.opening = true;
    try {
      const { GpuEffects } = await import('./effects-gpu.js');
      if (!this.active) return;
      const gpu = await GpuEffects.open(this.host);
      if (!this.state?.enabled) gpu.destroy();
      else this.gpu = gpu;
    } catch (error) {
      // The video continues with no effects on systems without WebGL2.
      this.failed = this.state?.enabled === true;
      console.warn('Effects unavailable', error);
    } finally {
      this.opening = false;
      this.update();
    }
  }

  private async openPixel(): Promise<void> {
    this.pixelOpening = true;
    try {
      const { PixelEffects } = await import('./effects-pixel.js');
      if (!this.active) return;
      const pixel = new PixelEffects(this.pixelHost);
      if (!this.state?.enabled) pixel.destroy();
      else this.pixel = pixel;
    } catch (error) {
      this.pixelFailed = this.state?.enabled === true;
      console.warn('Pixel effects unavailable', error);
    } finally {
      this.pixelOpening = false;
      this.update();
    }
  }
}
