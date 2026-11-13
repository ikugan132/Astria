'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only the local, trusted MultiNest interface gets this preload script.
// Sites loaded into isolated panels never receive this API.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel, cb) => {
  const handler = (_event, value) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('multiNest', Object.freeze({
  getState: () => invoke('state:get'),
  workspaceAdd: name => invoke('workspace:add', name),
  workspaceRename: (id, name) => invoke('workspace:rename', id, name),
  workspaceSelect: id => invoke('workspace:select', id),
  workspaceDelete: id => invoke('workspace:delete', id),
  workspaceLayout: layout => invoke('workspace:layout', layout),
  accountAdd: data => invoke('account:add', data),
  accountEdit: (id, data) => invoke('account:edit', id, data),
  accountDelete: id => invoke('account:delete', id),
  accountSelect: id => invoke('account:select', id),
  accountOrder: (workspaceId,ids) => invoke('account:order',workspaceId,ids),
  extensionsList: id => invoke('extensions:list',id),
  extensionsInstall: id => invoke('extensions:install',id),
  extensionsUpdate: (id,entryId) => invoke('extensions:update',id,entryId),
  extensionsEnable: (id,entryId,enabled) => invoke('extensions:enable',id,entryId,enabled),
  extensionsRemove: (id,entryId) => invoke('extensions:remove',id,entryId),
  extensionsOpen: (id,entryId,mode) => invoke('extensions:open',id,entryId,mode),
  extensionsDocks: () => invoke('extensions:docks'),
  extensionsDock: (id,extensionId) => invoke('extensions:dock',id,extensionId),
  extensionsClose: (id,extensionId) => invoke('extensions:close',id,extensionId),
  onDocks: cb => subscribe('extensions:docks',cb),
  accountRename: (id, name) => invoke('account:rename', id, name),
  accountColor: (id, color) => invoke('account:color', id, color),
  accountActivity: (id, mode) => invoke('account:activity', id, mode),
  accountEcoFPS: (id, fps) => invoke('account:eco-fps', id, fps),
  accountResolution: (id, preset) => invoke('account:resolution', id, preset),
  visualRest: enabled => invoke('settings:visual-rest', enabled),
  ultra: id => invoke('view:ultra', id),
  cleanup: id => invoke('view:cleanup', id),
  appMenu: point => invoke('menu:app', point),
  accountMenu: (id, point) => invoke('menu:account', id, point),
  sidebarWidth: width => invoke('settings:sidebar-width', width),
  layoutMenu: point => invoke('menu:layout', point),
  floatingSwap: () => invoke('floating:swap'),
  floatingStep: (x,y) => invoke('floating:step',x,y),
  floatingAccounts: ids => invoke('floating:accounts',ids),
  automationGet: id => invoke('automation:get',id),
  automationSave: (id,settings) => invoke('automation:save',id,settings),
  automationPick: (id,point) => invoke('automation:pick',id,point),
  automationPreview: (id,point) => invoke('automation:preview',id,point),
  automationStart: (id,request) => invoke('automation:start',id,request),
  automationStop: id => invoke('automation:stop',id),
  automationStopAll: () => invoke('automation:stop-all'),
  onAutomation: cb => subscribe('automation:state',cb),
  reload: id => invoke('view:reload', id, true), // the panel button is a full reload: nothing from the cache
  home: id => invoke('view:home', id),
  mute: id => invoke('view:mute', id),
  zoom: (id, delta) => invoke('view:zoom', id, delta),
  theme: theme => invoke('settings:theme', theme),
  language: language => invoke('settings:language', language),
  export: () => invoke('config:export'),
  import: () => invoke('config:import'),
  updateCheck: () => invoke('updates:check'),
  updateDownload: () => invoke('updates:download'),
  updateInstall: () => invoke('updates:install'),
  onUpdateProgress: cb => subscribe('updates:progress', cb),
  setOverlay: open => ipcRenderer.send('ui:overlay', open),
  layout: rects => ipcRenderer.send('layout:update', rects),
  onState: cb => subscribe('state:updated', cb),
  onStatus: cb => subscribe('view:status', cb),
  onMetrics: cb => subscribe('view:metrics', cb),
  onCommand: cb => subscribe('ui:command', cb),
  onToast: cb => subscribe('ui:toast', cb),
  onResize: cb => subscribe('window:resized', cb)
}));
