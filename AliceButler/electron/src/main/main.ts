import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Bridge, Message } from './bridge';
import { Director, Physics, Presence, validateConfig } from './engine';

const root = process.env.ALICE_PET_ROOT || 'C:\\ProgramData\\AliceButler';
const testMode = process.env.ALICE_PET_TEST === '1';
const ui = path.join(__dirname, '../../ui');
const media = path.join(__dirname, '../../media');
const configPath = path.join(app.getAppPath(), 'config.json');
const bridge = new Bridge(root);
const physics = new Physics();
let pet: BrowserWindow, chat: BrowserWindow, tray: Tray, director: Director;
let chatReady = false, ready = false, quitting = false, videoReady = false;
let dragOffset = { x: 0, y: 0 }, downCursor = { x: 0, y: 0 }, downAt = 0, lastMovedAt = 0, moved = false;
let nextRandom = Date.now() + 50000, lastInteract = Date.now(), clickTimer: NodeJS.Timeout | undefined;
let messages: Message[] = [], presenceNote = '在岗', pending = new Map<string, number>();
let decodedFrames = 0, lastClipToken = 0, totalFrames = 0;
let pollRunning = false, statusRunning = false, tickAt = performance.now();
let configStamp = 0, metricsStamp = Date.now();
let ignoringMouse = true;
const timers: NodeJS.Timeout[] = [];
function report(error: unknown): void {
  console.error(error);
  fs.appendFile(path.join(root, 'pet-error.log'), `${new Date().toISOString()} ${String(error)}\n`).catch(() => {});
}
function area() {
  const a = screen.getDisplayNearestPoint({ x: Math.round(physics.x + 266), y: Math.round(physics.y + 125) }).workArea;
  return { left: a.x - 533 * .3, right: a.x + a.width - 533 * .7, top: a.y, floor: a.y + a.height - 300 * .85 - 2 };
}
function sendChat(): void {
  if (chatReady) chat.webContents.send('chat-state', { messages: messages.slice(-200), note: presenceNote,
    pending: [...pending.entries()].map(([id, at]) => ({ id, stage: Date.now() - at < 2000 ? '已收到' : '思考中' })) });
}
function play(): void {
  if (!ready) return;
  const action = director.current;
  const clip = director.config.clips[action.clip];
  if (!clip) return;
  videoReady = false;
  pet.webContents.send('play', { ...action, token: ++lastClipToken, url: pathToFileURL(path.join(media, clip.file)).href,
    facing: clip.facing ?? 'right', direction: physics.direction });
}
function stopWalk(): void { if (physics.mode === 'walk') physics.mode = 'idle'; }
function reaction(kind: 'clicks' | 'drag' | 'turn' | 'moves'): void {
  if (kind !== 'moves') stopWalk();
  director.react(kind); play();
}
function toggleChat(): void {
  if (chat.isVisible()) { chat.hide(); return; }
  const bounds = pet.getBounds(); const a = screen.getDisplayMatching(bounds).workArea;
  chat.setPosition(Math.round(Math.max(a.x, Math.min(a.x + a.width - 372, bounds.x + bounds.width / 2 - 186))), Math.round(Math.max(a.y, Math.min(a.y + a.height - 500, bounds.y - 460))));
  chat.show(); chat.focus(); sendChat();
}
async function purposefulExit(): Promise<void> {
  await fs.writeFile(path.join(root, 'pet-disabled.flag'), new Date().toISOString());
  quitting = true; app.quit();
}
function menu(): Menu {
  return Menu.buildFromTemplate([
    { label: '和艾莉丝说话', click: toggleChat },
    { label: director?.rest === 'awake' ? '睡一会儿' : '起来', click: () => { stopWalk(); if (director.rest === 'awake') director.sleep(); else director.wake(); play(); } },
    { label: '跳一下', click: () => { stopWalk(); physics.mode = 'air'; physics.vy = -330; physics.vx = 0; } },
    { label: '回到原位', click: () => { physics.mode = 'idle'; physics.x = area().right - 30; physics.y = area().floor; } },
    { label: pet?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => pet.isVisible() ? pet.hide() : pet.showInactive() },
    { label: '重载动作配置', click: () => loadConfig().then(play).catch(report) },
    { type: 'separator' }, { label: '退出桌宠', click: () => purposefulExit().catch(report) }
  ]);
}
async function loadConfig(): Promise<void> {
  const config = validateConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
  for (const entry of Object.values(config.clips)) await fs.access(path.join(media, entry.file));
  if (director) { director.config = config; director.base(); }
  else { director = new Director(config); director.base(); }
  configStamp = (await fs.stat(configPath)).mtimeMs;
}
function trusted(sender: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, which: BrowserWindow): boolean {
  return sender.sender === which?.webContents && sender.senderFrame === which.webContents.mainFrame;
}
async function setup(): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await loadConfig(); messages = await bridge.history();
  const options = { frame: false, show: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } };
  pet = new BrowserWindow({ ...options, width: 533, height: 300, transparent: true, hasShadow: false, title: '艾莉丝桌宠' });
  chat = new BrowserWindow({ ...options, width: 372, height: 500, transparent: true, title: '和艾莉丝说话' });
  for (const w of [pet, chat]) {
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', event => event.preventDefault());
    w.on('close', event => { if (!quitting) { event.preventDefault(); w.hide(); } });
    w.webContents.on('render-process-gone', (_e, details) => { report(`renderer lost: ${details.reason}`); quitting = true; app.exit(1); });
  }
  const a = screen.getPrimaryDisplay().workArea;
  physics.x = a.x + a.width - 533 * .7 - 30; physics.y = a.y + a.height - 257;
  pet.setBounds({ x: Math.round(physics.x), y: Math.round(physics.y), width: 533, height: 300 });
  pet.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on('renderer-ready', event => {
    if (!trusted(event, pet)) return;
    ready = true; play(); if (!testMode) pet.showInactive();
  });
  ipcMain.on('chat-ready', event => { if (trusted(event, chat)) { chatReady = true; sendChat(); } });
  ipcMain.on('chat-close', event => { if (trusted(event, chat)) chat.hide(); });
  ipcMain.handle('chat-send', async (event, text: unknown) => {
    if (!trusted(event, chat)) throw Error('Invalid sender');
    const msg = await bridge.send(text); messages.push(msg); pending.set(msg.id, Date.now()); sendChat(); lastInteract = Date.now();
    return msg.id;
  });
  ipcMain.on('hit', (event, hit: unknown) => {
    if (trusted(event, pet) && typeof hit === 'boolean' && physics.mode !== 'drag' && ignoringMouse === hit) {
      ignoringMouse = !hit; pet.setIgnoreMouseEvents(ignoringMouse, { forward: true });
    }
  });
  ipcMain.on('frame', (event, value: unknown) => {
    if (trusted(event, pet) && typeof value === 'number' && value > 0 && value <= 240) { decodedFrames += value; totalFrames += value; }
  });
  ipcMain.on('video-ready', async (event, token: unknown) => {
    if (!trusted(event, pet) || token !== lastClipToken) return;
    videoReady = true;
    if (director.current.kind === 'moves' && physics.mode === 'idle') {
      const bounds = area(); physics.targetX = Math.max(bounds.left, Math.min(bounds.right, physics.x + physics.direction * (60 + Math.random() * 220)));
      physics.mode = 'walk';
    }
    try { await fs.rm(path.join(root, 'pet-disabled.flag'), { force: true }); await fs.writeFile(path.join(root, 'pet-start.log'), `electron video ok ${new Date().toISOString()}\n`); } catch (e) { report(e); }
  });
  ipcMain.on('video-error', (event, message: unknown) => { if (trusted(event, pet)) report(`video: ${String(message).slice(0, 500)}`); });
  ipcMain.on('ended', (event, token: unknown) => {
    if (!trusted(event, pet) || token !== lastClipToken) return;
    if (director.current.kind === 'turn') physics.direction *= -1;
    director.ended(); play();
  });
  ipcMain.on('pet-pointer', (event, type: unknown) => {
    if (!trusted(event, pet)) return;
    const now = Date.now(); const cursor = screen.getCursorScreenPoint();
    if (type === 'down') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = undefined; }
      downAt = now; downCursor = cursor; lastMovedAt = now; moved = false;
      dragOffset = { x: cursor.x - physics.x, y: cursor.y - physics.y };
      physics.vx = physics.vy = 0; physics.mode = 'drag';
      if (director.rest !== 'awake') { director.wake(); play(); }
    } else if (type === 'up' && physics.mode === 'drag') {
      lastInteract = now;
      if (!moved && now - downAt < 400) {
        physics.mode = 'idle'; physics.y = area().floor;
        clickTimer = setTimeout(() => { reaction('clicks'); toggleChat(); clickTimer = undefined; }, 260);
      } else { physics.release(now - lastMovedAt > 150); director.base(); play(); }
    } else if (type === 'double') {
      if (clickTimer) clearTimeout(clickTimer); clickTimer = undefined;
      director.wake(); director.base(); play();
      physics.mode = 'air'; physics.vx = 0; physics.vy = -330;
    } else if (type === 'menu') menu().popup({ window: pet });
  });
  pet.on('blur', () => { if (physics.mode === 'drag') { physics.release(true); director.base(); play(); } });
  await Promise.all([pet.loadFile(path.join(ui, 'pet.html')), chat.loadFile(path.join(ui, 'chat.html'))]);
  tray = new Tray(nativeImage.createFromPath(path.join(ui, 'avatar.ico')));
  tray.setToolTip('艾莉丝 · 在岗'); tray.setContextMenu(menu()); tray.on('double-click', toggleChat);
  screen.on('display-metrics-changed', () => { physics.x = Math.max(area().left, Math.min(area().right, physics.x)); physics.y = Math.min(area().floor, physics.y); });
  timers.push(setInterval(() => {
    const now = performance.now(), dt = (now - tickAt) / 1000; tickAt = now;
    const cursor = screen.getCursorScreenPoint();
    if (physics.mode === 'drag') {
      physics.targetX = cursor.x - dragOffset.x; physics.targetY = cursor.y - dragOffset.y;
      if (Math.abs(cursor.x - downCursor.x) + Math.abs(cursor.y - downCursor.y) > 4 && !moved) { moved = true; reaction('drag'); }
      if (Math.abs(physics.targetX - physics.x) + Math.abs(physics.targetY - physics.y) > 4) lastMovedAt = Date.now();
    }
    const oldMode = physics.mode;
    if (physics.mode !== 'walk' || videoReady) physics.step(dt, area(), now);
    if (oldMode === 'walk' && physics.mode === 'idle') { director.base(); play(); }
    const x = Math.round(physics.x), y = Math.round(physics.y); const b = pet.getBounds();
    if (b.x !== x || b.y !== y) pet.setPosition(x, y);
    if (ready) pet.webContents.send('pose', { x: cursor.x - x, y: cursor.y - y, squash: physics.squash, direction: physics.direction, heightAbove: Math.max(0, area().floor - y) });
    if (Date.now() > nextRandom && physics.mode === 'idle' && !chat.isVisible()) {
      const next = director.randomAction(); nextRandom = Date.now() + 1000 * (director.config.idleSeconds[0] + Math.random() * (director.config.idleSeconds[1] - director.config.idleSeconds[0]));
      if (next) { physics.direction = Math.random() < .5 ? -1 : 1; play(); }
    }
    if (Date.now() - lastInteract > 180000 && director.rest === 'awake' && physics.mode === 'idle' && director.presence === 'idle' && !chat.isVisible()) { director.sleep(); play(); }
  }, 16));
  timers.push(setInterval(() => { if (!pollRunning) { pollRunning = true; bridge.poll().then(replies => {
    for (const reply of replies) { messages.push(reply); pending.delete(reply.id); lastInteract = Date.now(); director.wake(); play(); }
    for (const [id, at] of pending) if (Date.now() - at > 120000) pending.delete(id);
    sendChat();
  }).catch(report).finally(() => { pollRunning = false; }); } }, 1000));
  timers.push(setInterval(() => { if (!statusRunning) { statusRunning = true; statusTick().catch(report).finally(() => { statusRunning = false; }); } }, 2000));
  timers.push(setInterval(() => heartbeat().catch(report), 30000)); await heartbeat();
  timers.push(setInterval(() => writeStats().catch(report), 60000));
  if (testMode) {
    Object.assign(globalThis, { aliceTest: {
      state: () => ({ action: director.current, rest: director.rest, mode: physics.mode, decodedFrames: totalFrames, videoReady, ignoringMouse, x: physics.x, y: physics.y }),
      play: (clip: string) => { if (!director.config.clips[clip]) throw Error('Unknown clip'); stopWalk(); director.play(clip, ['idle', 'walk', 'doze'].includes(clip), 'test'); play(); return lastClipToken; },
      playMove: () => { director.play('walk', true, 'moves'); play(); return lastClipToken; },
      pose: (direction: number) => { physics.mode = 'idle'; physics.direction = direction; pet.webContents.send('pose', { x: 0, y: 0, squash: 1, direction, heightAbove: 0 }); },
      sleep: () => { stopWalk(); director.sleep(); play(); },
      wake: () => { director.wake(); play(); },
      stats: writeStats
    } });
  }
}
async function heartbeat(): Promise<void> {
  if (ready && videoReady) await fs.writeFile(path.join(root, 'pet-heartbeat.txt'), new Date().toISOString());
}
async function statusTick(): Promise<void> {
  let state: Presence = 'idle'; presenceNote = '在岗';
  try {
    const p = JSON.parse((await fs.readFile(path.join(root, 'presence.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const age = Date.now() - Date.parse(p.ts);
    if (age >= -60000 && age < 720000 && ['idle', 'thinking', 'working', 'result', 'waiting', 'success', 'error'].includes(p.state)) {
      state = p.state;
      const names: Record<Presence, string> = { idle: '在岗', thinking: '思考中', working: '忙碌中', result: '整理中', waiting: '等待中', success: '已完成', error: '出问题了' };
      presenceNote = typeof p.note === 'string' && p.note.trim() ? p.note.slice(0, 200) : names[state];
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) report(e); }
  const previous = director.current; director.setPresence(state);
  if (previous !== director.current) { stopWalk(); play(); }
  tray.setToolTip(('艾莉丝 · ' + presenceNote).slice(0, 120)); sendChat();
  const stat = await fs.stat(configPath);
  if (stat.mtimeMs !== configStamp) { try { await loadConfig(); play(); } catch (e) { report(e); } }
}
async function writeStats(): Promise<void> {
  const metrics = app.getAppMetrics();
  const data = { ts: new Date().toISOString(), runtime: 'electron', diskLoads: 0, decodedFrames,
    intervalMs: Date.now() - metricsStamp, clip: director.current.clip, restState: director.rest,
    processCount: metrics.length, workingSetMB: metrics.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024,
    privateMB: metrics.reduce((n, p) => n + (p.memory.privateBytes ?? 0), 0) / 1024,
    processes: metrics.map(p => ({ type: p.type, pid: p.pid, workingSetMB: p.memory.workingSetSize / 1024 })) };
  await fs.writeFile(path.join(root, 'pet-stats.json'), JSON.stringify(data)); decodedFrames = 0; metricsStamp = Date.now();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) pet.showInactive(); });
  app.on('before-quit', () => { quitting = true; timers.forEach(clearInterval); });
  app.whenReady().then(setup).catch(e => { report(e); app.exit(1); });
}
