// Processo principal do app de computador. A página é a mesma build do site, servida por app://,
// e tudo o que só o app faz (atalhos globais, bandeja, mini janela, áudio do sistema) passa por aqui.
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeFromArgs, keyName } from './keys';

const ORIGIN = 'app://discordia';
const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'dist');
const STATIC = path.join(__dirname, '..', 'static');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, '..', 'build', 'tray.png');
const PICK_TIMEOUT_MS = 120_000;
// Compacta: uma pílula com rostos. Expandida: lista de nomes e controles.
const MINI_MIN = { width: 96, height: 34 };
const MINI_MAX = { width: 260, height: 420 };
// O app costuma ficar dias aberto na bandeja: procura versão nova de tempos em tempos, não só ao abrir.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

// A mesma CSP do site (gerada de vercel.json no build). Em desenvolvimento libera a sinalização local.
const CSP = (() => {
  const base: string = JSON.parse(readFileSync(path.join(__dirname, 'csp.json'), 'utf8'));
  return app.isPackaged ? base : base.replace('connect-src', 'connect-src http://localhost:8787 ws://localhost:8787');
})();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

type Call = { channel: string; muted: boolean; deafened: boolean; people: { name: string; color: string; speaking: boolean; self: boolean }[] };

let win: BrowserWindow | null = null;
let mini: BrowserWindow | null = null;
let tray: Tray | null = null;
let call: Call | null = null;
let miniEnabled = true;
let quitting = false;
let pendingJoin = codeFromArgs(process.argv);
let pttKey: number | null = null;
let pttHeld = false;
let pttRunning = false;
let hook: typeof import('uiohook-napi') | null = null;
const picks = new Map<number, (id: string | null) => void>();
let pickSeq = 0;
/** Versão nova já baixada, esperando o usuário reiniciar (ou o app fechar). */
let updateReady: string | null = null;

// Estado do hook para os testes de ponta a ponta (só fora do app empacotado).
if (!app.isPackaged) {
  Object.assign(globalThis, {
    discordiaPtt: () => ({ key: pttKey, running: pttRunning }),
    // Simula uma atualização baixada, sem depender de um Release de verdade.
    discordiaFakeUpdate: (version: string) => announceUpdate(version),
  });
}

// Dados do app em ~/.config/Discordia (ou equivalente). Os testes usam uma pasta descartável.
app.setName('Discordia');
if (process.env.DISCORDIA_PROFILE) app.setPath('userData', process.env.DISCORDIA_PROFILE);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Um app só: abrir de novo (ou por um link discordia://) traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showMain();
    const code = codeFromArgs(argv);
    if (code) win?.webContents.send('join', code);
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    const code = codeFromArgs([url]);
    if (!code) return;
    if (win) {
      showMain();
      win.webContents.send('join', code);
    } else pendingJoin = code;
  });
  if (process.defaultApp) app.setAsDefaultProtocolClient('discordia', process.execPath, [path.resolve(process.argv[1] ?? '.')]);
  else app.setAsDefaultProtocolClient('discordia');

  app.whenReady().then(start);
}

async function start() {
  serveApp();
  guardSession();
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  createWindow(process.argv.includes('--hidden'));
  createTray();
  registerIpc();
  startUpdates();
}

/** Baixa a versão nova em segundo plano e avisa a página, que oferece reiniciar na hora. */
function startUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.on('update-downloaded', (info) => announceUpdate(info.version));
  const check = () => autoUpdater.checkForUpdates().catch((err) => console.warn('atualização', err));
  void check();
  setInterval(check, UPDATE_CHECK_MS);
}

function announceUpdate(version: string) {
  updateReady = version;
  win?.webContents.send('update-ready', version);
}

/** Serve a build do site em app://discordia, com a CSP do site e sem sair da pasta. */
function serveApp() {
  protocol.handle('app', async (req) => {
    const { host, pathname } = new URL(req.url);
    if (host !== 'discordia') return new Response('', { status: 404 });
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(WEB + path.sep) || !existsSync(file)) return new Response('não encontrado', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers({ 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: 200, headers });
  });
}

/** Permissões só para a própria página; a captura de tela passa pelo seletor do app. */
function guardSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);
  const ours = (url: string | undefined) => !!url && url.startsWith(ORIGIN);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ours(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && ours(origin));

  // O YouTube exige o cabeçalho Referer de um site; app:// não manda nenhum.
  const site: string | null = JSON.parse(readFileSync(path.join(__dirname, 'site.json'), 'utf8'));
  const referer = site ? `${site.replace(/\/$/, '')}/` : null;
  if (referer) ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] }, (details, callback) => {
    details.requestHeaders.Referer ??= referer;
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const id = await pickSource(
        sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumbnail: s.thumbnail.toDataURL() })),
      );
      const source = sources.find((s) => s.id === id);
      if (!source) return callback({});
      // No Windows o áudio do sistema vem junto (loopback); nos outros sistemas o Electron não captura.
      callback({ video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) });
    } catch (err) {
      console.warn('captura de tela', err);
      callback({});
    }
  });
}

function pickSource(sources: { id: string; name: string; kind: string; thumbnail: string }[]) {
  if (!win) return Promise.resolve(null);
  const id = ++pickSeq;
  showMain();
  win.webContents.send('pick-source', { id, sources });
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => finish(null), PICK_TIMEOUT_MS);
    const finish = (choice: string | null) => {
      clearTimeout(timer);
      picks.delete(id);
      resolve(choice);
    };
    picks.set(id, finish);
  });
}

function createWindow(hidden: boolean) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1360, width),
    height: Math.min(860, height),
    minWidth: 940,
    minHeight: 600,
    show: !hidden,
    title: 'Discordia',
    icon: ICON,
    backgroundColor: '#0f0f15',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Voz e rádio continuam rodando com a janela minimizada.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  void win.loadURL(`${ORIGIN}/`);

  win.webContents.on('did-finish-load', () => {
    if (pendingJoin) win?.webContents.send('join', pendingJoin);
    pendingJoin = null;
  });
  // Links externos abrem no navegador do sistema; a janela nunca sai do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });
  // O host perguntaria "encerrar a sala?" no navegador; aqui a pergunta vira um diálogo do sistema.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['Encerrar sala e sair', 'Continuar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Encerrar a sala?',
      message: 'Você é o host. Ao sair, a sala acaba para todos.',
    });
    if (choice === 0) e.preventDefault();
    else quitting = false;
  });
  // Fechar a janela deixa o app na bandeja, com a chamada de pé.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) win.on(event as 'focus', updateMini);
}

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('Discordia');
  tray.on('click', showMain);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const send = (action: string) => () => win?.webContents.send('call-action', action);
  tray.setToolTip(call ? `Discordia · ${call.channel}${call.muted ? ' · microfone desligado' : ''}` : 'Discordia');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Discordia', click: showMain },
      { type: 'separator' },
      ...(call
        ? ([
            { label: `Na voz: ${call.channel}`, enabled: false },
            { label: 'Silenciar microfone', type: 'checkbox', checked: call.muted, click: send('mute') },
            { label: 'Ensurdecer', type: 'checkbox', checked: call.deafened, click: send('deafen') },
            { label: 'Sair da chamada', click: send('leave') },
            { type: 'separator' },
          ] as const)
        : []),
      {
        label: 'Sair do Discordia',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** Onde a mini janela fica: borda direita e topo, para crescer para a esquerda ao expandir. */
const MINI_FILE = () => path.join(app.getPath('userData'), 'mini.json');

function loadMiniSpot(): { right: number; top: number } | null {
  try {
    const spot = JSON.parse(readFileSync(MINI_FILE(), 'utf8'));
    const visible = screen.getAllDisplays().some(({ workArea: a }) => spot.right > a.x + 40 && spot.right <= a.x + a.width + 4 && spot.top >= a.y && spot.top < a.y + a.height - 20);
    return visible ? spot : null;
  } catch {
    return null;
  }
}

let saveTimer: NodeJS.Timeout | undefined;
function saveMiniSpot() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!mini || mini.isDestroyed()) return;
    const b = mini.getBounds();
    writeFileSync(MINI_FILE(), JSON.stringify({ right: b.x + b.width, top: b.y }));
  }, 400);
}

/** O conteúdo diz o tamanho (compacta ou expandida); a borda direita fica parada. */
function resizeMini(width: number, height: number) {
  if (!mini || mini.isDestroyed()) return;
  const w = Math.round(Math.min(MINI_MAX.width, Math.max(MINI_MIN.width, width)));
  const h = Math.round(Math.min(MINI_MAX.height, Math.max(MINI_MIN.height, height)));
  const b = mini.getBounds();
  if (b.width === w && b.height === h) return;
  mini.setBounds({ x: b.x + b.width - w, y: b.y, width: w, height: h });
}

/** Mini janela: aparece por cima do jogo quando há chamada e a janela principal não está em foco. */
function updateMini() {
  const wanted = miniEnabled && !!call && !!win && !win.isFocused();
  if (!wanted) return mini?.hide();
  if (!mini || mini.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    const spot = loadMiniSpot() ?? { right: area.x + area.width - 16, top: area.y + 16 };
    mini = new BrowserWindow({
      width: MINI_MIN.width,
      height: MINI_MIN.height,
      x: spot.right - MINI_MIN.width,
      y: spot.top,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'mini-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    mini.setAlwaysOnTop(true, 'screen-saver');
    mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mini.on('moved', saveMiniSpot);
    void mini.loadFile(path.join(STATIC, 'mini.html'));
    mini.webContents.on('did-finish-load', () => mini?.webContents.send('call', call));
  }
  mini.webContents.send('call', call);
  if (!mini.isVisible()) mini.showInactive();
}

/** Atalhos globais só existem durante a chamada, para não roubar teclas de outros programas à toa. */
function updateShortcuts() {
  globalShortcut.unregisterAll();
  if (!call) return;
  const send = (shortcut: string) => () => win?.webContents.send('shortcut', shortcut);
  const map: [string, string][] = [
    ['Alt+Shift+M', 'mute'],
    ['Alt+Shift+D', 'deafen'],
    ['Alt+Shift+P', 'radio-pause'],
    ['Alt+Shift+N', 'radio-next'],
    ['Alt+Shift+Up', 'radio-up'],
    ['Alt+Shift+Down', 'radio-down'],
  ];
  for (const [accelerator, shortcut] of map) {
    if (!globalShortcut.register(accelerator, send(shortcut))) console.warn(`atalho ${accelerator} em uso por outro programa`);
  }
}

/** Apertar para falar no sistema todo. O hook só roda enquanto a função está ligada. */
function setPushToTalk(code: string | null) {
  const name = code ? keyName(code) : null;
  try {
    hook ??= require('uiohook-napi') as typeof import('uiohook-napi');
  } catch (err) {
    console.warn('hook de teclado indisponível', err);
    return;
  }
  const { uIOhook, UiohookKey } = hook;
  const next = name ? ((UiohookKey as Record<string, number>)[name] ?? null) : null;
  if (next === pttKey) return;
  uIOhook.removeAllListeners();
  if (pttRunning) uIOhook.stop();
  pttRunning = false;
  pttKey = next;
  pttHeld = false;
  if (pttKey === null) return;
  uIOhook.on('keydown', (e) => {
    if (e.keycode !== pttKey || pttHeld) return;
    pttHeld = true;
    win?.webContents.send('ptt', true);
  });
  uIOhook.on('keyup', (e) => {
    if (e.keycode !== pttKey || !pttHeld) return;
    pttHeld = false;
    win?.webContents.send('ptt', false);
  });
  try {
    uIOhook.start();
    pttRunning = true;
  } catch (err) {
    // macOS pede permissão de Acessibilidade; no Wayland só funciona com apps do XWayland.
    console.warn('hook de teclado não iniciou', err);
  }
}

const AUTOSTART_FILE = path.join(os.homedir(), '.config', 'autostart', 'discordia.desktop');

function getAutoStart() {
  if (process.platform === 'linux') return existsSync(AUTOSTART_FILE);
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(on: boolean) {
  if (process.platform !== 'linux') return app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (!on) return rmSync(AUTOSTART_FILE, { force: true });
  const exec = process.env.APPIMAGE ?? process.execPath;
  mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  writeFileSync(AUTOSTART_FILE, `[Desktop Entry]\nType=Application\nName=Discordia\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
}

function registerIpc() {
  // Só a página do app e a mini janela falam com o processo principal.
  const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent) => e.senderFrame?.url.startsWith(ORIGIN) ?? false;
  const fromMini = (e: IpcMainEvent) => !!mini && e.sender === mini.webContents;

  ipcMain.on('info', (e) => {
    e.returnValue = fromApp(e) ? { version: app.getVersion(), platform: process.platform, systemAudio: process.platform === 'win32' } : null;
  });
  ipcMain.handle('update:get', (e) => (fromApp(e) ? updateReady : null));
  ipcMain.on('update:install', (e) => {
    if (!fromApp(e) || !updateReady) return;
    quitting = true;
    // Sem Release de verdade (testes), só fecha.
    if (app.isPackaged) autoUpdater.quitAndInstall();
    else app.quit();
  });
  ipcMain.on('ptt-key', (e, code: unknown) => fromApp(e) && setPushToTalk(typeof code === 'string' ? code : null));
  ipcMain.on('mini', (e, on: unknown) => {
    if (!fromApp(e)) return;
    miniEnabled = Boolean(on);
    updateMini();
  });
  ipcMain.on('call', (e, next: Call | null) => {
    if (!fromApp(e)) return;
    const had = !!call;
    call = next && typeof next.channel === 'string' ? next : null;
    if (had !== !!call) updateShortcuts();
    updateTray();
    updateMini();
  });
  ipcMain.on('pick-answer', (e, answer: { id: number; choice: string | null }) => {
    if (fromApp(e)) picks.get(answer?.id)?.(typeof answer.choice === 'string' ? answer.choice : null);
  });
  ipcMain.on('mini-size', (e, size: { width?: unknown; height?: unknown }) => {
    if (fromMini(e) && typeof size?.width === 'number' && typeof size.height === 'number') resizeMini(size.width, size.height);
  });
  ipcMain.on('mini-action', (e, action: unknown) => {
    if (!fromMini(e)) return;
    if (action === 'open') return showMain();
    if (action === 'mute' || action === 'deafen' || action === 'leave') win?.webContents.send('call-action', action);
  });
  ipcMain.handle('autostart:get', (e) => fromApp(e) && getAutoStart());
  ipcMain.handle('autostart:set', (e, on: unknown) => {
    if (fromApp(e)) setAutoStart(Boolean(on));
  });
}

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pttRunning) hook?.uIOhook.stop();
});
app.on('activate', showMain);
app.on('window-all-closed', () => {
  // Fica na bandeja; sair é pelo menu dela.
});
