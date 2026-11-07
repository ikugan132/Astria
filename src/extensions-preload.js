'use strict';
const { contextBridge, ipcRenderer } = require('electron');

(() => {
if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) {
  const extensionId = contextBridge.executeInMainWorld({ func: () => globalThis.chrome?.runtime?.id });
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) return;
  let receive;
  ipcRenderer.on('astria-extension-event', (_event, name, ...args) => receive?.(name, args));
  const bridge = {
    invoke: (method, args) => ipcRenderer.invoke('astria-extension-api', extensionId, method, args),
    listen: callback => { receive = callback; }
  };
  function inject(bridge) {
    const chrome = globalThis.chrome;
    if (!chrome?.runtime?.id) return;
    const listeners = new Map();
    const event = name => {
      const callbacks = new Set(); listeners.set(name, callbacks);
      return { addListener: callback => { if (typeof callback === 'function') callbacks.add(callback); },
        removeListener: callback => callbacks.delete(callback), hasListener: callback => callbacks.has(callback), hasListeners: () => callbacks.size > 0 };
    };
    bridge.listen((name, args) => {
      for (const callback of listeners.get(name) || []) { try { callback(...args); } catch (error) { console.error(error); } }
    });
    const call = method => (...args) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
      const promise = bridge.invoke(method, args).then(response => {
        if (response.error) throw new Error(response.error);
        return response.result;
      });
      if (!callback) return promise;
      promise.then(result => callback(result), error => {
        const runtime = chrome.runtime, descriptor = Object.getOwnPropertyDescriptor(runtime, 'lastError');
        Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message: error.message } });
        try { callback(); }
        finally { if (descriptor) Object.defineProperty(runtime, 'lastError', descriptor); else delete runtime.lastError; }
      });
    };
    Object.defineProperty(chrome, 'debugger', { configurable: true, enumerable: true, value: {
      attach: call('debugger.attach'), detach: call('debugger.detach'), sendCommand: call('debugger.sendCommand'), getTargets: call('debugger.getTargets'),
      onDetach: event('debugger.onDetach'), onEvent: event('debugger.onEvent')
    } });
    Object.defineProperty(chrome, 'sidePanel', { configurable: true, enumerable: true, value: {
      setPanelBehavior: call('sidePanel.setPanelBehavior'), getOptions: call('sidePanel.getOptions'), setOptions: call('sidePanel.setOptions'), open: call('sidePanel.open'), close: call('sidePanel.close')
    } });
    Object.defineProperty(chrome, 'tabs', { configurable: true, enumerable: true, value: {
      ...chrome.tabs, captureVisibleTab: call('tabs.captureVisibleTab')
    } });
    bridge.invoke('subscribe', []).catch(error => console.error(error));
  }
  contextBridge.executeInMainWorld({ func: inject, args: [bridge] });
}
})();
