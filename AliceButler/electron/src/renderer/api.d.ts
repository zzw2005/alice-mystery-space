interface DisplayTuning {
  loopCoverMs: number;
  hitAlpha: number;
  bubbleMs: number; frameReportMs: number; firstFrameMs: number; fadeMs: number;
  maxMessageChars: number; chatScrollPx: number;
}
interface AliceAPI {
  ready(kind: 'pet' | 'chat'): void;
  onPlay(cb: (data: import('./player').PlayRequest) => void): () => void;
  onClickSound(cb: () => void): () => void;
  onReclaimDone(cb: () => void): void;
  onReclaim(cb: () => void): void; reclaimed(): void;
  onProbe(cb: (data: { day: string; clips: Record<string, string>; timeoutMs: number }) => void): void;
  probed(day: string, clips: Record<string, string>): void;
  onSuspend(cb: () => void): () => void;
  suspended(): void;
  onBubble(cb: (text: string) => void): () => void;
  onPose(cb: (data: { x: number; y: number; squash: number; direction: number; heightAbove: number; dragging?: boolean; tilt?: number }) => void): () => void;
  onChat(cb: (data: { tuning: DisplayTuning; messages: { id: string; text: string; mine: boolean }[]; note: string; pending: { id: string; stage: string }[] }) => void): () => void;
  hit(value: boolean): void; pointer(kind: string): void; ended(token: number): void;
  playbackResult(token: number, outcome: 'cancelled', reason: 'superseded'): void;
  videoReady(token: number, started: boolean): void; videoError(message: string, token?: number): void; frames(count: number): void;
  closeChat(): void; send(text: string): Promise<string>;
}
interface Window { alice: AliceAPI }
