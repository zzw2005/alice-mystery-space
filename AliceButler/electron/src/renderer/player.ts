type Skin = 'uniform' | 'wafuku';
type Blink = { url: string; closedAtSec: number };
export type PlayRequest = {
  tuning: DisplayTuning; clip: string; kind: string; loop: boolean; rate: number; token: number;
  url: string; facing: string; direction: number; skin: Skin; endsClosed?: boolean;
  blink?: { uniform: Blink; wafuku?: Blink }; interactive?: boolean;
};
const REASON_SUPERSEDED = 'superseded';
const BLINK_QUICK_RATE = 3;
type Swap = { gen: number; controller: AbortController; token?: number };
type SwapOptions = { reclaim?: boolean; transition?: boolean; cut?: boolean; offset?: number };

// Two bounded slots: the displayed clip and one incoming clip. A frozen canvas
// covers native loop seeks and suspension. A transition commits only on a decoded frame.
export class Player {
  private active = -1;
  private outgoing?: HTMLVideoElement;
  private request?: PlayRequest;
  private swapGen = 0;
  private pending?: Swap;
  private activeOnce?: number;
  private frameId = 0;
  private fadeTimer = 0;
  private suspended = false;
  private frames = 0;
  private reportTimer = 0;
  private reportMs = 0;
  private fading = false;
  private buffering = false;
  private hasPoster = false;
  private copying = false;
  private posterVersion = 0;
  private pixels = new Uint8ClampedArray(640 * 360 * 4);
  private image = new ImageData(this.pixels, 640, 360);
  private posterContext: CanvasRenderingContext2D;
  constructor(private videos: HTMLVideoElement[], private poster: HTMLCanvasElement,
    private actor: HTMLElement, private reducedMotion: MediaQueryList,
    private shown: (data: PlayRequest) => void, private frame: () => void) {
    // One reusable CPU image avoids a canvas cache of converted VideoFrames.
    this.posterContext = poster.getContext('2d', { willReadFrequently: true })!;
  }
  get video(): HTMLVideoElement | undefined { return this.videos[this.active]; }
  private release(video: HTMLVideoElement): void {
    video.pause(); video.onended = null; video.onerror = null; video.onwaiting = null; video.onseeking = null;
    video.style.transition = 'none'; video.style.opacity = '0';
    video.removeAttribute('src'); video.load();
  }
  private snapshot(video: HTMLVideoElement | undefined): void {
    this.posterVersion++;
    if (video && video.readyState >= 2) {
      this.posterContext.clearRect(0, 0, 640, 360);
      this.posterContext.drawImage(video, 0, 0, 640, 360);
      this.hasPoster = true;
    }
  }
  private refresh(video: HTMLVideoElement): void {
    if (this.copying || this.fading || video.readyState < 2 || video.seeking) return;
    const frame = new VideoFrame(video), version = this.posterVersion;
    this.copying = true;
    frame.copyTo(this.pixels, { format: 'RGBA' }).then(() => {
      if (version !== this.posterVersion || video !== this.video || this.suspended || this.fading) return;
      this.posterContext.putImageData(this.image, 0, 0); this.hasPoster = true;
    }).catch(() => window.alice.videoError('poster')).finally(() => {
      frame.close(); this.copying = false;
    });
  }
  private finishFade(): void {
    clearTimeout(this.fadeTimer);
    if (this.outgoing) {
      this.release(this.outgoing); this.outgoing = undefined;
      if (this.video) { this.video.style.transition = 'none'; this.video.style.opacity = '1'; }
    }
    this.fading = false;
  }
  private freeze(): void {
    this.finishFade();
    if (!this.buffering) this.snapshot(this.video);
    if (this.hasPoster) { this.poster.style.zIndex = '1'; this.poster.style.opacity = '1'; }
  }
  private hold(video: HTMLVideoElement): void {
    if (video !== this.video || this.suspended || !this.hasPoster) return;
    this.finishFade(); this.buffering = true;
    // Keep the video composited so Chromium continues frame callbacks. Hiding it
    // here can stall presentation callbacks during the seek we are waiting for.
    this.poster.style.zIndex = '3'; this.poster.style.opacity = '1';
    video.style.transition = 'none'; video.style.opacity = '1';
  }
  private follow(video: HTMLVideoElement): void {
    this.frameId = video.requestVideoFrameCallback((_now, frame) => {
      if (video !== this.video || this.suspended) return;
      // Reuse one CPU buffer, closing every temporary VideoFrame explicitly.
      if (video.readyState < 2 || video.seeking) this.hold(video);
      else {
        this.refresh(video);
        // During a native loop seek Chromium can lose HAVE_CURRENT_DATA before
        // dispatching waiting/seeking. Keep the refreshed poster visible across that seek.
        if (video.loop && this.request && (video.duration - frame.mediaTime) * 1000 <= this.request.tuning.loopCoverMs)
          this.hold(video);
        else if (this.buffering) {
          this.buffering = false; video.style.transition = 'none'; video.style.opacity = '1';
          this.poster.style.opacity = '0'; this.poster.style.zIndex = '1';
        }
      }
      this.frames++; this.frame(); this.follow(video);
    });
  }
  suspend(): void {
    if (this.suspended) return;
    this.swapGen++;
    this.pending?.controller.abort(); this.pending = undefined; this.activeOnce = undefined;
    this.freeze(); this.video?.cancelVideoFrameCallback(this.frameId);
    this.suspended = true;
    this.videos.forEach(video => this.release(video)); this.active = -1;
    this.actor.dataset.suspended = 'true';
    window.alice.suspended();
  }
  coverReclaim(): void {
    if (!this.video || this.suspended) return;
    if (!this.buffering) this.snapshot(this.video);
    if (this.hasPoster) this.actor.dataset.reclaim = 'true';
  }
  finishReclaim(): void {
    delete this.actor.dataset.reclaim;
  }
  async reclaim(): Promise<void> {
    // Swap at the current timeline position. An ordinary action takes priority.
    if (!this.request || !this.video || this.pending || this.suspended || this.video.ended) return;
    if ((this.video.duration - this.video.currentTime) * 1000 < this.request.tuning.fadeMs) return;
    await this.play(this.request, true);
  }
  async play(data: PlayRequest, reclaim = false): Promise<void> {
    if (this.reportMs !== data.tuning.frameReportMs) {
      this.reportMs = data.tuning.frameReportMs;
      clearInterval(this.reportTimer);
      this.reportTimer = window.setInterval(() => {
        if (this.frames) { window.alice.frames(this.frames); this.frames = 0; }
      }, this.reportMs);
    }
    const prev = this.pending;
    prev?.controller.abort();
    if (!reclaim) {
      for (const token of new Set([prev?.token, this.activeOnce])) {
        if (token !== undefined && token !== data.token) window.alice.playbackResult(token, 'cancelled', REASON_SUPERSEDED);
      }
      this.activeOnce = undefined;
    }
    const swap = { gen: ++this.swapGen, controller: new AbortController(), token: !reclaim && !data.loop ? data.token : undefined };
    this.pending = swap;
    if (!reclaim && !this.suspended && this.video?.src === data.url && this.request?.loop && data.loop) {
      this.video.playbackRate = data.rate;
      this.request = data; this.pending = undefined; this.present(data, false); return;
    }

    try {
      const from = this.request?.skin;
      if (!reclaim && !this.suspended && this.video && from && from !== data.skin)
        await this.changeSkin(from, data, swap);
      if (!this.isCurrent(swap)) return;
      const shown = await this.swap(data, swap, { reclaim, cut: this.request?.skin !== data.skin });
      if (!shown && this.isCurrent(swap)) window.alice.videoError('first-frame', reclaim ? undefined : data.token);
    } finally {
      if (this.pending === swap) this.pending = undefined;
    }
  }
  private async changeSkin(from: Skin, data: PlayRequest, swap: Swap): Promise<void> {
    const closing = data.blink?.[from], opening = data.blink?.[data.skin];
    const blink = { ...data, loop: false, endsClosed: false };
    const alreadyClosed = this.video?.ended && this.request?.endsClosed;
    if (closing && !alreadyClosed) {
      const shown = await this.swap({
        ...blink, url: closing.url, skin: from, rate: data.interactive ? BLINK_QUICK_RATE : 1
      }, swap, { transition: true });
      const closed = shown && await this.waitForBlink(swap, closing.closedAtSec);
      if (!closed && this.isCurrent(swap)) window.alice.videoError('skin-transition');
    }
    if (!opening || !this.isCurrent(swap)) return;
    // Both 10s assets have a closed frame at 2.5s. Play the remaining 7.5s
    // in 2.5s to keep a full close/reopen sequence around five seconds.
    const shown = await this.swap({ ...blink, url: opening.url, rate: BLINK_QUICK_RATE }, swap, {
      transition: true, cut: true, offset: opening.closedAtSec
    });
    if (!this.isCurrent(swap)) return;
    if (shown && data.interactive) {
      this.video?.pause();
      return;
    }
    if (!(shown && await this.waitForBlink(swap)) && this.isCurrent(swap))
      window.alice.videoError('skin-transition');
  }
  private isCurrent(swap: Swap): boolean {
    return swap.gen === this.swapGen && !swap.controller.signal.aborted;
  }
  private waitForBlink(swap: Swap, closeAt?: number): Promise<boolean> {
    const video = this.video, request = this.request;
    if (!video || !request || !this.isCurrent(swap)) return Promise.resolve(false);
    const { signal } = swap.controller;
    return new Promise(resolve => {
      let frameId = 0;
      const finish = (completed: boolean) => {
        clearTimeout(timeout); video.cancelVideoFrameCallback(frameId);
        video.removeEventListener('ended', ended); video.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed); resolve(completed);
      };
      const ended = () => finish(closeAt === undefined);
      const failed = () => finish(false);
      const timeout = window.setTimeout(failed, request.tuning.firstFrameMs);
      video.addEventListener('ended', ended); video.addEventListener('error', failed);
      signal.addEventListener('abort', failed, { once: true });
      if (closeAt !== undefined) {
        const watch: VideoFrameRequestCallback = (_now, frame) => {
          if (frame.mediaTime < closeAt) { frameId = video.requestVideoFrameCallback(watch); return; }
          video.pause(); finish(true);
        };
        frameId = video.requestVideoFrameCallback(watch);
      }
    });
  }
  private async swap(data: PlayRequest, swap: Swap, options: SwapOptions): Promise<boolean> {
    const { signal } = swap.controller;
    const incoming = this.videos[this.active === 0 ? 1 : 0];
    this.finishFade();
    this.release(incoming);
    const loading = new AbortController();
    let timeout = 0, firstFrameId = 0;
    let rejectFrame: (error: Error) => void;
    const cancel = () => {
      this.release(incoming);
      rejectFrame(new DOMException(REASON_SUPERSEDED, 'AbortError'));
    };
    try {
      const firstFrame = new Promise<void>((resolve, reject) => {
        rejectFrame = reject;
        timeout = window.setTimeout(() => reject(Error('first frame timeout')), data.tuning.firstFrameMs);
        signal.addEventListener('abort', cancel, { once: true });
        const listener = { once: true, signal: loading.signal };
        incoming.addEventListener('error', () => reject(Error(incoming.error?.message || 'media decode failed')), listener);
        incoming.addEventListener('loadeddata', () => {
          // loadeddata and play() alone do not guarantee a presented frame.
          const offset = options.reclaim ? this.video?.currentTime : options.offset;
          if (offset !== undefined) incoming.currentTime = offset;
          const waitPresented = () => {
            firstFrameId = incoming.requestVideoFrameCallback((_now, frame) => {
              if (incoming.seeking || (options.offset !== undefined && frame.mediaTime + .005 < options.offset)) waitPresented();
              else resolve();
            });
          };
          waitPresented();
          incoming.play().catch(reject);
        }, listener);
        incoming.loop = data.loop; incoming.src = data.url; incoming.load();
        incoming.playbackRate = data.rate;
      });
      await firstFrame;
      if (!this.isCurrent(swap)) return false;
      signal.removeEventListener('abort', cancel);
      const previous = this.video;
      const previousReady = previous && previous.readyState >= 2 && !this.buffering;
      this.freeze(); previous?.cancelVideoFrameCallback(this.frameId);
      this.active = this.videos.indexOf(incoming); this.request = data; this.suspended = false;
      this.buffering = false;
      const fade = !options.reclaim && !options.cut && !this.reducedMotion.matches && previousReady && data.tuning.fadeMs;
      if (previous && fade) {
        this.outgoing = previous;
        previous.onended = previous.onwaiting = previous.onseeking = previous.onerror = null;
        previous.pause();
        previous.style.transition = `opacity ${fade}ms linear`; previous.style.opacity = '0';
      } else if (previous) this.release(previous);
      this.poster.style.opacity = '0';
      incoming.style.transition = fade ? `opacity ${fade}ms linear` : 'none';
      incoming.style.opacity = '1';
      if (!options.transition) incoming.onended = () => {
        if (this.activeOnce === data.token) {
          this.activeOnce = undefined; this.frame(); window.alice.ended(data.token);
        }
      };
      incoming.onwaiting = incoming.onseeking = () => this.hold(incoming);
      incoming.onerror = () => {
        this.hold(incoming);
        if (!options.transition && incoming === this.video && this.request) {
          this.activeOnce = undefined;
          window.alice.videoError('decode', this.request.token);
        }
      };
      this.actor.dataset.suspended = 'false';
      this.fading = !!fade;
      if (!this.hasPoster || this.actor.dataset.reclaim) this.snapshot(incoming);
      this.frames++; this.frame(); this.follow(incoming);
      if (!options.reclaim && !options.transition) this.present(data, true);
      this.fadeTimer = window.setTimeout(() => {
        this.finishFade(); if (!this.buffering) this.snapshot(incoming);
        if (!this.buffering) this.poster.style.opacity = '0';
      }, fade ? fade + 10 : 0);
      return true;
    } catch {
      if (this.isCurrent(swap)) this.release(incoming);
      return false;
    } finally {
      loading.abort(); signal.removeEventListener('abort', cancel);
      clearTimeout(timeout); incoming.cancelVideoFrameCallback(firstFrameId);
    }
  }
  private present(data: PlayRequest, started: boolean): void {
    this.activeOnce = data.loop ? undefined : data.token;
    this.actor.dataset.clip = data.clip; this.actor.dataset.kind = data.kind;
    this.actor.dataset.token = String(data.token); this.shown(data);
    window.alice.videoReady(data.token, started);
  }
}
