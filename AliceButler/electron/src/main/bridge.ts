import { defaultTuning } from './tuning';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export type Message = { id: string; text: string; mine: boolean; ts?: string };
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
    await fs.access(file);
    return { ...data, mine: true };
  }
  async poll(): Promise<Message[]> {
    const dir = path.join(this.root, 'outbox'); const seen = path.join(dir, 'seen');
    await fs.mkdir(seen, { recursive: true });
    const result: Message[] = [];
    for (const name of (await fs.readdir(dir)).filter(n => /^reply-[\w-]+\.json$/.test(n)).sort()) {
      const file = path.join(dir, name);
      try {
        let data: { id: string; text: string; ts?: string };
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
        try { await fs.access(dest); await fs.unlink(file); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        await fs.rename(file, dest);
        this.failures.delete(name); result.push({ ...data, id: name.slice(6, -5), mine: false });
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return result;
  }
  async history(): Promise<Message[]> {
    const result: Message[] = [];
    const dir = path.join(this.root, 'inbox', 'seen');
    let names: string[];
    try { names = (await fs.readdir(dir)).filter(n => /^msg-[\w-]+\.json$/.test(n)).sort().slice(-this.tuning.historyPairs); }
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
