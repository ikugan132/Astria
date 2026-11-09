'use strict';
const path = require('node:path');
const { lease: debuggerLease } = require('./debugger-share');

const CHANNEL = 'astria-extension-api', EVENT = 'astria-extension-event';
const sessions = new WeakMap(), registered = new WeakSet();
const BUTTONS = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };
const DEBUG_COMMANDS = new Set(['Input.dispatchKeyEvent','Input.dispatchMouseEvent','Input.insertText','Runtime.evaluate','Runtime.callFunctionOn',
  'Emulation.setFocusEmulationEnabled','Page.setWebLifecycleState','Page.getLayoutMetrics','Page.captureScreenshot']);
const extensionOrigin = value => {
  try { const url = new URL(value); return url.protocol === 'chrome-extension:' ? url.hostname : null; }
  catch { return null; }
};
const bounded = async (promise, milliseconds) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Extension debugger timed out.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
};

class AccountExtensions {
  constructor({ session, game, window, onActivity, onWindow, onDock, selectGame, electron }) {
    if (sessions.has(session)) throw new Error('An extension runtime already exists for this account session.');
    this.session = session; this.game = game; this.window = window;
    this.onActivity = onActivity || (() => {}); this.onWindow = onWindow || (() => {});
    this.selectGame = selectGame || (() => {});
    // onDock(extensionId, view|null, event): the host places docked extension pages inside the account window.
    this.onDock = onDock || null; this.docked = new Map();
    this.electron = electron || require('electron');
    this.tabs = new Map(); this.windows = new Set(); this.panels = new Map(); this.captureGrants = new Map(); this.unloading = new Map();
    this.gameTabs = new WeakSet();
    this.attached = new Map(); this.subscribers = new Map(); this.panelOptions = new Map();
    this.loaded = new Set(); this.panelBehaviors = new Map();
    this.extensions = session.extensions || session;
    sessions.set(session, this);
    const ipcMain = this.electron.ipcMain;
    if (!registered.has(ipcMain)) {
      registered.add(ipcMain);
      ipcMain.handle(CHANNEL, async (event, extensionId, method, args) => {
        const runtime = sessions.get(event.sender?.session);
        if (!runtime) return { error: 'Invalid extension context.' };
        return runtime._dispatch(event, extensionId, method, args);
      });
    }
    session.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
      if (runningStatus !== 'starting') return;
      const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = extensionOrigin(worker?.scope);
      if (!worker || !id || this.workerHandlers?.has(worker)) return;
      this.workerHandlers ||= new WeakSet(); this.workerHandlers.add(worker);
      worker.ipc.handle(CHANNEL, (event, extensionId, method, args) => this._dispatch(event, extensionId, method, args, worker));
    });
    const preload = path.join(__dirname, 'extensions-preload.js');
    session.registerPreloadScript({ id: 'astria-extension-frame', type: 'frame', filePath: preload });
    session.registerPreloadScript({ id: 'astria-extension-worker', type: 'service-worker', filePath: preload });
    const { ElectronChromeExtensions } = require('electron-chrome-extensions');
    this._host = new ElectronChromeExtensions({
      session,
      createTab: async details => {
        this._checkWindow(details.windowId);
        const win = await this._createWindow(details, true);
        return [win.webContents, win];
      },
      createWindow: details => this._createWindow(details, true),
      selectTab: (contents, win) => { this._tab(contents.id); if (contents === this.game()) this.selectGame(); win.show(); win.focus(); },
      removeTab: contents => {
        if (this.gameTabs.has(contents)) return;
        this.tabs.delete(contents.id);
        if (!contents.isDestroyed()) contents.close();
      },
      removeWindow: win => {
        if (!this.windows.has(win)) throw new Error('The account window cannot be closed by an extension.');
        if (!win.isDestroyed()) win.close();
      },
      requestPermissions: async () => false
    });
    this._guardLibrary();
  }

  get host() { return this._host; }
  get controlling() { return this.attached.size > 0; }

  async load(folder) {
    const extension = await this.extensions.loadExtension(folder, { allowFileAccess: false });
    this.loaded.add(extension.id);
    return extension;
  }

  addGame(contents) {
    if (!contents || contents.isDestroyed() || contents.session !== this.session) throw new Error('Invalid account game tab.');
    if (!this.tabs.has(contents.id)) {
      this.gameTabs.add(contents);
      const id = contents.id;
      this.tabs.set(contents.id, contents);
      this._host.addTab(contents, this.window());
      contents.once('destroyed', () => {
        for (const record of this._records(id)) this._lost(record, 'target_closed');
        this.tabs.delete(id);
      });
    }
    this._host.selectTab(contents);
    this._host.ctx.store.lastFocusedWindowId = this.window().id;
  }

  unload(extensionId) {
    if (this.unloading.has(extensionId)) return this.unloading.get(extensionId);
    const task = Promise.resolve().then(async () => {
      await Promise.all([...this.attached.values()].filter(record => record.extensionId === extensionId).map(record => this._detach(record)));
      const panel = this.panels.get(extensionId);
      if (panel && !panel.isDestroyed()) panel.destroy();
      this._destroyDock(extensionId);
      for (const win of this.windows) if (!win.isDestroyed() && extensionOrigin(win.webContents.getURL()) === extensionId) win.destroy();
      this.panels.delete(extensionId);
      this.captureGrants.delete(extensionId);
      this.subscribers.delete(extensionId); this.panelOptions.delete(extensionId); this.panelBehaviors.delete(extensionId);
      if (this.extensions.getExtension(extensionId)) await this.extensions.removeExtension(extensionId);
      this.loaded.delete(extensionId);
    }).finally(() => this.unloading.delete(extensionId));
    this.unloading.set(extensionId, task);
    return task;
  }

  async dispose() {
    await Promise.all([...this.loaded].map(id => this.unload(id)));
    for (const win of this.windows) if (!win.isDestroyed()) win.destroy();
    for (const id of [...this.docked.keys()]) this._destroyDock(id);
    for (const contents of this.tabs.values()) if (!contents.isDestroyed()) this._host.removeTab(contents);
    this.tabs.clear();
  }

  _extension(id) {
    if (this.unloading.has(id)) throw new Error('The extension is unloading.');
    const extension = typeof id === 'string' && this.extensions.getExtension(id);
    if (!extension) throw new Error('Invalid extension context for this account.');
    return extension;
  }
  _tab(id) {
    const contents = Number.isSafeInteger(id) && this.tabs.get(id);
    if (!contents || contents.isDestroyed() || contents.session !== this.session) throw new Error('Target tab does not belong to this account.');
    return contents;
  }
  _target(target) {
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => key !== 'tabId')) throw new Error('Only an account tab debugger target is supported.');
    const contents = this._tab(target.tabId);
    if (!/^https?:\/\//i.test(contents.getURL())) throw new Error('Debugger only supports account web pages.');
    return contents;
  }
  _checkWindow(id) {
    if (id === undefined || id === -2 || id === this.window()?.id) return;
    if (![...this.windows].some(win => !win.isDestroyed() && win.id === id)) throw new Error('Window does not belong to this account.');
  }
  _url(value, extensionId) {
    let url;
    try { url = new URL(value, extensionId ? `chrome-extension://${extensionId}/` : undefined); }
    catch { throw new Error('Invalid extension URL.'); }
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    if (url.protocol === 'chrome-extension:' && this.extensions.getExtension(url.hostname) && (!extensionId || url.hostname === extensionId)) return url.href;
    throw new Error('This extension URL is not allowed.');
  }
  _extensionPage(id, value) {
    const url = this._url(value, id);
    if (extensionOrigin(url) !== id) throw new Error('Panel must use a page from this extension.');
    return url;
  }

  async _dispatch(event, extensionId, method, args, worker) {
    try {
      const id = worker ? extensionOrigin(worker.scope) : extensionOrigin(event.senderFrame?.url);
      const session = worker ? event.session : event.sender?.session;
      if (session !== this.session || id !== extensionId || worker && event.serviceWorker !== worker) throw new Error('Invalid extension context.');
      const extension = this._extension(extensionId);
      if (typeof method !== 'string' || !Array.isArray(args) || args.length > 5) throw new Error('Invalid extension API request.');
      if (method === 'subscribe') {
        let subscribers = this.subscribers.get(extensionId);
        if (!subscribers) this.subscribers.set(extensionId, subscribers = new Set());
        subscribers.add(worker || event.senderFrame);
        return { result: undefined };
      }
      if (method === 'tabs.captureVisibleTab') return { result: await this._captureVisibleTab(extension, args) };
      const permission = method.startsWith('debugger.') ? 'debugger' : method.startsWith('sidePanel.') ? 'sidePanel' : null;
      if (!permission || !extension.manifest.permissions?.includes(permission)) throw new Error('Extension API permission is required.');
      const result = permission === 'debugger' ? await this._debugger(extensionId, method.slice(9), args) : await this._sidePanel(extensionId, method.slice(10), args[0] || {});
      return { result };
    } catch (error) { return { error: error.message || 'Extension API failed.' }; }
  }

  async _captureVisibleTab(extension, args) {
    const manifest = extension.manifest;
    const allUrls = manifest.permissions?.includes('<all_urls>') || manifest.host_permissions?.includes('<all_urls>');
    if (!manifest.permissions?.includes('activeTab') && !allUrls) throw new Error('Capturing the account game requires activeTab or <all_urls> permission.');
    let [windowId, options] = args;
    if (windowId && typeof windowId === 'object') { options = windowId; windowId = undefined; }
    if (args.length > 2 || windowId !== undefined && windowId !== -2 && windowId !== this.window()?.id) throw new Error('Only the account game window can be captured.');
    options ??= {};
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['format', 'quality'].includes(key))) throw new Error('Invalid capture options.');
    const format = options.format ?? 'jpeg', quality = options.quality ?? 90;
    if (!['png', 'jpeg'].includes(format)) throw new Error('Capture format must be png or jpeg.');
    if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('Capture quality must be an integer from 0 to 100.');
    const contents = this.game();
    if (!contents || contents.isDestroyed() || this._tab(contents.id) !== contents) throw new Error('The account game tab is unavailable.');
    const origin = new URL(contents.getURL()).origin, grant = this.captureGrants.get(extension.id);
    if (!allUrls && (grant?.tabId !== contents.id || grant.origin !== origin)) throw new Error('Open the extension panel to grant capture permission for this page.');
    const image = await contents.capturePage();
    if (contents.isDestroyed() || this.game() !== contents || new URL(contents.getURL()).origin !== origin) throw new Error('The account page changed during capture.');
    if (image.isEmpty()) throw new Error('The account game capture is empty.');
    const bytes = format === 'png' ? image.toPNG() : image.toJPEG(quality);
    return `data:image/${format};base64,${bytes.toString('base64')}`;
  }

  _event(extensionId, name, ...args) {
    for (const recipient of this.subscribers.get(extensionId) || []) {
      try {
        if (extensionOrigin(recipient.scope || recipient.url) !== extensionId || recipient.isDestroyed?.()) continue;
        recipient.send(EVENT, name, ...args);
      } catch { this.subscribers.get(extensionId)?.delete(recipient); }
    }
  }

  async _debugger(extensionId, method, args) {
    if (method === 'getTargets') return [...this.tabs.values()].filter(contents => !contents.isDestroyed()).map(contents => ({ id: String(contents.id), tabId: contents.id, type: 'page', url: contents.getURL(), title: contents.getTitle?.() || '', attached: contents.debugger.isAttached() }));
    const contents = this._target(args[0]);
    const slot = `${contents.id}|${extensionId}`;
    let record = this.attached.get(slot);
    if (method === 'attach') {
      // Like Chrome, several extensions and Astria's Auto Clicker may control the same tab: they share Electron's one debugger connection.
      // Chrome's wording, so extensions that detach and retry on "already attached" recover.
      const taken = `Another debugger is already attached to the tab with id: ${contents.id}.`;
      if (record) throw new Error(taken);
      if (args[1] !== undefined && typeof args[1] !== 'string') throw new Error('Invalid debugger protocol version.');
      let connection;
      try { connection = debuggerLease(contents, args[1] || '1.3'); } catch { throw new Error(taken); }
      record = { connection, slot, extensionId, contents, debug: contents.debugger, tabId: contents.id, attached: true, closing: false, keys: new Map(), buttons: new Map(), mouse: { x: 0, y: 0 }, tail: Promise.resolve() };
      record.detachListener = (_event, reason) => this._lost(record, reason || 'target_closed');
      record.messageListener = (_event, name, params) => this._event(extensionId, 'debugger.onEvent', { tabId: contents.id }, name, params);
      contents.debugger.on('detach', record.detachListener);
      contents.debugger.on('message', record.messageListener);
      this.attached.set(slot, record); this.onActivity();
      return;
    }
    if (!record || record.extensionId !== extensionId || !record.attached) throw new Error('Debugger is not attached by this extension owner.');
    if (method === 'detach') return this._detach(record);
    if (method !== 'sendCommand') throw new Error('Unsupported debugger API.');
    const command = args[1], raw = args[2] || {};
    if (!DEBUG_COMMANDS.has(command) || command === 'Page.setWebLifecycleState' && raw.state !== 'active') throw new Error('Debugger command is not allowed.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid debugger parameters.');
    const params = { ...raw };
    if (command === 'Input.dispatchKeyEvent') {
      const names = [params.key, params.code].filter(value=>typeof value==='string').map(value=>value.toLowerCase());
      const codes = [params.windowsVirtualKeyCode, params.nativeVirtualKeyCode], mods = params.modifiers || 0;
      if (params.commands !== undefined || names.some(name=>name==='paste'||name==='clipboardpaste')
        || (mods & 6) && (names.some(name=>name==='v'||name==='keyv')||codes.includes(86))
        || (mods & 8) && (names.includes('insert')||codes.includes(45))) throw new Error('Clipboard commands are not allowed through extension input.');
    }
    if (command === 'Input.dispatchMouseEvent') {
      const scale = Number.isFinite(contents.astriaInputScale) && contents.astriaInputScale > 0 ? contents.astriaInputScale : 1;
      if (Number.isFinite(params.x)) params.x *= scale;
      if (Number.isFinite(params.y)) params.y *= scale;
    }
    const next = record.tail.catch(() => {}).then(async () => {
      if (record.closing || !record.attached || contents.isDestroyed()) throw new Error('Extension debugger is closed.');
      if (command === 'Input.dispatchMouseEvent') {
        record.mouse = { x: params.x, y: params.y };
        if (params.type === 'mousePressed' && BUTTONS[params.button]) record.buttons.set(params.button, params);
        if (params.button === 'right') contents.astriaAutomationContextUntil = Date.now() + 500;
      }
      const key = `${params.code || params.key || params.windowsVirtualKeyCode}:${params.location || 0}`;
      if (command === 'Input.dispatchKeyEvent' && ['keyDown', 'rawKeyDown'].includes(params.type)) record.keys.set(key, params);
      const result = await bounded(record.connection.send(command, params), 3000);
      if (command === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') record.buttons.delete(params.button);
      if (command === 'Input.dispatchKeyEvent' && params.type === 'keyUp') record.keys.delete(key);
      return result;
    });
    record.tail = next;
    return next;
  }

  _lost(record, reason) {
    if (!record.attached) return;
    record.attached = false;
    record.debug.removeListener('detach', record.detachListener);
    record.debug.removeListener('message', record.messageListener);
    if (this.attached.get(record.slot) === record) this.attached.delete(record.slot);
    this._event(record.extensionId, 'debugger.onDetach', { tabId: record.tabId }, reason);
    this.onActivity();
  }

  _detach(record) {
    if (record.cleanup) return record.cleanup;
    record.closing = true;
    record.cleanup = (async () => {
      const deadline = Date.now() + 1500, debug = record.debug;
      try {
        await bounded(record.tail.catch(() => {}), Math.min(250, Math.max(1, deadline - Date.now()))).catch(() => {});
        for (const [button, params] of [...record.buttons].reverse()) {
          if (!record.attached || record.contents.isDestroyed() || Date.now() >= deadline) break;
          record.buttons.delete(button);
          await bounded(record.connection.send('Input.dispatchMouseEvent', { ...params, ...record.mouse, type: 'mouseReleased', buttons: [...record.buttons.keys()].reduce((bits, name) => bits | BUTTONS[name], 0), modifiers: 0 }), deadline - Date.now()).catch(() => {});
        }
        for (const params of [...record.keys.values()].reverse()) {
          if (!record.attached || record.contents.isDestroyed() || Date.now() >= deadline) break;
          await bounded(record.connection.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp', text: '', unmodifiedText: '', modifiers: 0 }), deadline - Date.now()).catch(() => {});
        }
      } finally {
        // The connection stays while another extension or the Auto Clicker still controls this tab.
        try { record.connection.release(); }
        finally { this._lost(record, 'canceled_by_user'); }
      }
    })();
    return record.cleanup;
  }

  _records(tabId) { return [...this.attached.values()].filter(record => record.tabId === tabId); }

  _options(id, tabId) {
    const extension = this._extension(id);
    const defaults = { path: extension.manifest.side_panel?.default_path, enabled: Boolean(extension.manifest.side_panel?.default_path) };
    return { ...defaults, ...this.panelOptions.get(id)?.get(null), ...(tabId === undefined ? {} : this.panelOptions.get(id)?.get(tabId)), ...(tabId === undefined ? {} : { tabId }) };
  }
  async _sidePanel(id, method, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid side panel options.');
    if (options.tabId !== undefined) this._tab(options.tabId);
    this._checkWindow(options.windowId);
    if (method === 'setPanelBehavior') {
      if (typeof options.openPanelOnActionClick !== 'boolean') throw new Error('Invalid side panel behavior.');
      this.panelBehaviors.set(id, options.openPanelOnActionClick);
      return;
    }
    if (method === 'getOptions') return this._options(id, options.tabId);
    if (method === 'setOptions') {
      if (options.path !== undefined) this._extensionPage(id, options.path);
      if (options.enabled !== undefined && typeof options.enabled !== 'boolean') throw new Error('Invalid side panel enabled state.');
      let store = this.panelOptions.get(id);
      if (!store) this.panelOptions.set(id, store = new Map());
      const key = options.tabId ?? null;
      store.set(key, { ...store.get(key), ...options });
      return;
    }
    if (method === 'open') {
      const panel = this._options(id, options.tabId);
      if (!panel.enabled || !panel.path) throw new Error('This side panel is disabled.');
      await this._openPanel(id, panel.path); return;
    }
    if (method === 'close') { this.panels.get(id)?.close(); return; }
    throw new Error('Unsupported side panel API.');
  }

  async open(extensionId, { window: separate = false } = {}) {
    const extension = this._extension(extensionId), manifest = extension.manifest;
    const game = this.game();
    if (manifest.permissions?.includes('activeTab') && game && !game.isDestroyed() && /^https?:\/\//i.test(game.getURL())) this.captureGrants.set(extensionId, { tabId: game.id, origin: new URL(game.getURL()).origin });
    const panel = this._options(extensionId, this.game()?.id);
    const page = this.panelBehaviors.get(extensionId) !== false && panel.enabled && panel.path || manifest.action?.default_popup || manifest.browser_action?.default_popup || manifest.options_ui?.page || manifest.options_page;
    if (page) return this.onDock && !separate ? this._openDock(extensionId, page) : this._openPanel(extensionId, page);
    if (!game || game.isDestroyed()) throw new Error('The account game tab is unavailable.');
    // shortcut: the pinned compatibility library has no public action-click method; replace when it adds one.
    this._host.ctx.router.sendEvent(extensionId, 'browserAction.onClicked', { id: game.id, windowId: this.window().id, active: true, url: game.getURL(), title: game.getTitle?.() || '' });
  }

  async _openPanel(id, page) {
    const url = this._extensionPage(id, page);
    if (this.docked.has(id)) await this.closeDock(id);
    let win = this.panels.get(id);
    if (!win || win.isDestroyed()) {
      win = this._newWindow({ title: this._extension(id).manifest.name, width: 1050, height: 780 });
      this.panels.set(id, win);
      let closing = false;
      win.on('close', event => {
        if (closing) return;
        event.preventDefault(); closing = true;
        Promise.all([...this.attached.values()].filter(record => record.extensionId === id).map(record => this._detach(record))).catch(() => {}).finally(() => { if (!win.isDestroyed()) win.destroy(); });
      });
      win.on('closed', () => { if (this.panels.get(id) === win) this.panels.delete(id); });
    }
    if (win.webContents.getURL() !== url) await win.loadURL(url);
    win.show(); win.focus();
    const game = this.game();
    if (game && !game.isDestroyed()) this._host.selectTab(game);
    this._host.ctx.store.lastFocusedWindowId = this.window().id;
  }

  async _openDock(id, page) {
    const url = this._extensionPage(id, page);
    const panel = this.panels.get(id);
    if (panel && !panel.isDestroyed()) panel.close();
    let view = this.docked.get(id);
    if (!view || view.webContents.isDestroyed()) {
      view = new this.electron.WebContentsView({ webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
      const contents = view.webContents, contentsId = contents.id;
      this._guardContents(contents);
      // A docked page keeps working while it is collapsed or the account is in the background.
      contents.setBackgroundThrottling(false);
      this.docked.set(id, view);
      // window.close() in a docked page only collapses the dock, as closing a Chrome popup returns to the page.
      contents.on('close', () => { if (this.docked.get(id) === view) this.onDock(id, view, 'collapse'); });
      contents.once('destroyed', () => {
        for (const record of this._records(contentsId)) this._lost(record, 'target_closed');
        this.tabs.delete(contentsId);
        if (this.docked.get(id) !== view) return;
        this.docked.delete(id);
        this.onDock(id, null, 'closed');
      });
    }
    if (view.webContents.getURL() !== url) await view.webContents.loadURL(url);
    this.onDock(id, view, 'open');
    const game = this.game();
    if (game && !game.isDestroyed()) this._host.selectTab(game);
    this._host.ctx.store.lastFocusedWindowId = this.window().id;
  }

  // Closing a docked page releases its debugger sessions, like closing its window.
  async closeDock(id) {
    const view = this.docked.get(id);
    if (!view) return;
    await Promise.all([...this.attached.values()].filter(record => record.extensionId === id).map(record => this._detach(record))).catch(() => {});
    this._destroyDock(id);
  }

  _destroyDock(id) {
    const view = this.docked.get(id);
    if (!view) return;
    this.docked.delete(id);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.onDock?.(id, null, 'closed');
  }

  _guardContents(contents) {
    const guard = (event, url) => { try { this._url(url); } catch { event.preventDefault(); } };
    contents.on('will-navigate', guard); contents.on('will-redirect', guard);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      try { this._url(url); this._createWindow({ url }, true).catch(() => {}); } catch {}
      return { action: 'deny' };
    });
  }

  _newWindow(details) {
    const dimension = (value, fallback) => Number.isFinite(value) ? Math.max(200, Math.min(4096, Math.round(value))) : fallback;
    const win = new this.electron.BrowserWindow({ parent: this.window(), title: details.title || 'Extension', width: dimension(details.width, 960), height: dimension(details.height, 760), show: false,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
    const contents = win.webContents, id = contents.id;
    this.windows.add(win); this.onWindow(win);
    this._guardContents(contents);
    let closing = false;
    win.on('close', event => {
      const records = this._records(id);
      if (!records.length || closing) return;
      event.preventDefault(); closing = true;
      Promise.all(records.map(record => this._detach(record))).catch(() => {}).finally(() => { if (!win.isDestroyed()) win.destroy(); });
    });
    win.on('closed', () => {
      this.windows.delete(win);
      for (const record of this._records(id)) this._lost(record, 'target_closed');
      this.tabs.delete(id);
    });
    return win;
  }

  async _createWindow(details = {}, tracked) {
    const values = Array.isArray(details.url) ? details.url : [details.url || this.game()?.getURL()];
    if (values.length !== 1) throw new Error('Extension windows support one page at a time.');
    const url = this._url(values[0]);
    const win = this._newWindow(details);
    try {
      if (tracked) {
        this.tabs.set(win.webContents.id, win.webContents);
        this._host.addTab(win.webContents, win);
      }
      await win.loadURL(url); win.show();
      return win;
    } catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
  }

  _guardLibrary() {
    // shortcut: 4.10 lacks URL/current-window hooks and caches window tabs too early; remove guards when upstream fixes them.
    const handlers = this._host.ctx.router.handlers;
    const wrap = (name, guard) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Extension compatibility handler is unavailable: ${name}`);
      const original = handler.callback;
      handler.callback = (event, ...args) => guard(event, args, original);
    };
    for (const name of ['runtime.connectNative','runtime.sendNativeMessage','runtime.disconnectNative','browserAction.openPopup','browserAction.activate']) if (handlers.has(name)) wrap(name, () => { throw new Error('This extension API is unavailable in Astria.'); });
    if (handlers.has('browserAction.setPopup')) wrap('browserAction.setPopup', (event, args, original) => {
      if (args[0]?.popup) this._extensionPage(event.extension.id, args[0].popup);
      return original(event, ...args);
    });
    for (const name of handlers.keys()) if (name.startsWith('notifications.')) wrap(name, (event, args, original) => {
      if (!event.extension.manifest.permissions?.includes('notifications')) throw new Error('Extension notification permission is required.');
      const index = typeof args[0] === 'string' ? 1 : 0, options = args[index];
      if (typeof options?.iconUrl === 'string' && options.iconUrl.startsWith('chrome-extension://')) {
        const url = new URL(this._extensionPage(event.extension.id, options.iconUrl));
        args[index] = { ...options, iconUrl: url.pathname.slice(1) };
      }
      return original(event, ...args);
    });
    // Chrome side panels live inside the browser window; a focused docked page or panel window counts as its account window.
    const focusView = details => {
      const main = this.window();
      if (!details || typeof details !== 'object' || !main || details.id !== main.id || details.focused) return details;
      const focused = [...this.panels.values()].some(win => !win.isDestroyed() && win.isFocused()) || [...this.docked.values()].some(view => !view.webContents.isDestroyed() && view.webContents.isFocused());
      return focused ? { ...details, focused: true } : details;
    };
    for (const name of ['windows.get', 'windows.getAll', 'windows.getCurrent', 'windows.getLastFocused']) wrap(name, async (event, args, original) => {
      this._host.ctx.store.windowDetailsCache.clear();
      const result = await original(event, ...args);
      return Array.isArray(result) ? result.map(focusView) : focusView(result);
    });
    wrap('tabs.query', (event, [info = {}], original) => original(event, info.currentWindow ? { ...info, windowId: this.window().id } : info));
    wrap('tabs.update', (event, args, original) => {
      const props = typeof args[0] === 'object' ? args[0] : args[1];
      if (typeof args[0] === 'number') this._tab(args[0]);
      if (props?.url) this._url(props.url, event.extension.id);
      if (props?.active && (typeof args[0] !== 'number' || args[0] === this.game()?.id)) this.selectGame();
      return original(event, ...args);
    });
    wrap('tabs.remove', (event, args, original) => {
      for (const id of Array.isArray(args[0]) ? args[0] : [args[0]]) {
        if (this.gameTabs.has(this._tab(id))) throw new Error('The account game tab cannot be closed by an extension.');
      }
      return original(event, ...args);
    });
    wrap('windows.remove', (event, args, original) => {
      const id = args[0] === undefined || args[0] === -2 ? this._host.ctx.store.lastFocusedWindowId : args[0];
      if (id === this.window().id) throw new Error('The account window cannot be closed by an extension.');
      this._checkWindow(id);
      return original(event, ...args);
    });
    wrap('windows.update', async (event, args, original) => {
      const [id, props = {}] = args; this._checkWindow(id);
      const resolved = id === -2 ? this._host.ctx.store.lastFocusedWindowId : id;
      const win = resolved === this.window().id ? this.window() : [...this.windows].find(win => win.id === resolved);
      if (!win) throw new Error('Window does not belong to this account.');
      if (props.focused) { win.show(); win.focus(); }
      const bounds = Object.fromEntries(['x', 'y', 'width', 'height'].flatMap(key => {
        const value = props[{ x: 'left', y: 'top' }[key] || key];
        return Number.isFinite(value) ? [[key, Math.round(value)]] : [];
      }));
      if (win !== this.window() && Object.keys(bounds).length) win.setBounds(bounds);
      return win === this.window() ? original(event, id, { ...props, state: undefined }) : original(event, ...args);
    });
  }
}

module.exports = { AccountExtensions };
