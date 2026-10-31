'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const { normalizeSettings, createDriver, runMacro, runClicker } = require('../src/automation-engine');
const core = require('../src/macro-core');
const keys = require('../src/macro-keys');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function page(width = 800, height = 600) {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.viewport = [width, height];
  contents.commands = [];
  contents.debugger = new EventEmitter();
  let attached = false;
  contents.debugger.isAttached = () => attached;
  contents.debugger.attach = () => { assert.equal(attached, false); attached = true; };
  contents.debugger.detach = () => { attached = false; contents.debugger.emit('detach', {}, 'target_closed'); };
  contents.debugger.sendCommand = async (method, params) => {
    contents.commands.push({ method, params: structuredClone(params), at: Date.now() });
    if (contents.intercept) await contents.intercept(method, params);
    if (method === 'Runtime.evaluate') return { result: { type: 'object', value: [...contents.viewport] } };
    return {};
  };
  return contents;
}
const input = p => p.commands.filter(c => c.method.startsWith('Input.'));
const target = (id, interval = .05, action = { type: 'mouse', button: 'left' }) => ({
  id, name: id, enabled: true, interval, action, point: { x: .25, y: .5, width: 800, height: 600 }
});
const record = steps => ({ id: 'macro', name: 'Macro', viewport: { width: 800, height: 600 },
  profile: { version: 2, repeat: 1, start_delay: 0, loop_delay: 0, steps } });

test('version 2 profiles and all key helpers work in CommonJS and browser scripts', () => {
  assert.deepEqual(keys.makeCombo('control', ['SHIFT', 'Ctrl']), { key: 'Ctrl', mods: ['Shift'] });
  assert.deepEqual(keys.makeCombo('escape', []), { key: 'Esc', mods: [] });
  const p = core.cleanProfile({ version: 2, repeat: 2, start_delay: 0, steps: [
    { type: 'key', key: 'F8' }, { type: 'mouse', x: 100, y: 200 }, { type: 'text', text: 'é🐈' }
  ] });
  assert.equal(p.steps[0].key, 'F8');
  assert.equal(p.steps[1].at_point, true);
  assert.equal(p.steps[2].text, 'é🐈');
  assert.throws(() => core.cleanProfile({ version: 3 }), /versão/);
  assert.throws(() => core.cleanStep({ type: 'key', key: 'made up' }), /Tecla/);
  const context = vm.createContext({ URL });
  for (const file of ['macro-keys.js', 'macro-core.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  assert.equal(context.AstriaMacroKeys.keyDef('F10').name, 'F10');
  assert.equal(context.AstriaMacroCore.newProfile().version, 2);
  assert.equal(context.AstriaMacroCore.describeStep(context.AstriaMacroCore.defaultStep('wait')), 'Esperar 1 s');
});

test('settings validation snapshots and bounds account data without retaining extra fields', () => {
  assert.deepEqual(normalizeSettings(), { macros: [], targets: [] });
  const raw = { macros: [record([{ type: 'key', key: 'return', mods: ['control'] }])], targets: [target('one')], extra: true };
  const result = normalizeSettings(raw);
  raw.targets[0].point.x = .9;
  assert.equal(result.targets[0].point.x, .25);
  assert.deepEqual(result.macros[0].profile.steps[0].mods, ['Ctrl']);
  assert.equal(result.macros[0].profile.steps[0].key, 'Enter');
  assert.equal('extra' in result, false);
  for (const invalid of [null, [], { macros: {} }, { targets: [target('same'), target('same')] },
    { targets: [{ ...target('one'), interval: .049 }] }, { targets: [{ ...target('one'), point: { x: 1, y: 0, width: 800, height: 600 } }] },
    { macros: [{ ...record([]), viewport: { width: 0, height: 600 } }] },
    { targets: [{ ...target('one'), action: { type: 'key', key: 'invalid' } }] },
    { targets: Array.from({ length: 101 }, (_, n) => target(String(n))) }]) {
    assert.throws(() => normalizeSettings(invalid));
  }
  assert.equal(normalizeSettings({ targets: [target('key', 5, { type: 'key', key: 'F10', mods: [] })] }).targets[0].action.key, 'F10');
});

test('normalized points retain precision at the right and bottom viewport edges', () => {
  const raw = target('edge');
  raw.point.x = .999999;
  raw.point.y = .123456789;
  const clean = normalizeSettings({ targets: [raw] }).targets[0].point;
  assert.equal(clean.x, .999999);
  assert.equal(clean.y, .123456789);
});

test('marker options default to visible red and reject invalid colors or visibility', () => {
  const original = target('old');
  const clean = normalizeSettings({ targets: [original] }).targets[0];
  assert.equal(clean.showMarker, true, 'existing saved targets receive the new default');
  assert.equal(clean.markerColor, '#ff0000');
  const custom = normalizeSettings({ targets: [{ ...original, showMarker: false, markerColor: '#12AbEf' }] }).targets[0];
  assert.equal(custom.showMarker, false);
  assert.equal(custom.markerColor, '#12abef');
  assert.equal(custom.enabled, true, 'hiding a marker does not disable its target');
  for (const markerColor of [null, 123, '#fff', 'red', '#ff0000;display:none', '#GG0000']) {
    assert.throws(() => normalizeSettings({ targets: [{ ...original, markerColor }] }), /color/i);
  }
  for (const showMarker of [null, 0, 'false']) {
    assert.throws(() => normalizeSettings({ targets: [{ ...original, showMarker }] }), /marker/i);
  }
});

test('settings reject macro and target IDs that could alter selectors or paths', () => {
  for (const id of ['bad"id', 'bad\'id', '../macro', 'path\\target', '#selector', 'spaced id', 'under_score', ' padded ']) {
    assert.throws(() => normalizeSettings({ targets: [{ ...target('one'), id }] }), /ID/);
    assert.throws(() => normalizeSettings({ macros: [{ ...record([]), id }] }), /ID/);
  }
  assert.equal(normalizeSettings({ targets: [target('Aa09-valid-uuid')] }).targets[0].id, 'Aa09-valid-uuid');
});

test('driver refuses another debugger and keeps its attachment until disposal', async () => {
  const foreign = page();
  foreign.debugger.attach();
  await assert.rejects(createDriver(foreign), /debugger|depurador/i);
  assert.equal(foreign.debugger.isAttached(), true);
  const p = page();
  const driver = await createDriver(p);
  await assert.rejects(createDriver(p), /debugger|depurador/i);
  assert.deepEqual(await driver.viewport(), { width: 800, height: 600 });
  await driver.dispose();
  await driver.dispose();
  assert.equal(p.debugger.isAttached(), false);
  assert.ok(p.commands.every(c => !c.method.startsWith('Emulation.') && c.method !== 'Page.setWebLifecycleState'));
  const again = await createDriver(p);
  await again.dispose();
});

test('pointer dispatch uses current widget scale while stored positions and viewport remain logical', async () => {
  const p = page();
  const driver = await createDriver(p);
  p.astriaInputScale = .25;
  await driver.mouse('move', { x: 400, y: 300 });
  await driver.mouse('down', null, { button: 'left' });
  p.astriaInputScale = 1;
  await driver.mouse('up', null, { button: 'left' });
  p.astriaInputScale = 1.5;
  await driver.mouse('wheel', null, { deltaY: 100 });
  assert.deepEqual(input(p).map(c => [c.params.type, c.params.x, c.params.y]), [
    ['mouseMoved', 100, 75], ['mousePressed', 100, 75], ['mouseReleased', 400, 300], ['mouseWheel', 600, 450]
  ]);
  assert.equal(input(p).at(-1).params.deltaY, 100);
  assert.deepEqual(driver.position, { x: 400, y: 300 });
  assert.deepEqual(await driver.viewport(), { width: 800, height: 600 });
  for (const invalid of [undefined, 0, -1, NaN, Infinity, '2']) {
    p.astriaInputScale = invalid;
    await driver.mouse('move', null);
    assert.deepEqual([input(p).at(-1).params.x, input(p).at(-1).params.y], [400, 300]);
  }
  await driver.dispose();
});

test('macro rescales logical points after resize and sends trusted CDP key combinations', async () => {
  const p = page(400, 300);
  const driver = await createDriver(p);
  const states = [];
  await runMacro(record([
    { type: 'mouse', action: 'click', button: 'right', at_point: true, x: 200, y: 300, after: 0 },
    { type: 'key', action: 'tap', key: 'A', mods: ['Ctrl'], hold: 0, after: 0 },
    { type: 'key', action: 'tap', key: 'F8', hold: 0, after: 0 },
    { type: 'mouse', action: 'click', x: 200, y: 300, after: 0 }
  ]), { driver, onState: patch => { states.push(patch); if (patch.step === 1) p.viewport = [1600, 1200]; } });
  const events = input(p);
  const click = events.find(c => c.params.type === 'mousePressed');
  assert.equal(click.params.x, 100);
  assert.equal(click.params.y, 150);
  assert.equal(click.params.button, 'right');
  assert.deepEqual(events.filter(c => c.params.type === 'mousePressed').map(c => [c.params.x, c.params.y]), [[100, 150], [400, 600]]);
  assert.ok(p.astriaAutomationContextUntil > Date.now());
  const a = events.find(c => c.params.code === 'KeyA' && c.params.type === 'rawKeyDown');
  assert.equal(a.params.modifiers, 2);
  assert.equal(a.params.text, '');
  assert.ok(events.some(c => c.params.code === 'F8' && c.params.type === 'rawKeyDown'));
  assert.equal(states.at(-1).phase, 'completed');
  await driver.dispose();
});

test('macro point moves, wheel notches and unicode text retain profile behavior', async () => {
  const p = page();
  const driver = await createDriver(p);
  await runMacro(record([
    { type: 'move', x: 100, y: 50, glide: 0, after: 0 },
    { type: 'scroll', direction: 'down', amount: 2, at_point: false, after: 0 },
    { type: 'text', text: 'Aé\n', char_delay: 0, after: 0 }
  ]), { driver });
  const events = input(p);
  assert.deepEqual(events.filter(c => c.params.type === 'mouseWheel').map(c => [c.params.x, c.params.y, c.params.deltaY]), [[100, 50, 100], [100, 50, 100]]);
  assert.ok(events.some(c => c.params.code === 'KeyA' && c.params.key === 'A' && c.params.modifiers === 8));
  assert.ok(events.some(c => c.method === 'Input.insertText' && c.params.text === 'é'));
  assert.ok(events.some(c => c.params.code === 'Enter' && c.params.type === 'keyDown'));
  await driver.dispose();
});

test('imports without viewport snapshot the starting page and start the virtual pointer at its center', async () => {
  const p = page(400, 300);
  const driver = await createDriver(p);
  const imported = record([
    { type: 'mouse', at_point: false, after: 0 },
    { type: 'mouse', x: 100, y: 150, after: 0 }
  ]);
  delete imported.viewport;
  await runMacro(imported, { driver, onState: s => { if (s.step === 1) p.viewport = [800, 600]; } });
  assert.deepEqual(input(p).filter(c => c.params.type === 'mousePressed').map(c => [c.params.x, c.params.y]), [[200, 150], [200, 300]]);
  await driver.dispose();
});

test('once and profile repeat counts finish, empty and out-of-viewport macros fail before input', async () => {
  const p = page();
  const driver = await createDriver(p);
  const r = record([{ type: 'key', key: 'F10', hold: 0, after: 0 }]);
  r.profile.repeat = 3;
  await runMacro(r, { driver });
  assert.equal(input(p).filter(c => c.params.code === 'F10' && c.params.type === 'rawKeyDown').length, 3);
  p.commands.length = 0;
  await runMacro({ ...r, once: true }, { driver });
  assert.equal(input(p).filter(c => c.params.code === 'F10' && c.params.type === 'rawKeyDown').length, 1);
  await assert.rejects(runMacro(record([]), { driver }), /passo|step/i);
  const outside = record([{ type: 'mouse', x: 800, y: 0 }]);
  await assert.rejects(runMacro(outside, { driver }), /ponto|point|visível|viewport/i);
  await driver.dispose();
});

test('abort while a down is in flight releases it and prevents every later macro step', async () => {
  const p = page();
  const driver = await createDriver(p);
  const controller = new AbortController();
  let resumed;
  const gate = new Promise(resolve => { resumed = resolve; });
  p.intercept = async (method, params) => {
    if (method === 'Input.dispatchKeyEvent' && params.code === 'KeyA' && params.type === 'keyDown') {
      controller.abort();
      await gate;
    }
  };
  const running = runMacro(record([
    { type: 'key', action: 'down', key: 'A', after: 0 },
    { type: 'mouse', x: 5, y: 5, after: 0 }, { type: 'text', text: 'never', after: 0 }
  ]), { driver, signal: controller.signal });
  await sleep(10);
  resumed();
  await running;
  assert.deepEqual(input(p).map(c => [c.method, c.params.type, c.params.code]), [
    ['Input.dispatchKeyEvent', 'keyDown', 'KeyA'], ['Input.dispatchKeyEvent', 'keyUp', 'KeyA']
  ]);
  await driver.dispose();
});

test('abort interrupts waits immediately and releases persistent mouse and modifier holds', async () => {
  const p = page();
  const driver = await createDriver(p);
  const controller = new AbortController();
  const running = runMacro(record([
    { type: 'key', action: 'down', key: 'B', mods: ['Shift'], after: 0 },
    { type: 'mouse', action: 'down', x: 10, y: 20, after: 0 },
    { type: 'wait', seconds: 86400 }
  ]), { driver, signal: controller.signal, onState: s => { if (s.step === 2) controller.abort(); } });
  await running;
  const events = input(p);
  assert.ok(events.some(c => c.params.type === 'mouseReleased' && c.params.buttons === 0));
  assert.ok(events.some(c => c.params.code === 'KeyB' && c.params.type === 'keyUp'));
  assert.ok(events.some(c => c.params.code === 'ShiftLeft' && c.params.type === 'keyUp' && c.params.modifiers === 0));
  await driver.dispose();
});

test('failed input still releases all tracked downs and disposal blocks queued input', async () => {
  const p = page();
  const driver = await createDriver(p);
  p.intercept = async (method, params) => { if (params.code === 'KeyA' && params.type === 'rawKeyDown') throw Error('CDP failure'); };
  await assert.rejects(runMacro(record([{ type: 'key', action: 'down', key: 'A', mods: ['Ctrl'] }]), { driver }), /CDP failure/);
  assert.ok(input(p).some(c => c.params.code === 'KeyA' && c.params.type === 'keyUp'));
  assert.ok(input(p).some(c => c.params.code === 'ControlLeft' && c.params.type === 'keyUp'));
  p.intercept = null;
  await driver.key('down', 'C');
  const disposed = driver.dispose();
  await assert.rejects(driver.key('down', 'D'), /disposed|closed|fechado/i);
  await disposed;
  assert.ok(input(p).some(c => c.params.code === 'KeyC' && c.params.type === 'keyUp'));
  assert.equal(input(p).some(c => c.params.code === 'KeyD'), false);
});

test('a queued input checks abort again before reaching Chromium', async () => {
  const p = page();
  const driver = await createDriver(p);
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  p.intercept = async (method, params) => { if (params.code === 'KeyA' && params.type === 'keyDown') await gate; };
  const first = driver.key('down', 'A');
  const controller = new AbortController();
  const queued = driver.key('down', 'B', [], controller.signal);
  const rejection = assert.rejects(queued, /abort/i);
  controller.abort();
  unblock();
  await first;
  await rejection;
  assert.equal(input(p).some(c => c.params.code === 'KeyB'), false);
  await driver.dispose();
});

test('losing debugger ownership never detaches a later external attachment', async () => {
  const p = page();
  const driver = await createDriver(p);
  p.debugger.detach();
  p.debugger.attach();
  await assert.rejects(driver.key('down', 'A'), /closed/i);
  await driver.dispose();
  assert.equal(p.debugger.isAttached(), true);
  p.debugger.detach();
});

test('failed release is retried during disposal for both mouse buttons and keys', async () => {
  const p = page();
  const driver = await createDriver(p);
  await driver.key('down', 'A');
  await driver.mouse('down', { x: 10, y: 20 }, { button: 'left' });
  const failed = new Set();
  p.intercept = async (method, params) => {
    if (params.type === 'mouseReleased' || params.type === 'keyUp') {
      if (!failed.has(params.type)) { failed.add(params.type); throw Error('release failed'); }
    }
  };
  await assert.rejects(driver.release(), /release failed/);
  await driver.dispose();
  assert.equal(input(p).filter(c => c.params.type === 'mouseReleased').length, 2);
  assert.equal(input(p).filter(c => c.params.type === 'keyUp' && c.params.code === 'KeyA').length, 2);
});

test('disposal during a modifier down cancels the rest of its in-flight combination', async () => {
  const p = page();
  const driver = await createDriver(p);
  let unblock, started;
  const gate = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  p.intercept = async (method, params) => {
    if (params.code === 'ControlLeft' && params.type === 'rawKeyDown') { started(); await gate; }
  };
  const pressing = driver.key('down', 'A', ['Ctrl']);
  const rejection = assert.rejects(pressing, /disposed|closed/i);
  await entered;
  const disposing = driver.dispose();
  unblock();
  await rejection;
  await disposing;
  assert.equal(input(p).some(c => c.params.code === 'KeyA'), false);
  assert.ok(input(p).some(c => c.params.code === 'ControlLeft' && c.params.type === 'keyUp'));
});

test('driver disposal interrupts a running macro wait without waiting for its timer', async () => {
  const p = page();
  const driver = await createDriver(p);
  const controller = new AbortController();
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const macro = runMacro(record([{ type: 'wait', seconds: 1 }]), {
    driver, signal: controller.signal, onState: s => { if (s.step === 0) entered(); }
  });
  await waiting;
  await driver.dispose();
  const completed = await Promise.race([macro.then(() => true), sleep(60).then(() => false)]);
  controller.abort();
  await macro;
  assert.equal(completed, true);
});

test('an unresponsive renderer cannot hang input or disposal indefinitely', async () => {
  const p = page();
  const driver = await createDriver(p);
  p.intercept = () => new Promise(() => {});
  const began = Date.now();
  await assert.rejects(driver.key('down', 'A'), /timed out/i);
  await assert.rejects(driver.dispose(), /timed out/i);
  assert.equal(p.debugger.isAttached(), false);
  assert.ok(Date.now() - began < 6500, 'input plus cleanup has a bounded deadline');
});

test('clicker targets have independent countdowns, resize with the logical viewport and stop cleanly', async () => {
  const p = page();
  const driver = await createDriver(p);
  const controller = new AbortController();
  const states = [];
  const items = [{ ...target('fast'), showMarker: false }, { ...target('slow', .12, { type: 'key', key: 'F1', mods: [] }), markerColor: '#00ff00' }, { ...target('disabled'), enabled: false }];
  const stop = setTimeout(() => controller.abort(), 285);
  await runClicker(items, { driver, signal: controller.signal, onState: s => { states.push(s); p.viewport = [400, 200]; } });
  clearTimeout(stop);
  const events = input(p);
  const clicks = events.filter(c => c.params.type === 'mousePressed');
  const presses = events.filter(c => c.params.code === 'F1' && c.params.type === 'rawKeyDown');
  assert.ok(clicks.length >= 3 && clicks.length <= 5, `fast count ${clicks.length}`);
  assert.equal(presses.length, 2);
  assert.ok(clicks.every(c => c.params.x === 100 && c.params.y === 100));
  const first = states.find(s => s.targets?.length);
  assert.deepEqual(first.targets.map(t => t.id), ['fast', 'slow']);
  assert.ok(first.targets[1].nextAt - first.targets[0].nextAt >= 60);
  assert.equal(first.targets[0].showMarker, false, 'hidden target still runs on its own interval');
  assert.equal(first.targets[1].markerColor, '#00ff00');
  const count = events.length;
  await sleep(60);
  assert.equal(input(p).length, count);
  await driver.dispose();
});

test('slow target input never creates catch-up clicks after a stall', async () => {
  const p = page();
  const driver = await createDriver(p);
  const controller = new AbortController();
  let calls = 0;
  p.intercept = async (method, params) => {
    if (params.type === 'mouseReleased' && ++calls === 1) await sleep(160);
    if (params.type === 'mousePressed' && calls >= 2) controller.abort();
  };
  const stop = setTimeout(() => controller.abort(), 450);
  await runClicker([target('one')], { driver, signal: controller.signal });
  clearTimeout(stop);
  const clicks = input(p).filter(c => c.params.type === 'mousePressed');
  assert.ok(clicks.length >= 2 && clicks.length <= 3);
  assert.ok(clicks[1].at - clicks[0].at >= 200, `click gap ${clicks[1].at - clicks[0].at}`);
  await driver.dispose();
});

(async () => {
  for (const { name, fn } of tests) { await fn(); console.log('PASS: ' + name); }
})().catch(error => { console.error(error); process.exitCode = 1; });
