'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only animation callbacks are paced; game clocks, timers and networking stay native.
const setLimit = contextBridge.executeInMainWorld({
  args: [Number(process.argv.find(value => value.startsWith('--astria-fps='))?.split('=')[1]) || 0],
  func: initial => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const timeout = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    const now = window.performance.now.bind(window.performance);
    const pending = new Map();
    let fps = initial, sequence = 0, last = -Infinity, timer = null;
    function stopTimer() {
      if (timer !== null) { clear(timer); timer = null; }
    }
    function queue(entry) {
      // Separate native callbacks preserve browser microtask and error handling.
      entry.frame = request(time => {
        if (!pending.has(entry.id)) return;
        entry.frame = null;
        if (fps && time !== last && time - last < 1000 / fps - 0.5) { schedule(); return; }
        last = time;
        pending.delete(entry.id);
        if (!pending.size) stopTimer();
        entry.callback.call(window, time);
      });
    }
    function flush() {
      timer = null;
      for (const entry of pending.values()) if (entry.frame === null) queue(entry);
    }
    function schedule() {
      if (timer !== null) return;
      // Sleep between budgets instead of polling every display refresh.
      const wait = fps ? 1000 / fps - (now() - last) : 0;
      if (wait > 0) timer = timeout(flush, wait);
      else flush();
    }
    window.requestAnimationFrame = callback => {
      if (typeof callback !== 'function') throw new TypeError('Animation callback must be a function');
      const entry = { id: ++sequence, callback, frame: null };
      pending.set(entry.id, entry);
      if (fps) schedule();
      else queue(entry);
      return entry.id;
    };
    window.cancelAnimationFrame = id => {
      id = Number(id);
      const entry = pending.get(id);
      if (entry && entry.frame !== null) cancel(entry.frame);
      pending.delete(id);
      if (!pending.size) stopTimer();
    };
    return value => {
      if ([0, 1, 2, 5, 10, 15, 30, 60].includes(value) && value !== fps) { fps = value; last = -Infinity; stopTimer(); flush(); }
    };
  }
});

// No API is exported to the site; only the host can send a new frame budget.
ipcRenderer.on('astria:frame-limit', (_event, fps) => setLimit(fps));

// Passive page-relative markers; the website never receives an automation API.
if(process.isMainFrame){
  let host,root,markers=[],preview,pick,timer,suppressClick=false,suppressContext=false;
  const heldKeys=new Set(),heldButtons=new Set(),suppressedKeys=new Set(),suppressedButtons=new Set();
  const style=(node,text)=>{node.style.cssText=text;return node;};
  function surface(){
    if(host?.isConnected)return true;
    if(!document.documentElement)return false;
    host=style(document.createElement('div'),'all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;');
    host.setAttribute('data-astria-overlay','');host.setAttribute('aria-hidden','true');root=host.attachShadow({mode:'closed'});document.documentElement.append(host);return true;
  }
  function circle(point,color='#ff0000'){
    return style(document.createElement('div'),`position:absolute;left:${point.x*innerWidth}px;top:${point.y*innerHeight}px;transform:translate(-50%,-50%);width:20px;height:20px;border:2px solid ${color};border-radius:50%;box-sizing:border-box;opacity:.5;pointer-events:none;`);
  }
  function draw(){
    if(!surface())return;
    root.replaceChildren();const now=Date.now();
    if(preview&&now>=preview.expires)preview=undefined;
    const visible=markers.filter(marker=>marker.showMarker!==false);
    host.dataset.astriaMarkers=String(visible.length+(preview?1:0));host.dataset.astriaPicking=String(!!pick);
    host.style.setProperty('pointer-events',pick?'auto':'none','important');host.style.cursor=pick?'crosshair':'default';
    if(pick){
      root.append(circle(pick.point));
      const help=style(document.createElement('div'),'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);max-width:90%;background:#101820e8;color:#e9f3ff;border:1px solid #9fd8ed;border-radius:6px;padding:9px 13px;font:12px "Segoe UI",sans-serif;pointer-events:none;');help.textContent=pick.text;root.append(help);
    }else if(!document.hidden){
      for(const marker of visible)root.append(circle(marker.point,marker.markerColor));
      if(preview)root.append(circle(preview.point,preview.markerColor));
    }
    clearTimeout(timer);timer=undefined;
    if(preview)timer=setTimeout(draw,Math.max(1,preview.expires-now));
    if(!pick&&!visible.length&&!preview){host.remove();host=root=undefined;}
  }
  function finish(cancelled){
    if(!pick)return;const result=pick;pick=undefined;draw();
    for(const key of heldKeys)suppressedKeys.add(key);heldKeys.clear();
    for(const button of heldButtons)suppressedButtons.add(button);heldButtons.clear();
    ipcRenderer.send('astria:automation-picked',{token:result.token,cancelled,point:cancelled?undefined:{...result.point,width:innerWidth,height:innerHeight}});
  }
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
  function point(event){return {x:Math.max(0,Math.min(innerWidth-1,event.clientX))/innerWidth,y:Math.max(0,Math.min(innerHeight-1,event.clientY))/innerHeight};}
  for(const type of ['pointerdown','pointerup','pointermove','mousedown','mouseup','click','contextmenu','wheel','keydown','keyup','keypress'])window.addEventListener(type,event=>{
    if(!event.isTrusted)return;
    const key=event.code||event.key;
    if(!pick){
      if(type==='keydown'&&!event.repeat)suppressedKeys.delete(key);
      if(suppressedKeys.has(key)&&['keydown','keyup','keypress'].includes(type)){stop(event);if(type==='keyup')suppressedKeys.delete(key);return;}
      if(type==='pointerdown'){suppressedButtons.delete(event.button);suppressClick=false;suppressContext=false;}
      if(suppressedButtons.has(event.button)&&['mousedown','mouseup','pointerup'].includes(type)){stop(event);if(type==='mouseup')suppressedButtons.delete(event.button);return;}
      if(type==='click'&&suppressClick){stop(event);suppressClick=false;}if(type==='contextmenu'&&suppressContext){stop(event);suppressContext=false;}return;
    }
    stop(event);
    if(type==='keydown')heldKeys.add(key);if(type==='keyup')heldKeys.delete(key);
    if(type==='pointerdown')heldButtons.add(event.button);if(type==='mouseup')heldButtons.delete(event.button);
    if(type==='pointermove'){pick.point=point(event);draw();}
    if(type==='pointerup'&&event.button===0){pick.point=point(event);suppressClick=true;setTimeout(()=>{suppressClick=false;},250);finish(false);}
    if(type==='pointerdown'&&event.button===2){suppressContext=true;setTimeout(()=>{suppressContext=false;},250);finish(true);}
    if(type==='keydown'){
      if(event.key==='Escape')finish(true);
      else if(event.key==='Enter')finish(false);
      else{
        const amount=event.shiftKey?10:1,delta={ArrowLeft:[-amount,0],ArrowRight:[amount,0],ArrowUp:[0,-amount],ArrowDown:[0,amount]}[event.key];
        if(delta){pick.point={x:Math.max(0,Math.min(innerWidth-1,pick.point.x*innerWidth+delta[0]))/innerWidth,y:Math.max(0,Math.min(innerHeight-1,pick.point.y*innerHeight+delta[1]))/innerHeight};draw();}
      }
    }
  },{capture:true,passive:false});
  ipcRenderer.on('astria:automation',(_event,value)=>{markers=Array.isArray(value?.targets)?value.targets:[];draw();});
  ipcRenderer.on('astria:automation-preview',(_event,value)=>{preview={...value,expires:Date.now()+1600};draw();});
  ipcRenderer.on('astria:automation-pick',(_event,value)=>{pick={...value,point:value.point||{x:.5,y:.5}};draw();});
  ipcRenderer.on('astria:automation-pick-cancel',()=>finish(true));
  document.addEventListener('visibilitychange',draw);window.addEventListener('resize',()=>{if(pick)finish(true);else if(markers.length||preview)draw();});
}
