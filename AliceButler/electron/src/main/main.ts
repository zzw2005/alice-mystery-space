import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { RunStats } from './run-stats';
import { atomicWrite, limits, loadPosition, Position, restore, snap } from './placement';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Absence, Gestures } from './gestures';
import { Bridge, Message } from './bridge';
import { Action, Director, Physics, Presence, validateConfig } from './engine';

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
let chatReady = false, ready = false, quitting = false, videoReady = false;
let dragOffset = { x: 0, y: 0 }, downCursor = { x: 0, y: 0 }, downAt = 0, lastMovedAt = 0, moved = false;
let clickTimer: NodeJS.Timeout | undefined, lastLoggedAction: Action | undefined;
let messages: Message[] = [], presenceNote = '在岗', pending = new Map<string, number>();
let decodedFrames = 0, lastClipToken = 0, totalFrames = 0;
let pollRunning = false, statusRunning = false, tickAt = performance.now();
let configStamp: number | undefined, metricsStamp = Date.now();
const sessionId = randomUUID();
const statsPath = path.join(root, 'pet-stats.json');
let runStats: RunStats, lastReclaimAt = -Infinity, guardBefore: number | undefined;
let lastReclaim: { beforeMiB: number; afterMiB: number | null; at: string } | undefined;
let probeDay = '', healthWarning = false;
let sampledStats: Record<string, unknown>;
let ignoringMouse = true;
let windowX = 0, windowY = 0, lastPose = '';
const timers: NodeJS.Timeout[] = [];
function report(error: unknown): void {
  console.error(error);
  fs.appendFile(path.join(root, 'pet-error.log'), `${new Date().toISOString()} ${String(error)}\n`).catch(() => {});
}
const statePath = path.join(root, 'pet-position.json');
let standing = false, desktop: Position, lastSaved = '';
const gestures = new Gestures(), absence = new Absence();
let approached = false;
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
  const result = restore(pos, screen.getAllDisplays(), screen.getPrimaryDisplay(), standing, director.config.tuning);
  director.endHold();
  physics.mode = 'idle'; physics.vx = physics.vy = 0;
  physics.x = result.x; physics.y = result.y;
}
function setStanding(enabled: boolean): void {
  const previous = position();
  if (enabled) desktop = previous;
  standing = enabled; place(enabled ? previous : desktop);
  director.base(); play('placement'); savePosition(); tray.setContextMenu(menu());
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
  if (chatReady && chat) chat.webContents.send('chat-state', { messages: messages.slice(-director.config.tuning.chatRows), note: presenceNote, tuning: director.config.tuning,
    pending: [...pending.entries()].map(([id, at]) => ({ id, stage: Date.now() - at < director.config.tuning.pendingThinkMs ? '已收到' : '思考中' })) });
}
function play(source: string): void {
  if (!ready) return;
  if (unavailable.has(director.current.clip)) {
    const fallback = ['idle', ...Object.keys(director.config.clips)].find(id => director.config.clips[id] && !unavailable.has(id));
    if (!fallback) { report('No playable clip remains'); return; }
    director.rest = 'awake'; stopWalk(); director.play(fallback, true, 'idle');
    source = 'media-fallback';
  }
  const action = director.current;
  const clip = director.config.clips[action.clip];
  if (!clip) return;
  if (lastLoggedAction !== action) {
    runStats.recordTrigger(source, action.clip, { kind: action.kind, rest: director.rest,
      presence: director.presence, motion: physics.mode, chatOpen: chat?.isVisible() ?? false });
    lastLoggedAction = action;
  }
  // Keep a hidden pet parked; waking a visible sleeping pet resumes immediately.
  if (suspended && hiddenByUser) return;
  suspended = false; parkPending = false;
  videoReady = false;
  pet.webContents.send('play', { ...action, tuning: director.config.tuning, token: ++lastClipToken, url: pathToFileURL(path.join(media, clip.file)).href,
    facing: clip.facing ?? 'right', direction: physics.direction });
}
function stopWalk(): void { if (physics.mode === 'walk') physics.mode = 'idle'; }
function gesture(clip: 'wave' | 'sitdown' | 'startled' | 'peek', source: string): void {
  stopWalk(); director.interact(Date.now()); director.gesture(clip); play(source);
}
function wakeFromInteraction(source: string, now = Date.now()): void {
  director.interact(now);
  const previous = director.current;
  if (director.wake() !== previous) play(source);
}
async function ensureChat(): Promise<BrowserWindow> {
  if (!chat) {
    chat = new BrowserWindow({ ...windowOptions(), width: 372, height: 500, transparent: true, title: '和艾莉丝说话' });
    secureWindow(chat);
    chat.on('hide', () => director.interact(Date.now()));
    chatLoading = chat.loadFile(path.join(ui, 'chat.html'));
  }
  await chatLoading; return chat;
}
async function toggleChat(): Promise<void> {
  if (chat?.isVisible()) { chat.hide(); return; }
  const window = await ensureChat();
  followChat(window);
  window.show(); window.focus(); sendChat();
  wakeFromInteraction('chat-open');
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
    { label: director?.rest === 'awake' ? '睡一会儿' : '起来', click: () => {
      stopWalk();
      if (director.rest === 'awake') { director.interact(Date.now()); director.sleep(); play('menu-sleep'); }
      else wakeFromInteraction('menu-wake');
    } },
    { label: '任务栏站立', type: 'checkbox', checked: standing, click: item => setStanding(item.checked) },
    { label: '跳一下', click: () => { stopWalk(); physics.mode = 'air'; physics.vy = -330; physics.vx = 0; } },
    { label: '回到原位', click: () => { physics.mode = 'idle'; physics.x = area().right - director.config.tuning.homeInsetPx; physics.y = area().floor; } },
    { label: pet?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => pet.isVisible() ? pet.hide() : pet.showInactive() },
    { label: '回滚上一版', enabled: backups.length > 0, submenu: backups.map(id => ({ label: id, click: () => rollback(id) })) },
    { label: '重载动作配置', click: () => loadConfig().then(() => play('config-reload')).catch(report) },
    { type: 'separator' }, { label: '退出桌宠', click: () => purposefulExit().catch(report) }
  ]);
}
async function loadConfig(): Promise<void> {
  let config;
  const defaults = await fs.readFile(path.join(app.getAppPath(), 'defaults.json'), 'utf8');
  try {
    const input = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (input && input.interaction === undefined && input.clips && input.animations) {
      const builtIn = JSON.parse(defaults);
      input.interaction = builtIn.interaction;
      input.clips = { ...builtIn.clips, ...input.clips };
      if (input.animations.drag?.length === 1 && input.animations.drag[0].provisional)
        input.animations.drag = builtIn.animations.drag;
    }
    config = validateConfig(input);
    for (const id of ['dangle', 'sitdown', 'peek', 'startled', 'idle', 'wave'])
      if (!config.clips[id]) throw Error('Missing interaction clip: ' + id);
  }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    const backup = path.join(root, 'config.json.bad-' + Date.now());
    if (!missing) await fs.copyFile(configPath, backup).catch(e => { if (!['EACCES', 'EPERM'].includes(e.code)) throw e; report(e); });
    config = validateConfig(JSON.parse(defaults));
    try { atomicWrite(configPath, defaults); }
    catch (e) { if (!['EACCES', 'EPERM', 'EROFS'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    configNotice = missing ? '配置缺失，已使用内置默认值。' : '读取配置失败，已启用内置默认值。';
    report(error); notifyConfig();
  }
  unavailable.clear();
  if (director) { director.config = config; director.base(); gestures.resetClicks(); }
  else { director = new Director(config); director.base(); }
  bridge.tuning = config.tuning;
  if (timers.length) startTimers();
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
async function trimPlaybackMemory(highWater = false): Promise<void> {
  // Ask Chromium to reclaim caches after sources have been detached. Never force
  // GC on a frame/drag path, and never detach a debugger owned by another client.
  const debug = pet.webContents.debugger;
  if (debug.isAttached()) return;
  try {
    debug.attach('1.3');
    if (highWater) await debug.sendCommand('HeapProfiler.collectGarbage');
    await debug.sendCommand('Memory.simulatePressureNotification', { level: highWater ? 'moderate' : 'critical' });
  } finally { if (debug.isAttached()) debug.detach(); }
}
async function setup(): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  runStats = new RunStats(statsPath);
  await loadConfig();
  pet = new BrowserWindow({ ...windowOptions(), width: 533, height: 300, transparent: true, hasShadow: false, title: '艾莉丝桌宠' });
  secureWindow(pet);
  pet.on('hide', () => { hiddenByUser = true; });
  pet.on('show', () => { hiddenByUser = false; lowActivityAt = 0; if (suspended || parkPending) play('resume'); });
  const back = (reason: string) => { if (absence.back(reason, Date.now(), director.config.interaction.awayMs)) gesture('wave', 'desktop-return'); };
  powerMonitor.on('lock-screen', () => absence.leave('lock', Date.now()));
  powerMonitor.on('unlock-screen', () => back('lock'));
  pet.on('minimize', () => absence.leave('minimize', Date.now()));
  pet.on('restore', () => back('minimize'));
  const saved = loadPosition(statePath);
  standing = saved?.standing ?? false;
  place(saved?.position); desktop = saved?.desktop ?? position();
  windowX = Math.round(physics.x); windowY = Math.round(physics.y);
  pet.setBounds({ x: windowX, y: windowY, width: 533, height: 300 });
  pet.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on('renderer-ready', event => {
    if (!trusted(event, pet)) return;
    ready = true; play('startup');
  });
  ipcMain.on('chat-ready', event => { if (trusted(event, chat)) { chatReady = true; sendChat(); } });
  ipcMain.on('chat-close', event => { if (trusted(event, chat)) chat?.hide(); });
  ipcMain.handle('chat-send', async (event, text: unknown) => {
    if (!trusted(event, chat)) throw Error('Invalid sender');
    const msg = await bridge.send(text); messages.push(msg); pending.set(msg.id, Date.now()); sendChat(); wakeFromInteraction('chat-send');
    return msg.id;
  });
  ipcMain.on('hit', (event, hit: unknown) => {
    if (trusted(event, pet) && typeof hit === 'boolean' && physics.mode !== 'drag' && ignoringMouse === hit) {
      if (!hit) {
        gestures.leave();
        if (director.current.kind === 'peek') { director.base(); play('hover-exit'); }
      }
      ignoringMouse = !hit; pet.setIgnoreMouseEvents(ignoringMouse, { forward: true });
    }
  });
  ipcMain.on('frame', (event, value: unknown) => {
    if (trusted(event, pet) && typeof value === 'number' && value > 0 && value <= Math.ceil(240 * director.config.tuning.frameReportMs / 1000)) { decodedFrames += value; totalFrames += value; }
  });
  ipcMain.on('video-ready', async (event, token: unknown, started: unknown) => {
    if (!trusted(event, pet) || token !== lastClipToken) return;
    videoReady = true;
    const day = runStats.today();
    if (started === true) day.plays[director.current.clip] = (day.plays[director.current.clip] ?? 0) + 1;
    if (runStats.recoveryPending) { day.recoveries++; runStats.recoveryPending = false; }
    persistStats();
    if (startupMs === null) await heartbeat();
    if (startupMs === null) { startupMs = performance.now() - launchAt; if (!testMode) pet.showInactive(); }
    if (director.current.kind === 'moves' && physics.mode === 'idle') {
      const bounds = area(); physics.targetX = Math.max(bounds.left, Math.min(bounds.right, physics.x + physics.direction * (director.config.tuning.walkMinPx + Math.random() * director.config.tuning.walkExtraPx)));
      physics.mode = 'walk';
    }
    try { await fs.rm(path.join(root, 'pet-disabled.flag'), { force: true }); atomicWrite(path.join(root, 'pet-start.log'), `electron video ok ${new Date().toISOString()}\n`); } catch (e) { report(e); }
  });
  ipcMain.on('probed', (event, day, clips) => {
    if (!trusted(event, pet) || day !== probeDay) return;
    if (!clips || Object.keys(director.config.clips).some(id => typeof clips[id] !== 'string')) return;
    atomicWrite(path.join(root, 'pet-decode-check.json'), JSON.stringify({ day, clips }));
  });
  ipcMain.on('reclaimed', async event => {
    if (!trusted(event, pet) || guardBefore === undefined) return;
    try {
      await trimPlaybackMemory(true);
      await delay(director.config.tuning.maintenanceMs);
      const after = memorySample(app.getAppMetrics());
      lastReclaim = { beforeMiB: guardBefore, afterMiB: after.privateMiB, at: new Date().toISOString() };
      await writeStats();
    } catch (error) { report(error); }
    finally { guardBefore = undefined; if (!pet.isDestroyed()) pet.webContents.send('reclaim-done'); }
  });
  ipcMain.on('playback-suspended', event => {
    if (!trusted(event, pet) || !parkPending) return;
    parkPending = false; suspended = true; trimPlaybackMemory().catch(report);
  });
  ipcMain.on('video-error', (event, message: unknown, token?: number) => {
    if (!trusted(event, pet)) return;
    report(`video: ${String(message).slice(0, 500)}`);
    if (token === lastClipToken) { unavailable.add(director.current.clip); play('media-fallback'); }
  });
  ipcMain.on('ended', (event, token: unknown) => {
    if (!trusted(event, pet) || token !== lastClipToken) return;
    if (director.current.kind === 'turn') physics.direction *= -1;
    director.ended(); play('animation-end');
  });
  ipcMain.on('pet-pointer', (event, type: unknown) => {
    if (!trusted(event, pet)) return;
    const now = Date.now(); const cursor = screen.getCursorScreenPoint();
    if (type === 'down') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = undefined; }
      approached = gestures.press(now, director.config.interaction);
      if (director.current.kind === 'peek') { director.base(); play('click'); }
      downAt = now; downCursor = cursor; lastMovedAt = now; moved = false;
      dragOffset = { x: cursor.x - physics.x, y: cursor.y - physics.y };
      physics.vx = physics.vy = 0; physics.mode = 'drag';
      director.beginHold(now); wakeFromInteraction('pointer-wake', now);
    } else if (type === 'up') {
      director.endHold();
      if (physics.mode !== 'drag') return;
      director.interact(now);
      if (!moved && now - downAt < director.config.tuning.clickHoldMs) {
        physics.mode = 'idle';
        // Count confirmed singles at release time, after the double-click window.
        clickTimer = setTimeout(() => {
          clickTimer = undefined;
          const combo = gestures.singleClick(now, director.config.triggers);
          if (!combo && approached && gestures.allowStartle(now, director.config.interaction)) gesture('startled', 'click-startle');
          else if (director.rest === 'awake') { director.click(combo); play(combo ? 'click-combo' : 'click'); }
          else wakeFromInteraction('pointer-wake');
          toggleChat().catch(report);
        }, director.config.tuning.doubleClickMs);
      } else {
        gestures.resetClicks();
        const edge = snap(physics.x, physics.y, area(), director.config.tuning);
        if (edge || standing) {
          physics.mode = 'idle'; physics.vx = physics.vy = 0;
          if (edge) { physics.x = edge.x; physics.y = edge.y; }
          if (standing) physics.y = area().floor;
        } else physics.release(now - lastMovedAt > director.config.tuning.releaseStaleMs, director.config.tuning);
        director.base(); play('drag-release');
      }
    } else if (type === 'double') {
      if (clickTimer) clearTimeout(clickTimer); clickTimer = undefined;
      director.endHold(); gestures.resetClicks();
      physics.mode = 'idle'; physics.vx = physics.vy = 0; gesture('wave', 'double-click');
    } else if (type === 'menu') menu().popup({ window: pet });
  });
  pet.on('blur', () => {
    director.endHold();
    if (physics.mode !== 'drag') return;
    director.interact(Date.now()); gestures.resetClicks();
    physics.release(true, director.config.tuning); director.base(); play('drag-release');
  });
  writeStats();
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
  startTimers(); await heartbeat();
  if (testMode) {
    Object.assign(globalThis, { aliceTest: {
      tuning: () => director.config.tuning,
      menu: () => menu(),
      state: () => ({ standing, configNotified, action: director.current, token: lastClipToken, rest: director.rest, mode: physics.mode, decodedFrames: totalFrames, videoReady, ignoringMouse, suspended, startupMs, x: physics.x, y: physics.y }),
      play: (clip: string) => { if (!director.config.clips[clip]) throw Error('Unknown clip'); stopWalk(); director.play(clip, ['idle', 'walk', 'doze', 'dangle'].includes(clip), 'test'); play('test'); return lastClipToken; },
      playMove: () => { director.play('walk', true, 'moves'); play('test'); return lastClipToken; },
      pose: (direction: number) => { physics.mode = 'idle'; physics.direction = direction; pet.webContents.send('pose', { x: 0, y: 0, squash: 1, direction, heightAbove: 0 }); },
      sleep: () => { stopWalk(); director.sleep(); play('test'); },
      wake: () => { director.wake(); play('test'); },
      openChat: ensureChat,
      park: parkPlayback,
      resume: () => play('resume'),
      hide: () => { pet.showInactive(); pet.hide(); },
      show: () => pet.showInactive(),
      ageLowActivity: (ms: number) => { lowActivityAt = Date.now() - ms; },
      healthWarning: () => healthWarning,
      stats: writeStats
    } });
  }
}
function startTimers(): void {
  timers.splice(0).forEach(clearInterval);
  const tuning = director.config.tuning;
  timers.push(setInterval(() => {
    const now = performance.now(), dt = (now - tickAt) / 1000; tickAt = now;
    const wallNow = Date.now();
    const cursor = screen.getCursorScreenPoint();
    if (physics.mode === 'drag') {
      physics.targetX = cursor.x - dragOffset.x; physics.targetY = cursor.y - dragOffset.y;
      if (Math.abs(cursor.x - downCursor.x) + Math.abs(cursor.y - downCursor.y) > tuning.dragDistancePx && !moved) {
        moved = true; director.react('drag'); play('drag');
      }
      if (Math.abs(physics.targetX - physics.x) + Math.abs(physics.targetY - physics.y) > tuning.dragDistancePx) lastMovedAt = wallNow;
    }
    const oldMode = physics.mode, bounds = area();
    const cfg = director.config.interaction;
    if (physics.mode !== 'walk' || videoReady) {
      const hardLanding = physics.step(dt, bounds, now, cfg, tuning);
      if (hardLanding && !standing) gesture('sitdown', 'landing');
    }
    if (standing && physics.mode !== 'drag') { physics.y = bounds.floor; if (physics.mode === 'air') physics.mode = 'idle'; }
    if (physics.mode !== 'drag' && gestures.sample(cursor, { x: physics.x + 266, y: physics.y + 150 }, !ignoringMouse,
        pet.isVisible() && physics.mode === 'idle' && director.rest === 'awake' && director.current.kind === 'idle',
        wallNow, cfg)) gesture('peek', 'hover-peek');
    if (oldMode === 'walk' && physics.mode === 'idle') { director.base(); play('walk-end'); }
    const x = Math.round(physics.x), y = Math.round(physics.y);
    if (windowX !== x || windowY !== y) { pet.setPosition(x, y); windowX = x; windowY = y; if (chat?.isVisible()) followChat(chat); }
    const pose = { x: cursor.x - x, y: cursor.y - y, squash: physics.squash, direction: director.current.kind === 'peek' ? gestures.direction : physics.direction,
      tilt: physics.mode === 'drag' && moved ? Math.max(-1, Math.min(1, physics.vx / cfg.dragTiltSpeed)) * cfg.dragTiltDegrees : 0, dragging: physics.mode === 'drag', heightAbove: Math.max(0, bounds.floor - y) };
    const key = JSON.stringify(pose);
    if (ready && (!suspended || (pet.isVisible() && key !== lastPose))) pet.webContents.send('pose', pose);
    lastPose = key;
    if (physics.mode === 'idle') {
      const next = director.automaticAction(wallNow, chat?.isVisible() ?? false);
      if (next?.kind === 'sleep.start') play('auto-sleep');
      else if (next) { physics.direction = Math.random() < .5 ? -1 : 1; play('random-chain'); }
    }
  }, tuning.tickMs));
  timers.push(setInterval(() => {
    if (physics.mode === 'idle') savePosition();
    const lowActivity = director.rest === 'asleep' || hiddenByUser;
    if (!lowActivity) lowActivityAt = 0;
    else if (!lowActivityAt) lowActivityAt = Date.now();
    else if (Date.now() - lowActivityAt >= tuning.decoderReleaseMs) parkPlayback();
  }, tuning.maintenanceMs));
  timers.push(setInterval(() => { if (!pollRunning) { pollRunning = true; bridge.poll().then(replies => {
    for (const reply of replies) { messages.push(reply); pet.webContents.send('bubble', reply.text); const sentAt = pending.get(reply.id);
      if (sentAt !== undefined) { runStats.today().chatRoundTripMs.push(Date.now() - sentAt); persistStats(); }
      pending.delete(reply.id); wakeFromInteraction('chat-reply'); }
    for (const [id, at] of pending) if (Date.now() - at > tuning.replyTimeoutMs) pending.delete(id);
    sendChat();
  }).catch(report).finally(() => { pollRunning = false; }); } }, tuning.replyPollMs));
  timers.push(setInterval(() => { if (!statusRunning) { statusRunning = true; statusTick().catch(report).finally(() => { statusRunning = false; }); } }, tuning.statusPollMs));
  timers.push(setInterval(() => {
    const sample = memorySample(app.getAppMetrics());
    runStats.recordMemory(sample.workingSetMiB, sample.privateMiB);
    if (sample.privateMiB !== null && sample.privateMiB >= tuning.memoryHighMiB && ready && videoReady &&
        !suspended && guardBefore === undefined && Date.now() - lastReclaimAt >= tuning.reclaimCooldownMs) {
      guardBefore = sample.privateMiB; lastReclaimAt = Date.now();
      pet.webContents.send('reclaim');
    }
  }, tuning.memoryPollMs));
  timers.push(setInterval(() => heartbeat().catch(report), tuning.heartbeatMs));
  timers.push(setInterval(() => writeStats(), tuning.statsMs));
}
async function heartbeat(): Promise<void> {
  if (ready && videoReady) atomicWrite(path.join(root, 'pet-heartbeat.txt'), new Date().toISOString());
}
async function statusTick(): Promise<void> {
  let state: Presence = 'idle'; presenceNote = '在岗';
  try {
    const p = JSON.parse((await fs.readFile(path.join(root, 'presence.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const age = Date.now() - Date.parse(p.ts);
    if (age >= -director.config.tuning.futureToleranceMs && age < director.config.tuning.presenceValidMs && ['idle', 'thinking', 'working', 'result', 'waiting', 'success', 'error'].includes(p.state)) {
      state = p.state;
      const names: Record<Presence, string> = { idle: '在岗', thinking: '思考中', working: '忙碌中', result: '整理中', waiting: '等待中', success: '已完成', error: '出问题了' };
      presenceNote = typeof p.note === 'string' && p.note.trim() ? p.note.slice(0, 200) : names[state];
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) report(e); }
  const previous = director.current; director.setPresence(state);
  if (previous !== director.current) { stopWalk(); play('presence'); }
  await healthTick();
  tray.setToolTip(((healthWarning ? '⚠ 每日自检异常 · ' : '') + '艾莉丝 · ' + presenceNote).slice(0, 120)); sendChat();
  const stat = await fs.stat(configPath).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
  if (stat?.mtimeMs !== configStamp) { try { await loadConfig(); play('config-reload'); } catch (e) { report(e); } }
}
async function optionalJson(name: string) {
  try { return JSON.parse(await fs.readFile(path.join(root, name), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function healthTick(): Promise<void> {
  const request = await optionalJson('pet-check-request.json');
  const today = new Date().toISOString().slice(0, 10);
  if (request?.day === today && probeDay !== today && ready) {
    probeDay = today;
    const clips = Object.fromEntries(Object.entries(director.config.clips).map(([id, clip]) =>
      [id, pathToFileURL(path.join(media, clip.file)).href]));
    pet.webContents.send('probe', { day: today, clips, timeoutMs: director.config.tuning.firstFrameMs });
  }
  const result = await optionalJson('pet-daily-check.json');
  const warn = result?.ok === false;
  if (warn !== healthWarning) {
    healthWarning = warn;
    tray.setImage(nativeImage.createFromPath(path.join(ui, warn ? 'avatar-warning.png' : 'avatar.png')).resize({ width: 32, height: 32 }));
  }
}
function memorySample(metrics: Electron.ProcessMetric[]) {
  const workingSetMiB = metrics.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024;
  let privateMiB: number | null = null;
  if (metrics.every(p => typeof p.memory.privateBytes === 'number')) {
    privateMiB = metrics.reduce((n, p) => n + p.memory.privateBytes!, 0) / 1024;
  } else if (process.platform === 'linux') {
    privateMiB = 0;
    for (const p of metrics) {
      try {
        const rollup = readFileSync(`/proc/${p.pid}/smaps_rollup`, 'utf8');
        for (const match of rollup.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+)/gm)) privateMiB += Number(match[1]) / 1024;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  return { workingSetMiB, privateMiB };
}
function persistStats(sessionOpen = true): void {
  atomicWrite(statsPath, JSON.stringify({ ...sampledStats, days: runStats.days, sessionOpen, sessionId }));
}
function writeStats(sessionOpen = true): void {
  const metrics = app.getAppMetrics();
  const memory = memorySample(metrics);
  runStats.recordMemory(memory.workingSetMiB, memory.privateMiB);
  sampledStats = { pid: process.pid, lastReclaim,
    privateSampleMiB: memory.privateMiB, ts: new Date().toISOString(), runtime: 'electron', diskLoads: 0, decodedFrames,
    intervalMs: Date.now() - metricsStamp, clip: director.current.clip, restState: director.rest,
    processCount: metrics.length, workingSetMB: metrics.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024,
    privateMB: metrics.every(p => typeof p.memory.privateBytes === 'number') ? metrics.reduce((n, p) => n + p.memory.privateBytes!, 0) / 1024 : null,
    cpuPercent: metrics.reduce((n, p) => n + p.cpu.percentCPUUsage, 0), startupMs, suspended,
    acceleration: process.env.ALICE_PET_ACCELERATION === 'off' ? 'off' : 'on',
    processes: metrics.map(p => ({ type: p.type, pid: p.pid, workingSetMB: p.memory.workingSetSize / 1024 })) };
  persistStats(sessionOpen); decodedFrames = 0; metricsStamp = Date.now();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) { if (pet.isMinimized()) pet.restore(); pet.show(); pet.focus(); } });
  app.on('before-quit', () => { quitting = true; if (pet && desktop) { savePosition(); writeStats(false); } timers.forEach(clearInterval); });
  app.whenReady().then(setup).catch(e => { report(e); app.exit(1); });
}
