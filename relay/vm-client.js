'use strict';
// Alice-side relay client — runs on Alice's VM as a常驻 service.
//
// Inbound: pet chat messages arrive over the relay (end-to-end encrypted),
// are decrypted here and spooled to ~/hooks/state/relay-spool/ where the
// pet-inbox hook picks them up within its 5s poll — no SSH pull needed.
// Outbound: replies written by pet-reply.sh into ~/hooks/state/relay-outbox/
// are encrypted and pushed to the PC immediately; the file moves to sent/
// when the PC acks (reply written into the pet outbox).
//
// If this client is down, its heartbeat file goes stale and the hook falls
// back to the legacy SSH file bridge automatically.
//
// Config: PET_RELAY_CONFIG env or ~/workspace/pet-relay/config.json
//   { "url": "wss://www.gzmaoxing.com/pet-relay", "token": "...", "keyHex": "..." }
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { loadKey, encrypt, decrypt } = require('./crypto');

const HOME = os.homedir();
const CONFIG_PATH = process.env.PET_RELAY_CONFIG || path.join(HOME, 'workspace/pet-relay/config.json');
const STATE = path.join(HOME, 'hooks/state');
const SPOOL_IN = path.join(STATE, 'relay-spool');
const SPOOL_OUT = path.join(STATE, 'relay-outbox');
const SENT_DIR = path.join(SPOOL_OUT, 'sent');
const HEARTBEAT = path.join(STATE, 'relay-heartbeat');
const LOG_FILE = path.join(HOME, 'workspace/pet-relay/vm-client.log');

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const KEY = loadKey(cfg.keyHex);

for (const d of [SPOOL_IN, SPOOL_OUT, SENT_DIR]) fs.mkdirSync(d, { recursive: true });

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, s);
  } catch (_) {}
  process.stdout.write(s);
}

function touchHeartbeat() {
  try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch (_) {}
}

let ws = null;
let connected = false;
let backoff = 1000;
const awaitingAck = new Map(); // reply id -> spool filename

function send(env) {
  if (connected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(env));
    return true;
  }
  return false;
}

function atomicWrite(dir, name, text) {
  const tmp = path.join(dir, '.tmp-' + name);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, path.join(dir, name));
}

function handleMsg(env) {
  let obj;
  try { obj = JSON.parse(decrypt(KEY, env.payload)); } catch (e) { log(`decrypt failed for ${env.id}: ${e.message}`); return; }
  if (!obj || !obj.id || !obj.text) { log(`bad payload for ${env.id}`); return; }
  atomicWrite(SPOOL_IN, `msg-${obj.id}.json`, JSON.stringify({ id: obj.id, ts: obj.ts || '', text: obj.text }));
  send({ kind: 'ack', id: env.id });
  touchHeartbeat();
  log(`spooled msg ${obj.id}`);
}

const PC_STATUS = path.join(STATE, 'relay-pc-status');
function notePcStatus(online) {
  try { fs.writeFileSync(PC_STATUS, JSON.stringify({ online: !!online, at: Date.now() })); } catch (_) {}
  log(`pc peer ${online ? 'online' : 'offline'}`);
  if (online) { awaitingAck.clear(); flushOutbox(); }
}

function handleAck(env) {
  const name = awaitingAck.get(env.id);
  if (!name) return;
  awaitingAck.delete(env.id);
  try { fs.renameSync(path.join(SPOOL_OUT, name), path.join(SENT_DIR, name)); } catch (_) {}
  log(`reply ${env.id} acked by pc, retired`);
}

function flushOutbox() {
  if (!connected) return;
  let names = [];
  try { names = fs.readdirSync(SPOOL_OUT).filter(n => /^reply-.+\.json$/.test(n)); } catch (_) {}
  for (const name of names) {
    const id = name.slice('reply-'.length, -'.json'.length);
    if (awaitingAck.has(id)) continue;
    let obj;
    try { obj = JSON.parse(fs.readFileSync(path.join(SPOOL_OUT, name), 'utf8')); } catch (_) { continue; }
    const payload = encrypt(KEY, JSON.stringify({ id: obj.id || id, text: obj.text || '', ts: obj.ts || '',
      animationCategory: obj.animationCategory }));
    if (send({ kind: 'reply', id, payload })) {
      awaitingAck.set(id, name);
      log(`reply ${id} pushed`);
    }
  }
}

function connect() {
  // The VM reaches the internet through the platform egress proxy; ws does
  // not honour proxy env vars by itself, so hand it an agent explicitly.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const opts = { headers: { 'x-relay-role': 'alice', 'x-relay-token': cfg.token } };
  if (proxy && !/127\.0\.0\.1|localhost/.test(cfg.url)) opts.agent = new HttpsProxyAgent(proxy);
  ws = new WebSocket(cfg.url, opts);
  ws.on('open', () => {
    connected = true;
    backoff = 1000;
    touchHeartbeat();
    log('connected to relay');
    flushOutbox();
  });
  ws.on('message', (data) => {
    let env;
    try { env = JSON.parse(data.toString()); } catch (_) { return; }
    if (env.kind === 'msg') handleMsg(env);
    else if (env.kind === 'ack') handleAck(env);
    else if (env.kind === 'peer' && env.role === 'pc') notePcStatus(env.online);
    else if (env.kind === 'hello') notePcStatus(env.peerOnline);
  });
  const retry = () => {
    if (!connected && ws && ws.readyState !== WebSocket.OPEN) { /* fallthrough */ }
    connected = false;
    awaitingAck.clear();
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30000);
    log(`disconnected; retry in ${wait}ms`);
    setTimeout(connect, wait).unref();
  };
  ws.on('close', retry);
  ws.on('error', (e) => { log(`ws error: ${e.message}`); try { ws.close(); } catch (_) {} });
}

setInterval(() => { if (connected) touchHeartbeat(); }, 20000).unref();
try { fs.watch(SPOOL_OUT, () => flushOutbox()); } catch (_) {}
setInterval(flushOutbox, 3000).unref();

connect();
log('vm relay client started');
