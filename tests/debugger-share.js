'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { lease } = require('../src/debugger-share');
const { createDriver } = require('../src/automation-engine');
const { AccountExtensions } = require('../src/extensions-runtime');
function page() {
  const contents = new EventEmitter(), debug = new EventEmitter();
  let attached = false;
  Object.assign(debug, { attaches: 0, detaches: 0, isAttached: () => attached,
    attach() { assert.equal(attached, false, 'one real attach'); attached = true; debug.attaches++; },
    detach() { attached = false; debug.detaches++; debug.emit('detach', {}, 'target_closed'); },
    sendCommand: async method => method === 'Runtime.evaluate' ? { result: { type: 'object', value: [800, 600] } } : {} });
  Object.assign(contents, { debugger: debug, isDestroyed: () => false });
  return contents;
}
(async () => {
  // Leases share one attach; the last release detaches.
  let p = page();
  const a = lease(p), b = lease(p);
  assert.equal(p.debugger.attaches, 1);
  a.release(); a.release();
  assert.equal(p.debugger.isAttached(), true, 'still held by the other lease');
  b.release();
  assert.equal(p.debugger.detaches, 1);
  // Another tool's debugger (DevTools) is refused and never detached.
  p = page(); p.debugger.attach();
  assert.throws(() => lease(p), /already attached/);
  assert.equal(p.debugger.isAttached(), true);
  // A lost connection is not detached again, even after another tool attaches.
  p = page(); const lost = lease(p); p.debugger.detach(); p.debugger.attach(); lost.release();
  assert.equal(p.debugger.isAttached(), true); assert.equal(lost.active, false);

  // One click (press … release) from a lease is never split by another lease's mouse events.
  p = page(); const order = [], send = p.debugger.sendCommand;
  p.debugger.sendCommand = async (method, params) => { order.push((params.who || '') + ':' + params.type); return send(method, params); };
  const one = lease(p), two = lease(p), sleep = ms => new Promise(r => setTimeout(r, ms));
  await one.send('Input.dispatchMouseEvent', { who: 'one', type: 'mousePressed' });
  const other = two.send('Input.dispatchMouseEvent', { who: 'two', type: 'mousePressed' });
  await two.send('Input.dispatchKeyEvent', { who: 'two', type: 'keyDown' });
  await sleep(30);
  await one.send('Input.dispatchMouseEvent', { who: 'one', type: 'mouseReleased' });
  await other; await two.send('Input.dispatchMouseEvent', { who: 'two', type: 'mouseReleased' });
  assert.deepEqual(order, ['one:mousePressed', 'two:keyDown', 'one:mouseReleased', 'two:mousePressed', 'two:mouseReleased'], 'keys pass, the other click waits');
  // A click that never releases cannot hold the mouse forever.
  order.length = 0; await one.send('Input.dispatchMouseEvent', { who: 'one', type: 'mousePressed' });
  const started = Date.now(); await two.send('Input.dispatchMouseEvent', { who: 'two', type: 'mousePressed' });
  assert.ok(Date.now() - started >= 1400 && Date.now() - started < 2500, 'stuck click is bounded');
  one.release(); two.release();

  // The Auto Clicker starts while an extension holds the tab, and the reverse.
  p = page();
  const ext = lease(p);
  const driver = await createDriver(p);
  ext.release();
  assert.equal(p.debugger.isAttached(), true, 'extension leaving keeps the Auto Clicker connected');
  await driver.key('down', 'A'); await driver.key('up', 'A');
  const later = lease(p);
  await driver.dispose();
  assert.equal(p.debugger.isAttached(), true, 'Auto Clicker stopping keeps the extension connected');
  later.release();
  assert.equal(p.debugger.detaches, 1);
  assert.ok(AccountExtensions, 'extension runtime loads with the shared debugger');
  console.log('PASS: Auto Clicker, extensions and memory cleanup share one debugger connection; other tools are never taken over');
})().catch(error => { console.error(error); process.exitCode = 1; });
