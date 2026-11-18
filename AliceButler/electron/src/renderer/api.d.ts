interface AliceAPI {
  ready(kind: 'pet' | 'chat'): void;
  onPlay(cb: (data: { clip: string; kind: string; loop: boolean; token: number; url: string; facing: string; direction: number }) => void): () => void;
  onSuspend(cb: () => void): () => void;
  suspended(): void;
  onBubble(cb: (text: string) => void): () => void;
  onPose(cb: (data: { x: number; y: number; squash: number; direction: number; heightAbove: number; dragging?: boolean; tilt?: number }) => void): () => void;
  onChat(cb: (data: { messages: { id: string; text: string; mine: boolean }[]; note: string; pending: { id: string; stage: string }[] }) => void): () => void;
  hit(value: boolean): void; pointer(kind: string): void; ended(token: number): void;
  videoReady(token: number): void; videoError(message: string, token?: number): void; frames(count: number): void;
  closeChat(): void; send(text: string): Promise<string>;
}
interface Window { alice: AliceAPI }
