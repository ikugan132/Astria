'use strict';
// Electron gives a page one debugger connection; Chrome lets several clients share a tab.
// Astria's Auto Clicker, memory cleanup and every extension take a lease on the same
// connection. The first lease attaches and the last one released detaches. A debugger
// attached by anything else (DevTools) is never taken over or detached.
//
// The page has one mouse. A click from one lease (press … release) is never split by
// another lease's mouse events: those wait until the button is released, so two tools
// clicking at once both land instead of breaking each other's clicks.
const leases = new WeakMap();
const GRAB_LIMIT = 1500;

function lease(contents, version = '1.3') {
  if (!contents || contents.isDestroyed()) throw new Error('Account page is closed.');
  const debug = contents.debugger;
  let entry = leases.get(debug);
  if (!entry || entry.gone) {
    if (debug.isAttached()) throw new Error('Another debugger is already attached to this page.');
    debug.attach(version);
    entry = { count: 0, gone: false, grab: null, timer: null, waiters: [] };
    entry.lost = () => { entry.gone = true; free(entry); debug.removeListener('detach', entry.lost); };
    debug.on('detach', entry.lost);
    leases.set(debug, entry);
  }
  entry.count++;
  const owner = {};
  let released = false;
  return {
    get active() { return !released && !entry.gone; },
    async send(method, params) {
      const mouse = method === 'Input.dispatchMouseEvent';
      if (mouse) {
        const deadline = Date.now() + GRAB_LIMIT;
        while (entry.grab && entry.grab !== owner && Date.now() < deadline) {
          await new Promise(resolve => { entry.waiters.push(resolve); setTimeout(resolve, deadline - Date.now()); });
        }
        if (params?.type === 'mousePressed') {
          entry.grab = owner; clearTimeout(entry.timer);
          entry.timer = setTimeout(() => free(entry), GRAB_LIMIT);
        }
      }
      try { return await debug.sendCommand(method, params); }
      finally { if (mouse && params?.type === 'mouseReleased' && entry.grab === owner) free(entry); }
    },
    release() {
      if (released) return;
      released = true;
      if (entry.grab === owner) free(entry);
      if (entry.gone || leases.get(debug) !== entry || --entry.count > 0) return;
      debug.removeListener('detach', entry.lost);
      leases.delete(debug);
      if (!contents.isDestroyed() && debug.isAttached()) debug.detach();
    }
  };
}

function free(entry) {
  entry.grab = null; clearTimeout(entry.timer); entry.timer = null;
  for (const resolve of entry.waiters.splice(0)) resolve();
}

module.exports = { lease };
