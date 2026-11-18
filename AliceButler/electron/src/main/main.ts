import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import fs from 'node:fs/promises';
import { atomicWrite, limits, loadPosition, Position, restore, snap } from './placement';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Bridge, Message } from './bridge';
import { Director, Physics, Presence, validateConfig } from './engine';

const launchAt = performance.now();
// Preserve Chromium's current default until the target Windows A/B is accepted.
if (process.env.ALICE_PET_ACCELERATION === 'off') app.disableHardwareAcceleration();
const root = process.env.ALICE_PET_ROOT || 'C:\\ProgramData\\AliceButler';
const testMode = process.env.ALICE_PET_TEST === '1';
const ui = path.join(__dirname, '../../ui');
const media = path.join(__dirname, '../../media');
const configPath = path.join(app.getAppPath(), 'config.json');
const bridge = new Bridge(root);
const physics = new Physics();
let pet: BrowserWindow, chat: BrowserWindow | undefined, tray: Tray, director: Director;
let chatLoading: Promise<void> | undefined, startupMs: number | null = null;
let suspended = false, lowActivityAt = 0, parkPending = false, hiddenByUser = false;
const DECODER_RELEASE_MS = 120000;
let chatReady = false, ready = false, quitting = false, videoReady = false;
let dragOffset = { x: 0, y: 0 }, downCursor = { x: 0, y: 0 }, downAt = 0, lastMovedAt = 0, moved = false;
let nextRandom = Date.now() + 50000, lastInteract = Date.now(), clickTimer: NodeJS.Timeout | undefined;
let messages: Message[] = [], presenceNote = '在岗', pending = new Map<string, number>();
let decodedFrames = 0, lastClipToken = 0, totalFrames = 0;
let pollRunning = false, statusRunning = false, tickAt = performance.now();
let configStamp: number | undefined, metricsStamp = Date.now();
let ignoringMouse = true;
let windowX = 0, windowY = 0, lastPose = '';
const timers: NodeJS.Timeout[] = [];
function report(error: unknown): void {
  console.error(error);
  fs.appendFile(path.join(root, 'pet-error.log'), `${new Date().toISOString()} ${String(error)}\n`).catch(() => {});
}
const statePath = path.join(root, 'pet-position.json');
let standing = false, desktop: Position, lastSaved = '', dragDirection = 0;
let configNotice = '', configNotified = false;
const unavailable = new Set<string>();
function monitor() {
  const point = physics.mode === 'drag' ? screen.getCursorScreenPoint() : { x: Math.round(physics.x + 266), y: Math.round(physics.y + 150) };
  return screen.getDisplayNearestPoint(point);
}
function area() { return limits(monitor(), standing); }
function position(): Position { return { display: monitor().id, x: physics.x, y: physics.y }; }
function savePosition(): void {
  if (!standing) desktop = position();
  const json = JSON.stringify({ standing, desktop, position: position() });
  if (lastSaved !== json) { atomicWrite(statePath, json); lastSaved = json; }
}
function place(pos: Position | undefined): void {
  const result = restore(pos, screen.getAllDisplays(), screen.getPrimaryDisplay(), standing);
  physics.mode = 'idle'; physics.vx = physics.vy = 0;
  physics.x = result.x; physics.y = result.y;
}
function setStanding(enabled: boolean): void {
  const previous = position();
  if (enabled) desktop = previous;
  standing = enabled; place(enabled ? previous : desktop);
  director.base(); play(); savePosition(); tray.setContextMenu(menu());
}
function followChat(window: BrowserWindow): void {
  const bounds = pet.getBounds(), a = monitor().workArea;
  window.setPosition(Math.round(Math.max(a.x, Math.min(a.x + a.width - 372, bounds.x + bounds.width / 2 - 186))),
    Math.round(Math.max(a.y, Math.min(a.y + a.height - 500, bounds.y - 460))));
}
function notifyConfig(): void {
  if (tray && configNotice && !configNotified) {
    configNotified = true; tray.displayBalloon({ title: '艾莉丝 · 配置已恢复', content: configNotice });
  }
}
function sendChat(): void {
  if (chatReady && chat) chat.webContents.send('chat-state', { messages: messages.slice(-200), note: presenceNote,
    pending: [...pending.entries()].map(([id, at]) => ({ id, stage: Date.now() - at < 2000 ? '已收到' : '思考中' })) });
}
function play(): void {
  if (!ready) return;
  if (unavailable.has(director.current.clip)) {
    const fallback = ['idle', ...Object.keys(director.config.clips)].find(id => director.config.clips[id] && !unavailable.has(id));
    if (!fallback) { report('No playable clip remains'); return; }
    director.rest = 'awake'; stopWalk(); director.play(fallback, true, 'idle');
  }
  const action = director.current;
  const clip = director.config.clips[action.clip];
  if (!clip) return;
  // Keep a hidden pet parked; waking a visible sleeping pet resumes immediately.
  if (suspended && hiddenByUser) return;
  suspended = false; parkPending = false;
  videoReady = false;
  pet.webContents.send('play', { ...action, token: ++lastClipToken, url: pathToFileURL(path.join(media, clip.file)).href,
    facing: clip.facing ?? 'right', direction: physics.direction });
}
function stopWalk(): void { if (physics.mode === 'walk') physics.mode = 'idle'; }
function reaction(kind: 'clicks' | 'drag' | 'turn' | 'moves'): void {
  if (kind !== 'moves') stopWalk();
  director.react(kind); play();
}
async function ensureChat(): Promise<BrowserWindow> {
  if (!chat) {
    chat = new BrowserWindow({ ...windowOptions(), width: 372, height: 500, transparent: true, title: '和艾莉丝说话' });
    secureWindow(chat);
    chatLoading = chat.loadFile(path.join(ui, 'chat.html'));
  }
  await chatLoading; return chat;
}
async function toggleChat(): Promise<void> {
  if (chat?.isVisible()) { chat.hide(); return; }
  const window = await ensureChat();
  followChat(window);
  window.show(); window.focus(); sendChat();
}
async function purposefulExit(): Promise<void> {
  atomicWrite(path.join(root, 'pet-disabled.flag'), new Date().toISOString());
  quitting = true; app.quit();
}
let backups: string[] = [];
async function refreshBackups(): Promise<void> {
  const dir = path.join(root, 'deploy-backups');
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(e => {
    if (e.code === 'ENOENT') return []; throw e;
  });
  const dated = await Promise.all(entries.filter(e => e.isDirectory() && /^\d{14}-[0-9a-f]{8}$/.test(e.name))
    .map(async e => ({ id: e.name, time: (await fs.stat(path.join(dir, e.name))).birthtimeMs })));
  backups = dated.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id)).slice(0, 3).map(x => x.id);
}
function rollback(id: string): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  // The installed helper runs outside Electron so Windows can release the executable.
  // PowerShell 7 and the existing scheduled task are deployment prerequisites.
  const helper = path.join(app.getAppPath(), 'rollback.ps1').replace(/'/g, "''");
  const command = `Start-Process pwsh.exe -Verb RunAs -ArgumentList '-NoProfile -File "${helper}" -BackupId ${id}'`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
  child.on('error', report);
  child.on('exit', code => { if (code) report('Rollback helper launch failed: ' + code); });
}
function menu(): Menu {
  return Menu.buildFromTemplate([
    { label: '和艾莉丝说话', click: () => { toggleChat().catch(report); } },
    { label: director?.rest === 'awake' ? '睡一会儿' : '起来', click: () => { stopWalk(); if (director.rest === 'awake') director.sleep(); else director.wake(); play(); } },
    { label: '任务栏站立', type: 'checkbox', checked: standing, click: item => setStanding(item.checked) },
    { label: '跳一下', click: () => { stopWalk(); physics.mode = 'air'; physics.vy = -330; physics.vx = 0; } },
    { label: '回到原位', click: () => { physics.mode = 'idle'; physics.x = area().right - 30; physics.y = area().floor; } },
    { label: pet?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => pet.isVisible() ? pet.hide() : pet.showInactive() },
    { label: '回滚上一版', enabled: backups.length > 0, submenu: backups.map(id => ({ label: id, click: () => rollback(id) })) },
    { label: '重载动作配置', click: () => loadConfig().then(play).catch(report) },
    { type: 'separator' }, { label: '退出桌宠', click: () => purposefulExit().catch(report) }
  ]);
}
async function loadConfig(): Promise<void> {
  let config;
  try { config = validateConfig(JSON.parse(await fs.readFile(configPath, 'utf8'))); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    const backup = path.join(root, 'config.json.bad-' + Date.now());
    if (!missing) await fs.copyFile(configPath, backup).catch(e => { if (!['EACCES', 'EPERM'].includes(e.code)) throw e; report(e); });
    const defaults = await fs.readFile(path.join(app.getAppPath(), 'defaults.json'), 'utf8');
    config = validateConfig(JSON.parse(defaults));
    try { atomicWrite(configPath, defaults); }
    catch (e) { if (!['EACCES', 'EPERM', 'EROFS'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    configNotice = missing ? '配置缺失，已使用内置默认值。' : '读取配置失败，已启用内置默认值。';
    report(error); notifyConfig();
  }
  unavailable.clear();
  if (director) { director.config = config; director.base(); }
  else { director = new Director(config); director.base(); }
  configStamp = (await fs.stat(configPath).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; }))?.mtimeMs;
}
function trusted(sender: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, which: BrowserWindow | undefined): boolean {
  return !!which && sender.sender === which.webContents && sender.senderFrame === which.webContents.mainFrame;
}
function windowOptions() {
  return { frame: false, show: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } };
}
function secureWindow(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', event => event.preventDefault());
  w.on('close', event => { if (!quitting) { event.preventDefault(); w.hide(); } });
  w.webContents.on('render-process-gone', (_e, details) => { report(`renderer lost: ${details.reason}`); quitting = true; app.exit(1); });
}
function parkPlayback(): void {
  if (!ready || suspended || parkPending) return;
  parkPending = true; pet.webContents.send('suspend-playback');
}
async function trimPlaybackMemory(): Promise<void> {
  // Ask Chromium to reclaim caches after sources have been detached. Never force
  // GC on a frame/drag path, and never detach a debugger owned by another client.
  const debug = pet.webContents.debugger;
  if (debug.isAttached()) return;
  try {
    debug.attach('1.3');
    await debug.sendCommand('Memory.simulatePressureNotification', { level: 'critical' });
  } finally { if (debug.isAttached()) debug.detach(); }
}
async function setup(): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await loadConfig();
  pet = new BrowserWindow({ ...windowOptions(), width: 533, height: 300, transparent: true, hasShadow: false, title: '艾莉丝桌宠' });
  secureWindow(pet);
  pet.on('hide', () => { hiddenByUser = true; });
  pet.on('show', () => { hiddenByUser = false; lowActivityAt = 0; if (suspended || parkPending) play(); });
  const saved = loadPosition(statePath);
  standing = saved?.standing ?? false;
  place(saved?.position); desktop = saved?.desktop ?? position();
  windowX = Math.round(physics.x); windowY = Math.round(physics.y);
  pet.setBounds({ x: windowX, y: windowY, width: 533, height: 300 });
  pet.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on('renderer-ready', event => {
    if (!trusted(event, pet)) return;
    ready = true; play();
  });
  ipcMain.on('chat-ready', event => { if (trusted(event, chat)) { chatReady = true; sendChat(); } });
  ipcMain.on('chat-close', event => { if (trusted(event, chat)) chat?.hide(); });
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
    if (startupMs === null) { startupMs = performance.now() - launchAt; if (!testMode) pet.showInactive(); }
    if (director.current.kind === 'moves' && physics.mode === 'idle') {
      const bounds = area(); physics.targetX = Math.max(bounds.left, Math.min(bounds.right, physics.x + physics.direction * (60 + Math.random() * 220)));
      physics.mode = 'walk';
    }
    try { await fs.rm(path.join(root, 'pet-disabled.flag'), { force: true }); atomicWrite(path.join(root, 'pet-start.log'), `electron video ok ${new Date().toISOString()}\n`); } catch (e) { report(e); }
  });
  ipcMain.on('playback-suspended', event => {
    if (!trusted(event, pet) || !parkPending) return;
    parkPending = false; suspended = true; trimPlaybackMemory().catch(report);
  });
  ipcMain.on('video-error', (event, message: unknown, token?: number) => {
    if (!trusted(event, pet)) return;
    report(`video: ${String(message).slice(0, 500)}`);
    if (token === lastClipToken) { unavailable.add(director.current.clip); play(); }
  });
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
      dragDirection = 0; downAt = now; downCursor = cursor; lastMovedAt = now; moved = false;
      dragOffset = { x: cursor.x - physics.x, y: cursor.y - physics.y };
      physics.vx = physics.vy = 0; physics.mode = 'drag';
      if (director.rest !== 'awake') { director.wake(); play(); }
    } else if (type === 'up' && physics.mode === 'drag') {
      lastInteract = now;
      if (!moved && now - downAt < 400) {
        physics.mode = 'idle';
        clickTimer = setTimeout(() => { reaction('clicks'); toggleChat().catch(report); clickTimer = undefined; }, 260);
      } else {
        const edge = snap(physics.x, physics.y, area());
        if (edge || standing) {
          physics.mode = 'idle'; physics.vx = physics.vy = 0;
          if (edge) { physics.x = edge.x; physics.y = edge.y; }
          if (standing) physics.y = area().floor;
        } else physics.release(now - lastMovedAt > 150);
        director.base(); play();
      }
      dragDirection = 0;
    } else if (type === 'double') {
      if (clickTimer) clearTimeout(clickTimer); clickTimer = undefined;
      director.wake(); director.base(); play();
      physics.mode = 'air'; physics.vx = 0; physics.vy = -330;
    } else if (type === 'menu') menu().popup({ window: pet });
  });
  pet.on('blur', () => { if (physics.mode === 'drag') { physics.release(true); director.base(); play(); } });
  await pet.loadFile(path.join(ui, 'pet.html'));
  messages = await bridge.history();
  tray = new Tray(nativeImage.createFromPath(path.join(ui, 'avatar.ico')));
  await refreshBackups();
  tray.setToolTip('艾莉丝 · 在岗'); tray.setContextMenu(menu()); tray.on('double-click', () => { toggleChat().catch(report); });
  notifyConfig();
  // A deploy or rollback restarts the pet and refreshes the backup list.

  screen.on('display-removed', (_event, removed) => {
    const saved = loadPosition(statePath);
    if (saved?.position.display === removed.id) place(undefined);
  });
  screen.on('display-metrics-changed', () => { physics.x = Math.max(area().left, Math.min(area().right, physics.x)); physics.y = Math.min(area().floor, physics.y); });
  timers.push(setInterval(() => {
    const now = performance.now(), dt = (now - tickAt) / 1000; tickAt = now;
    const cursor = screen.getCursorScreenPoint();
    if (physics.mode === 'drag') {
      physics.targetX = cursor.x - dragOffset.x; physics.targetY = cursor.y - dragOffset.y;
      if (Math.abs(cursor.x - downCursor.x) + Math.abs(cursor.y - downCursor.y) > 4 && !moved) { moved = true; reaction('drag'); }
      if (Math.abs(physics.targetX - physics.x) + Math.abs(physics.targetY - physics.y) > 4) lastMovedAt = Date.now();
    }
    const oldMode = physics.mode, bounds = area();
    if (physics.mode !== 'walk' || videoReady) physics.step(dt, bounds, now);
    if (standing && physics.mode !== 'drag') { physics.y = bounds.floor; if (physics.mode === 'air') physics.mode = 'idle'; }
    if (physics.mode === 'drag' && moved && Math.abs(physics.vx) > 110) {
      dragDirection = Math.sign(physics.vx);
      if (director.current.kind !== 'drag.walk' && !unavailable.has('walk') && director.config.clips.walk) {
        director.play('walk', true, 'drag.walk'); play();
      }
    }
    if (oldMode === 'walk' && physics.mode === 'idle') { director.base(); play(); }
    const x = Math.round(physics.x), y = Math.round(physics.y);
    if (windowX !== x || windowY !== y) { pet.setPosition(x, y); windowX = x; windowY = y; if (chat?.isVisible()) followChat(chat); }
    const pose = { x: cursor.x - x, y: cursor.y - y, squash: physics.squash, direction: physics.mode === 'drag' && dragDirection ? dragDirection : physics.direction, dragging: physics.mode === 'drag', heightAbove: Math.max(0, bounds.floor - y) };
    const key = JSON.stringify(pose);
    if (ready && (!suspended || (pet.isVisible() && key !== lastPose))) pet.webContents.send('pose', pose);
    lastPose = key;
    if (Date.now() > nextRandom && physics.mode === 'idle') {
      const next = director.randomAction(); nextRandom = Date.now() + 1000 * (director.config.idleSeconds[0] + Math.random() * (director.config.idleSeconds[1] - director.config.idleSeconds[0]));
      if (next) { physics.direction = Math.random() < .5 ? -1 : 1; play(); }
    }
    if (Date.now() - lastInteract > 180000 && director.rest === 'awake' && physics.mode === 'idle' && director.presence === 'idle' && !chat?.isVisible()) { director.sleep(); play(); }
  }, 16));
  timers.push(setInterval(() => {
    if (physics.mode === 'idle') savePosition();
    const lowActivity = director.rest === 'asleep' || hiddenByUser;
    if (!lowActivity) lowActivityAt = 0;
    else if (!lowActivityAt) lowActivityAt = Date.now();
    else if (Date.now() - lowActivityAt >= DECODER_RELEASE_MS) parkPlayback();
  }, 1000));
  timers.push(setInterval(() => { if (!pollRunning) { pollRunning = true; bridge.poll().then(replies => {
    for (const reply of replies) { messages.push(reply); pet.webContents.send('bubble', reply.text); pending.delete(reply.id); lastInteract = Date.now(); director.wake(); play(); }
    for (const [id, at] of pending) if (Date.now() - at > 120000) pending.delete(id);
    sendChat();
  }).catch(report).finally(() => { pollRunning = false; }); } }, 1000));
  timers.push(setInterval(() => { if (!statusRunning) { statusRunning = true; statusTick().catch(report).finally(() => { statusRunning = false; }); } }, 2000));
  timers.push(setInterval(() => heartbeat().catch(report), 30000)); await heartbeat();
  timers.push(setInterval(() => writeStats().catch(report), 60000));
  if (testMode) {
    Object.assign(globalThis, { aliceTest: {
      menu: () => menu(),
      state: () => ({ standing, configNotified, action: director.current, token: lastClipToken, rest: director.rest, mode: physics.mode, decodedFrames: totalFrames, videoReady, ignoringMouse, suspended, startupMs, x: physics.x, y: physics.y }),
      play: (clip: string) => { if (!director.config.clips[clip]) throw Error('Unknown clip'); stopWalk(); director.play(clip, ['idle', 'walk', 'doze'].includes(clip), 'test'); play(); return lastClipToken; },
      playMove: () => { director.play('walk', true, 'moves'); play(); return lastClipToken; },
      pose: (direction: number) => { physics.mode = 'idle'; physics.direction = direction; pet.webContents.send('pose', { x: 0, y: 0, squash: 1, direction, heightAbove: 0 }); },
      sleep: () => { stopWalk(); director.sleep(); play(); },
      wake: () => { director.wake(); play(); },
      openChat: ensureChat,
      park: parkPlayback,
      resume: play,
      hide: () => { pet.showInactive(); pet.hide(); },
      show: () => pet.showInactive(),
      ageLowActivity: (ms: number) => { lowActivityAt = Date.now() - ms; },
      stats: writeStats
    } });
  }
}
async function heartbeat(): Promise<void> {
  if (ready && videoReady) atomicWrite(path.join(root, 'pet-heartbeat.txt'), new Date().toISOString());
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
  const stat = await fs.stat(configPath).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
  if (stat?.mtimeMs !== configStamp) { try { await loadConfig(); play(); } catch (e) { report(e); } }
}
async function writeStats(): Promise<void> {
  const metrics = app.getAppMetrics();
  const data = { ts: new Date().toISOString(), runtime: 'electron', diskLoads: 0, decodedFrames,
    intervalMs: Date.now() - metricsStamp, clip: director.current.clip, restState: director.rest,
    processCount: metrics.length, workingSetMB: metrics.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024,
    privateMB: metrics.every(p => typeof p.memory.privateBytes === 'number') ? metrics.reduce((n, p) => n + p.memory.privateBytes!, 0) / 1024 : null,
    cpuPercent: metrics.reduce((n, p) => n + p.cpu.percentCPUUsage, 0), startupMs, suspended,
    acceleration: process.env.ALICE_PET_ACCELERATION === 'off' ? 'off' : 'on',
    processes: metrics.map(p => ({ type: p.type, pid: p.pid, workingSetMB: p.memory.workingSetSize / 1024 })) };
  atomicWrite(path.join(root, 'pet-stats.json'), JSON.stringify(data)); decodedFrames = 0; metricsStamp = Date.now();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) { if (pet.isMinimized()) pet.restore(); pet.show(); pet.focus(); } });
  app.on('before-quit', () => { quitting = true; if (pet && desktop) savePosition(); timers.forEach(clearInterval); });
  app.whenReady().then(setup).catch(e => { report(e); app.exit(1); });
}
