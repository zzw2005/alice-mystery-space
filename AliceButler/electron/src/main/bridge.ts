import { defaultTuning } from './tuning';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './placement';
export type Message = { id: string; text: string; mine: boolean; ts?: string; animationCategory?: string };
const inboxName = /^msg-[\w-]+\.json$/;

export class ReplyQueue {
  private replies: Message[] = [];
  private deliveredAt = -Infinity;
  enqueue(replies: Message[]): void { for (const reply of replies) this.replies.push(reply); }
  next(now: number, gap: number): Message | number | undefined {
    if (!this.replies.length) return;
    const remaining = this.deliveredAt + gap - now;
    if (remaining > 0) return remaining;
    return this.replies.shift();
  }
  delivered(now: number): void {
    this.deliveredAt = this.replies.length ? now : -Infinity;
  }
}

export class Bridge {
  private failures = new Map<string, number>();
  constructor(readonly root: string, public tuning = defaultTuning) {}
  async send(text: unknown): Promise<Message> {
    if (typeof text !== 'string' || !text.trim() || text.length > this.tuning.maxMessageChars) throw Error('消息为空或过长');
    const id = 'msg-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
    const data = { id, ts: new Date().toISOString(), text: text.trim() };
    const dir = path.join(this.root, 'inbox'); await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, id + '.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(data), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(file + '.tmp', file);
    try { await fs.access(file); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await fs.access(path.join(dir, 'seen', id + '.json'));
    }
    return { ...data, mine: true };
  }
  async unsent(): Promise<Message[]> {
    const dir = path.join(this.root, 'inbox');
    const names = await fs.readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const messages: Message[] = [];
    for (const name of names.sort().filter(n => inboxName.test(n))) {
      try {
        const data = JSON.parse((await fs.readFile(path.join(dir, name), 'utf8')).replace(/^\uFEFF/, ''));
        if (data?.id === name.slice(0, -5) && typeof data.text === 'string' && data.text.trim()) {
          messages.push({ id: data.id, text: data.text, ts: typeof data.ts === 'string' ? data.ts : '', mine: true });
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
      }
    }
    return messages;
  }
  archiveSent(id: string): void {
    const dir = path.join(this.root, 'inbox'), seen = path.join(dir, 'seen');
    mkdirSync(seen, { recursive: true });
    try { renameSync(path.join(dir, id + '.json'), path.join(seen, id + '.json')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  acceptRelayReply(id: string, json: string): Message | undefined {
    if (!/^[\w-]+$/.test(id) || Buffer.byteLength(json) > this.tuning.maxReplyBytes) throw Error('Invalid reply envelope');
    const data = JSON.parse(json);
    if (data?.id !== id || typeof data.text !== 'string' || !data.text.trim()) throw Error('Invalid reply');
    const seen = path.join(this.root, 'outbox', 'seen');
    mkdirSync(seen, { recursive: true });
    const dest = path.join(seen, 'reply-' + id + '.json');
    if (existsSync(dest)) return;
    const reply = { id, text: data.text, ts: typeof data.ts === 'string' ? data.ts : new Date().toISOString(),
      animationCategory: typeof data.animationCategory === 'string' ? data.animationCategory : undefined };
    atomicWrite(dest, JSON.stringify(reply));
    return { ...reply, mine: false };
  }
  async poll(): Promise<Message[]> {
    const dir = path.join(this.root, 'outbox'); const seen = path.join(dir, 'seen');
    await fs.mkdir(seen, { recursive: true });
    const result: Message[] = [];
    for (const name of (await fs.readdir(dir)).filter(n => /^reply-[\w-]+\.json$/.test(n)).sort()) {
      const file = path.join(dir, name);
      try {
        let data: Omit<Message, 'mine'>;
        try {
          if ((await fs.stat(file)).size > this.tuning.maxReplyBytes) throw Error('Oversized reply');
          data = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
          if (!data || typeof data.text !== 'string' || !data.text.trim()) throw Error('Invalid reply');
        } catch {
          const count = (this.failures.get(name) ?? 0) + 1; this.failures.set(name, count);
          if (count >= this.tuning.replyBadCount && Date.now() - (await fs.stat(file)).mtimeMs > this.tuning.replyBadAgeMs) { await fs.rename(file, file + '.bad'); this.failures.delete(name); }
          continue;
        }
        const dest = path.join(seen, name);
        // Share the seen marker with direct replies without yielding between check and move.
        if (existsSync(dest)) { unlinkSync(file); continue; }
        renameSync(file, dest);
        this.failures.delete(name); result.push({ ...data, id: name.slice(6, -5), mine: false });
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return result;
  }
  async history(): Promise<Message[]> {
    const result: Message[] = [];
    const dir = path.join(this.root, 'inbox', 'seen');
    let names: string[];
    try { names = (await fs.readdir(dir)).filter(n => inboxName.test(n)).sort().slice(-this.tuning.historyPairs); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    for (const name of names) {
      for (const [file, mine] of [[path.join(dir, name), true], [path.join(this.root, 'outbox', 'seen', 'reply-' + name), false]] as const) {
        try { const o = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); if (typeof o.text === 'string') result.push({ id: o.id, text: o.text, mine }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
      }
    }
    return result;
  }
}
