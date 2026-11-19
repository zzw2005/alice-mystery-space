import type { EffectAnchor } from '../shared/effects';

// The implementation is plain JS (src/renderer/pixel/pixel-layer.js, bundling the
// vendored pixelfx core) bundled by esbuild to dist/renderer/effects-pixel.js,
// mirroring how effects-gpu is loaded.
export class PixelEffects {
  constructor(host: HTMLElement);
  play(fx: string, anchor: EffectAnchor): void;
  clear(): void;
  destroy(): void;
}
