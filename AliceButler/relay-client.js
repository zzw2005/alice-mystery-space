'use strict';
// PC-side relay client — runs as an AliceButler service job on the owner's PC.
//
// Fast path for the pet chat bridge, replacing SSH polling:
//  - Watches the butler inbox/ for new pet messages (msg-*.json), encrypts
//    them end-to-end and pushes them through the relay on the gzmaoxing
//    server to Alice's VM listener. When Alice acks (message spooled on her
//    side), the file moves to inbox/seen/ — same end state as the legacy
//    hook, so pet history replay is unaffected.
//  - Replies arriving through the relay are decrypted and written into
//    outbox/ with the usual atomic tmp->rename discipline, then acked.
//  - If the relay is unreachable, files simply stay in inbox/ and the legacy
//    SSH hook on Alice's side keeps working as the fallback path.
//
// Files next to this script:
//   relay-client-config.json  {url, token, keyFile}
//   relay-key.txt             32-byte hex E2E key (same as Alice's VM copy)
//   relay-ws/                 vendored `ws` package (pure JS, no native deps)
//   relay-crypto.js           AES-256-GCM helpers (copy of relay/crypto.js)
const fs = require('fs');
const path = require('path');
const WebSocket = require('./relay-ws');
const { loadKey, encrypt, decrypt } = require('./relay-crypto');

const DIR = __dirname;
const BUTLER = process.env.ALICE_BUTLER_DIR || 'C:\\ProgramData\\AliceButler';
const INBOX = path.join(BUTLER, 'inbox');
const SEEN = path.join(INBOX, 'seen');
const OUTBOX = path.join(BUTLER, 'outbox');
const OUT_SEEN = path.join(OUTBOX, 'seen');
const STATE_FILE = path.join(DIR, 'relay-state.json');
const STATUS_FILE = path.join(DIR, 'relay-status.json');
const LOG_FILE = path.join(DIR, 'relay-client.log');

const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'relay-client-config.json'), 'utf8'));
const KEY = loadKey(fs.readFileSync(path.join(DIR, cfg.keyFile || 'relay-key.txt'), 'utf8'));

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, s);
  } catch (_) {}
}

let state = { acked: [] };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
const ackedSet = new Set(state.acked || []);
function saveState() {
  state.acked = [...ackedSet].slice(-500);
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

let ws = null;
let connected = false;
let backoff = 1000;
const awaiting = new Map(); // msg id -> {name, since}

function send(env) {
  if (connected && ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(env)); return true; }
  return false;
}

function scanInbox() {
  let names = [];
  try { names = fs.readdirSync(INBOX).filter(n => /^msg-.+\.json$/.test(n)); } catch (_) { return; }
  const present = new Set();
  for (const name of names) {
    let obj;
    try { obj = JSON.parse(fs.readFileSync(path.join(INBOX, name), 'utf8')); } catch (_) { continue; }
    if (!obj || !obj.id || !obj.text) continue;
    present.add(obj.id);
    if (ackedSet.has(obj.id)) {
      // Already delivered via relay but the move failed earlier; retry move.
      try { fs.renameSync(path.join(INBOX, name), path.join(SEEN, name)); } catch (_) {}
      continue;
    }
    const wait = awaiting.get(obj.id);
    if (wait && Date.now() - wait.since < 15000) continue;
    if (!connected) continue;
    const payload = encrypt(KEY, JSON.stringify({ id: obj.id, ts: obj.ts || '', text: obj.text }));
    if (send({ kind: 'msg', id: obj.id, payload })) {
      awaiting.set(obj.id, { name, since: Date.now() });
      log(`pushed msg ${obj.id}`);
    }
  }
  // Files that vanished while awaiting were taken by the legacy hook.
  for (const id of [...awaiting.keys()]) {
    if (!present.has(id)) { awaiting.delete(id); ackedSet.add(id); saveState(); }
  }
}

function handleAck(env) {
  const wait = awaiting.get(env.id);
  if (!wait) return;
  awaiting.delete(env.id);
  ackedSet.add(env.id);
  saveState();
  try { fs.renameSync(path.join(INBOX, wait.name), path.join(SEEN, wait.name)); } catch (_) {}
  log(`msg ${env.id} acked, moved to seen`);
}

function handleReply(env) {
  let obj;
  try { obj = JSON.parse(decrypt(KEY, env.payload)); } catch (e) { log(`reply decrypt failed: ${e.message}`); return; }
  if (!obj || !obj.id || typeof obj.text !== 'string') return;
  const finalName = `reply-${obj.id}.json`;
  const exists = fs.existsSync(path.join(OUTBOX, finalName)) || fs.existsSync(path.join(OUT_SEEN, finalName));
  if (!exists) {
    const tmp = path.join(OUTBOX, `.tmp-${obj.id}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ id: obj.id, text: obj.text, ts: obj.ts || new Date().toISOString() }), 'utf8');
    fs.renameSync(tmp, path.join(OUTBOX, finalName));
    log(`reply ${obj.id} written to outbox`);
  }
  send({ kind: 'ack', id: env.id });
}

function writeStatus() {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ connected, ts: new Date().toISOString() })); } catch (_) {}
}

function connect() {
  ws = new WebSocket(cfg.url, { headers: { 'x-relay-role': 'pc', 'x-relay-token': cfg.token } });
  ws.on('open', () => { connected = true; backoff = 1000; log('connected to relay'); writeStatus(); scanInbox(); });
  ws.on('message', (data) => {
    let env;
    try { env = JSON.parse(data.toString()); } catch (_) { return; }
    if (env.kind === 'reply') handleReply(env);
    else if (env.kind === 'ack') handleAck(env);
    else if (env.kind === 'hello') scanInbox();
  });
  ws.on('close', () => {
    connected = false;
    writeStatus();
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30000);
    log(`disconnected; retry in ${wait}ms`);
    setTimeout(connect, wait).unref();
  });
  ws.on('error', (e) => { log(`ws error: ${e.message}`); try { ws.close(); } catch (_) {} });
}

try { fs.watch(INBOX, () => scanInbox()); } catch (_) {}
setInterval(scanInbox, 1500).unref();
setInterval(writeStatus, 10000).unref();
connect();
log('relay client started');
