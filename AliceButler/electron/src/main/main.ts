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
import { Absence, Gestures, PointerPress } from './gestures';
import { Bridge, Message, ReplyQueue } from './bridge';
import { Action, ActionRequest, Director, Physics, Presence, validateConfig } from './engine';

const launchAt = performance.now();
// Preserve Chromium's current default until the target Windows A/B is accepted.
if (process.env.ALICE_PET_ACCELERATION === 'off') app.disableHardwareAcceleration();
const root = process.env.ALICE_PET_ROOT || 'C:\\ProgramData\\AliceButler';
const testMode = process.env.ALICE_PET_TEST === '1';
const ui = path.join(__dirname, '../../ui');
const media = path.join(__dirname, '../../media');
const mediaUrl = (file: string) => pathToFileURL(path.join(media, file)).href;
const petSize = { width: 533, height: 300 };
const configPath = path.join(app.getAppPath(), 'config.json');
const bridge = new Bridge(root);
const physics = new Physics();
let pet: BrowserWindow, chat: BrowserWindow | undefined, tray: Tray, director: Director;
let chatLoading: Promise<void> | undefined, startupMs: number | null = null;
let suspended = false, lowActivityAt = 0, parkPending = false, hiddenByUser = false;
let chatReady = false, ready = false, quitting = false, videoReady = false;
let dragOffset = { x: 0, y: 0 }, press: PointerPress | undefined, lastMovedAt = 0;
let doubleAllowed = true;
let clickTimer: NodeJS.Timeout | undefined, pressTimer: NodeJS.Timeout | undefined, replyTimer: NodeJS.Timeout | undefined;
let lastLoggedAction: Action | undefined;
const actionRequests: ActionRequest[] = [];
const replies = new ReplyQueue();
const automaticRequests = [{ source: 'auto-sleep' }, { source: 'random-chain' }] as const;
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
function errorCode(error: unknown): string {
  if (error instanceof SyntaxError) return 'invalid-json';
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && /^E[A-Z0-9_]+$/.test(code) ? code : 'failed';
}
function report(operation: string, error?: unknown): void {
  const message = error === undefined ? operation : operation + ' ' + errorCode(error);
  console.error(message);
  fs.appendFile(path.join(root, 'pet-error.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
}
const statePath = path.join(root, 'pet-position.json');
const settingsPath = path.join(root, 'pet-settings.json');
const clickSoundIntervalMs = 100;
let clickSoundEnabled = true, lastClickSoundAt = -Infinity;
let standing = false, desktop: Position, lastSaved = '';
const gestures = new Gestures(), absence = new Absence();
let approached = false;
let configNotice = '', configNotified = false;
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
  clearTimeout(pressTimer); press = undefined; director.endHold();
  physics.mode = 'idle'; physics.vx = physics.vy = 0;
  physics.x = result.x; physics.y = result.y;
}
function setStanding(enabled: boolean): void {
  const previous = position();
  if (enabled) desktop = previous;
  standing = enabled; place(enabled ? previous : desktop);
  actionRequests.push({ source: 'placement' }); savePosition(); tray.setContextMenu(menu());
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
function dispatch(requests: readonly ActionRequest[], now = Date.now()): void {
  if (!requests.length) return;
  const chatOpen = chat?.isVisible() ?? false;
  const decisions = director.request(requests, { now, motion: physics.mode, chatOpen });
  for (const [index, decision] of decisions.entries()) {
    if (requests[index].source === 'media-fallback' && decision.outcome === 'rejected') report('No playable clip remains');
    if (decision.outcome !== 'played') continue;
    const { action, source } = decision;
    if (source !== 'resume') stopWalk();
    if (source === 'random-chain') physics.direction = Math.random() < .5 ? -1 : 1;
    if (source === 'landing' || source === 'hover-peek' || source === 'desktop-return' || source === 'click-startle') director.interact(now);
    if (lastLoggedAction !== action) {
      runStats.recordTrigger(source, action.clip, { kind: action.kind, rest: director.rest,
        presence: director.presence, motion: physics.mode, chatOpen });
      lastLoggedAction = action;
    }
    // Keep a hidden pet parked; waking a visible sleeping pet resumes immediately.
    if (suspended && hiddenByUser) return;
    const clip = director.config.clips[action.clip];
    const transition = director.config.skinTransition;
    suspended = false; parkPending = false;
    videoReady = false;
    pet.webContents.send('play', { ...action, tuning: director.config.tuning, token: ++lastClipToken, url: mediaUrl(clip.file),
      facing: clip.facing ?? 'right', direction: physics.direction, skin: clip.skin ?? 'uniform', endsClosed: clip.endsClosed,
      blink: transition && {
        uniform: { url: mediaUrl(transition.uniform.file), closedAtSec: transition.uniform.closedAtSec },
        wafuku: transition.wafuku && { url: mediaUrl(transition.wafuku.file), closedAtSec: transition.wafuku.closedAtSec }
      },
      interactive: ['click', 'click-combo', 'click-startle', 'double-click', 'drag', 'long-press', 'landing'].includes(source) });
  }
}
function stopWalk(): void { if (physics.mode === 'walk') physics.mode = 'idle'; }
function interact(request: ActionRequest, now = Date.now()): void {
  director.interact(now);
  actionRequests.push(request);
}
function deliverReplies(): void {
  clearTimeout(replyTimer); replyTimer = undefined;
  const next = replies.next(performance.now(), bridge.tuning.replyStaggerMs);
  if (typeof next === 'number') { replyTimer = setTimeout(deliverReplies, next); return; }
  if (!next) return;

  messages.push(next);
  pet.webContents.send('bubble', next.text);
  replies.delivered(performance.now());
  const now = Date.now(), sentAt = pending.get(next.id);
  if (sentAt !== undefined) { runStats.today().chatRoundTripMs.push(now - sentAt); persistStats(); }
  pending.delete(next.id);
  interact({ source: 'chat-reply' }, now);
  if (typeof next.animationCategory === 'string') actionRequests.push({ source: 'reply-category', category: next.animationCategory });
  sendChat();
  deliverReplies();
}
function clearClick(): void { clearTimeout(clickTimer); clickTimer = undefined; }
function samplePress(cursor: Electron.Point, now: number): boolean {
  const gesture = press?.sample(cursor, now, director.config.tuning, director.config.triggers);
  if (!gesture) return false;
  clearTimeout(pressTimer);
  gestures.resetClicks();
  actionRequests.push({ source: gesture });
  return true;
}
function finishPress(cursor: Electron.Point, now: number, cancelled: boolean): void {
  const held = press;
  press = undefined;
  clearTimeout(pressTimer);
  director.endHold();
  if (!held) return;
  const { tuning } = director.config;
  const release = held.release(cursor, now, tuning);
  doubleAllowed = release === 'click' && !cancelled;
  if (clickSoundEnabled && !cancelled && (release === 'click' || held.isWakeClick(cursor, now, tuning))) {
    const soundAt = performance.now();
    if (soundAt - lastClickSoundAt >= clickSoundIntervalMs) {
      lastClickSoundAt = soundAt;
      pet.webContents.send('click-sound');
    }
  }
  if (release === 'wake') { gestures.resetClicks(); return; }
  director.interact(now);
  if (release !== 'click' || cancelled) gestures.resetClicks();
  if (release === 'drag') {
    if (cancelled) physics.release(true, director.config.tuning);
    else {
      const edge = snap(physics.x, physics.y, area(), director.config.tuning);
      if (edge || standing) {
        physics.mode = 'idle'; physics.vx = physics.vy = 0;
        if (edge) { physics.x = edge.x; physics.y = edge.y; }
        if (standing) physics.y = area().floor;
      } else physics.release(now - lastMovedAt > director.config.tuning.releaseStaleMs, director.config.tuning);
    }
    actionRequests.push({ source: 'drag-release' });
    return;
  }

  physics.mode = 'idle'; physics.vx = physics.vy = 0;
  if (release === 'long-press') {
    actionRequests.push({ source: 'long-press-release', cancelled });
  } else if (release === 'click' && !cancelled) {
    // Count confirmed singles at release time, after the double-click window.
    clickTimer = setTimeout(() => {
      clickTimer = undefined;
      const combo = gestures.singleClick(now, director.config.triggers);
      if (combo) actionRequests.push({ source: 'click-combo' });
      else if (approached && gestures.allowStartle(now, director.config.interaction)) actionRequests.push({ source: 'click-startle' });
      else actionRequests.push({ source: 'click' });
      if (director.rest === 'awake') toggleChat().catch(report.bind(null, 'chat-window'));
    }, director.config.tuning.doubleClickMs);
  } else if (director.current.kind === 'moves') {
    actionRequests.push({ source: 'walk-end' });
  }
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
  interact({ source: 'chat-open' });
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
  child.on('error', report.bind(null, 'rollback-launch'));
  child.on('exit', code => { if (code) report('Rollback helper launch failed: ' + code); });
}
function menu(): Menu {
  return Menu.buildFromTemplate([
    { label: '和艾莉丝说话', click: () => { toggleChat().catch(report.bind(null, 'chat-window')); } },
    { label: director?.rest === 'awake' ? '睡一会儿' : '起来', click: () => {
      interact({ source: director.rest === 'awake' ? 'menu-sleep' : 'menu-wake' });
    } },
    { label: '任务栏站立', type: 'checkbox', checked: standing, click: item => setStanding(item.checked) },
    { label: '点击音效', type: 'checkbox', checked: clickSoundEnabled, click: item => {
      try {
        atomicWrite(settingsPath, JSON.stringify({ clickSoundEnabled: item.checked }));
        clickSoundEnabled = item.checked;
      } catch (error) { report('settings-write', error); }
      tray.setContextMenu(menu());
    } },
    { label: '跳一下', click: () => { finishPress(screen.getCursorScreenPoint(), Date.now(), true); physics.mode = 'air'; physics.vy = -330; physics.vx = 0; } },
    { label: '回到原位', click: () => { finishPress(screen.getCursorScreenPoint(), Date.now(), true); physics.mode = 'idle'; physics.x = area().right - director.config.tuning.homeInsetPx; physics.y = area().floor; } },
    { label: pet?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => pet.isVisible() ? pet.hide() : pet.showInactive() },
    { label: '回滚上一版', enabled: backups.length > 0, submenu: backups.map(id => ({ label: id, click: () => rollback(id) })) },
    { label: '重载动作配置', click: () => loadConfig().catch(report.bind(null, 'config-reload')) },
    { type: 'separator' }, { label: '退出桌宠', click: () => purposefulExit().catch(report.bind(null, 'disable-pet')) }
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
    if (!missing) {
      // A rejected config is arbitrary input. Keep a recovery record without its bytes.
      try { atomicWrite(backup, JSON.stringify({ reason: errorCode(error) })); }
      catch (e) {
        if (!['EACCES', 'EPERM'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
        report('config-recovery-record', e);
      }
    }
    config = validateConfig(JSON.parse(defaults));
    try { atomicWrite(configPath, defaults); }
    catch (e) { if (!['EACCES', 'EPERM', 'EROFS'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    configNotice = missing ? '配置缺失，已使用内置默认值。' : '读取配置失败，已启用内置默认值。';
    report('config-load', error); notifyConfig();
  }
  if (director) { director.replaceConfig(config); gestures.resetClicks(); actionRequests.push({ source: 'config-reload' }); }
  else director = new Director(config);
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
  try { clickSoundEnabled = (await optionalJson('pet-settings.json'))?.clickSoundEnabled !== false; }
  catch (error) { report('settings-read', error); }
  runStats = new RunStats(statsPath);
  await loadConfig();
  pet = new BrowserWindow({ ...windowOptions(), ...petSize, transparent: true, hasShadow: false, title: '艾莉丝桌宠' });
  secureWindow(pet);
  pet.on('hide', () => { hiddenByUser = true; });
  pet.on('show', () => { hiddenByUser = false; lowActivityAt = 0; if (suspended || parkPending) dispatch([{ source: 'resume' }]); });
  const back = (reason: string) => { if (absence.back(reason, Date.now(), director.config.interaction.awayMs)) actionRequests.push({ source: 'desktop-return' }); };
  powerMonitor.on('lock-screen', () => absence.leave('lock', Date.now()));
  powerMonitor.on('unlock-screen', () => back('lock'));
  pet.on('minimize', () => absence.leave('minimize', Date.now()));
  pet.on('restore', () => back('minimize'));
  const saved = loadPosition(statePath);
  standing = saved?.standing ?? false;
  place(saved?.position); desktop = saved?.desktop ?? position();
  windowX = Math.round(physics.x); windowY = Math.round(physics.y);
  pet.setBounds({ x: windowX, y: windowY, ...petSize });
  pet.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on('renderer-ready', event => {
    if (!trusted(event, pet)) return;
    ready = true; dispatch([{ source: 'startup' }]);
  });
  ipcMain.on('chat-ready', event => { if (trusted(event, chat)) { chatReady = true; sendChat(); } });
  ipcMain.on('chat-close', event => { if (trusted(event, chat)) chat?.hide(); });
  ipcMain.handle('chat-send', async (event, text: unknown) => {
    if (!trusted(event, chat)) throw Error('Invalid sender');
    const msg = await bridge.send(text); messages.push(msg); pending.set(msg.id, Date.now()); sendChat(); interact({ source: 'chat-send' });
    return msg.id;
  });
  ipcMain.on('hit', (event, hit: unknown) => {
    if (trusted(event, pet) && typeof hit === 'boolean' && physics.mode !== 'drag' && ignoringMouse === hit) {
      if (!hit) {
        gestures.leave();
        if (director.current.kind === 'peek') actionRequests.push({ source: 'hover-exit' });
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
    try { await fs.rm(path.join(root, 'pet-disabled.flag'), { force: true }); atomicWrite(path.join(root, 'pet-start.log'), `electron video ok ${new Date().toISOString()}\n`); } catch (e) { report('video-ready-state', e); }
  });
  ipcMain.on('probed', (event, day, clips) => {
    if (!trusted(event, pet) || day !== probeDay) return;
    const names = Object.keys(director.config.clips);
    if (!clips || names.some(id => !['ok', 'decode-failed', 'decode-timeout'].includes(clips[id]))) return;
    atomicWrite(path.join(root, 'pet-decode-check.json'), JSON.stringify({ day,
      clips: Object.fromEntries(names.map(id => [id, clips[id]])) }));
  });
  ipcMain.on('reclaimed', async event => {
    if (!trusted(event, pet) || guardBefore === undefined) return;
    try {
      await trimPlaybackMemory(true);
      await delay(director.config.tuning.maintenanceMs);
      const after = memorySample(app.getAppMetrics());
      lastReclaim = { beforeMiB: guardBefore, afterMiB: after.privateMiB, at: new Date().toISOString() };
      await writeStats();
    } catch (error) { report('playback-reclaim', error); }
    finally { guardBefore = undefined; if (!pet.isDestroyed()) pet.webContents.send('reclaim-done'); }
  });
  ipcMain.on('playback-suspended', event => {
    if (!trusted(event, pet) || !parkPending) return;
    parkPending = false; suspended = true; trimPlaybackMemory().catch(report.bind(null, 'playback-trim'));
  });
  ipcMain.on('video-error', (event, message: unknown, token?: number) => {
    if (!trusted(event, pet)) return;
    const reason = message === 'poster' || message === 'first-frame' || message === 'skin-transition' ? message : 'decode';
    report('video-' + reason);
    if (token === lastClipToken) dispatch([{ source: 'media-fallback' }]);
  });
  ipcMain.on('playback-result', (event, token: unknown, outcome: unknown, reason: unknown) => {
    if (!trusted(event, pet) || typeof token !== 'number' || !Number.isSafeInteger(token) ||
        token <= 0 || token >= lastClipToken || outcome !== 'cancelled' || reason !== 'superseded') return;
    const counts = runStats.today().cancelled ??= { superseded: 0 };
    counts.superseded++;
  });
  ipcMain.on('ended', (event, token: unknown) => {
    if (!trusted(event, pet) || token !== lastClipToken) return;
    // Requests received while a sleep transition is finishing still belong to it.
    if (director.rest === 'entering' || director.rest === 'waking') dispatch(actionRequests.splice(0));
    if (director.current.kind === 'turn') physics.direction *= -1;
    dispatch([{ source: 'animation-end' }]);
  });
  ipcMain.on('pet-pointer', (event, type: unknown) => {
    if (!trusted(event, pet)) return;
    const now = Date.now(); const cursor = screen.getCursorScreenPoint();
    if (type === 'down') {
      clearClick();
      const wakeOnly = director.rest !== 'awake';
      press = new PointerPress(cursor, now, wakeOnly);
      interact({ source: 'pointer-wake' }, now);
      if (wakeOnly) return;
      approached = gestures.press(now, director.config.interaction);
      if (director.current.kind === 'peek') actionRequests.push({ source: 'click', dismissPeek: true });
      lastMovedAt = now;
      dragOffset = { x: cursor.x - physics.x, y: cursor.y - physics.y };
      physics.targetX = physics.x; physics.targetY = physics.y;
      physics.vx = physics.vy = 0; physics.mode = 'drag';
      director.beginHold(now);
      pressTimer = setTimeout(() => {
        const at = Date.now();
        if (samplePress(screen.getCursorScreenPoint(), at)) dispatch(actionRequests.splice(0), at);
      }, director.config.triggers.longPressMs);
    } else if (type === 'up' || type === 'cancel') {
      finishPress(cursor, now, type === 'cancel');
    } else if (type === 'double') {
      clearClick(); gestures.resetClicks();
      if (!doubleAllowed || press) return;
      physics.mode = 'idle'; physics.vx = physics.vy = 0;
      interact({ source: 'double-click' }, now);
    } else if (type === 'menu') menu().popup({ window: pet });
  });
  pet.on('blur', () => finishPress(screen.getCursorScreenPoint(), Date.now(), true));
  writeStats();
  await pet.loadFile(path.join(ui, 'pet.html'));
  messages = await bridge.history();
  tray = new Tray(nativeImage.createFromPath(path.join(ui, 'avatar.ico')));
  await refreshBackups();
  tray.setToolTip('艾莉丝 · 在岗'); tray.setContextMenu(menu()); tray.on('double-click', () => { toggleChat().catch(report.bind(null, 'chat-window')); });
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
      state: () => ({ standing, configNotified, action: director.current, token: lastClipToken, rest: director.rest, presence: director.presence, mode: physics.mode, decodedFrames: totalFrames, videoReady, ignoringMouse, suspended, startupMs, x: physics.x, y: physics.y }),
      play: (clip: string) => {
        if (!director.config.clips[clip]) throw Error('Unknown clip');
        dispatch([{ source: 'test', action: { clip, loop: ['idle', 'walk', 'doze', 'dangle'].includes(clip), kind: 'test', rate: 1 } }]);
        return lastClipToken;
      },
      playMove: () => {
        const move = director.config.animations.moves[0];
        if (!move) throw Error('No configured move');
        dispatch([{ source: 'test', action: { clip: move.clip, loop: true, kind: 'moves', rate: 1 } }]);
        return lastClipToken;
      },
      playPeek: () => { dispatch([{ source: 'test', action: { clip: 'peek', loop: false, kind: 'peek', rate: 1 } }]); return lastClipToken; },
      pose: (direction: number) => { physics.mode = 'idle'; physics.direction = direction; pet.webContents.send('pose', { x: 0, y: 0, squash: 1, direction, heightAbove: 0 }); },
      sleep: () => dispatch([{ source: 'test', action: 'sleep' }]),
      wake: () => dispatch([{ source: 'test', action: 'wake' }]),
      openChat: ensureChat,
      park: parkPlayback,
      resume: () => dispatch([{ source: 'resume' }]),
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
    if (press && physics.mode === 'drag') {
      samplePress(cursor, wallNow);
      if (press.state === 'drag') {
        physics.targetX = cursor.x - dragOffset.x; physics.targetY = cursor.y - dragOffset.y;
        if (Math.abs(physics.targetX - physics.x) + Math.abs(physics.targetY - physics.y) > tuning.dragDistancePx) lastMovedAt = wallNow;
      }
    }
    const oldMode = physics.mode, bounds = area();
    const cfg = director.config.interaction;
    if (physics.mode !== 'walk' || videoReady) {
      const hardLanding = physics.step(dt, bounds, now, cfg, tuning);
      if (hardLanding && !standing) actionRequests.push({ source: 'landing' });
    }
    if (standing && physics.mode !== 'drag') { physics.y = bounds.floor; if (physics.mode === 'air') physics.mode = 'idle'; }
    if (physics.mode !== 'drag' && gestures.sample(cursor, { x: physics.x + 266, y: physics.y + 150 }, !ignoringMouse,
        pet.isVisible() && physics.mode === 'idle' && director.rest === 'awake' && director.current.kind === 'idle',
        wallNow, cfg)) actionRequests.push({ source: 'hover-peek' });
    if (oldMode === 'walk' && physics.mode === 'idle') actionRequests.push({ source: 'walk-end' });
    if (physics.mode === 'idle' && director.rest === 'awake') actionRequests.push(...automaticRequests);
    if (ready && actionRequests.length) dispatch(actionRequests.splice(0), wallNow);
    const x = Math.round(physics.x), y = Math.round(physics.y);
    if (windowX !== x || windowY !== y) {
      // Round-tripping native bounds through setPosition grows the window on fractional DPI.
      pet.setBounds({ x, y, ...petSize });
      windowX = x; windowY = y;
      if (chat?.isVisible()) followChat(chat);
    }
    const pose = { x: cursor.x - x, y: cursor.y - y, squash: physics.squash, direction: director.current.kind === 'peek' ? gestures.direction : physics.direction,
      tilt: physics.mode === 'drag' && press?.state === 'drag' ? Math.max(-1, Math.min(1, physics.vx / cfg.dragTiltSpeed)) * cfg.dragTiltDegrees : 0, dragging: physics.mode === 'drag', heightAbove: Math.max(0, bounds.floor - y) };
    const key = JSON.stringify(pose);
    if (ready && (!suspended || (pet.isVisible() && key !== lastPose))) pet.webContents.send('pose', pose);
    lastPose = key;
  }, tuning.tickMs));
  timers.push(setInterval(() => {
    if (physics.mode === 'idle') savePosition();
    const lowActivity = director.rest === 'asleep' || hiddenByUser;
    if (!lowActivity) lowActivityAt = 0;
    else if (!lowActivityAt) lowActivityAt = Date.now();
    else if (Date.now() - lowActivityAt >= tuning.decoderReleaseMs) parkPlayback();
  }, tuning.maintenanceMs));
  timers.push(setInterval(() => { if (!pollRunning) { pollRunning = true; bridge.poll().then(batch => {
    replies.enqueue(batch);
    deliverReplies();
    for (const [id, at] of pending) if (Date.now() - at > tuning.replyTimeoutMs) pending.delete(id);
    sendChat();
  }).catch(report.bind(null, 'reply-poll')).finally(() => { pollRunning = false; }); } }, tuning.replyPollMs));
  timers.push(setInterval(() => { if (!statusRunning) { statusRunning = true; statusTick().catch(report.bind(null, 'status-poll')).finally(() => { statusRunning = false; }); } }, tuning.statusPollMs));
  timers.push(setInterval(() => {
    const sample = memorySample(app.getAppMetrics());
    runStats.recordMemory(sample.workingSetMiB, sample.privateMiB);
    if (sample.privateMiB !== null && sample.privateMiB >= tuning.memoryHighMiB && ready && videoReady &&
        !suspended && guardBefore === undefined && Date.now() - lastReclaimAt >= tuning.reclaimCooldownMs) {
      guardBefore = sample.privateMiB; lastReclaimAt = Date.now();
      pet.webContents.send('reclaim');
    }
  }, tuning.memoryPollMs));
  timers.push(setInterval(() => heartbeat().catch(report.bind(null, 'heartbeat')), tuning.heartbeatMs));
  timers.push(setInterval(() => writeStats(), tuning.statsMs));
}
async function heartbeat(): Promise<void> {
  if (ready && videoReady) atomicWrite(path.join(root, 'pet-heartbeat.txt'), new Date().toISOString());
}
async function statusTick(): Promise<void> {
  let state: Presence = 'idle', valid = false; presenceNote = '在岗';
  try {
    const p = JSON.parse((await fs.readFile(path.join(root, 'presence.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const age = Date.now() - Date.parse(p?.ts);
    if (age >= -director.config.tuning.futureToleranceMs && age < director.config.tuning.presenceValidMs && ['idle', 'thinking', 'working', 'result', 'waiting', 'success', 'error'].includes(p.state)) {
      state = p.state; valid = true;
      const names: Record<Presence, string> = { idle: '在岗', thinking: '思考中', working: '忙碌中', result: '整理中', waiting: '等待中', success: '已完成', error: '出问题了' };
      presenceNote = typeof p.note === 'string' && p.note.trim() ? p.note.slice(0, 200) : names[state];
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) report('presence-read', e); }
  actionRequests.push({ source: 'presence', state, valid });
  await healthTick();
  tray.setToolTip(((healthWarning ? '⚠ 每日自检异常 · ' : '') + '艾莉丝 · ' + presenceNote).slice(0, 120)); sendChat();
  const stat = await fs.stat(configPath).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
  if (stat?.mtimeMs !== configStamp) await loadConfig();
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
      [id, mediaUrl(clip.file)]));
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
  app.on('before-quit', () => {
    quitting = true; clearClick(); clearTimeout(pressTimer); clearTimeout(replyTimer);
    if (pet && desktop) { savePosition(); writeStats(false); }
    timers.forEach(clearInterval);
  });
  app.whenReady().then(setup).catch(e => { report('setup', e); app.exit(1); });
}
