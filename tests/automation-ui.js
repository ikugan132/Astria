'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../src/macro-core');
const keys = require('../src/macro-keys');
const strings = require('../src/automation-i18n');
global.AstriaMacroCore = core;
global.AstriaMacroKeys = keys;
global.document = { body: {} };
let observe;
global.MutationObserver = class {
  constructor(callback) { observe = callback; }
  observe() {}
  disconnect() {}
};
const ui = require('../src/automation-ui');
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const tr = value => strings[value] || value;
const point = { x: 0.25, y: 0.5, width: 800, height: 600 };
const settings = {
  targets: [{ id: 'target-one', name: 'First', enabled: true, interval: 5, action: { type: 'mouse', button: 'left' }, point }],
  macros: [{ id: 'macro-one', name: 'Salvar', profile: { ...core.newProfile(), steps: [core.defaultStep('move')] }, viewport: { width: 800, height: 600 } }]
};
let current, markup, draws = 0, listener, unsubscribed = 0, saved, started, pickResult, pendingSave;
let previewResult = { ok: true };
const realSetTimeout = global.setTimeout, previewDelays = [], previewPoints = [];
global.setTimeout = (callback, delay) => { previewDelays.push(delay); return realSetTimeout(callback, 0); };
const messages = [];
function modal(html, ready) {
  if (current) current.isConnected = false;
  markup = html; draws++;
  const nodes = new Map();
  current = {
    isConnected: true, classList: { add() {} }, setAttribute() {},
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, disabled: false, value: 'key', focus() {} });
      return nodes.get(selector);
    },
    querySelectorAll() { return []; }
  };
  ready(current);
}
function closeModal() { current.isConnected = false; observe?.(); }
const api = {
  async automationGet() { return { ok: true, settings, runtime: { running: false } }; },
  async automationSave(id, value) { saved = clone(value); if (pendingSave) await pendingSave; return { ok: true, settings: clone(value) }; },
  async automationStart(id, value) { started = value; return { ok: true, runtime: { kind: value.kind, running: true } }; },
  async automationStop() { return { ok: true }; },
  async automationPreview(id, value) {
    assert.equal(current.isConnected, false, 'marker preview must uncover the game');
    assert.ok(value.x >= 0 && value.x < 1); previewPoints.push(clone(value));
    return previewResult;
  },
  async automationPick() { assert.equal(current.isConnected, false, 'point picker must uncover the game'); return pickResult; },
  onAutomation(callback) { listener = callback; return () => { unsubscribed++; }; }
};
const options = { account: { id: 'account-one', name: '<Account>' }, api, modal, closeModal, tr, toast: value => messages.push(value), esc };
const input = (scope, field, value, type = 'text') => {
  const target = { dataset: { scope, field }, value: String(value), type, checked: !!value };
  current.oninput({ target });
  return target;
};
async function click(action, data = {}) {
  const node = { dataset: { do: action, ...data }, disabled: false };
  return current.onclick({ target: { closest: () => node } });
}

(async () => {
  await ui.open(options);
  assert.match(markup, /role="tablist"/);
  assert.match(markup, /&lt;Account&gt;/);
  assert.match(markup, /type="color"[^>]*value="#ff0000"/);
  assert.match(markup, /data-field="showMarker" checked/);
  input('target', 'name', '<Draft>');
  input('target', 'interval', 1.25, 'number');
  input('target', 'markerColor', '#12abef', 'color');
  input('target', 'showMarker', false, 'checkbox');
  const beforeEvent = draws;
  listener({ id: 'other-account', runtime: { running: true } });
  listener({ id: 'account-one', runtime: { running: true, kind: 'clicker', cycle: 2 } });
  assert.equal(draws, beforeEvent, 'runtime events preserve the form DOM and drafts');
  assert.match(current.querySelector('[data-runtime]').textContent, /Running/);
  pickResult = { ok: true, point: { ...point, x: 0.75 } };
  await click('pick-target');
  assert.match(markup, /&lt;Draft&gt;/);
  assert.match(markup, /value="1.25"/);
  const beforePreview = draws;
  await click('preview-target');
  assert.equal(draws, beforePreview + 1, 'target preview restores the modal');
  assert.equal(current.isConnected, true);
  assert.match(markup, /&lt;Draft&gt;/);
  assert.match(markup, /value="1.25"/);
  assert.equal(previewPoints[0].x, 0.75);
  assert.equal(previewPoints[0].markerColor, '#12abef', 'explicit preview uses the chosen color');
  assert.deepEqual(previewDelays, [1600]);
  assert.equal(saved, undefined, 'preview never saves or sends input');
  assert.equal(started, undefined);
  const type = input('action', 'type', 'key'); current.onchange({ target: type });
  input('action', 'key', 'F10');
  current.oninput({ target: { dataset: { scope: 'action', mod: 'Ctrl' }, checked: true } });
  await click('start');
  assert.equal(saved.targets[0].name, '<Draft>');
  assert.equal(saved.targets[0].point.x, 0.75);
  assert.equal(saved.targets[0].markerColor, '#12abef');
  assert.equal(saved.targets[0].showMarker, false, 'marker visibility is independent of starting inputs');
  assert.deepEqual(saved.targets[0].action, { type: 'key', key: 'F10', mods: ['Ctrl'] }, 'action keys are not reserved hotkeys');
  assert.deepEqual(started, { kind: 'clicker' });
  await click('add-target');
  assert.match(markup, /type="color"[^>]*value="#ff0000"/);
  assert.match(markup, /data-field="showMarker" checked/);
  pickResult = { ok: true, cancelled: true };
  await click('pick-target');
  await click('save');
  assert.match(current.querySelector('[data-error]').textContent, /Choose a point/);
  assert.equal(saved.targets.length, 1, 'an unfinished target is never persisted');
  await click('delete-target');
  await click('tab', { tab: 'macro' });
  assert.match(markup, />Salvar<\/option>/, 'user profile names are never translated');
  pickResult = { ok: true, point: { x: 0.5, y: 0.25, width: 1600, height: 1200 } };
  await click('pick-step');
  input('step', 'glide', 0.75, 'number');
  await click('preview-step');
  assert.equal(current.isConnected, true);
  assert.match(markup, /value="0.75"/);
  assert.deepEqual(previewPoints[1], { x: 0.5, y: 0.25, width: 800, height: 600 });
  assert.deepEqual(previewDelays, [1600, 1600]);
  await click('save');
  assert.equal(saved.macros[0].profile.steps[0].x, 400, 'picked point uses the existing macro viewport');
  assert.equal(saved.macros[0].profile.steps[0].y, 150);
  current.querySelector('#automation-new-type').value = 'text';
  await click('add-step');
  input('step', 'text', 'Keep <text> intact');
  await click('step-up');
  await click('once');
  assert.equal(saved.macros[0].profile.steps[0].text, 'Keep <text> intact');
  assert.deepEqual(started, { kind: 'macro', macroId: 'macro-one', once: true });
  const allTypes = ['key', 'mouse', 'move', 'scroll', 'text', 'wait'];
  for (const type of allTypes) {
    current.querySelector('#automation-new-type').value = type;
    await click('add-step');
    assert.match(markup, /Pass|Step/, 'each supported editor renders');
  }
  await click('save');
  assert.equal(saved.macros[0].profile.steps.length, 8);
  assert.equal(core.cleanProfile(saved.macros[0].profile).version, 2);
  await click('close');
  assert.equal(unsubscribed, 1);
  await ui.open(options);
  pickResult = { ok: false, error: 'Picker failed' };
  input('target', 'name', 'Keep on picker failure');
  await click('pick-target');
  assert.match(markup, /Keep on picker failure/);
  assert.equal(current.querySelector('[data-error]').textContent, 'Picker failed');
  previewResult = { ok: false, error: 'Preview failed' };
  await click('preview-target');
  assert.equal(current.isConnected, true, 'failed preview restores the draft for editing');
  assert.match(markup, /Keep on picker failure/);
  assert.equal(current.querySelector('[data-error]').textContent, 'Preview failed');
  previewResult = { ok: true };
  started = undefined;
  let finishSave;
  pendingSave = new Promise(resolve => { finishSave = resolve; });
  const stoppedStart = click('start');
  await click('stop');
  finishSave(); await stoppedStart;
  assert.equal(started, undefined, 'Stop cancels a pending start while settings save');
  pendingSave = new Promise(resolve => { finishSave = resolve; });
  const starting = click('start');
  await click('close');
  finishSave(); await starting;
  assert.equal(started, undefined, 'closing during save prevents a later start');
  assert.equal(unsubscribed, 2);
  await ui.open(options);
  let finishPreview;
  previewResult = new Promise(resolve => { finishPreview = resolve; });
  const previewing = click('preview-target');
  await ui.open(options);
  const replacementDraws = draws;
  finishPreview({ ok: true }); await previewing;
  assert.equal(draws, replacementDraws, 'disposed preview never reopens over a newer dialog');
  assert.equal(current.isConnected, true);
  await click('close');
  assert.equal(unsubscribed, 4);
  const source = fs.readFileSync(require.resolve('../src/automation-ui'), 'utf8');
  for (const match of source.matchAll(/\b(?:t|tr|Error)\('([^']+)'\)/g)) assert.ok(strings[match[1]], `missing EN string: ${match[1]}`);
  console.log('PASS: automation drafts, runtime isolation, picking/cancel, uncovered marker previews, page coordinates, macro editing, action keys, cleanup and EN strings');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.setTimeout = realSetTimeout; });
