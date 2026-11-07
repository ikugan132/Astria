'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const vm = require('node:vm');
const { AccountExtensions } = require('../src/extensions-runtime');
const ID = 'a'.repeat(32), OTHER = 'b'.repeat(32);
let next = 100;

function setup() {
  const calls = [], handlers = new Map(), extensions = new Map();
  class Contents extends EventEmitter {
    constructor(session, url = 'https://game.example/') {
      super(); this.id = next++; this.session = session; this.url = url; this.dead = false;
      this.debugger = new EventEmitter(); this.debugger.attached = false;
      this.debugger.isAttached = () => this.debugger.attached;
      this.debugger.attach = () => { this.debugger.attached = true; };
      this.debugger.detach = () => { calls.push(['detach', this.id]); this.debugger.attached = false; this.debugger.emit('detach', {}, 'target_closed'); };
      this.debugger.sendCommand = async (method, params) => { calls.push([method, params]); return { ok: true }; };
    }
    getURL() { return this.url; }
    isDestroyed() { return this.dead; }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
    async capturePage() {
      calls.push(['capture', this.id]);
      return { isEmpty: () => false, toPNG: () => Buffer.from('game-png'), toJPEG: quality => { calls.push(['jpegQuality', quality]); return Buffer.from('game-jpeg'); } };
    }
    async loadURL(url) { this.url = url; }
    close() { this.dead = true; this.emit('destroyed'); }
  }
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.id = next++; this.options = options; this._contents = new Contents(options.webPreferences?.session); this.dead = false; }
    get webContents() { if (this.dead) throw new TypeError('Object has been destroyed'); return this._contents; }
    isDestroyed() { return this.dead; }
    async loadURL(url) { return this.webContents.loadURL(url); }
    show() { this.shown = true; }
    focus() { this.emit('focus'); }
    destroy() { if (this.dead) return; const contents = this.webContents; this.dead = true; contents.close(); this.emit('closed'); }
    close() { const event = { preventDefault() { this.prevented = true; } }; this.emit('close', event); if (!event.prevented) this.destroy(); }
    setBounds(bounds) { this.bounds = bounds; }
  }
  class Host {
    constructor(options) {
      this.options = options; this.tabs = new Set(); this.windows = new Set(); this.events = [];
      const windowDetailsCache = new Map();
      const details = window => {
        if (!windowDetailsCache.has(window.id)) windowDetailsCache.set(window.id, { id: window.id,
          tabs: [...this.tabs].filter(tab => tab.window === window).map(tab => ({ id: tab.id, url: tab.getURL() })) });
        return windowDetailsCache.get(window.id);
      };
      const handlers = new Map([
        ['tabs.query', { callback: (_event, info) => [...this.tabs].filter(t => !info.windowId || t.window.id === info.windowId).map(t => ({ id: t.id, windowId: t.window.id })) }],
        ['tabs.update', { callback: async (_event, id, props) => { const t = [...this.tabs].find(t => t.id === id); if (props.url) await t.loadURL(props.url); return { id }; } }],
        ['tabs.remove', { callback: () => {} }],
        ['browserAction.setPopup', { callback: (_event, options) => options.popup }],
        ['browserAction.openPopup', { callback: () => 'unsafe popup' }],
        ['browserAction.activate', { callback: () => 'unsafe popup' }],
        ['notifications.create', { callback: (_event, _id, options) => options.iconUrl }],
        ['windows.get', { callback: (_event, id) => details([...this.windows].find(window => window.id === id)) }],
        ['windows.getAll', { callback: () => [...this.windows].map(details) }],
        ['windows.getCurrent', { callback: () => details([...this.windows].find(window => window.id === this.ctx.store.lastFocusedWindowId)) }],
        ['windows.getLastFocused', { callback: () => details([...this.windows].find(window => window.id === this.ctx.store.lastFocusedWindowId)) }],
        ['windows.update', { callback: async () => ({}) }],
        ['windows.remove', { callback: async (_event, id) => options.removeWindow([...this.windows].find(w => w.id === id)) }]
      ]);
      this.ctx = { router: { handlers, sendEvent: (...args) => this.events.push(args) }, store: { lastFocusedWindowId: null, windowDetailsCache } };
    }
    addTab(contents, window) {
      if (!this.windows.has(window)) this.ctx.store.windowDetailsCache.set(window.id, { id: window.id, tabs: [] });
      contents.window = window; this.tabs.add(contents); this.windows.add(window); this.ctx.store.lastFocusedWindowId ||= window.id;
    }
    removeTab(contents) { this.tabs.delete(contents); }
    selectTab(contents) { this.selected = contents; }
  }
  const session = { extensions: new EventEmitter(), serviceWorkers: new EventEmitter(), preloads: [], registerPreloadScript(p) { this.preloads.push(p); } };
  session.extensions.getExtension = id => extensions.get(id);
  session.extensions.loadExtension = async () => { const extension = { id: ID, url: `chrome-extension://${ID}/`, manifest: { name: 'Test', permissions: ['debugger', 'sidePanel'], side_panel: { default_path: 'panel.html' } } }; extensions.set(ID, extension); return extension; };
  session.extensions.removeExtension = id => { extensions.delete(id); };
  const windows = [], root = new Window(), game = new Contents(session);
  session.serviceWorkers.getWorkerFromVersionID = id => session.worker?.versionId === id ? session.worker : null;
  const electron = { BrowserWindow: Window, ipcMain: { handle: (name, callback) => handlers.set(name, callback) } };
  const original = Module._load;
  Module._load = function (name, ...args) { return name === 'electron-chrome-extensions' ? { ElectronChromeExtensions: Host } : original.call(this, name, ...args); };
  let runtime;
  try { runtime = new AccountExtensions({ session, game: () => game, window: () => root, electron, onWindow: w => windows.push(w), onActivity: () => calls.push(['activity']), selectGame: () => calls.push(['selectGame']) }); }
  finally { Module._load = original; }
  const senderFrame = { url: `chrome-extension://${ID}/panel.html`, send: (...args) => calls.push(['event', ...args]) };
  const event = { type: 'frame', sender: { session }, senderFrame };
  const invoke = async (method, ...args) => {
    const response = await [...handlers.values()][0](event, ID, method, args);
    if (response.error) throw new Error(response.error);
    return response.result;
  };
  return { runtime, session, root, game, windows, calls, invoke, event, handlers, extensions, Contents };
}

(async () => {
  const a = setup(); await a.runtime.load('fixture'); a.runtime.addGame(a.game);
  assert.equal(a.session.preloads[0].type, 'frame');
  assert.equal(a.session.preloads[1].type, 'service-worker');
  await a.invoke('subscribe');
  await a.invoke('debugger.attach', { tabId: a.game.id }, '1.3');
  assert.equal(a.runtime.controlling, true);
  a.game.astriaInputScale = 0.5;
  await a.invoke('debugger.sendCommand', { tabId: a.game.id }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 40, button: 'left', buttons: 1 });
  await a.invoke('debugger.sendCommand', { tabId: a.game.id }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  assert.deepEqual(a.calls.find(c => c[0] === 'Input.dispatchMouseEvent')[1], { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1 });
  for (const method of ['Target.getTargets', 'Browser.close', 'Network.getCookies', 'Fetch.enable', 'IO.read', 'DOM.setFileInputFiles', 'Input.dispatchDragEvent']) {
    await assert.rejects(a.invoke('debugger.sendCommand', { tabId: a.game.id }, method, {}), /not allowed/i);
  }
  await assert.rejects(a.invoke('debugger.sendCommand', { tabId: a.game.id }, 'Page.setWebLifecycleState', { state: 'frozen' }), /not allowed/i);
  for (const params of [{commands:['Paste']},{key:'Paste'},{modifiers:2,code:'KeyV'},{modifiers:10,windowsVirtualKeyCode:86},{modifiers:8,nativeVirtualKeyCode:45}]) {
    await assert.rejects(a.invoke('debugger.sendCommand', { tabId: a.game.id }, 'Input.dispatchKeyEvent', params), /clipboard/i);
  }
  await assert.rejects(a.invoke('debugger.sendCommand', { tabId: a.game.id, sessionId: 'other' }, 'Runtime.evaluate', {}), /target/i);
  const b = setup(); await b.runtime.load('fixture'); b.runtime.addGame(b.game);
  await assert.rejects(a.invoke('debugger.attach', { tabId: b.game.id }), /account/i);
  const mainHandler = [...a.handlers.values()][0];
  assert.match((await mainHandler({ ...a.event, senderFrame: { url: 'https://game.example/' } }, ID, 'subscribe', [])).error, /context/i);
  assert.match((await mainHandler(a.event, OTHER, 'subscribe', [])).error, /context/i);
  assert.match((await mainHandler({ ...a.event, sender: { session: b.session } }, ID, 'debugger.attach', [{ tabId: a.game.id }])).error, /account/i);
  await a.runtime.unload(ID);
  assert.equal(a.runtime.controlling, false);
  assert.ok(a.calls.some(c => c[0] === 'Input.dispatchMouseEvent' && c[1].type === 'mouseReleased'));
  assert.ok(a.calls.some(c => c[0] === 'Input.dispatchKeyEvent' && c[1].type === 'keyUp'));
  assert.ok(a.calls.some(c => c[0] === 'event' && c.includes('debugger.onDetach')));

  const c = setup(); await c.runtime.load('fixture'); c.runtime.addGame(c.game);
  c.game.debugger.attached = true;
  await assert.rejects(c.invoke('debugger.attach', { tabId: c.game.id }, '1.3'), /attached/i);
  await assert.rejects(c.invoke('debugger.detach', { tabId: c.game.id }), /owner|attached/i);
  assert.equal(c.game.debugger.attached, true);
  c.game.debugger.attached = false;
  c.extensions.get(ID).manifest.permissions = [];
  await assert.rejects(c.invoke('debugger.attach', { tabId: c.game.id }), /permission/i);
  c.extensions.get(ID).manifest.permissions = ['sidePanel', 'debugger'];
  await c.runtime.open(ID);
  assert.equal(c.windows.length, 1);
  assert.equal(c.windows[0].webContents.session, c.session);
  assert.equal(c.windows[0].webContents.getURL(), `chrome-extension://${ID}/panel.html`);
  assert.equal(c.windows[0].options.webPreferences.sandbox, true);
  await c.invoke('sidePanel.setOptions', { path: 'other.html' });
  await assert.rejects(c.invoke('sidePanel.setOptions', { path: 'https://evil.example/' }), /extension/i);
  assert.equal((await c.invoke('sidePanel.getOptions', {})).path, 'other.html');
  const host = c.runtime.host;
  assert.equal(host.tabs.has(c.windows[0].webContents), false);
  const library = (name, ...args) => host.ctx.router.handlers.get(name).callback({ extension: c.extensions.get(ID), sender: c.windows[0].webContents }, ...args);
  for (const [name, args] of [['windows.getAll', [{ populate: true }]], ['windows.get', [c.root.id, { populate: true }]], ['windows.getCurrent', [{ populate: true }]], ['windows.getLastFocused', [{ populate: true }]]]) {
    const result = await library(name, ...args), rootWindow = Array.isArray(result) ? result.find(window => window.id === c.root.id) : result;
    assert.deepEqual(rootWindow.tabs, [{ id: c.game.id, url: 'https://game.example/' }], `${name} includes the account game when the window was cached before its first tab`);
    host.ctx.store.windowDetailsCache.set(c.root.id, { id: c.root.id, tabs: [] });
  }
  await library('tabs.update', c.game.id, { active: true });
  assert.ok(c.calls.some(call => call[0] === 'selectGame'), 'activating an already active session tab selects its visible Astria account');
  await assert.rejects(async () => library('tabs.update', c.game.id, { url: 'file:///C:/secret.txt' }), /URL|allowed/i);
  await assert.rejects(async () => library('browserAction.setPopup', { popup: 'file:///C:/secret.txt' }), /URL|allowed/i);
  await assert.rejects(async () => library('browserAction.openPopup'), /unavailable/i);
  await assert.rejects(async () => library('browserAction.activate'), /unavailable/i);
  const notification = { iconUrl: `chrome-extension://${ID}/icons/128.png` };
  await assert.rejects(async () => library('notifications.create', 'test', notification), /permission/i);
  c.extensions.get(ID).manifest.permissions.push('notifications');
  assert.equal(await library('notifications.create', 'test', notification), 'icons/128.png');
  await assert.rejects(async () => library('windows.remove', c.root.id), /account|window/i);
  for (const url of ['file:///C:/secret.txt', 'data:text/html,hello', 'javascript:alert(1)', `chrome-extension://${OTHER}/panel.html`]) {
    await assert.rejects(host.options.createTab({ url }), /URL|extension|allowed/i);
  }
  const [webtab, webwindow] = await host.options.createTab({ url: 'https://game.example/other' });
  assert.equal(webtab.session, c.session); assert.equal(webwindow.options.parent, c.root);
  await c.invoke('debugger.attach', { tabId: webtab.id }, '1.3');
  await c.invoke('debugger.sendCommand', { tabId: webtab.id }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyB', key: 'b' });
  webwindow.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(c.calls.some(call => call[0] === 'Input.dispatchKeyEvent' && call[1].code === 'KeyB' && call[1].type === 'keyUp'), 'closing a web tab releases held input before destroying its target');
  assert.deepEqual(await library('tabs.query', { active: true, currentWindow: true }), [{ id: c.game.id, windowId: c.root.id }]);
  const workerHandlers = new Map();
  c.session.worker = { versionId: 4, scope: `chrome-extension://${ID}/`, ipc: { handle: (name, callback) => workerHandlers.set(name, callback) }, send() {} };
  c.session.serviceWorkers.emit('running-status-changed', { runningStatus: 'starting', versionId: 4 });
  const workerInvoke = [...workerHandlers.values()][0];
  assert.equal((await workerInvoke({ type: 'service-worker', session: c.session, serviceWorker: c.session.worker }, ID, 'subscribe', [])).error, undefined);
  assert.match((await workerInvoke({ type: 'service-worker', session: c.session, serviceWorker: c.session.worker }, OTHER, 'subscribe', [])).error, /context/i);
  await c.runtime.dispose();
  assert.equal(c.extensions.size, 0, 'disposing unloads an extension even when no debugger or panel exists');

  const d = setup(); await d.runtime.load('fixture'); d.runtime.addGame(d.game);
  await d.invoke('debugger.attach', { tabId: d.game.id }, '1.3');
  await d.invoke('debugger.sendCommand', { tabId: d.game.id }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyC', key: 'c' });
  d.game.debugger.sendCommand = (method, params) => {
    d.calls.push([method, params]); return method === 'Runtime.evaluate' ? new Promise(() => {}) : Promise.resolve({});
  };
  const hanging = d.invoke('debugger.sendCommand', { tabId: d.game.id }, 'Runtime.evaluate', { expression: 'new Promise(()=>{})', awaitPromise: true }).catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  await d.runtime.unload(ID);
  assert.ok(d.calls.some(call => call[0] === 'Input.dispatchKeyEvent' && call[1].code === 'KeyC' && call[1].type === 'keyUp'), 'a stalled command leaves time in the shared cleanup deadline to release input');
  await hanging;

  const race = setup(); await race.runtime.load('fixture'); race.runtime.addGame(race.game); await race.runtime.open(ID);
  const racingPanel = race.windows[0];
  await race.invoke('debugger.attach', { tabId: race.game.id }, '1.3');
  await race.invoke('debugger.sendCommand', { tabId: race.game.id }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyR', key: 'r' });
  await Promise.all([race.runtime.unload(ID), race.runtime.dispose(), Promise.resolve().then(() => racingPanel.close())]);
  await race.runtime.unload(ID); await race.runtime.dispose();
  assert.equal(race.runtime.controlling, false);
  assert.equal(racingPanel.isDestroyed(), true);
  assert.equal(race.extensions.size, 0, 'simultaneous native panel close, unload and dispose complete idempotently');

  const removing = setup(); await removing.runtime.load('fixture'); removing.runtime.addGame(removing.game);
  const [otherTab] = await removing.runtime.host.options.createTab({ url: 'https://another.example/' });
  await removing.invoke('debugger.attach', { tabId: removing.game.id }, '1.3');
  await removing.invoke('debugger.sendCommand', { tabId: removing.game.id }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyT', key: 't' });
  let release, entered; const held = new Promise(resolve => { release = resolve; }), cleaning = new Promise(resolve => { entered = resolve; });
  removing.game.debugger.sendCommand = () => { entered(); return held; };
  const unloading = removing.runtime.unload(ID); await cleaning;
  try { await assert.rejects(removing.invoke('debugger.attach', { tabId: otherTab.id }, '1.3'), /unload|context/i); }
  finally { release(); await unloading; }
  assert.equal(otherTab.debugger.isAttached(), false, 'an extension cannot attach to another tab during removal');
  await removing.runtime.dispose();

  const capture = setup(); await capture.runtime.load('fixture'); capture.runtime.addGame(capture.game);
  await assert.rejects(capture.invoke('tabs.captureVisibleTab', capture.root.id, { format: 'png' }), /permission/i);
  capture.extensions.get(ID).manifest.permissions.push('activeTab');
  await assert.rejects(capture.invoke('tabs.captureVisibleTab', capture.root.id, { format: 'png' }), /open|permission/i);
  await capture.runtime.open(ID);
  assert.equal(await capture.invoke('tabs.captureVisibleTab', capture.root.id, { format: 'png' }), 'data:image/png;base64,Z2FtZS1wbmc=');
  assert.equal(await capture.invoke('tabs.captureVisibleTab', { format: 'jpeg', quality: 65 }), 'data:image/jpeg;base64,Z2FtZS1qcGVn');
  assert.ok(capture.calls.some(call => call[0] === 'jpegQuality' && call[1] === 65));
  await assert.rejects(capture.invoke('tabs.captureVisibleTab', c.root.id, { format: 'png' }), /account|window/i);
  await capture.runtime.open(ID);
  await assert.rejects(capture.invoke('tabs.captureVisibleTab', capture.windows[0].id, { format: 'png' }), /account|window/i);
  for (const options of [{ format: 'webp' }, { quality: -1 }, { quality: 101 }, { quality: 1.5 }, { rect: { x: 0, y: 0 } }]) {
    await assert.rejects(capture.invoke('tabs.captureVisibleTab', capture.root.id, options), /options|format|quality/i);
  }
  assert.deepEqual(capture.calls.filter(call => call[0] === 'capture').map(call => call[1]), [capture.game.id, capture.game.id], 'capture only reaches the account game, never panel, root interface or another account');
  capture.extensions.get(ID).manifest.permissions = [];
  capture.extensions.get(ID).manifest.host_permissions = ['<all_urls>'];
  assert.equal(await capture.invoke('tabs.captureVisibleTab', -2, { format: 'png' }), 'data:image/png;base64,Z2FtZS1wbmc=');
  await capture.runtime.dispose();

  // Run the actual preload in a VM: a game page gets no bridge; extension callers get callback lastError and Promise rejection.
  const preload = fs.readFileSync(require.resolve('../src/extensions-preload'), 'utf8');
  function runPreload(url, type = 'renderer', extensionId = ID) {
    const world = { location: { href: url }, chrome: { runtime: { id: extensionId } }, console, setTimeout };
    const context = vm.createContext(world);
    const ipc = new EventEmitter(); ipc.invoke = async (_channel, _id, method) => method === 'subscribe' ? { result: undefined } : { error: 'Permission denied' };
    const bridge = { exposeInMainWorld: (name, api) => { Object.defineProperty(world, name, { value: api, enumerable: true }); }, executeInMainWorld: ({ func, args = [] }) => {
      world.__arguments = args;
      try { return vm.runInContext(`(${func.toString()})(...__arguments)`, context); }
      finally { delete world.__arguments; }
    } };
    vm.runInContext(preload, vm.createContext({ require: () => ({ contextBridge: bridge, ipcRenderer: ipc }), process: { type, contextIsolated: true }, location: world.location, URL, console }));
    return world;
  }
  const gameWorld = runPreload('https://game.example/'); assert.equal(gameWorld.chrome.debugger, undefined);
  const extensionWorld = runPreload(`chrome-extension://${ID}/panel.html`);
  assert.equal(extensionWorld.__astriaExtensionAPI, undefined);
  await assert.rejects(extensionWorld.chrome.tabs.captureVisibleTab({ format: 'png' }), /Permission denied/);
  await assert.rejects(extensionWorld.chrome.debugger.attach({ tabId: 1 }, '1.3'), /Permission denied/);
  await new Promise(resolve => extensionWorld.chrome.debugger.attach({ tabId: 1 }, '1.3', () => { assert.equal(extensionWorld.chrome.runtime.lastError.message, 'Permission denied'); resolve(); }));
  assert.equal(extensionWorld.chrome.runtime.lastError, undefined);
  const workerWorld = runPreload('', 'service-worker');
  assert.equal(typeof workerWorld.chrome.debugger, 'object', 'extension worker injection uses native extension identity when its preload location is not the extension URL');
  const siteWorkerWorld = runPreload('https://game.example/worker.js', 'service-worker', null);
  assert.equal(siteWorkerWorld.chrome.debugger, undefined, 'normal site workers receive no extension debugger shim');
  console.log('Extension runtime: account boundaries, input cleanup, panel isolation, worker authentication and preload API semantics passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
