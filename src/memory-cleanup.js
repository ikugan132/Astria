'use strict';
const { lease } = require('./debugger-share');
const lastCleanup = new WeakMap();
let busy = false;
async function collectPageMemory(contents) {
  if (contents.isDestroyed()) return 'closed';
  if (busy) return 'busy';
  if (Date.now() - (lastCleanup.get(contents) || 0) < 120000) return 'cooldown';
  let timer, connection;
  // Shares the debugger with a running Auto Clicker or extension; only another tool (DevTools) blocks it.
  try { connection = lease(contents); } catch { return 'debugging'; }
  busy = true;
  try {
    await Promise.race([
      contents.debugger.sendCommand('HeapProfiler.collectGarbage'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Memory cleanup timed out')), 5000); })
    ]);
    lastCleanup.set(contents, Date.now());
    return 'collected';
  } finally {
    clearTimeout(timer);
    try { connection.release(); }
    finally { busy = false; }
  }
}
module.exports = { collectPageMemory };
