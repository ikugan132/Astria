'use strict';
const resolutions = { '720p': {width:1280,height:720}, '768p': {width:1366,height:768}, '900p': {width:1600,height:900}, '1080p': {width:1920,height:1080} };
function frameBudget(account, { active = false, loaded = 1, rest = false, ultraBackground = false } = {}) {
  let fps = 0;
  if (account.activity === 'eco') fps = account.ecoFPS || 15;
  else if (account.activity === 'adaptive') {
    const secondary = loaded >= 8 ? 5 : loaded >= 4 ? 10 : 15;
    fps = active ? 60 : Math.min(account.ecoFPS || 15, secondary);
  }
  if (rest) fps = Math.min(fps || 2, 2);
  if (ultraBackground) fps = Math.min(fps || 1, 1);
  return fps;
}
function resolutionBounds(preset, panel) {
  const size = typeof preset === 'string' ? Object.hasOwn(resolutions, preset) ? resolutions[preset] : null : preset;
  if (!size || ![size.width,size.height].every(value=>Number.isFinite(value)&&value>0)) return null;
  const scale = Math.min(panel.width / size.width, panel.height / size.height);
  const width = Math.round(size.width * scale), height = Math.round(size.height * scale);
  return {x: panel.x + Math.floor((panel.width-width)/2), y: panel.y + Math.floor((panel.height-height)/2), width, height};
}
// A crashed or navigating page has no render frame: Electron throws on mainFrame then.
// Returns false so the caller sends the limit again once the page is back.
function sendFrameLimit(contents, fps) {
  try {
    for (const frame of contents.mainFrame.framesInSubtree) {
      if (!frame.isDestroyed()) frame.send('astria:frame-limit', fps);
    }
    return true;
  } catch { return false; }
}

module.exports = { resolutions, frameBudget, resolutionBounds, sendFrameLimit };
