const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { Bridge } = require('../dist/main/bridge');
const { ChatRelay } = require('../dist/main/chat-relay');
const { encrypt, decrypt } = require('../../relay-crypto');

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    const result = predicate();
    if (result) return result;
    await wait(10);
  }
  assert.fail('Timed out waiting for relay');
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'alice-chat-relay-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const key = Buffer.alloc(32, 42);
  await fs.writeFile(path.join(root, 'relay-key.txt'), key.toString('hex'));
  await fs.writeFile(path.join(root, 'relay-client-config.json'), JSON.stringify({ url: 'wss://localhost/pet-relay', token: 'test-token' }));
  const sockets = [], replies = [], states = [], errors = [];
  class Socket extends EventEmitter {
    frames = [];
    constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this); }
    send(frame, callback) { this.frames.push(JSON.parse(frame)); callback(); }
    receive(frame) { this.emit('message', Buffer.from(JSON.stringify(frame))); }
    hello() { this.receive({ kind: 'hello', role: 'pc', peerOnline: true }); }
    terminate() { this.emit('close', 1006); }
  }
  const bridge = new Bridge(root);
  const relay = new ChatRelay(bridge, () => states.push(relay.connected), reply => replies.push(reply),
    (operation, error) => errors.push([operation, error]), Socket);
  t.after(() => relay.stop());
  return { root, key, bridge, relay, sockets, replies, states, errors };
}

test('direct relay authenticates before sending and archives an unchanged message only on ACK', async t => {
  const { root, key, bridge, relay, sockets, states } = await fixture(t);
  relay.start();
  const [socket] = sockets;
  assert.equal(socket.url, 'wss://localhost/pet-relay');
  assert.deepEqual(socket.options.headers, { 'x-relay-role': 'pc', 'x-relay-token': 'test-token' });
  const msg = await bridge.send('你好，艾莉丝');
  assert.match(msg.id, /^msg-\d{14}-[0-9a-f]{6}$/);
  relay.push(msg);
  assert.deepEqual(socket.frames, []);
  socket.hello();
  const frame = await until(() => socket.frames[0]);
  assert.deepEqual(states, [true]);
  assert.deepEqual({ kind: frame.kind, id: frame.id }, { kind: 'msg', id: msg.id });
  const { mine, ...wire } = msg;
  assert.deepEqual(JSON.parse(decrypt(key, frame.payload)), wire);
  const inbox = path.join(root, 'inbox');
  await fs.access(path.join(inbox, msg.id + '.json'));
  socket.receive({ kind: 'ack', id: msg.id });
  await assert.rejects(fs.access(path.join(inbox, msg.id + '.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(inbox, 'seen', msg.id + '.json'), 'utf8')), wire);
});

test('disconnect leaves messages in the file bridge and reconnect retries the same IDs', async t => {
  const { bridge, relay, sockets, states } = await fixture(t);
  relay.start();
  sockets[0].hello();
  const first = await bridge.send('发送中断');
  relay.push(first);
  sockets[0].terminate();
  const second = await bridge.send('离线发送');
  relay.push(second);
  assert.deepEqual((await bridge.unsent()).map(msg => msg.id).sort(), [first.id, second.id].sort());
  const next = await until(() => sockets[1]);
  next.hello();
  await until(() => next.frames.length === 2);
  assert.deepEqual(next.frames.map(f => f.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(states, [true, false, true]);
});

test('direct and fallback replies share deduplication and reject tampered envelopes', async t => {
  const { root, key, bridge, relay, sockets, replies, errors } = await fixture(t);
  relay.start();
  const [socket] = sockets;
  socket.hello();
  const id = 'msg-20261119000000-abcdef';
  const data = { id, text: '收到', ts: '2026-11-19T00:00:00Z', animationCategory: 'happy' };
  const frame = { kind: 'reply', id, payload: encrypt(key, JSON.stringify(data)) };
  socket.receive({ ...frame, id: '../x' });
  socket.receive({ ...frame, payload: encrypt(Buffer.alloc(32), JSON.stringify(data)) });
  assert.deepEqual(socket.frames, []);
  assert.equal(errors.length, 2);
  socket.receive(frame);
  socket.receive(frame);
  const ack = { kind: 'ack', id };
  assert.deepEqual(socket.frames, [ack, ack]);
  assert.deepEqual(replies, [{ ...data, mine: false }]);
  const outbox = path.join(root, 'outbox');
  const name = `reply-${id}.json`;
  await fs.writeFile(path.join(outbox, name), JSON.stringify(data));
  assert.deepEqual(await bridge.poll(), []);
  const fallback = { ...data, id: id + '2' };
  await fs.writeFile(path.join(outbox, `reply-${fallback.id}.json`), JSON.stringify(fallback));
  assert.deepEqual(await bridge.poll(), [{ ...fallback, mine: false }]);
  socket.receive({ ...frame, id: fallback.id, payload: encrypt(key, JSON.stringify(fallback)) });
  assert.equal(replies.length, 1);
  assert.deepEqual(socket.frames.at(-1), { kind: 'ack', id: fallback.id });
});
