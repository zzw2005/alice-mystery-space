'use strict';
// Alice pet chat relay — runs on the gzmaoxing server behind nginx (wss).
//
// Two authenticated roles connect: "pc" (AliceButler on the owner's PC) and
// "alice" (the listener on Alice's VM). The relay forwards opaque,
// end-to-end-encrypted payloads between them and keeps a small persistent
// store-and-forward queue for whichever side is offline. It never sees
// plaintext: payloads are AES-256-GCM ciphertext produced by the endpoints.
//
// Envelope (JSON text frames):
//   {kind:"msg",   id, payload}  pc -> alice   (a pet chat message)
//   {kind:"reply", id, payload}  alice -> pc   (Alice's reply)
//   {kind:"ack",   id}           either side confirms receipt of msg/reply id
//   {kind:"hello"}               sent by the relay after auth, then the queue
//                                for that role is flushed in order.
//
// Config via environment: RELAY_TOKEN (required), RELAY_PORT (default 7311),
// RELAY_QUEUE_FILE (default ./queue.json next to this file).
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const TOKEN = process.env.RELAY_TOKEN || '';
const PORT = parseInt(process.env.RELAY_PORT || '7311', 10);
const QUEUE_FILE = process.env.RELAY_QUEUE_FILE || path.join(__dirname, 'queue.json');
const QUEUE_CAP = 200;
const QUEUE_TTL_MS = 24 * 3600 * 1000;

if (!TOKEN) { console.error('RELAY_TOKEN missing'); process.exit(1); }

// ---- persistent queue: {pc: [env...], alice: [env...]} -------------------
let queue = { pc: [], alice: [] };
try {
  const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  if (raw && Array.isArray(raw.pc) && Array.isArray(raw.alice)) queue = raw;
} catch (_) { /* first run */ }

let queueDirty = false;
function saveQueue() {
  if (!queueDirty) return;
  queueDirty = false;
  const tmp = QUEUE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(queue));
  fs.renameSync(tmp, QUEUE_FILE);
}
setInterval(saveQueue, 2000).unref();

function prune() {
  const now = Date.now();
  for (const role of ['pc', 'alice']) {
    queue[role] = queue[role].filter(e => now - e.at < QUEUE_TTL_MS).slice(-QUEUE_CAP);
  }
}
setInterval(prune, 60000).unref();

function enqueue(role, env) {
  prune();
  if (!queue[role].some(e => e.id === env.id && e.kind === env.kind)) {
    queue[role].push({ ...env, at: Date.now() });
    queueDirty = true;
  }
}

function dequeue(role, id, kind) {
  const before = queue[role].length;
  queue[role] = queue[role].filter(e => !(e.id === id && e.kind === kind));
  if (queue[role].length !== before) queueDirty = true;
}

// ---- connections ----------------------------------------------------------
const peers = { pc: null, alice: null }; // role -> ws

function sendTo(role, env) {
  const ws = peers[role];
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(env));
    return true;
  }
  return false;
}

function flushQueue(role) {
  for (const env of [...queue[role]]) {
    const { at, ...wire } = env;
    if (!sendTo(role, wire)) break; // still not really open; keep queued
  }
}

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws, req) => {
  const role = req.headers['x-relay-role'];
  const token = req.headers['x-relay-token'];
  if ((role !== 'pc' && role !== 'alice') || token !== TOKEN) {
    ws.close(4401, 'unauthorized');
    return;
  }
  if (peers[role]) { try { peers[role].close(4409, 'replaced'); } catch (_) {} }
  peers[role] = ws;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  console.log(`[${new Date().toISOString()}] ${role} connected`);
  ws.send(JSON.stringify({ kind: 'hello', role }));
  flushQueue(role);

  ws.on('message', (data) => {
    let env;
    try { env = JSON.parse(data.toString()); } catch (_) { return; }
    if (!env || typeof env.id !== 'string') return;
    const target = role === 'pc' ? 'alice' : 'pc';
    if (env.kind === 'msg' && role === 'pc') {
      if (!sendTo(target, env)) enqueue(target, env);
    } else if (env.kind === 'reply' && role === 'alice') {
      if (!sendTo(target, env)) enqueue(target, env);
    } else if (env.kind === 'ack') {
      // Acks flow opposite to the item they confirm: alice acks a "msg",
      // pc acks a "reply". The queued copy (if any) sits in the acking
      // side's own queue — drop it, then forward the ack to the sender so
      // it can retire its state.
      dequeue(role, env.id, role === 'alice' ? 'msg' : 'reply');
      sendTo(target, env);
    }
  });

  const drop = () => { if (peers[role] === ws) peers[role] = null; console.log(`[${new Date().toISOString()}] ${role} disconnected`); };
  ws.on('close', drop);
  ws.on('error', drop);
});

const heartbeat = setInterval(() => {
  for (const role of ['pc', 'alice']) {
    const ws = peers[role];
    if (!ws) continue;
    if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 25000);
heartbeat.unref();

console.log(`[${new Date().toISOString()}] pet relay listening on 127.0.0.1:${PORT}`);
