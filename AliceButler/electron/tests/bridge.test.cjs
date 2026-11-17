const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Bridge } = require('../dist/main/bridge');

test('file bridge: atomic send, consume before display, duplicate suppression, quarantine and history', async () => {
  const base = path.resolve(__dirname, '../test-results'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'bridge-')); const bridge = new Bridge(root);
  await assert.rejects(bridge.send(' ')); await assert.rejects(bridge.send({ text: 'wrong type' }));
  const message = await bridge.send('你好');
  const file = path.join(root, 'inbox', message.id + '.json');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).text, '你好');
  assert.deepEqual((await fs.readdir(path.join(root, 'inbox'))), [message.id + '.json']);
  await fs.mkdir(path.join(root, 'outbox'), { recursive: true });
  const name = 'reply-' + message.id + '.json', reply = path.join(root, 'outbox', name);
  await fs.writeFile(reply + '.tmp', '{'); assert.deepEqual(await bridge.poll(), []);
  await fs.writeFile(reply, JSON.stringify({ id: message.id, text: '收到' }));
  const received = await bridge.poll(); assert.equal(received.length, 1); assert.equal(received[0].id, message.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'outbox/seen', name), 'utf8')).text, '收到');
  await fs.writeFile(reply, JSON.stringify({ id: message.id, text: 'duplicate' })); assert.deepEqual(await bridge.poll(), []);
  const bad = path.join(root, 'outbox/reply-bad.json'); await fs.writeFile(bad, '{');
  for (let i = 0; i < 6; i++) await bridge.poll(); await fs.access(bad);
  const old = new Date(Date.now() - 100000); await fs.utimes(bad, old, old); await bridge.poll(); await fs.access(bad + '.bad');
  await fs.mkdir(path.join(root, 'inbox/seen')); await fs.rename(file, path.join(root, 'inbox/seen', message.id + '.json'));
  assert.deepEqual((await bridge.history()).map(m => [m.mine, m.text]), [[true, '你好'], [false, '收到']]);
});
