'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const source = path.join(__dirname, '../src/account-order-ui.js');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'astria-account-order-'));
fs.writeFileSync(path.join(fixture, 'main.js'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(fixture, 'profile'))});
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL('data:text/html,<html><body></body></html>');
});
`);
let application;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: require('electron'), args: [path.join(fixture, 'main.js')], env });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>button{display:block;width:160px;height:40px}</style><nav id="accounts"></nav><button id="outside">Outside</button>');
  await page.addScriptTag({ path: source });
  await page.evaluate(() => {
    window.list = document.querySelector('#accounts');
    window.calls = []; window.selections = []; window.workspace = 'one';
    window.reset = (ids = ['a', 'b', 'c']) => {
      list.innerHTML = ids.map(id => `<button class="account-link" draggable="true" data-id="${id}" data-account="${id}" data-action="select"><span>${id}</span></button>`).join('');
      calls.length = 0; selections.length = 0; workspace = 'one';
    };
    window.row = id => list.querySelector(`[data-id="${id}"]`);
    window.gesture = (type, id, half = 'before') => {
      const target = id ? row(id).firstElementChild : document.querySelector('#outside');
      const rect = target.closest('button').getBoundingClientRect();
      const event = new DragEvent(type, { bubbles: true, cancelable: true, clientY: half === 'before' ? rect.top + 1 : rect.bottom - 1, dataTransfer: new DataTransfer() });
      target.dispatchEvent(event);
      window.lastTransfer = event.dataTransfer;
      return event.defaultPrevented;
    };
    document.body.addEventListener('click', event => {
      const node = event.target.closest('[data-action="select"]');
      if (node) selections.push(node.dataset.id);
    });
    window.dispose = AstriaAccountOrder.connect({ list, workspaceId: () => workspace, onOrder: async (id, ids) => {
      calls.push({ workspaceId: id, ids });
      if (window.waitForOrder) await window.waitForOrder;
      if (window.rejectOrder) throw new Error('Expected test persistence failure');
    } });
    reset();
  });

  await page.click('[data-id="b"]');
  assert.deepEqual(await page.evaluate(() => selections), ['b'], 'normal clicks still select accounts');
  assert.equal(await page.evaluate(() => {
    gesture('dragstart', 'c');
    const text = lastTransfer.getData('text/plain');
    gesture('dragend', 'c');
    return text;
  }), '', 'dragging a profile outside the sidebar must not paste its account ID into game fields');
  assert.deepEqual(await page.evaluate(() => {
    gesture('dragstart', 'c');
    const started = row('c').classList.contains('account-dragging');
    const accepted = gesture('dragover', 'a');
    const indicated = row('a').classList.contains('drop-before');
    gesture('drop', 'a');
    row('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    return { started, accepted, indicated, calls, selections, marked: list.querySelectorAll('.account-dragging,.drop-before,.drop-after').length };
  }), { started: true, accepted: true, indicated: true, calls: [{ workspaceId: 'one', ids: ['c', 'a', 'b'] }], selections: ['b'], marked: 0 }, 'dropping above a row submits the order and suppresses the drag-generated click');
  await page.click('[data-id="a"]');
  await page.focus('[data-id="c"]'); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => selections), ['b', 'a', 'c'], 'the next pointer click and keyboard selection remain usable');

  await page.evaluate(() => reset());
  await page.locator('[data-id="a"]').dragTo(page.locator('[data-id="c"]'), { targetPosition: { x: 20, y: 35 } });
  assert.deepEqual(await page.evaluate(() => calls), [{ workspaceId: 'one', ids: ['b', 'c', 'a'] }], 'a native Chromium mouse drag reaches the delegated controller');

  assert.deepEqual(await page.evaluate(() => {
    reset(); gesture('dragstart', 'a'); gesture('dragover', 'c', 'after');
    const indicated = row('c').classList.contains('drop-after'); gesture('drop', 'c', 'after');
    return { indicated, calls };
  }), { indicated: true, calls: [{ workspaceId: 'one', ids: ['b', 'c', 'a'] }] }, 'the bottom half inserts after the target');

  for (const cancellation of ['escape', 'outside', 'dragend', 'workspace', 'added', 'removed', 'reordered']) {
    assert.deepEqual(await page.evaluate(kind => {
      reset(); gesture('dragstart', 'a'); gesture('dragover', 'c', 'after');
      if (kind === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (kind === 'outside') gesture('drop');
      if (kind === 'dragend') gesture('dragend', 'a');
      if (kind === 'workspace') workspace = 'two';
      if (kind === 'added') list.append(row('b').cloneNode(true));
      if (kind === 'removed') row('b').remove();
      if (kind === 'reordered') list.prepend(row('b'));
      gesture('drop', 'c', 'after');
      return { calls, marked: list.querySelectorAll('.account-dragging,.drop-before,.drop-after').length };
    }, cancellation), { calls: [], marked: 0 }, `${cancellation} must cancel without persisting a stale order`);
  }

  assert.deepEqual(await page.evaluate(() => {
    reset();
    const external = gesture('dragover', 'c'); gesture('drop', 'c');
    gesture('dragstart', 'a'); gesture('drop', 'a');
    gesture('dragstart', 'a'); gesture('drop', 'b', 'before');
    row('a').draggable = false; gesture('dragstart', 'a'); gesture('drop', 'c');
    return { external, calls };
  }), { external: false, calls: [] }, 'external drags, self drops, unchanged order and non-draggable rows do nothing');

  await page.evaluate(() => { reset(); gesture('dragstart', 'a'); reset(); });
  assert.deepEqual(await page.evaluate(() => {
    gesture('drop', 'c', 'after');
    return calls;
  }), [{ workspaceId: 'one', ids: ['b', 'c', 'a'] }], 'delegation survives replacing the sidebar rows with the same members');

  await page.evaluate(() => {
    reset(); window.waitForOrder = new Promise(resolve => { window.finishOrder = resolve; });
    gesture('dragstart', 'a'); gesture('drop', 'c', 'after');
    gesture('dragstart', 'b'); gesture('drop', 'a');
  });
  assert.equal(await page.evaluate(() => calls.length), 1, 'a pending persistence operation blocks overlapping drags');
  await page.evaluate(async () => { finishOrder(); await waitForOrder; window.waitForOrder = null; });
  assert.deepEqual(await page.evaluate(() => {
    reset(); gesture('dragstart', 'c'); gesture('drop', 'a'); return calls;
  }), [{ workspaceId: 'one', ids: ['c', 'a', 'b'] }], 'reordering unlocks when persistence settles');
  await page.evaluate(() => { reset(); window.rejectOrder = true; gesture('dragstart', 'a'); gesture('drop', 'c', 'after'); });
  assert.deepEqual(await page.evaluate(() => {
    window.rejectOrder = false; reset(); gesture('dragstart', 'c'); gesture('drop', 'a'); return calls;
  }), [{ workspaceId: 'one', ids: ['c', 'a', 'b'] }], 'a rejected save is handled and permits a retry');
  await page.evaluate(() => { reset(); gesture('dragstart', 'a'); gesture('dragover', 'c'); dispose(); gesture('drop', 'c'); });
  assert.deepEqual(await page.evaluate(() => ({ calls, marked: list.querySelectorAll('.account-dragging,.drop-before,.drop-after').length })), { calls: [], marked: 0 }, 'disposing removes listeners and active markers');
  assert.deepEqual(errors, [], 'drag handling causes no browser errors');
  console.log('PASS: Electron DOM drag positions, delegated rerendering, selection preservation, stale/cancelled gestures and pending-save isolation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await application?.close();
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
});
