'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, session, dialog, nativeTheme, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isInterfaceURL } = require('./trusted-ui');
const { pageMetrics } = require('./metrics');
const { planViewLoads } = require('./view-loads');
const { closePage } = require('./view-close');
const { frameBudget, resolutions, resolutionBounds, sendFrameLimit } = require('./performance');
const { collectPageMemory } = require('./memory-cleanup');
const { Automation } = require('./automation');
const { ExtensionsStore } = require('./extensions-store');
const { reorderAccounts } = require('./account-order');
const { floatingPosition, floatingPositions, floatingDefault, floatingAccounts, floatingBounds, positionAt } = require('./floating-layout');
const { configureStorage, writeAccountGuide } = require('./storage');
const { Updates } = require('./updates');
const releaseConfig = require('./release-config.json');
const appVersion = require('../package.json').version;

let storage;
try { storage = configureStorage(app); }
catch (error) {
  dialog.showErrorBox('Astria — Save folder unavailable', 'Cannot open Save. Move the Astria folder to a writable location.\n\nNão foi possível abrir Save. Mova a pasta Astria para um local com permissão de gravação.\n\n' + error.message);
  app.exit(1);
}

app.setAppUserModelId('com.multinest.desktop');

// Rendering performance for browser games: request the high-performance GPU
// where Chromium supports it and keep page rasterization on the GPU.
// Set ASTRIA_SAFE_GPU=1 to start without these switches.
if (process.env.ASTRIA_SAFE_GPU !== '1') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

let windowMain;
let interfaceView;
const floatingViews=new Map(),floatingFrames=new Map();
let floatingDrag;
let state;
const I18n = require('./i18n');
const T = (value, ...values) => typeof value === 'string' ? I18n.translate(value, state?.preferences.language || 'en') : I18n.tag(value, values, state?.preferences.language || 'en');
let configPath;
let overlayOpen = false;
let metricsTimer;
let updates;
let automation,pendingPick,preparingPick;
let extensionsStore;
const extensionContexts=new Map(),extensionQueues=new Map(),extensionErrors=new Map();
let layoutReady = false;
let windowShown = false;
let quitting = false;
let pendingAccountFocus;
let closingApplication;
let allowWindowClose = false;
let quitAfterClosing = false;
const views = new Map();
const closingViews = new Map();
const initialLoads = new Map();
const viewStatuses = new Map();
const boundsForAccounts = new Map();
// Docked extension pages: the open page per account and its slot inside the account panel.
const dockActive = new Map(), dockBounds = new Map(), dockAttached = new Set();
const idleTimers = new Map();
const actions = new Map();
const activityModes = new Set(['always', 'eco', 'adaptive', 'visible', 'suspended']);
const ecoRates = [1, 5, 10, 15, 30];
const ecoFPS = account => ecoRates.includes(account.ecoFPS) ? account.ecoFPS : 15;
const backgroundMode = mode => mode === 'always' || mode === 'eco' || mode === 'adaptive';
const colors = { mint: '#46bfa8', blue: '#559ce8', violet: '#a78bed', amber: '#d7a744', rose: '#d981b0', red: '#e97778', slate: '#91a2b8' };
const normalizeColor = color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color) ? color.toLowerCase() : typeof color === 'string' && Object.hasOwn(colors, color) ? colors[color] : null;
const sidebarWidth = value => Math.max(44, Math.min(320, Math.round(value)));
const idleDelay = !app.isPackaged && process.env.ASTRIA_IDLE_MS ? Math.max(50, Number(process.env.ASTRIA_IDLE_MS) || 300000) : 300000;
const initialLoadLimit = !app.isPackaged && process.env.ASTRIA_INITIAL_LOAD_MS ? Math.max(100, Number(process.env.ASTRIA_INITIAL_LOAD_MS) || 10000) : 10000;
const modeFor = account => activityModes.has(account.activity) ? account.activity : 'visible';

// Disable app menu shortcuts without swallowing keys meant for the game.
app.on('web-contents-created', (_event, contents) => {
  contents.setIgnoreMenuShortcuts(true);
});

function requestAccountFocus(id = state?.selectedAccountId, afterLayout = true) {
  pendingAccountFocus = id ? { id, afterLayout } : undefined;
}

function focusRequestedAccount() {
  if (!pendingAccountFocus || pendingAccountFocus.afterLayout || overlayOpen || !windowMain?.isFocused() || windowMain.isMinimized()) return;
  const view = views.get(pendingAccountFocus.id);
  if (!view?.onScreen || view.webContents.isDestroyed()) return;
  // Consume the request once: metrics, resizing and state updates must not
  // steal focus from a game's chat field or from Astria's dialogs.
  pendingAccountFocus = undefined;
  view.webContents.focus();
}

const initialConfig = () => ({
  version: 1,
  activeWorkspaceId: 'games',
  selectedAccountId: null,
  workspaces: [{ id: 'games', name: T('Meus jogos'), layout: 'auto' }],
  accounts: [],
  preferences: { theme: 'dark', sidebarWidth: 152, language: 'en' }
});

const allowedLayouts = new Set(['auto', 'columns', 'rows', 'focus', 'floating']);
const safeString = (s, max = 120) => String(s ?? '').trim().slice(0, max);
const hasId = (id) => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);

function safeURL(value) {
  let input = safeString(value, 2048);
  if (!input || (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:/i.test(input) && !/^[\w.-]+:\d+(?:\/|$)/.test(input))) {
    throw new Error(T('Informe um endereço http/https válido.'));
  }
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;
  let url;
  try { url = new URL(input); } catch { throw new Error(T('URL inválida.')); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(T('Apenas sites http/https são permitidos.'));
  if (!url.hostname || url.username || url.password) throw new Error(T('URL inválida ou contém credenciais.'));
  return url.toString();
}

function normalizeImport(json) {
  if (!json || !Array.isArray(json.workspaces) || !Array.isArray(json.accounts)) {
    throw new Error(T('Arquivo de configuração inválido.'));
  }
  const used = new Set();
  const legacyFloating=new Map();
  const workspaces = [];
  for (const w of json.workspaces.slice(0, 100)) {
    if (!w || typeof w !== 'object') continue;
    const id = hasId(w.id) && !used.has(w.id) ? w.id : randomUUID();
    used.add(id);
    if(w.floating&&typeof w.floating==='object'&&!Array.isArray(w.floating))legacyFloating.set(id,w.floating);
    workspaces.push({ id, name: safeString(w.name, 55) || T('Espaço'), layout: allowedLayouts.has(w.layout) ? w.layout : 'auto', ...(w.floating ? {floating:floatingPositions(w.floating)} : {}) });
  }
  if (!workspaces.length) workspaces.push({ id: randomUUID(), name: T('Meus jogos'), layout: 'auto' });
  const wIds = new Set(workspaces.map(w => w.id));
  const accounts = [];
  for (const a of json.accounts.slice(0, 300)) {
    if (!a || typeof a !== 'object') continue;
    if (!wIds.has(a.workspaceId)) continue;
    try {
      const id = hasId(a.id) && !used.has(a.id) ? a.id : randomUUID();
      used.add(id);
      accounts.push({ id, workspaceId: a.workspaceId, name: safeString(a.name, 55) || T('Conta'), url: safeURL(a.url), muted: !!a.muted, zoom: Math.max(0.5, Math.min(2, Number(a.zoom) || 1)), color: normalizeColor(a.color) || colors.mint, activity: modeFor(a), ecoFPS: ecoFPS(a), resolution: Object.hasOwn(resolutions, a.resolution) ? a.resolution : 'auto' });
    } catch { /* skip malformed or unsupported entry */ }
  }
  for(const workspace of workspaces)if(legacyFloating.has(workspace.id)){
    const [entry]=floatingAccounts({workspaces:[{...workspace,layout:'floating',floating:legacyFloating.get(workspace.id)}],accounts,activeWorkspaceId:workspace.id,selectedAccountId:json.selectedAccountId});
    if(entry)workspace.floating=[{...entry.position,accountId:entry.account.id}];
  }
  return {
    version: 1,
    activeWorkspaceId: wIds.has(json.activeWorkspaceId) ? json.activeWorkspaceId : workspaces[0].id,
    selectedAccountId: accounts.some(a => a.id === json.selectedAccountId) ? json.selectedAccountId : null,
    workspaces, accounts,
    preferences: { theme: json.preferences?.theme === 'light' ? 'light' : 'dark', sidebarWidth: Number.isFinite(json.preferences?.sidebarWidth) ? sidebarWidth(json.preferences.sidebarWidth) : json.preferences?.sidebarCollapsed ? 44 : 152, language: json.preferences?.language === 'en' ? 'en' : 'pt-BR', visualRest: json.preferences?.visualRest === true }
  };
}

function loadState() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    return normalizeImport(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch (err) {
    if (fs.existsSync(configPath)) {
      try { fs.copyFileSync(configPath, configPath + '.backup-' + Date.now()); } catch { /* ignore */ }
      console.warn('Configuração inválida; cópia de segurança criada:', err.message);
    }
    return initialConfig();
  }
}

function persistState() {
  const temp = configPath + '.tmp';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { ultraAccountId, ...saved } = state;
  fs.writeFileSync(temp, JSON.stringify(saved, null, 2), { mode: 0o600 });
  fs.renameSync(temp, configPath);
  writeAccountGuide(storage, state);
}

function currentAccounts() {
  return state.accounts.filter(a => a.workspaceId === state.activeWorkspaceId);
}

function isAutomating(id){return automation?.runs.has(id)||extensionContexts.get(id)?.controlling;}

function accountSession(id){
  const siteSession=session.fromPartition(`persist:multinest-${id}`,{cache:true});
  siteSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  siteSession.setPermissionCheckHandler(()=>false);
  siteSession.setDevicePermissionHandler?.(()=>false);
  if(storage.portable)siteSession.setDownloadPath(storage.games);
  return siteSession;
}

function extensionQueue(id,operation){
  const previous=extensionQueues.get(id)||Promise.resolve();
  const next=previous.catch(()=>{}).then(operation);extensionQueues.set(id,next);
  next.finally(()=>{if(extensionQueues.get(id)===next)extensionQueues.delete(id);}).catch(()=>{});return next;
}

function extensionContext(id){
  accountById(id);
  if(state.accounts.some(account=>account.id!==id&&account.id.toLowerCase()===id.toLowerCase()))throw Error(T('IDs de contas conflitam neste Windows.'));
  if(!extensionContexts.has(id)){
    const {AccountExtensions}=require('./extensions-runtime');
    const siteSession=accountSession(id);
    extensionContexts.set(id,new AccountExtensions({session:siteSession,game:()=>views.get(id)?.webContents,window:()=>windowMain,onActivity:()=>refreshViews(),onDock:(extensionId,view,event)=>{
      if(event==='open')dockActive.set(id,extensionId);
      else if(dockActive.get(id)===extensionId)dockActive.set(id,null);
      sendDocks();refreshViews();
    },selectGame:()=>{const account=accountById(id);state.activeWorkspaceId=account.workspaceId;selectAccountState(id);requestAccountFocus();publish();},onWindow:child=>{
      const view=views.get(id);if(view){view.popups.add(child);child.on('closed',()=>view.popups.delete(child));}
    }}));
  }
  return extensionContexts.get(id);
}

function prepareExtensions(id,contents){return extensionQueue(id,async()=>{
  if(quitting)return;
  const entries=extensionsStore.list(id).filter(entry=>entry.enabled);
  if(!entries.length&&!extensionContexts.has(id))return;
  const context=extensionContext(id);if(contents&&!contents.isDestroyed())context.addGame(contents);
  const errors=extensionErrors.get(id)||new Map();extensionErrors.set(id,errors);
  for(const entry of entries){
    if(session.fromPartition(`persist:multinest-${id}`).extensions.getExtension(entry.extensionId))continue;
    try{const loaded=await context.load(extensionsStore.folder(id,entry.id));if(loaded.id!==entry.extensionId){await context.unload(loaded.id);throw Error(T('A identidade da extensão mudou. Reinstale a pasta.'));}errors.delete(entry.id);}
    catch(error){errors.set(entry.id,error.message||String(error));}
  }
});}

function dockState(){
  const result={};
  for(const [id,context] of extensionContexts){
    if(!state.accounts.some(a=>a.id===id)||!context.docked.size)continue;
    let entries=[];try{entries=extensionsStore.list(id);}catch{}
    const open=[...context.docked.keys()].map(extensionId=>{const entry=entries.find(item=>item.extensionId===extensionId);return {extensionId,entryId:entry?.id||'',name:entry?.name||extensionId};});
    result[id]={active:context.docked.has(dockActive.get(id))?dockActive.get(id):null,open};
  }
  return result;
}
function sendDocks(){if(windowMain&&!windowMain.isDestroyed())windowMain.webContents.send('extensions:docks',dockState());}
// Docked pages sit above the interface in the slot the renderer reserved inside the account panel.
function refreshDocks(windowVisible){
  const root=windowMain.contentView,want=new Map();
  if(windowVisible&&!overlayOpen)for(const [id,extensionId] of dockActive){
    const view=extensionId&&extensionContexts.get(id)?.docked.get(extensionId),bounds=dockBounds.get(id);
    if(view&&bounds&&!view.webContents.isDestroyed())want.set(view,bounds);
  }
  for(const view of dockAttached)if(!want.has(view)){try{root.removeChildView(view);}catch{/* already gone */}dockAttached.delete(view);}
  for(const [view,bounds] of want){view.setBounds(bounds);if(!root.children.includes(view))root.addChildView(view);dockAttached.add(view);}
}
const extensionIcons=new Map();
function extensionIcon(id,entry){
  const key=`${id}|${entry.id}|${entry.version}`;
  if(extensionIcons.has(key))return extensionIcons.get(key);
  let icon='';
  try{
    const icons=entry.manifest?.icons||entry.manifest?.action?.default_icon||{};
    const sizes=typeof icons==='string'?[[32,icons]]:Object.entries(icons).map(([size,file])=>[Number(size),file]).filter(([size,file])=>size>0&&typeof file==='string');
    sizes.sort((a,b)=>(a[0]>=32?a[0]:1000+a[0])-(b[0]>=32?b[0]:1000+b[0]));
    const folder=path.resolve(extensionsStore.folder(id,entry.id)),file=sizes[0]&&path.resolve(folder,sizes[0][1].replace(/^\/+/,''));
    const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file||'').toLowerCase()];
    if(file&&type&&file.startsWith(folder+path.sep)&&fs.statSync(file).size<=512*1024)icon=`data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  }catch{/* letter fallback */}
  extensionIcons.set(key,icon);return icon;
}

function listExtensions(id){
  accountById(id);const siteSession=session.fromPartition(`persist:multinest-${id}`);
  return extensionsStore.list(id).map(entry=>({...entry,icon:extensionIcon(id,entry),loaded:!!siteSession.extensions.getExtension(entry.extensionId),error:extensionErrors.get(id)?.get(entry.id)||''}));
}

function selectDefaultAccount() {
  const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId),accounts=currentAccounts();
  const floating=new Set(workspace.layout==='floating'?(floatingPositions(workspace.floating)||[]).map(p=>p.accountId):[]);
  state.selectedAccountId=(accounts.find(a=>!floating.has(a.id))||accounts[0])?.id||null;
  if(workspace.layout==='floating'&&Array.isArray(workspace.floating))workspace.floating=workspace.floating.filter(p=>p.accountId!==state.selectedAccountId);
}

function publish() {
  if (state.ultraAccountId && (state.ultraAccountId !== state.selectedAccountId || !currentAccounts().some(a => a.id === state.ultraAccountId && modeFor(a) !== 'suspended'))) {
    state.ultraAccountId = null;
    windowMain?.setFullScreen(false);
  }
  persistState();
  if (windowMain && !windowMain.isDestroyed()) windowMain.webContents.send('state:updated', state);
  refreshViews();
}

function setStatus(id, patch) {
  const previous = viewStatuses.get(id) || {};
  if (Object.entries(patch).every(([key, value]) => previous[key] === value)) return;
  viewStatuses.set(id, { ...viewStatuses.get(id), ...patch });
  if (windowMain && !windowMain.isDestroyed()) {
    windowMain.webContents.send('view:status', { id, ...viewStatuses.get(id) });
  }
}

function finishInitialLoad(id, view) {
  const pending = initialLoads.get(id);
  if (!pending || pending.view !== view) return;
  clearTimeout(pending.timer);
  initialLoads.delete(id);
  if (!quitting && windowMain && !windowMain.isDestroyed()) setImmediate(refreshViews);
}

function performanceFor(account) {
  const visible = windowMain?.isVisible() && !windowMain.isMinimized() && !overlayOpen && boundsForAccounts.has(account.id);
  const rest = !visible && state.preferences.visualRest;
  const ultraBackground = !!state.ultraAccountId && account.id !== state.ultraAccountId;
  return { fps: frameBudget(account, {active: visible && account.id === state.selectedAccountId, loaded: views.size, rest, ultraBackground}), resting: !!(rest || ultraBackground) };
}

function setFrameLimit(contents, account, force = false) {
  if (contents.isDestroyed()) return;
  const { fps, resting } = performanceFor(account);
  contents.setAudioMuted(!!account.muted || resting);
  if (contents.astriaResting !== resting) {
    // shortcut: Chromium applies this to newly decoded images; do not reset game-owned image sources.
    contents.setImageAnimationPolicy(resting ? 'noAnimation' : 'animate');
    contents.astriaResting = resting;
  }
  if (!force && contents.astriaFPS === fps) return;
  contents.astriaFPS = sendFrameLimit(contents, fps) ? fps : undefined;
}

function applyResolution(view, account, panel = view.getBounds()) {
  view.panelBounds = panel;
  const contents = view.webContents, size = resolutions[account.resolution] || view.floatingViewport;
  const fitted = resolutionBounds(size, panel);
  if (fitted) {
    // A new native view has no render widget yet. Initialize at the game's
    // preset size below the UI, then fit it only after the document is ready.
    if (!view.rendererReady) {
      contents.astriaInputScale=1;
      view.setBounds({x:panel.x,y:panel.y,...size});
      contents.setZoomFactor(1);
      return;
    }
    const key = `${size.width}x${size.height}:${fitted.width}:${fitted.height}`;
    contents.astriaInputScale=fitted.width/size.width;
    view.setBounds(fitted);
    if (view.resolutionKey !== key) {
      contents.setZoomFactor(1);
      contents.enableDeviceEmulation({screenPosition:'desktop', screenSize:size, viewPosition:{x:0,y:0}, deviceScaleFactor:1, viewSize:size, scale:fitted.width/size.width});
      view.emulated = true;
    }
    view.resolutionKey = key;
  } else {
    contents.astriaInputScale=1;
    if (view.emulated && view.rendererReady) { contents.disableDeviceEmulation(); view.emulated = false; }
    view.resolutionKey = null;
    view.setBounds(panel);
    contents.setZoomFactor(account.zoom || 1);
  }
}

function configureGameFrames(contents, accountId) {
  const sync = () => {
    const account = state.accounts.find(a => a.id === accountId);
    if (account) setFrameLimit(contents, account, true);
  };
  contents.on('dom-ready', sync);
  contents.on('frame-created', (_event, { frame }) => frame.once('dom-ready', sync));
}

function makeView(account) {
  if (quitting || closingViews.has(account.id)) return null;
  if (views.has(account.id)) return views.get(account.id);
  if (modeFor(account) === 'suspended') return null;
  const partition = `persist:multinest-${account.id}`;
  const siteSession = accountSession(account.id);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !backgroundMode(modeFor(account)),
      preload: path.join(__dirname, 'game-preload.js'),
      nodeIntegrationInSubFrames: true,
      additionalArguments: ['--astria-fps=' + performanceFor(account).fps],
      javascript: true,
      // Games rarely need spellcheck; it costs a dictionary and work per keystroke.
      spellcheck: false,
      // Cache compiled game scripts on first run so reloads and resumes start faster.
      v8CacheOptions: 'bypassHeatCheck'
    }
  });
  view.activityMode = modeFor(account);
  view.rendererReady = false;
  view.webContents.on('dom-ready', () => {
    if (view.webContents.isDestroyed() || views.get(account.id) !== view) return;
    view.rendererReady = true;
    view.resolutionKey = null;
    applyResolution(view, accountById(account.id), view.panelBounds || view.getBounds());
    refreshViews();
  });
  // Provisional/download navigations can abort and retain the existing document.
  view.webContents.on('did-navigate', () => { view.rendererReady = false; cancelPick(account.id); automation?.stop(account.id).catch(()=>{}); });
  for(const event of ['render-process-gone','destroyed'])view.webContents.on(event,()=>{cancelPick(account.id);automation?.stop(account.id).catch(()=>{});});
  view.throttled = !backgroundMode(modeFor(account));
  configureGameFrames(view.webContents, account.id);
  views.set(account.id, view);
  // A broken/slow website must not hold the startup queue indefinitely.
  initialLoads.set(account.id, { view, timer: setTimeout(() => finishInitialLoad(account.id, view), initialLoadLimit) });
  setStatus(account.id, { queued: false, sleeping: false, loading: true, error: '' });
  // Like a background browser tab, initialize at a real viewport size. A 1x1
  // surface can leave games with incorrect initial cameras, maps or HUDs.
  const [windowWidth, windowHeight] = windowMain.getContentSize();
  const interfaceBounds = interfaceView.getBounds();
  const width = windowWidth || interfaceBounds.width, height = windowHeight || interfaceBounds.height;
  const initialBounds = boundsForAccounts.get(account.id) || boundsForAccounts.get(state.selectedAccountId) || boundsForAccounts.values().next().value;
  view.setBounds(initialBounds || { x: 0, y: 36, width, height: Math.max(75, height - 36) });
  applyResolution(view, account);
  setFrameLimit(view.webContents, account);

  // Use the regular Chromium UA where Electron's brand could cause false incompatibility.
  const ua = view.webContents.getUserAgent().replace(/\sElectron\/\S+/g, '');
  view.webContents.setUserAgent(ua);
  view.webContents.on('context-menu', (_event, params) => {if(pendingPick?.id!==account.id&&Date.now()>(view.webContents.astriaAutomationContextUntil||0))showAccountMenu(account.id, null, params);});
  view.webContents.on('focus', () => {
    if (!overlayOpen && view.onScreen && !view.floatingViewport && state.selectedAccountId !== account.id) {
      selectAccountState(account.id);
      publish();
    }
  });
  const allowWebNavigation = (event, url) => {
    try { safeURL(url); if (!/^https?:\/\//i.test(url)) event.preventDefault(); }
    catch { event.preventDefault(); }
  };
  view.webContents.on('will-navigate', allowWebNavigation);
  view.webContents.on('will-redirect', allowWebNavigation);
  view.webContents.on('will-attach-webview', event => event.preventDefault());
  view.popups = new Set();
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (quitting || view.closing) return { action: 'deny' };
    try {
      safeURL(url);
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: {
        parent: windowMain,
        width: 960, height: 760,
        webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false,
          preload: path.join(__dirname, 'game-preload.js'), nodeIntegrationInSubFrames: true,
          additionalArguments: ['--astria-fps=' + performanceFor(account).fps] }
      } };
    } catch { return { action: 'deny' }; }
  });
  view.webContents.on('did-create-window', child => {
    view.popups.add(child);
    configureGameFrames(child.webContents, account.id);
    setFrameLimit(child.webContents, accountById(account.id));
    child.on('closed', () => view.popups.delete(child));
    child.webContents.on('will-navigate', allowWebNavigation);
    child.webContents.on('will-redirect', allowWebNavigation);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  view.webContents.on('did-start-loading', () => setStatus(account.id, { loading: true, error: '' }));
  view.webContents.on('did-stop-loading', () => {
    setStatus(account.id, { loading: false });
    finishInitialLoad(account.id, view);
  });
  view.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) setStatus(account.id, { loading: false, error: description });
  });
  view.webContents.on('render-process-gone', (_event, details) => {
    view.rendererReady = false; view.emulated = false; view.resolutionKey = null;
    finishInitialLoad(account.id, view);
    setStatus(account.id, { error: T('Processo encerrado: ') + details.reason });
  });
  Promise.resolve().then(async () => {
    try{await prepareExtensions(account.id,view.webContents);}catch(error){if(!quitting)windowMain.webContents.send('ui:toast',T('Extensões')+': '+error.message);}
    if (views.get(account.id) === view && !view.webContents.isDestroyed()) return view.webContents.loadURL(account.url);
  }).catch(err => {
    setStatus(account.id, { error: err.message, loading: false });
    finishInitialLoad(account.id, view);
  });
  return view;
}

function destroyView(id, preserveBounds = false) {
  cancelPick(id);
  clearTimeout(idleTimers.get(id)); idleTimers.delete(id);
  clearTimeout(initialLoads.get(id)?.timer); initialLoads.delete(id);
  const view = views.get(id);
  if (!view) return closingViews.get(id) || Promise.resolve();
  view.closing = true;
  if (windowMain && !windowMain.isDestroyed()) {
    try { windowMain.contentView.removeChildView(view); } catch { /* wasn't attached */ }
  }
  views.delete(id);
  viewStatuses.delete(id);
  if (!preserveBounds) boundsForAccounts.delete(id);
  const active=automation?.runs.has(id),stopping=automation?.stop(id);
  const close=()=>Promise.all([closePage(view.webContents), ...[...(view.popups || [])].filter(popup => !popup.isDestroyed()).map(popup => closePage(popup.webContents))]);
  const completion = (active?Promise.resolve(stopping).then(close):close()).finally(() => {
    closingViews.delete(id);
    if (!quitting && windowMain && !windowMain.isDestroyed()) setImmediate(refreshViews);
  });
  closingViews.set(id, completion);
  // Background suspension/removal also uses this path, without an awaited IPC.
  completion.catch(error => {
    if (windowMain && !windowMain.isDestroyed()) windowMain.webContents.send('ui:toast', error.message);
  });
  return completion;
}

function closeApplication(quit = false) {
  quitAfterClosing ||= quit;
  if (closingApplication) return closingApplication;
  quitting = true;
  cancelPick();
  closingApplication = Promise.all([automation?.stopAll(),...[...new Set([...extensionContexts.keys(),...extensionQueues.keys()])].map(id=>extensionQueue(id,()=>extensionContexts.get(id)?.dispose())),...closingViews.values(), ...[...views.keys()].map(id => destroyView(id))]).then(() => {
    allowWindowClose = true;
    if (quitAfterClosing) app.quit();
    else if (windowMain && !windowMain.isDestroyed()) windowMain.close();
  }).catch(error => {
    closingApplication = undefined; quitting = false; quitAfterClosing = false;
    if (windowMain && !windowMain.isDestroyed()) windowMain.webContents.send('ui:toast', error.message);
    setImmediate(refreshViews);
  });
  return closingApplication;
}

// Put a game surface above (on screen) or below (running in the background)
// the interface. An already-attached view is detached and attached again
// instead of being reordered in place: on Windows an in-place reorder can
// leave the native surface stacked where it was, so a background game kept
// drawing above the interface and showed through a suspended or empty panel.
function placeView(view, layer) {
  const root = windowMain.contentView;
  const children = root.children;
  const index = children.indexOf(view), ui = children.indexOf(interfaceView);
  const correct = index !== -1 && (layer === 'above' ? index > ui : index < ui);
  if (correct) return;
  if (index !== -1) root.removeChildView(view);
  if (layer === 'above') root.addChildView(view);
  else root.addChildView(view, 0);
}

function refreshViews() {
  if (quitting || !windowMain || windowMain.isDestroyed()) return;
  updateFloatingFrame();
  const windowVisible = windowMain.isVisible() && !windowMain.isMinimized();
  const floatingByAccount=new Map([...floatingFrames.values()].map(frame=>[frame.accountId,frame]));
  const visible = new Set(windowVisible ? currentAccounts().filter(a => boundsForAccounts.has(a.id) && (!state.ultraAccountId || state.ultraAccountId === a.id || floatingByAccount.has(a.id))).map(a => a.id) : []);
  // Release slots belonging to accounts that were suspended before this pass.
  for (const account of state.accounts) if (modeFor(account) === 'suspended') destroyView(account.id, true);
  const starts = planViewLoads(state.accounts, {
    ready: layoutReady && windowShown, visible, existing: new Set(views.keys()),
    loading: new Set(initialLoads.keys()), selected: state.selectedAccountId
  });
  for (const account of starts) {
    makeView(account);
  }
  // Release the host window's forced-visible state before hiding its surfaces.
  // Minimized pages then get Chromium's normal hidden-page fallback instead of
  // reporting 'visible' while no animation frames can be delivered.
  for (const account of state.accounts) {
    const view = views.get(account.id);
    if (!view) continue;
    const frame=floatingByAccount.get(account.id),floatingSize=frame?.viewport;
    if (floatingSize || view.floatingViewport) {
      const panel = boundsForAccounts.get(account.id) || view.floatingArea || view.panelBounds;
      view.floatingViewport = floatingSize;
      if (floatingSize) view.floatingArea = frame.area;
      if (panel) applyResolution(view,account,panel);
    }
    const automating=isAutomating(account.id);
    const throttled = !automating && (!(backgroundMode(modeFor(account)) || state.preferences.visualRest || state.ultraAccountId) || !windowVisible);
    if (view.throttled !== throttled) {
      view.webContents.setBackgroundThrottling(throttled);
      view.throttled = throttled;
    }
    setFrameLimit(view.webContents, account);
    for (const child of view.popups) if (!child.isDestroyed()) setFrameLimit(child.webContents, account);
  }
  for (const account of state.accounts) {
    const mode = modeFor(account), onScreen = visible.has(account.id);
    if (mode === 'suspended') {
      destroyView(account.id, true);
      setStatus(account.id, { queued: false, sleeping: true, loading: false, error: '' });
      continue;
    }
    if (backgroundMode(mode) || onScreen || isAutomating(account.id) || ((state.preferences.visualRest || state.ultraAccountId) && views.has(account.id))) {
      clearTimeout(idleTimers.get(account.id)); idleTimers.delete(account.id);
      const view = views.get(account.id);
      if (!view) {
        setStatus(account.id, { queued: true, sleeping: false, loading: false, error: '' });
        continue;
      }
      view.activityMode = mode;
      view.onScreen = onScreen && !overlayOpen && (view.rendererReady || !resolutions[account.resolution] && !view.floatingViewport);
      if (view.onScreen) {
        applyResolution(view, account, boundsForAccounts.get(account.id));
        view.setVisible(true);
        placeView(view, 'above');
      } else {
        // Keep full-sized background surfaces below the actual UI page.
        // Hiding or moving them outside the window slows frame-driven games.
        view.setVisible(windowVisible);
        placeView(view, 'below');
      }
    } else {
      if (viewStatuses.get(account.id)?.queued) setStatus(account.id, { queued: false });
      const view = views.get(account.id);
      if (!view) continue;
      view.onScreen = false;
      view.activityMode = mode;
      view.setVisible(false);
      if (windowMain.contentView.children.includes(view)) windowMain.contentView.removeChildView(view);
      if (!idleTimers.has(account.id)) {
        idleTimers.set(account.id, setTimeout(() => {
          idleTimers.delete(account.id);
          if (modeFor(accountById(account.id)) === 'visible') {
            destroyView(account.id, true);
            setStatus(account.id, { sleeping: true, loading: false });
          }
        }, idleDelay));
      }
    }
  }
  refreshDocks(windowVisible);
  refreshFloatingView();
  focusRequestedAccount();
  scheduleMetrics();
}

function visibleViews() {
  if (!windowMain || windowMain.isDestroyed() || !windowMain.isVisible() || windowMain.isMinimized() || overlayOpen) return [];
  const attached = windowMain.contentView.children;
  return [...views].filter(([, view]) => attached.includes(view) && view.onScreen && !view.webContents.isDestroyed());
}

function updateFloatingFrame() {
  for(const frame of floatingFrames.values())if(boundsForAccounts.get(frame.accountId)===frame.body)boundsForAccounts.delete(frame.accountId);
  floatingFrames.clear();
  const entries=floatingAccounts(state);
  const primary=currentAccounts().find(a=>a.id===state.selectedAccountId)||currentAccounts()[0];
  const slot=primary&&boundsForAccounts.get(primary.id);
  const area=slot&&(resolutionBounds(primary.resolution,slot)||slot);
  if(!entries.length||!area)return;
  const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  if(!Array.isArray(workspace.floating))workspace.floating=entries.map(({account,position})=>({...position,accountId:account.id}));
  for(const {account:secondary,position,index} of entries){
    const viewport=resolutions[secondary.resolution]||{width:Math.round(area.width/(secondary.zoom||1)),height:Math.round(area.height/(secondary.zoom||1))};
    const card=floatingBounds(area,viewport,position);
    if(!card)continue;
    workspace.floating[index]={...position,accountId:secondary.id};
    const body={x:card.x+2,y:card.y+26,width:card.width-4,height:card.height-28};
    floatingFrames.set(index,{accountId:secondary.id,primaryId:primary.id,workspaceId:workspace.id,slot,area,viewport,card,body});
    boundsForAccounts.set(secondary.id,body);
  }
}

function closeFloatingView(index) {
  for(const key of index===undefined?[...floatingViews.keys()]:[index]){
    if(floatingDrag?.index===key)floatingDrag=undefined;
    const chrome=floatingViews.get(key);if(!chrome)continue;
    if(windowMain&&!windowMain.isDestroyed()&&windowMain.contentView.children.includes(chrome))windowMain.contentView.removeChildView(chrome);
    floatingViews.delete(key);
    if(!chrome.webContents.isDestroyed())chrome.webContents.close();
  }
}

function sendFloatingState(index) {
  const chrome=floatingViews.get(index),frame=floatingFrames.get(index);
  if(!chrome||chrome.webContents.isDestroyed()||!frame)return;
  const a=accountById(frame.accountId),workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  const value={name:a.name,color:a.color,theme:state.preferences.theme,language:state.preferences.language,ready:!!views.get(a.id)?.onScreen,pinned:!!workspace.floating[index]?.pinned};
  const key=JSON.stringify(value);
  if(chrome.stateKey!==key){chrome.stateKey=key;chrome.webContents.send('floating:state',value);}
}

function raiseFloating(view) {
  if(windowMain.contentView.children.at(-1)===view)return;
  if(windowMain.contentView.children.includes(view))windowMain.contentView.removeChildView(view);
  windowMain.contentView.addChildView(view);
}

function refreshFloatingView() {
  const eligible=new Set(floatingAccounts(state).map(entry=>entry.index));
  for(const [index,chrome] of [...floatingViews])if(!eligible.has(index)||chrome.workspaceId!==state.activeWorkspaceId)closeFloatingView(index);
  const stack=[];
  for(const index of eligible){
    const frame=floatingFrames.get(index);
    const show=!!frame&&!overlayOpen&&windowMain.isVisible()&&!windowMain.isMinimized();
    let chrome=floatingViews.get(index);
    if(!show){
      if(floatingDrag?.index===index)floatingDrag=undefined;
      if(chrome){chrome.setVisible(false);if(windowMain.contentView.children.includes(chrome))windowMain.contentView.removeChildView(chrome);}
      continue;
    }
    if(!chrome){
      chrome=new WebContentsView({webPreferences:{preload:path.join(__dirname,'floating-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});
      chrome.workspaceId=state.activeWorkspaceId;floatingViews.set(index,chrome);chrome.setBackgroundColor('#00000000');
      chrome.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      chrome.webContents.on('will-navigate',event=>event.preventDefault());
      const control=chrome;
      chrome.webContents.once('did-finish-load',()=>{if(floatingViews.get(index)===control){control.stateKey=undefined;sendFloatingState(index);}});
      chrome.webContents.loadFile(path.join(__dirname,'floating.html'));
    }
    chrome.setBounds(frame.card);chrome.setVisible(true);
    const game=views.get(frame.accountId);
    if(game?.onScreen)stack.push(game);
    stack.push(chrome);sendFloatingState(index);
  }
  // Preserve each game's native surface immediately below its transparent controls.
  const tail=windowMain.contentView.children.slice(-stack.length);
  if(stack.some((view,index)=>tail[index]!==view))for(const view of stack)raiseFloating(view);
}

function floatingIndex(event) {
  for(const [index,chrome] of floatingViews)if(!chrome.webContents.isDestroyed()&&event.sender===chrome.webContents&&event.senderFrame===chrome.webContents.mainFrame&&isInterfaceURL(event.senderFrame?.url,path.join(__dirname,'floating.html')))return index;
}

function swapFloating(index) {
  const frame=floatingFrames.get(index);
  if(!frame||overlayOpen||!windowMain.isVisible()||windowMain.isMinimized())return {ok:false};
  const {accountId,primaryId,slot}=frame,workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  workspace.floating[index]={...floatingPosition(workspace.floating[index]),accountId:primaryId};
  state.selectedAccountId=accountId;
  if(state.ultraAccountId)state.ultraAccountId=accountId;
  floatingDrag=undefined;boundsForAccounts.set(accountId,slot);
  requestAccountFocus();publish();return {ok:true};
}

function moveFloating(index,x,y) {
  const frame=floatingFrames.get(index),workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  if(!frame||overlayOpen||workspace.floating[index]?.pinned)return;
  workspace.floating[index]={...floatingPosition(workspace.floating[index]),accountId:frame.accountId,...positionAt(frame.area,frame.card,x,y)};
  refreshViews();
}

function resizeFloating(index,width,origin=floatingFrames.get(index)?.card) {
  const frame=floatingFrames.get(index),workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  if(!frame||overlayOpen||workspace.floating[index]?.pinned)return;
  const {area,viewport}=frame;
  const position={...floatingPosition(workspace.floating[index]),width:Math.max(180,width)/area.width};
  const card=floatingBounds(area,viewport,position);
  workspace.floating[index]={...position,width:card.width/area.width,accountId:frame.accountId,...positionAt(area,card,origin.x,origin.y)};
  refreshViews();
}

function selectAccountState(id) {
  const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
  if(workspace.layout==='floating'&&state.selectedAccountId!==id&&currentAccounts().some(a=>a.id===state.selectedAccountId)){
    const entries=floatingAccounts(state),target=entries.find(entry=>entry.account.id===id)||entries[0];
    if(target){
      if(!Array.isArray(workspace.floating))workspace.floating=entries.map(({account,position})=>({...position,accountId:account.id}));
      workspace.floating[target.index]={...target.position,accountId:state.selectedAccountId};
    }
  }
  state.selectedAccountId=id;
}

function scheduleMetrics(delay = 200) {
  if (!visibleViews().length) {
    clearTimeout(metricsTimer); metricsTimer = undefined; return;
  }
  if (metricsTimer !== undefined) return;
  metricsTimer = setTimeout(() => {
    metricsTimer = undefined;
    const entries = visibleViews();
    if (!entries.length) return;
    const pages = entries.map(([id, view]) => {
      const pids = new Set([view.webContents.getOSProcessId()]);
      for (const contents of [view.webContents, ...[...view.popups].filter(popup => !popup.isDestroyed()).map(popup => popup.webContents)]) {
        try { for (const frame of contents.mainFrame.framesInSubtree) if (frame.osProcessId > 0) pids.add(frame.osProcessId); } catch { /* a frame may exit during sampling */ }
      }
      return { id, pids: [...pids] };
    });
    windowMain.webContents.send('view:metrics', pageMetrics(pages, app.getAppMetrics()));
    scheduleMetrics(2500);
  }, delay);
}

function accountById(id) {
  const account = state.accounts.find(a => a.id === id);
  if (!account) throw new Error(T('Conta não encontrada.'));
  return account;
}

function cancelPick(id) {
  if(id&&pendingPick?.id!==id&&preparingPick?.id!==id)return;
  preparingPick=undefined;
  if(!pendingPick)return;
  const pick=pendingPick;pendingPick=undefined;clearTimeout(pick.timer);
  if(!pick.contents.isDestroyed())pick.contents.send('astria:automation-pick-cancel');
  pick.resolve({ok:true,cancelled:true});
}

function automationPoint(value) {
  if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y)||value.x<0||value.x>=1||value.y<0||value.y>=1||!Number.isFinite(value.width)||!Number.isFinite(value.height)||value.width<1||value.height<1||value.width>100000||value.height>100000)throw Error(T('Ponto inválido.'));
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}

async function pickAutomationPoint(id,initial) {
  accountById(id);if(initial)initial=automationPoint(initial);
  cancelPick();const preparation={id};preparingPick=preparation;
  await automation.stop(id);if(preparingPick!==preparation)return {ok:true,cancelled:true};
  const a=accountById(id);if(modeFor(a)==='suspended')throw Error(T('Retome a conta suspensa primeiro.'));
  state.activeWorkspaceId=a.workspaceId;selectAccountState(id);requestAccountFocus();publish();
  let view;
  for(let n=0;n<100;n++){
    if(preparingPick!==preparation)return {ok:true,cancelled:true};
    view=views.get(id);
    if(view?.rendererReady&&view.onScreen&&!overlayOpen)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(preparingPick!==preparation)return {ok:true,cancelled:true};
  preparingPick=undefined;
  if(!view?.rendererReady||!view.onScreen||overlayOpen)throw Error(T('Aguarde o carregamento da página.'));
  return new Promise(resolve=>{
    const token=randomUUID(),contents=view.webContents;
    pendingPick={id,token,contents,resolve,timer:setTimeout(()=>cancelPick(id),300000)};
    contents.send('astria:automation-pick',{token,point:initial,text:T('Clique para marcar · Setas para ajustar · Enter confirma · Esc ou botão direito cancela')});
    if(windowMain.isFocused())contents.focus();
  });
}

function listen(name, fn, authorize = trustedSender) {
  actions.set(name, fn);
  ipcMain.handle(name, async (event, ...args) => {
    try {
      if (!authorize(event)) throw new Error(T('Origem não autorizada.'));
      return await fn(...args);
    }
    catch (err) { return { ok: false, error: T(err.message || String(err)) }; }
  });
}

function trustedSender(event) {
  return !!windowMain && !windowMain.isDestroyed() &&
    event.sender === windowMain.webContents &&
    event.senderFrame === windowMain.webContents.mainFrame &&
    isInterfaceURL(event.senderFrame?.url, path.join(__dirname, 'index.html'));
}

function updateTitleBar() {
  if (process.platform !== 'win32' || !windowMain || windowMain.isDestroyed()) return;
  const light = state.preferences.theme === 'light';
  windowMain.setTitleBarOverlay({ color: light ? '#ffffff' : '#121a29', symbolColor: light ? '#243247' : '#dbe5f3', height: 36 });
}

function uiCommand(type, id) {
  windowMain.webContents.send('ui:command', { type, id });
}

function runAction(name, ...args) {
  return Promise.resolve().then(() => actions.get(name)(...args)).catch(error => {
    if (windowMain && !windowMain.isDestroyed()) windowMain.webContents.send('ui:toast', error.message);
  });
}

function layoutMenuItems(workspace) {
  const items=Object.entries({auto:T('Grade automática'),columns:T('Colunas'),rows:T('Linhas'),focus:T('Uma conta por vez'),floating:T('Flutuante')}).map(([layout,label])=>({label,type:'radio',checked:workspace.layout===layout,click:()=>runAction('workspace:layout',layout).then(result=>{if(result?.ok&&layout==='floating')uiCommand('floating-accounts');})}));
  return [...items,{type:'separator'},{label:T('Contas flutuantes…'),enabled:currentAccounts().length>1,click:()=>uiCommand('floating-accounts')}];
}

function popupMenu(template, point) {
  const options = { window: windowMain };
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    const [width, height] = windowMain.getContentSize();
    options.x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
    options.y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  }
  Menu.buildFromTemplate(template).popup(options);
}

function showAccountMenu(id, point, params) {
  const a = accountById(id), v = views.get(id);
  const ordered=currentAccounts(),index=ordered.findIndex(account=>account.id===id);
  const move=offset=>{const ids=ordered.map(account=>account.id);[ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];return runAction('account:order',a.workspaceId,ids);};
  const template = [
    { label: a.name, enabled: false },
    { label: T('Renomear conta…'), click: () => uiCommand('rename-account', id) },
    { label: T('Escolher cor…'), click: () => uiCommand('account-color', id) },
    { label: T('Mover para cima'), enabled:index>0, click:()=>move(-1) },
    { label: T('Mover para baixo'), enabled:index>=0&&index<ordered.length-1, click:()=>move(1) },
    { label: T('Extensões…'), click:()=>uiCommand('extensions',id) },
    { label: T('Contas flutuantes…'), enabled:currentAccounts().length>1, click:()=>uiCommand('floating-accounts') },
    { label: 'Auto Clicker…', click:()=>uiCommand('auto-clicker',id) },
    { label: T('Parar automação'), enabled:automation.runs.has(id), click:()=>runAction('automation:stop',id) },
    { type: 'separator' },
    { label: T('Atividade'), submenu: [
      { label: T('Sempre ativa · desempenho máximo'), type: 'radio', checked: modeFor(a) === 'always', click: () => runAction('account:activity', id, 'always') },
      { label: T('Economia de energia'), type: 'radio', checked: modeFor(a) === 'eco', click: () => runAction('account:activity', id, 'eco') },
      { label: T('Eco adaptativo'), type: 'radio', checked: modeFor(a) === 'adaptive', click: () => runAction('account:activity', id, 'adaptive') },
      { label: T('FPS em economia'), submenu: ecoRates.map(fps => ({label: fps + ' FPS', type: 'radio', checked: ecoFPS(a) === fps, click: () => runAction('account:eco-fps', id, fps)})) },
      { label: T('Ativa quando visível'), type: 'radio', checked: modeFor(a) === 'visible', click: () => runAction('account:activity', id, 'visible') },
      { label: T('Suspender agora · liberar RAM'), type: 'radio', checked: modeFor(a) === 'suspended', click: () => runAction('account:activity', id, 'suspended') },
      { type: 'separator' },
      { label: T('Quando oculta: descarrega após 5 minutos'), enabled: false },
      { label: T('Ao retomar, o jogo reconecta'), enabled: false }
    ] },
    { type: 'separator' },
    { label: T('Atualizar'), enabled: !!v, click: () => runAction('view:reload', id) },
    { label: T('Atualizar sem cache'), enabled: !!v, click: () => runAction('view:reload', id, true) },
    { label: T('Endereço inicial'), click: () => runAction('view:home', id) },
    { label: a.muted ? T('Ativar áudio') : T('Silenciar'), click: () => runAction('view:mute', id) },
    { label: T('Resolução fixa'), submenu: ['auto', ...Object.keys(resolutions)].map(preset => ({label: preset === 'auto' ? T('Automática') : `${preset} · ${resolutions[preset].width} × ${resolutions[preset].height}`, type:'radio', checked: (a.resolution || 'auto') === preset, click: () => runAction('account:resolution', id, preset)})) },
    { label: T('Modo Ultra'), type:'checkbox', checked: state.ultraAccountId === id, click: () => runAction('view:ultra', id) },
    { label: T('Limpar memória sem uso'), enabled:!!v, click: () => uiCommand('performance-help', id) },
    { label: `Zoom · ${Math.round(a.zoom * 100)}%`, submenu: [
      { label: T('Aumentar'), click: () => runAction('view:zoom', id, 0.1) },
      { label: T('Diminuir'), click: () => runAction('view:zoom', id, -0.1) },
      { label: T('Restaurar 100%'), click: () => runAction('view:zoom', id, 1 - a.zoom) }
    ] },
    { type: 'separator' },
    { label: T('Editar endereço…'), click: () => uiCommand('edit-account', id) },
    { label: T('Nova conta neste espaço…'), click: () => uiCommand('add-account') },
    { label: T('Remover painel…'), click: () => uiCommand('delete-account', id) }
  ];
  if (params?.isEditable || params?.selectionText) {
    template.push({ type: 'separator' }, { role: 'copy', label: T('Copiar') });
    if (params.isEditable) template.push({ role: 'paste', label: T('Colar') }, { role: 'selectAll', label: T('Selecionar tudo') });
  }
  popupMenu(template, point);
}

function showAppMenu(point) {
  const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  const metrics = app.getAppMetrics();
  const memory = Math.round(metrics.reduce((sum, m) => sum + Number(m.memory?.workingSetSize || 0), 0) / 1024);
  const selected=currentAccounts().find(a=>a.id===state.selectedAccountId)||currentAccounts()[0];
  popupMenu([
    { label: T('Nova conta…'), click: () => uiCommand('add-account') },
    { label: T('Novo espaço…'), click: () => uiCommand('add-workspace') },
    { label: T('Editar espaço…'), click: () => uiCommand('edit-workspace') },
    { type: 'separator' },
    { label: 'Layout', submenu: layoutMenuItems(workspace) },
    { label: T('Automação'), submenu:[
      {label:'Auto Clicker…',enabled:!!selected,click:()=>uiCommand('auto-clicker',selected.id)},
      {type:'separator'},
      {label:T('Parar todas as automações'),enabled:automation.runs.size>0,click:()=>runAction('automation:stop-all')}
    ]},
    { type: 'separator' },
    { label: T('Exportar configuração…'), click: () => runAction('config:export') },
    { label: T('Importar configuração…'), click: () => uiCommand('import') },
    { label: storage.portable ? T('Abrir pasta Save') : T('Abrir pasta de dados'), click: () => runAction('storage:open') },
    { label: T('Idioma'), submenu: [
      { label: 'English', type: 'radio', checked: state.preferences.language === 'en', click: () => runAction('settings:language', 'en') },
      { label: 'Português (Brasil)', type: 'radio', checked: state.preferences.language === 'pt-BR', click: () => runAction('settings:language', 'pt-BR') }
    ] },
    { type: 'separator' },
    { label: T('Desempenho'), submenu: [
      { label: T`${views.size} painéis carregados · ~${memory} MB no aplicativo`, enabled: false },
      { label: T('Cache nativo independente por conta'), enabled: false },
      { label: T('Ativa quando visível economiza RAM após 5 minutos'), enabled: false },
      { label: T('Suspender descarrega o painel imediatamente'), enabled: false },
      { label: T('Sobre os modos…'), click: () => uiCommand('performance-help') }
    ] },
    { label: T('Verificar atualizações…'), click: () => uiCommand('updates') },
    { label: 'Astria · ' + appVersion + (storage.portable ? T(' · Portátil') : ''), enabled: false }
  ], point);
}

function registerIPC() {
  function control(name,fn,allowRoot=false){
    ipcMain.handle('floating:'+name,async(event,...args)=>{
      try{
        let index=floatingIndex(event);
        if(index===undefined&&allowRoot&&trustedSender(event)){index=floatingFrames.keys().next().value;if(index===undefined)return {ok:false};}
        if(index===undefined)throw new Error(T('Origem não autorizada.'));
        return await fn(index,...args);
      }catch(error){return {ok:false,error:T(error.message||String(error))};}
    });
  }
  listen('floating:accounts',ids=>{
    const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
    const available=currentAccounts().filter(a=>a.id!==state.selectedAccountId&&modeFor(a)!=='suspended');
    if(!Array.isArray(ids)||ids.length>299||new Set(ids).size!==ids.length||ids.some(id=>!hasId(id)||!available.some(a=>a.id===id)))throw new Error(T('Seleção de contas inválida.'));
    const kept=(floatingPositions(workspace.floating)||[]).filter((p,index,all)=>ids.includes(p.accountId)&&all.findIndex(other=>other.accountId===p.accountId)===index);
    const existing=new Set(kept.map(p=>p.accountId));
    for(const id of ids)if(!existing.has(id)){
      let index=0,position;
      do{position=floatingDefault(index++);}while(kept.some(p=>p.x===position.x&&p.y===position.y));
      kept.push({accountId:id,...position});existing.add(id);
    }
    workspace.floating=kept;
    if(workspace.layout!=='floating'){workspace.layout='floating';boundsForAccounts.clear();}
    floatingDrag=undefined;publish();return {ok:true};
  });
  control('swap',swapFloating,true);
  control('corner',index=>{
    const frame=floatingFrames.get(index);if(!frame)return {ok:false};
    const w=state.workspaces.find(w=>w.id===state.activeWorkspaceId),p=floatingPosition(w.floating[index]);
    if(p.pinned)return {ok:false};
    const next=p.x>=.5?(p.y>=.5?{x:0,y:1}:{x:1,y:1}):(p.y>=.5?{x:0,y:0}:{x:1,y:0});
    w.floating[index]={...p,accountId:frame.accountId,...next};refreshViews();persistState();return {ok:true};
  });
  control('step',(index,x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(T('Posição inválida.'));
    const frame=floatingFrames.get(index);if(!frame)return {ok:false};
    moveFloating(index,frame.card.x+x,frame.card.y+y);persistState();return {ok:true};
  },true);
  control('resize-step',(index,delta)=>{
    if(!Number.isFinite(delta))throw new Error(T('Tamanho inválido.'));
    const frame=floatingFrames.get(index);if(!frame)return {ok:false};
    resizeFloating(index,frame.card.width+delta);persistState();return {ok:true};
  });
  control('pin',index=>{
    if(!floatingFrames.has(index)||overlayOpen)return {ok:false};
    const w=state.workspaces.find(w=>w.id===state.activeWorkspaceId),p=floatingPosition(w.floating[index]);
    w.floating[index]={...p,pinned:!p.pinned};
    floatingDrag=undefined;refreshViews();persistState();return {ok:true};
  });
  ipcMain.on('floating:drag-start',(event,mode='move')=>{
    const index=floatingIndex(event),frame=floatingFrames.get(index);
    if(!frame||overlayOpen||!floatingViews.get(index)?.getVisible())return;
    const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId);
    if(workspace.floating[index]?.pinned||!['move','resize'].includes(mode))return;
    floatingDrag={index,mode,accountId:frame.accountId,workspaceId:state.activeWorkspaceId,card:{...frame.card}};
  });
  ipcMain.on('floating:drag-move',(event,x,y)=>{
    const index=floatingIndex(event),frame=floatingFrames.get(index);
    if(index===undefined||!floatingDrag||floatingDrag.index!==index||floatingDrag.accountId!==frame?.accountId||floatingDrag.workspaceId!==state.activeWorkspaceId||!Number.isFinite(x)||!Number.isFinite(y))return;
    if(floatingDrag.mode==='resize'){
      const vertical=y*frame.viewport.width/frame.viewport.height;
      resizeFloating(index,floatingDrag.card.width+(Math.abs(x)>=Math.abs(vertical)?x:vertical),floatingDrag.card);
    }else moveFloating(index,floatingDrag.card.x+x,floatingDrag.card.y+y);
  });
  ipcMain.on('floating:drag-end',event=>{
    if(!floatingDrag||floatingIndex(event)!==floatingDrag.index)return;
    floatingDrag=undefined;
    try{persistState();}catch(error){windowMain.webContents.send('ui:toast',T(error.message));}
    requestAccountFocus(state.selectedAccountId,false);focusRequestedAccount();
  });
  listen('settings:language', language => {
    if (!['en', 'pt-BR'].includes(language)) throw new Error(T('Idioma inválido.'));
    state.preferences.language = language;
    publish(); return { ok: true };
  });
  listen('updates:check', async () => ({ ok: true, ...await updates.check() }));
  listen('updates:download', async () => ({ ok: true, ...await updates.download(percent => {
    if (windowMain && !windowMain.isDestroyed()) windowMain.webContents.send('updates:progress', percent);
  }) }));
  listen('updates:install', async () => {
    await updates.install();
    setImmediate(() => app.quit());
    return { ok: true };
  });
  listen('storage:open', async () => {
    const folder = storage.portable ? storage.root : app.getPath('userData');
    fs.mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return { ok: true };
  });
  listen('state:get', () => ({ ok: true, state, statuses: Object.fromEntries(viewStatuses) }));
  listen('account:order',(workspaceId,ids)=>{
    if(workspaceId!==state.activeWorkspaceId)throw Error(T('Espaço não encontrado.'));
    state.accounts=reorderAccounts(state.accounts,workspaceId,ids);publish();return {ok:true};
  });
  listen('extensions:list',async id=>{await prepareExtensions(id,views.get(id)?.webContents);return {ok:true,extensions:listExtensions(id)};});
  listen('extensions:install',async id=>{
    accountById(id);const result=await dialog.showOpenDialog(windowMain,{title:T('Instalar extensão da pasta'),properties:['openDirectory']});
    if(result.canceled||!result.filePaths?.[0])return {ok:true,cancelled:true};
    await extensionQueue(id,()=>{accountById(id);extensionsStore.install(id,result.filePaths[0]);});
    await prepareExtensions(id,views.get(id)?.webContents);return {ok:true};
  });
  listen('extensions:enable',async(id,entryId,enabled)=>{
    await extensionQueue(id,async()=>{accountById(id);const entry=extensionsStore.setEnabled(id,entryId,enabled);if(!enabled)await extensionContexts.get(id)?.unload(entry.extensionId);});
    await prepareExtensions(id,views.get(id)?.webContents);return {ok:true};
  });
  listen('extensions:remove',async(id,entryId)=>{
    await extensionQueue(id,async()=>{accountById(id);const entry=extensionsStore.list(id).find(item=>item.id===entryId);if(!entry)throw Error(T('Extensão não encontrada.'));await extensionContexts.get(id)?.unload(entry.extensionId);extensionsStore.remove(id,entryId);extensionErrors.get(id)?.delete(entryId);});return {ok:true};
  });
  listen('extensions:open',async(id,entryId,mode)=>{
    await prepareExtensions(id,views.get(id)?.webContents);const entry=listExtensions(id).find(item=>item.id===entryId);
    if(!entry?.enabled||!entry.loaded)throw Error(T('Ative a extensão primeiro.'));
    await extensionContext(id).open(entry.extensionId,{window:mode==='window'});return {ok:true};
  });
  listen('extensions:docks',()=>({ok:true,docks:dockState()}));
  // Show an open docked page again, or collapse the dock (extensionId null) without closing the page.
  listen('extensions:dock',(id,extensionId)=>{
    accountById(id);const context=extensionContexts.get(id);
    if(extensionId!==null&&!context?.docked.has(extensionId))throw Error(T('Extensão não encontrada.'));
    dockActive.set(id,extensionId);sendDocks();refreshViews();return {ok:true};
  });
  listen('extensions:close',async(id,extensionId)=>{accountById(id);await extensionContexts.get(id)?.closeDock(extensionId);return {ok:true};});
  listen('automation:get',id=>({ok:true,...automation.get(id)}));
  listen('automation:save',async(id,settings)=>({ok:true,settings:await automation.save(id,settings)}));
  listen('automation:start',async(id,request)=>({ok:true,runtime:await automation.start(id,request)}));
  listen('automation:stop',async id=>{accountById(id);await automation.stop(id);return {ok:true};});
  listen('automation:stop-all',async()=>{await automation.stopAll();return {ok:true};});
  listen('automation:pick',pickAutomationPoint);
  listen('automation:preview',(id,value)=>{
    const a=accountById(id),point=automationPoint(value),view=views.get(id);
    const markerColor=normalizeColor(value.markerColor === undefined ? '#ff0000' : value.markerColor);
    if(!markerColor)throw Error(T('Cor inválida.'));
    if(!view?.rendererReady)throw Error(T('Aguarde o carregamento da página.'));
    state.activeWorkspaceId=a.workspaceId;selectAccountState(id);requestAccountFocus();publish();
    view.webContents.send('astria:automation-preview',{point,markerColor});return {ok:true};
  });
  ipcMain.on('astria:automation-picked',(event,result)=>{
    const pick=pendingPick;
    if(!pick||event.sender!==pick.contents||event.senderFrame!==pick.contents.mainFrame||result?.token!==pick.token)return;
    let point;try{if(!result.cancelled)point=automationPoint(result.point);}catch{return;}
    pendingPick=undefined;clearTimeout(pick.timer);pick.resolve(result.cancelled?{ok:true,cancelled:true}:{ok:true,point});
  });
  listen('workspace:add', (name) => {
    const w = { id: randomUUID(), name: safeString(name, 55) || T('Novo espaço'), layout: 'auto' };
    state.workspaces.push(w); state.activeWorkspaceId = w.id; state.selectedAccountId = null;
    boundsForAccounts.clear(); publish(); return { ok: true };
  });
  listen('workspace:rename', (id, name) => {
    const w = state.workspaces.find(w => w.id === id);
    if (!w) throw new Error(T('Espaço não encontrado.'));
    w.name = safeString(name, 55) || w.name; publish(); return { ok: true };
  });
  listen('workspace:select', (id) => {
    if (!state.workspaces.some(w => w.id === id)) throw new Error(T('Espaço não encontrado.'));
    state.activeWorkspaceId = id;
    selectDefaultAccount();
    requestAccountFocus();
    boundsForAccounts.clear(); publish(); return { ok: true };
  });
  listen('workspace:delete', async (id) => {
    if (state.workspaces.length < 2) throw new Error(T('Mantenha pelo menos um espaço.'));
    const w = state.workspaces.find(w => w.id === id);
    if (!w) throw new Error(T('Espaço não encontrado.'));
    await Promise.all(state.accounts.filter(a=>a.workspaceId===id).map(a=>extensionQueue(a.id,()=>extensionContexts.get(a.id)?.dispose())));
    for (const a of state.accounts.filter(a => a.workspaceId === id)) destroyView(a.id);
    state.accounts = state.accounts.filter(a => a.workspaceId !== id);
    state.workspaces = state.workspaces.filter(w => w.id !== id);
    if (state.activeWorkspaceId === id) state.activeWorkspaceId = state.workspaces[0].id;
    selectDefaultAccount();
    boundsForAccounts.clear(); publish(); return { ok: true };
  });
  listen('workspace:layout', (layout) => {
    if (!allowedLayouts.has(layout)) throw new Error(T('Layout desconhecido.'));
    const workspace=state.workspaces.find(w => w.id === state.activeWorkspaceId);workspace.layout = layout;
    if(layout==='floating'&&workspace.floating?.some(p=>p.accountId===state.selectedAccountId))selectDefaultAccount();
    boundsForAccounts.clear(); publish(); return { ok: true };
  });
  listen('account:add', (data) => {
    const account = {
      id: randomUUID(), workspaceId: state.activeWorkspaceId,
      name: safeString(data?.name, 55) || T`Conta ${currentAccounts().length + 1}`,
      url: safeURL(data?.url), muted: false, zoom: 1,
      color: normalizeColor(data?.color) || colors.mint, activity: 'visible', ecoFPS: 15
    };
    state.accounts.push(account); selectAccountState(account.id);
    requestAccountFocus();
    publish(); return { ok: true };
  });
  listen('account:edit', (id, data) => {
    const a = accountById(id);
    const newURL = safeURL(data?.url);
    a.name = safeString(data?.name, 55) || a.name;
    if (a.url !== newURL) {
      a.url = newURL;
      const view = views.get(id);
      if (view && !view.webContents.isDestroyed()) view.webContents.loadURL(newURL).catch(() => {});
    }
    publish(); return { ok: true };
  });
  listen('account:delete', async (id) => {
    accountById(id);await extensionQueue(id,()=>extensionContexts.get(id)?.dispose());destroyView(id);
    state.accounts = state.accounts.filter(a => a.id !== id);
    if (state.selectedAccountId === id) selectDefaultAccount();
    publish(); return { ok: true, note: T('Sessão salva no disco; dados do site não foram apagados.') };
  });
  listen('account:select', (id) => {
    const a = accountById(id);
    if (a.workspaceId !== state.activeWorkspaceId) throw new Error(T('Conta fora deste espaço.'));
    selectAccountState(id); requestAccountFocus(); publish(); return { ok: true };
  });
  listen('account:rename', (id, name) => {
    const a = accountById(id), next = safeString(name, 55);
    if (!next) throw new Error(T('Informe o nome da conta.'));
    a.name = next; publish(); return { ok: true };
  });
  listen('account:color', (id, color) => {
    const next = normalizeColor(color);
    if (!next) throw new Error(T('Cor inválida.'));
    accountById(id).color = next; publish(); return { ok: true };
  });
  listen('account:activity', async (id, mode) => {
    if (!activityModes.has(mode)) throw new Error(T('Modo de atividade inválido.'));
    accountById(id).activity = mode;
    if (id === state.selectedAccountId && mode !== 'suspended') requestAccountFocus();
    publish();
    if(mode==='suspended')await closingViews.get(id);
    return { ok: true };
  });
  listen('account:eco-fps', (id, fps) => {
    if (!ecoRates.includes(fps)) throw new Error(T('FPS inválido.'));
    accountById(id).ecoFPS = fps;
    publish(); return { ok: true };
  });
  listen('account:resolution', (id, preset) => {
    if (preset !== 'auto' && !Object.hasOwn(resolutions, preset)) throw new Error(T('Resolução inválida.'));
    const a = accountById(id); a.resolution = preset;
    const view = views.get(id);
    if (view) applyResolution(view, a, boundsForAccounts.get(id) || view.panelBounds || view.getBounds());
    publish(); return { ok:true };
  });
  listen('settings:visual-rest', enabled => {
    if (typeof enabled !== 'boolean') throw new Error(T('Opção inválida.'));
    state.preferences.visualRest = enabled;
    publish(); return {ok:true};
  });
  listen('view:ultra', id => {
    const a = accountById(id);
    const enabled = state.ultraAccountId !== id;
    if (enabled && modeFor(a) === 'suspended') throw new Error(T('Retome a conta suspensa primeiro.'));
    state.ultraAccountId = enabled ? id : null;
    if (enabled) {state.activeWorkspaceId = a.workspaceId; selectAccountState(id);}
    windowMain.setFullScreen(enabled);
    requestAccountFocus(); boundsForAccounts.clear(); publish(); return {ok:true};
  });
  listen('view:cleanup', async id => {
    accountById(id);
    if(automation.runs.has(id))throw Error(T('Pare a automação antes de limpar a memória.'));
    const view = views.get(id);
    if (!view) throw new Error(T('Retome a conta suspensa primeiro.'));
    return {ok:true, result:await collectPageMemory(view.webContents)};
  });
  listen('view:reload', (id, ignoreCache = false) => {
    const a = accountById(id); const existed = views.has(id); const v = makeView(a);
    if (!v) throw new Error(T('Retome a conta suspensa primeiro.'));
    if (existed) {
      if (ignoreCache) v.webContents.reloadIgnoringCache();
      else v.webContents.reload();
    }
    return { ok: true };
  });
  listen('view:home', (id) => {
    const a = accountById(id), existed = views.has(id), v = makeView(a);
    if (!v) throw new Error(T('Retome a conta suspensa primeiro.'));
    if (existed) v.webContents.loadURL(a.url).catch(() => {}); return { ok: true };
  });
  listen('view:mute', (id) => {
    const a = accountById(id); a.muted = !a.muted;
    const view = views.get(id);
    if (view) {
      view.webContents.setAudioMuted(a.muted);
      for (const child of view.popups) {
        if (!child.webContents.isDestroyed()) child.webContents.setAudioMuted(a.muted);
      }
    }
    publish(); return { ok: true };
  });
  listen('view:zoom', (id, delta) => {
    if (!Number.isFinite(delta)) throw new Error(T('Zoom inválido.'));
    const a = accountById(id); a.zoom = Math.round(Math.max(0.5, Math.min(2, (a.zoom || 1) + Number(delta))) * 10) / 10;
    const view = views.get(id); if (view && !resolutions[a.resolution]) view.webContents.setZoomFactor(a.zoom);
    publish(); return { ok: true };
  });
  listen('settings:theme', (theme) => {
    state.preferences.theme = theme === 'light' ? 'light' : 'dark';
    nativeTheme.themeSource = state.preferences.theme;
    updateTitleBar();
    publish(); return { ok: true };
  });
  listen('settings:sidebar-width', width => {
    if (!Number.isFinite(width)) throw new Error(T('Largura inválida.'));
    state.preferences.sidebarWidth = sidebarWidth(width);
    boundsForAccounts.clear(); publish(); return { ok: true };
  });
  listen('menu:layout', point => {
    const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    popupMenu(layoutMenuItems(workspace), point);
    return { ok: true };
  });
  listen('menu:app', point => { showAppMenu(point); return { ok: true }; });
  listen('menu:account', (id, point) => { accountById(id); showAccountMenu(id, point); return { ok: true }; });
  listen('config:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(windowMain, {
      title: T('Exportar espaços e contas (não inclui cookies)'), defaultPath: storage.portable ? path.join(storage.backups, 'astria-config.json') : 'astria-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!canceled && filePath) fs.writeFileSync(filePath, JSON.stringify({ ...state, warning: T('Logins e cookies não estão neste arquivo.') }, null, 2));
    return { ok: true, canceled };
  });
  listen('config:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowMain, {
      title: T('Importar espaços e contas (substitui a configuração)'), properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePaths?.[0]) return { ok: true, canceled: true };
    const handle = await fs.promises.open(filePaths[0], 'r');
    let parsed;
    try {
      const buffer = Buffer.alloc(3_000_001);
      let total = 0, count;
      do { ({ bytesRead: count } = await handle.read(buffer, total, buffer.length - total, null)); total += count; } while (count && total < buffer.length);
      if (total > 3_000_000) throw new Error(T('Arquivo muito grande.'));
      parsed = JSON.parse(buffer.subarray(0, total).toString('utf8'));
    } finally { await handle.close(); }
    const newState = normalizeImport(parsed);
    const partitionIds=new Set();for(const account of newState.accounts){const folded=account.id.toLowerCase();if(partitionIds.has(folded))throw Error(T('IDs de contas conflitam neste Windows.'));partitionIds.add(folded);}
    await Promise.all([...extensionContexts.keys()].map(id=>extensionQueue(id,()=>extensionContexts.get(id).dispose())));
    for (const id of [...views.keys()]) destroyView(id);
    state = newState; boundsForAccounts.clear(); publish(); return { ok: true };
  });
  ipcMain.on('ui:overlay', (event, open) => {
    if (!trustedSender(event)) return;
    overlayOpen = !!open;
    const focusInterface = overlayOpen && windowMain.isFocused();
    if (!overlayOpen) requestAccountFocus(state.selectedAccountId, false);
    refreshViews();
    if (focusInterface) windowMain.webContents.focus();
  });
  ipcMain.on('layout:update', (event, rects) => {
    if (!trustedSender(event)) return;
    if (!Array.isArray(rects) || !windowMain || windowMain.isDestroyed()) return;
    const workspace=state.workspaces.find(w=>w.id===state.activeWorkspaceId),accounts=currentAccounts();
    const primary=state.ultraAccountId||state.selectedAccountId||accounts[0]?.id;
    const single=!!state.ultraAccountId||['focus','floating'].includes(workspace.layout);
    const ids = new Set(accounts.filter(a=>!single||a.id===primary).map(a => a.id));
    // A late layout from the previous main must not raise and focus that old game.
    if(rects.length&&!rects.some(rect=>ids.has(rect?.id)))return;
    boundsForAccounts.clear(); dockBounds.clear();
    const [ww, wh] = windowMain.getContentSize();
    for (const rect of rects.slice(0, 300)) {
      if (!rect || typeof rect !== 'object') continue;
      if (!ids.has(rect.id)) continue;
      const x = Math.round(Number(rect.x)), y = Math.round(Number(rect.y));
      const width = Math.round(Number(rect.width)), height = Math.round(Number(rect.height));
      if (![x, y, width, height].every(Number.isFinite)) continue;
      if (x < 0 || y < 0 || width < 100 || height < 75) continue;
      if (x + width > ww + 2 || y + height > wh + 2) continue;
      (rect.dock === true ? dockBounds : boundsForAccounts).set(rect.id, { x, y, width, height });
    }
    layoutReady = true;
    if (pendingAccountFocus) pendingAccountFocus.afterLayout = false;
    refreshViews();
    // A trusted renderer layout after ready-to-show confirms an interactive,
    // visible interface instead of merely acknowledging the document load.
    acknowledgeUpdateHealth();
  });
}

function createMainWindow() {
  allowWindowClose = false; closingApplication = undefined; quitAfterClosing = false; quitting = false;
  layoutReady = false;
  windowShown = false;
  windowMain = new BaseWindow({
    width: 1500, height: 950, minWidth: 780, minHeight: 500,
    show: false,
    backgroundColor: '#0b1020',
    title: 'Astria',
    icon: path.join(__dirname, 'astria.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: state.preferences.theme === 'light' ? '#ffffff' : '#121a29', symbolColor: state.preferences.theme === 'light' ? '#243247' : '#dbe5f3', height: 36 } : false,
    autoHideMenuBar: true
  });
  // The interface is a real page in the native stack, not an empty View.
  // It covers background games without exchanging their sessions or bounds.
  interfaceView = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false, contextIsolation: true, sandbox: true
  } });
  windowMain.webContents = interfaceView.webContents;
  windowMain.contentView.addChildView(interfaceView);
  const resizeInterface = () => {
    const [width, height] = windowMain.getContentSize();
    // Windows reports 0x0 while minimized. Keep the last real viewport: a
    // zero-sized interface surface can stop frame delivery to active games.
    if (width > 0 && height > 0) interfaceView.setBounds({ x: 0, y: 0, width, height });
  };
  resizeInterface();
  // BaseWindow has no implicit page or ready-to-show event.
  windowMain.webContents.once('did-finish-load', () => {
    if (windowMain && !windowMain.isDestroyed()) {
      windowShown = true;
      windowMain.show();
    }
  });
  windowMain.webContents.loadFile(path.join(__dirname, 'index.html'));
  windowMain.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowMain.webContents.on('will-navigate', event => event.preventDefault());
  windowMain.on('close', event => {
    if (allowWindowClose) return;
    event.preventDefault();
    closeApplication();
  });
  windowMain.on('closed', () => {
    closeFloatingView(); floatingFrames.clear();
    const contents = interfaceView?.webContents;
    clearTimeout(metricsTimer); metricsTimer = undefined;
    for (const id of [...views.keys()]) destroyView(id);
    boundsForAccounts.clear(); overlayOpen = false; windowMain = null; interfaceView = null;
    // Child WebContentsView pages need explicit lifetime management.
    if (contents && !contents.isDestroyed()) contents.close();
  });
  windowMain.on('resize', () => {
    if (!windowMain.isDestroyed()) { resizeInterface(); windowMain.webContents.send('window:resized'); }
  });
  windowMain.on('focus', () => setImmediate(focusRequestedAccount));
  for (const event of ['minimize', 'restore', 'show', 'hide']) {
    windowMain.on(event, () => setImmediate(() => {
      if (!windowMain || windowMain.isDestroyed()) return;
      refreshViews();
      if (event === 'restore' || event === 'show') windowMain.webContents.send('window:resized');
    }));
  }
  windowMain.webContents.on('did-finish-load', () => {
    windowMain.webContents.send('state:updated', state);
  });
}

function acknowledgeUpdateHealth() {
  if (!windowMain || windowMain.updateHealthReported || !windowMain.isVisible() || windowMain.isMinimized()) return;
  const healthArgument = process.argv.find(value => value.startsWith('--astria-update-health='));
  if (storage.portable && healthArgument) {
    const jobPath = path.resolve(healthArgument.slice('--astria-update-health='.length));
    const relative = path.relative(path.join(storage.root, 'Updates'), jobPath);
    if (/^update-[a-f\d-]+[\\/]job\.json$/.test(relative) && fs.existsSync(jobPath)) fs.writeFileSync(jobPath + '.healthy', appVersion);
  }
  windowMain.updateHealthReported = true;
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (windowMain && !windowMain.isDestroyed()) {
    if (windowMain.isMinimized()) windowMain.restore();
    windowMain.focus();
  }
});

if (ownsInstance) app.whenReady().then(() => {
  updates = new Updates({ storage, currentVersion: appVersion, ...releaseConfig });
  session.defaultSession?.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession?.setPermissionCheckHandler(() => false);
  session.defaultSession?.setDevicePermissionHandler?.(() => false);
  state = loadState();
  extensionsStore=new ExtensionsStore({directory:path.join(storage.root||app.getPath('userData'),'Extensions')});
  automation=new Automation({directory:path.join(storage.root||app.getPath('userData'),'Automation'),account:accountById,view:id=>views.get(id),notify:(id,runtime)=>{
    if(windowMain&&!windowMain.isDestroyed())windowMain.webContents.send('automation:state',{id,runtime});
    const view=views.get(id),contents=view?.webContents;if(contents&&!contents.isDestroyed())contents.send('astria:automation',runtime);
    if(view&&view.automating!==runtime.running){view.automating=runtime.running;refreshViews();}
  }});
  requestAccountFocus();
  Menu.setApplicationMenu(null);
  // Game requests use Chromium's per-account cache without request interception.
  writeAccountGuide(storage, state);
  nativeTheme.themeSource = state.preferences.theme;
  registerIPC(); createMainWindow();
  app.on('activate', () => { if (BaseWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (allowWindowClose) { quitting = true; return; }
  event.preventDefault();
  closeApplication(true);
});
