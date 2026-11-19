import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Bridge, Message } from './bridge';

// Bundled with the existing PC relay's wire dependencies.
const WebSocket = require('../../../relay-ws') as new (url: string, options: object) => RelaySocket;
const { loadKey, encrypt, decrypt } = require('../../../relay-crypto') as {
  loadKey(hex: string): Buffer;
  encrypt(key: Buffer, json: string): string;
  decrypt(key: Buffer, payload: string): string;
};
interface RelaySocket extends NodeJS.EventEmitter {
  send(data: string, callback: (error?: Error) => void): void;
  terminate(): void;
}

const ackTimeoutMs = 15_000;
const fallbackWindowMs = 10_000;
const heartbeatTimeoutMs = 60_000;

export class ChatRelay {
  connected = false;
  private stopped = false;
  private socket?: RelaySocket;
  private retry?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private key?: Buffer;
  private backoff = 1000;
  private retryDelay = 0;
  private awaiting = new Map<string, NodeJS.Timeout>();

  constructor(private bridge: Bridge, private onState: () => void,
    private onReply: (reply: Message) => void, private report: (operation: string, error: unknown) => void,
    private Socket = WebSocket) {}

  start(): void {
    if (this.stopped || this.socket || this.retry) return;
    const root = this.bridge.root;
    // The server allows one PC per token. Let the installed service finish stopping first.
    if (existsSync(path.join(root, 'running', 'relay-client.job.json'))) {
      this.schedule(5000);
      return;
    }
    let socket: RelaySocket, key: Buffer;
    try {
      const cfg = JSON.parse(readFileSync(path.join(root, 'relay-client-config.json'), 'utf8').replace(/^\uFEFF/, ''));
      const url = new URL(cfg.url);
      if (url.protocol !== 'wss:' || url.username || url.password || typeof cfg.token !== 'string' || !cfg.token) throw Error('Invalid relay config');
      key = loadKey(readFileSync(path.resolve(root, cfg.keyFile || 'relay-key.txt'), 'utf8'));
      socket = new this.Socket(url.href, {
        headers: { 'x-relay-role': 'pc', 'x-relay-token': cfg.token },
        handshakeTimeout: 10_000,
        maxPayload: Math.ceil(this.bridge.tuning.maxReplyBytes * 4 / 3) + 1024
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.report('chat-relay-config', e);
      this.schedule(30_000);
      return;
    }
    this.socket = socket;
    this.key = key;
    const renew = () => {
      clearTimeout(this.heartbeat);
      this.heartbeat = setTimeout(() => socket.terminate(), heartbeatTimeoutMs);
    };
    renew();
    socket.on('ping', renew);
    socket.on('message', (frame: Buffer) => {
      if (this.stopped || this.socket !== socket) return;
      let env;
      try { env = JSON.parse(frame.toString()); } catch { return; }
      if (env?.kind === 'hello' && env.role === 'pc' && !this.connected) {
        this.connected = true;
        this.backoff = 1000;
        this.onState();
        this.bridge.unsent().then(messages => {
          if (this.socket === socket) for (const msg of messages) this.push(msg);
        }).catch(e => {
          this.report('chat-relay-inbox', e);
          socket.terminate();
        });
      } else if (this.connected && env?.kind === 'ack' && this.awaiting.has(env.id)) {
        try {
          this.bridge.archiveSent(env.id);
          clearTimeout(this.awaiting.get(env.id));
          this.awaiting.delete(env.id);
        } catch (e) {
          this.report('chat-relay-ack', e);
          socket.terminate();
        }
      } else if (this.connected && env?.kind === 'reply' && typeof env.id === 'string' && typeof env.payload === 'string') {
        let json: string;
        try { json = decrypt(key, env.payload); }
        catch (e) { this.report('chat-relay-decrypt', e); return; }
        let reply: Message | undefined;
        try {
          reply = this.bridge.acceptRelayReply(env.id, json);
        } catch (e) {
          this.report('chat-relay-reply', e);
          if ((e as NodeJS.ErrnoException).code) socket.terminate();
          return;
        }
        this.send({ kind: 'ack', id: env.id });
        if (reply) this.onReply(reply);
      }
    });
    socket.on('error', e => this.report('chat-relay-socket', e));
    socket.on('close', (code: number) => {
      this.socket = undefined;
      if (this.connected) { this.connected = false; this.onState(); }
      clearTimeout(this.heartbeat);
      for (const timeout of this.awaiting.values()) clearTimeout(timeout);
      this.awaiting.clear();
      const wait = Math.max(this.backoff, this.retryDelay, code === 4409 ? 30_000 : 0);
      this.retryDelay = 0;
      this.backoff = Math.min(30_000, this.backoff * 2);
      if (!this.stopped) this.schedule(wait);
    });
  }

  push({ id, text, ts }: Message): void {
    if (!this.connected || !this.key || this.awaiting.has(id)) return;
    const timeout = setTimeout(() => {
      // Give the legacy hook a polling window when the peer never acknowledges.
      this.retryDelay = fallbackWindowMs;
      this.socket?.terminate();
    }, ackTimeoutMs);
    this.awaiting.set(id, timeout);
    this.send({ kind: 'msg', id, payload: encrypt(this.key, JSON.stringify({ id, text, ts })) });
  }

  private send(env: { kind: string; id: string; payload?: string }): void {
    const socket = this.socket;
    socket?.send(JSON.stringify(env), error => { if (error) socket.terminate(); });
  }

  private schedule(ms: number): void {
    this.retry = setTimeout(() => { this.retry = undefined; this.start(); }, ms);
    this.retry.unref();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.terminate();
  }
}
