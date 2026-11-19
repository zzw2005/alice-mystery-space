import type { ActionEffect, EffectsState } from '../shared/effects';
import type { Ambient, GpuEffects } from './effects-gpu.js';

export class EffectsLayer {
  private state?: EffectsState;
  private gpu?: GpuEffects;
  private opening = false;
  private failed = false;
  private clip = '';
  private token?: number;
  private suspended = false;
  private pending?: ActionEffect;

  constructor(private host: HTMLElement) {}

  configure(state: EffectsState): void {
    this.state = state;
    if (!state.enabled) {
      this.failed = false;
      this.gpu?.destroy();
      this.gpu = undefined;
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
      this.gpu?.clear();
      return;
    }
    const ambient: Ambient = this.clip === 'doze' ? 'dream' : this.state!.config.atmosphere;
    if (this.gpu) {
      this.gpu.setAmbient(ambient);
      if (this.pending) this.gpu.emit(this.pending);
      this.pending = undefined;
    } else if ((ambient !== 'off' || (this.pending && this.pending.intensity > 0)) && !this.opening && !this.failed) {
      void this.open();
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
}
