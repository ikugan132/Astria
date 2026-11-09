'use strict';
const keys = require('./macro-keys');

const owners = new WeakMap();
const running = new WeakSet();
const driverSignals = new WeakMap();
const BUTTON_BIT = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };
const MAX_SETTINGS_BYTES = 8 * 1024 * 1024;
const abortError = () => Object.assign(new Error('Automation aborted.'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };

function fmtNum(v) { return Number.isInteger(v) ? String(v) : String(+v.toFixed(3)).replace('.', ','); }
function parseNum(value, label, lo, hi, integer = false) {
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  if (typeof n !== 'number' || value === '' || value === null || !Number.isFinite(n)) throw new Error(`${label}: precisa ser um número.`);
  if (n < lo || n > hi) throw new Error(`${label}: precisa estar entre ${fmtNum(lo)} e ${fmtNum(hi)}.`);
  if (integer && !Number.isInteger(n)) throw new Error(`${label}: precisa ser um número inteiro.`);
  return integer ? n : Math.round(n * 10000) / 10000;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: invalid object.`);
  return value;
}
function label(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}: invalid text (maximum ${max}).`);
  return value.trim();
}
function viewport(value) {
  object(value, 'Viewport');
  return { width: parseNum(value.width, 'Viewport width', 1, 100000, true),
    height: parseNum(value.height, 'Viewport height', 1, 100000, true) };
}
function point(value) {
  object(value, 'Point');
  if (![value.x, value.y].every(n => Number.isFinite(n) && n >= 0 && n < 1)) throw new Error('Point must be inside the viewport.');
  return { x: value.x, y: value.y, ...viewport(value) };
}
function normalizeSettings(raw = {}) {
  object(raw, 'Settings');
  const list = name => {
    const values = raw[name] === undefined ? [] : raw[name];
    if (!Array.isArray(values) || values.length > 100) throw new Error(`${name}: maximum 100 entries.`);
    const ids = new Set();
    return values.map(value => {
      object(value, name);
      const id = value.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error('ID: use letters, digits and hyphens only (maximum 128).');
      if (ids.has(id)) throw new Error(`${name}: duplicate ID.`);
      ids.add(id);
      return { ...value, id, name: label(value.name, 'Name', 80) };
    });
  };
  const targets = list('targets').map(value => {
    const action = object(value.action, 'Action');
    let clean;
    if (action.type === 'key') clean = { type: 'key', ...keys.makeCombo(action.key, action.mods) };
    else if (action.type === 'mouse' && ['left', 'right', 'middle'].includes(action.button)) clean = { type: 'mouse', button: action.button };
    else throw new Error('Invalid clicker action.');
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Enabled must be boolean.');
    if (value.showMarker !== undefined && typeof value.showMarker !== 'boolean') throw new Error('Show marker must be boolean.');
    const markerColor = value.markerColor === undefined ? '#ff0000' : value.markerColor;
    if (typeof markerColor !== 'string' || !/^#[a-f\d]{6}$/i.test(markerColor)) throw new Error('Invalid marker color.');
    return { id: value.id, name: value.name, enabled: value.enabled !== false,
      showMarker: value.showMarker !== false, markerColor: markerColor.toLowerCase(),
      interval: parseNum(value.interval ?? 5, 'Interval', .05, 86400), action: clean, point: point(value.point) };
  });
  const result = { targets };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SETTINGS_BYTES) throw new Error('Automation settings exceed 8 MiB.');
  return result;
}

async function createDriver(contents) {
  if (!contents || contents.isDestroyed()) throw new Error('Account page is closed.');
  const debug = contents.debugger;
  if (owners.has(contents) || debug.isAttached()) throw new Error('This account already has an attached debugger.');
  debug.attach('1.3');
  let attached = true, disposed = false, disposePromise, fault = null, tail = Promise.resolve();
  let position = { x: 0, y: 0 }, buttons = 0;
  const lifecycle = new AbortController();
  const held = new Map();
  const clickCounts = new Map();
  const lost = () => { attached = false; lifecycle.abort(); };
  debug.on('detach', lost);
  contents.on('destroyed', lost);
  function available() {
    if (disposed) throw new Error('Automation driver is disposed.');
    if (!attached || contents.isDestroyed()) throw new Error('Account page or debugger is closed.');
    if (fault) throw fault;
  }
  function enqueue(task, signal, cleanup = false) {
    const next = tail.catch(() => {}).then(() => {
      if (!cleanup) { checkAbort(signal); available(); }
      return task();
    });
    tail = next;
    return next;
  }
  async function send(method, params, timeout = 3000) {
    if (!attached || contents.isDestroyed()) throw new Error('Account debugger is closed.');
    let timer;
    try {
      return await Promise.race([debug.sendCommand(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => {
          fault = new Error('Automation input timed out.');
          reject(fault);
        }, Math.max(1, timeout));
      })]);
    } finally { clearTimeout(timer); }
  }
  const modifierBits = () => [...held.values()].reduce((bits, def) => bits | (keys.MOD_BIT[keys.MOD_OF_NAME[def.name]] || 0), 0);
  async function mouse(type, at, options = {}, signal, cleanup = false, timeout) {
    if (!cleanup) { checkAbort(signal); available(); }
    if (at) position = { x: at.x, y: at.y };
    const button = options.button || 'left';
    if (!(button in BUTTON_BIT)) throw new Error('Invalid mouse button.');
    const wasHeld = !!(buttons & BUTTON_BIT[button]);
    if (type === 'down') { buttons |= BUTTON_BIT[button]; clickCounts.set(button, options.clickCount || 1); }
    if (type === 'up') buttons &= ~BUTTON_BIT[button];
    if (button === 'right' && (type === 'down' || type === 'up')) contents.astriaAutomationContextUntil = Date.now() + 500;
    // CDP pointer input uses widget coordinates when Electron emulation or zoom scales the page.
    const scale = Number.isFinite(contents.astriaInputScale) && contents.astriaInputScale > 0 ? contents.astriaInputScale : 1;
    try {
      await send('Input.dispatchMouseEvent', { type: { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased', wheel: 'mouseWheel' }[type],
        x: position.x * scale, y: position.y * scale,
        button: type === 'move' ? Object.keys(BUTTON_BIT).find(b => buttons & BUTTON_BIT[b]) || 'none' : type === 'wheel' ? 'none' : button,
        buttons, modifiers: modifierBits(), clickCount: type === 'down' || type === 'up' ? clickCounts.get(button) || 1 : 0,
        ...(type === 'wheel' ? { deltaX: 0, deltaY: options.deltaY } : {}) }, timeout);
    } catch (error) {
      if (type === 'up' && wasHeld) buttons |= BUTTON_BIT[button];
      throw error;
    }
  }
  async function key(type, name, signal, cleanup = false, timeout) {
    if (!cleanup) { checkAbort(signal); available(); }
    const def = keys.keyDef(name);
    if (!def) throw new Error('Unknown key.');
    if (keys.MOUSE_KEYS[def.name]) return mouse(type, null, { button: keys.MOUSE_KEYS[def.name] }, signal, cleanup, timeout);
    const id = def.code || def.name;
    const wasHeld = held.has(id);
    if (type === 'down') held.set(id, def);
    else held.delete(id);
    const modifiers = modifierBits();
    const shifted = (modifiers & 8) && def.shifted;
    const text = type === 'up' || (modifiers & 7) ? '' : shifted && def.text ? def.shifted : def.text;
    try {
      await send('Input.dispatchKeyEvent', { type: type === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
        code: def.code, key: shifted || def.key, text, unmodifiedText: type === 'up' ? '' : def.text,
        windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, location: def.loc, isKeypad: def.loc === 3, modifiers }, timeout);
    } catch (error) {
      if (type === 'up' && wasHeld) held.set(id, def);
      throw error;
    }
  }
  async function release() {
    const deadline = Date.now() + 1500;
    let firstError;
    // Cleanup has one shared deadline, even if the renderer stops replying with many keys held.
    for (const button of Object.keys(BUTTON_BIT).reverse()) {
      if (!(buttons & BUTTON_BIT[button]) || !attached || Date.now() >= deadline) continue;
      try { await mouse('up', null, { button }, null, true, deadline - Date.now()); } catch (error) { firstError ||= error; }
    }
    for (const def of [...held.values()].reverse()) {
      if (!attached || Date.now() >= deadline) break;
      try { await key('up', def.name, null, true, deadline - Date.now()); } catch (error) { firstError ||= error; }
    }
    if (firstError) throw firstError;
  }
  const driver = {
    get position() { return { ...position }; },
    viewport(signal) {
      return enqueue(async () => {
        const response = await send('Runtime.evaluate', { expression: '[innerWidth, innerHeight]', returnByValue: true });
        checkAbort(signal);
        const value = response.result?.value;
        if (!Array.isArray(value) || value.length !== 2) throw new Error('Cannot read account viewport.');
        return viewport({ width: value[0], height: value[1] });
      }, signal);
    },
    mouse(type, at, options, signal) { return enqueue(() => mouse(type, at, options, signal), signal); },
    key(type, name, mods = [], signal) {
      return enqueue(async () => {
        const combo = keys.makeCombo(name, mods);
        const names = [...combo.mods.map(m => keys.MOD_KEY_NAME[m]), combo.key];
        for (const item of type === 'up' ? names.reverse() : names) await key(type, item, signal);
      }, signal);
    },
    release() { return enqueue(release, null, true); },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      lifecycle.abort();
      disposePromise = enqueue(async () => {
        try { await release(); }
        finally {
          debug.removeListener('detach', lost);
          contents.removeListener('destroyed', lost);
          try { if (attached && debug.isAttached()) { attached = false; debug.detach(); } }
          finally { if (owners.get(contents) === driver) owners.delete(contents); }
        }
      }, null, true);
      return disposePromise;
    }
  };
  owners.set(contents, driver);
  driverSignals.set(driver, lifecycle.signal);
  try {
    const size = await driver.viewport();
    position = { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) };
  } catch (error) { await driver.dispose().catch(() => {}); throw error; }
  return driver;
}

function wait(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError()); };
    const timer = setTimeout(finish, Math.max(0, Math.ceil(ms)));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function withRun({ driver, signal, onState }, execute) {
  if (!driver || running.has(driver)) throw new Error('Automation driver is missing or already running.');
  running.add(driver);
  let failure;
  try { checkAbort(signal); await execute(); }
  catch (error) { if (error.name !== 'AbortError' || !signal?.aborted) failure = error; }
  finally {
    try { await driver.release(); } catch (error) { failure ||= error; }
    running.delete(driver);
  }
  onState?.({ phase: failure ? 'error' : signal?.aborted ? 'stopped' : 'completed' });
  if (failure) throw failure;
}
async function tapKey(driver, key, mods, hold, signal) {
  await driver.key('down', key, mods, signal);
  await wait(Math.max(10, hold * 1000), signal);
  await driver.key('up', key, mods, signal);
}
async function click(driver, button, count, signal, hold = 30) {
  for (let n = 1; n <= count; n++) {
    if (n > 1) await wait(70, signal);
    await driver.mouse('down', null, { button, clickCount: n }, signal);
    await wait(hold, signal);
    await driver.mouse('up', null, { button, clickCount: n }, signal);
  }
}
function runOptions(options) {
  const signals = [options.signal, driverSignals.get(options.driver)].filter(Boolean);
  return { ...options, signal: signals.length ? AbortSignal.any(signals) : undefined };
}
async function runClicker(targets, options) {
  options = runOptions(options);
  const { driver, signal, onState } = options;
  return withRun(options, async () => {
    const now = Date.now();
    const active = normalizeSettings({ targets }).targets.filter(t => t.enabled).map(t => ({ ...t, nextAt: now + t.interval * 1000 }));
    if (!active.length) throw new Error('Add an enabled clicker target first.');
    const report = () => onState?.({ phase: 'running', targets: active.map(t => ({ id: t.id, point: { ...t.point }, nextAt: t.nextAt, showMarker: t.showMarker, markerColor: t.markerColor })) });
    report();
    while (true) {
      checkAbort(signal);
      const next = active.reduce((a, b) => a.nextAt <= b.nextAt ? a : b);
      if (next.nextAt > Date.now()) await wait(next.nextAt - Date.now(), signal);
      const startedAt = Date.now(), size = await driver.viewport(signal);
      await driver.mouse('move', { x: Math.min(size.width - 1, Math.floor(next.point.x * size.width)),
        y: Math.min(size.height - 1, Math.floor(next.point.y * size.height)) }, {}, signal);
      if (next.action.type === 'mouse') await click(driver, next.action.button, 1, signal, 10);
      else await tapKey(driver, next.action.key, next.action.mods, .01, signal);
      const scheduled = startedAt + next.interval * 1000;
      next.nextAt = scheduled > Date.now() ? scheduled : Date.now() + next.interval * 1000;
      report();
    }
  });
}

module.exports = { normalizeSettings, createDriver, runClicker };
