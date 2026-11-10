'use strict';
const api = window.multiNest;
const tr = value => window.AstriaI18n.translate(value, state?.preferences.language || 'en');
const h = (parts, ...values) => window.AstriaI18n.tag(parts, values, state?.preferences.language || 'en');
const automationStates={};
let state, statuses = {}, metrics = {}, queuedLayout = false, modalShowing = false, toastTimer, sidebarDrag;
// Extensions docked inside the game panel, and the right rail listing the selected account's extensions.
let docks = {}, rail = {account:null,list:[]}, railLoading = null, dockDrag;
const dockKey = ext => 'astria.dock-width.'+ext;
const clampDock = width => Math.round(Math.max(220,Math.min(1400,width)));
function dockWidth(ext){try{const v=Number(localStorage.getItem(dockKey(ext)));if(v)return clampDock(v);}catch{/* default */}return 380;}
function dockMarkup(a,item){
  return h`<div class="dock-resizer" data-dock-resizer="${esc(a.id)}" role="separator" aria-orientation="vertical" aria-label="Largura da extensão" title="Arraste para ajustar a largura." tabindex="0"></div><aside class="ext-dock" data-dock-ext="${esc(item.extensionId)}" aria-label="${esc(item.name)}"><header class="dock-head"><span class="dock-title" title="${esc(item.name)}">${esc(item.name)}</span><button class="icon-button" data-action="dock-window" data-id="${esc(a.id)}" title="Abrir em janela" aria-label="Abrir em janela"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button><button class="icon-button" data-action="dock-close" data-id="${esc(a.id)}" title="Fechar extensão" aria-label="Fechar extensão">×</button></header><div class="dock-body" data-dock="${esc(a.id)}"></div></aside>`;
}
function drawRail(){
  const node=el('ext-rail'),id=state?.selectedAccountId,a=id&&account(id);
  node.classList.toggle('hidden',!a);
  if(!a){node.innerHTML='';return;}
  const dock=docks[id],list=rail.account===id?rail.list:[];
  node.innerHTML=h`<button class="rail-button rail-manage" data-action="extensions" data-id="${esc(id)}" title="Gerenciar extensões" aria-label="Gerenciar extensões">${glyph('extensions')}</button>`+list.map(e=>{
    const open=!!dock?.open.some(o=>o.extensionId===e.extensionId),active=dock?.active===e.extensionId;
    return `<button class="rail-button${open?' open':''}" data-action="rail-extension" data-id="${esc(e.id)}" data-extension="${esc(e.extensionId)}" aria-pressed="${active}" title="${esc(e.name)}${e.loaded?'':' · '+esc(tr('Não carregada'))}" aria-label="${esc(e.name)}">${e.icon?`<img src="${esc(e.icon)}" alt="">`:`<span class="rail-letter">${esc(e.name.slice(0,1).toUpperCase())}</span>`}</button>`;
  }).join('');
}
async function loadRail(force=false){
  const id=state?.selectedAccountId;
  if(!id||!force&&(rail.account===id||railLoading===id)){drawRail();return;}
  railLoading=id;drawRail();
  const result=await api.extensionsList(id).catch(()=>null);
  if(railLoading===id)railLoading=null;
  if(state.selectedAccountId!==id)return;
  rail={account:id,list:result?.ok?result.extensions.filter(e=>e.enabled):[]};drawRail();
}
async function railExtension(button){
  const id=state.selectedAccountId,ext=button.dataset.extension,dock=docks[id];
  if(dock?.active===ext)return call(api.extensionsDock,id,null);
  if(dock?.open.some(o=>o.extensionId===ext))return call(api.extensionsDock,id,ext);
  return call(api.extensionsOpen,id,button.dataset.id);
}
const { hsvToHex, hexToHsv } = window.AstriaColor;
const el = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currentWorkspace = () => state.workspaces.find(w => w.id === state.activeWorkspaceId);
const currentAccounts = () => state.accounts.filter(a => a.workspaceId === state.activeWorkspaceId);
const account = id => state.accounts.find(a => a.id === id);
const host = url => { try { return new URL(url).hostname; } catch { return url; } };
const activityLabel = a => ({always:tr('Sempre ativa · desempenho máximo'),eco:tr('Economia de energia'),adaptive:tr('Eco adaptativo'),visible:tr('Ativa quando visível'),suspended:tr('Suspensa · RAM liberada')}[a.activity] || tr('Ativa quando visível'));
const modeIcon = a => a.activity === 'always' ? glyph('always') : ['eco','adaptive'].includes(a.activity) ? glyph('eco') : a.activity === 'suspended' ? glyph('pause') : '';
const glyph = name => {
  const paths = {
    extensions: '<path d="M9 3h6v4a3 3 0 1 1 4 4h2v10h-8v-2a3 3 0 1 0-4 0v2H3V11h4V7h2Z"/>',
    target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18"/>',
    rows: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 12h18"/>',
    floating: '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="11" y="12" width="11" height="9" rx="1.5"/>',
    swap: '<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
    focus: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8v8H8z"/>',
    always: '<path d="M4 19a9 9 0 1 1 16 0M5 13H3m4-6 1.5 1.5M12 4v2m6-1-5 7"/><circle cx="12" cy="13" r="2"/>',
    eco: '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4M12 8l-3 5h5l-3 3"/>',
    ultra: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    tune: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    visible: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    pause: '<path d="M9 5v14m6-14v14"/>',
    reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
    menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20 15.4A8.5 8.5 0 0 1 8.6 4 8.5 8.5 0 1 0 20 15.4Z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const layoutIcons = {auto:glyph('grid'),columns:glyph('columns'),rows:glyph('rows'),focus:glyph('focus'),floating:glyph('floating')};
const clampSidebar = width => Math.round(Math.max(44,Math.min(320,width)));
function applySidebar(width) {
  width = clampSidebar(width);
  document.documentElement.style.setProperty('--sidebar',width+'px');
  document.documentElement.classList.toggle('collapsed',width<100);
  el('sidebar-resizer').setAttribute('aria-valuenow',width);
  return width;
}
function themeToggle() {
  return h`<button class="theme-toggle" role="switch" aria-label="Tema escuro" aria-checked="${state.preferences.theme==='dark'}" data-action="theme" title="Alternar tema"><span aria-hidden="true">${glyph('sun')}</span><span aria-hidden="true">${glyph('moon')}</span><i class="theme-thumb"></i></button>`;
}
function audioToggle(a) {
  const sound = a.muted
    ? '<path d="m16 9 5 6m0-6-5 6"/>'
    : '<path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>';
  return h`<button class="icon-button audio-toggle" data-action="mute" data-id="${esc(a.id)}" aria-label="Áudio de ${esc(a.name)}" aria-pressed="${!a.muted}" title="${tr(a.muted?'Ativar áudio':'Silenciar')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5Z"/>${sound}</svg></button>`;
}
function updateCosts() {
  document.querySelectorAll('[data-cost]').forEach(node=>{
    const a=account(node.dataset.cost); if(!a)return;
    const m=a.activity==='suspended'?{ram:0,cpu:0,processes:0}:metrics[a.id];
    node.querySelector('.metric-ram').textContent=m?(m.ram>=1024?`~${(m.ram/1024).toFixed(1)} GB`:`~${m.ram} MB`):'— MB';
    node.querySelector('.metric-cpu').textContent=m?` · ${m.cpu.toFixed(1)}% CPU`:'';
    node.title=m?h`RAM aproximada dos processos da página: ${m.ram} MB. CPU: ${m.cpu.toFixed(1)}%. ${m.processes} processo(s).${m.shared?tr(' Processo compartilhado com outro painel.'):''} Não inclui o custo compartilhado do aplicativo e da GPU.`:tr('Aguardando medição dos processos da página.');
  });
}
function toast(message) {
  el('toast').textContent = message;
  el('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el('toast').classList.add('hidden'), 4500);
}
async function call(action, ...args) {
  try { const r = await action(...args); if (!r?.ok) toast(r?.error || tr('Não foi possível concluir.')); return r || {ok:false}; }
  catch (e) { toast(e.message); return {ok:false}; }
}
function panelStatus(id) {
  const status = statuses[id] || {};
  return status.error ? tr('Erro ao carregar') : status.queued ? tr('Aguardando carregamento…') : status.loading ? tr('Carregando…') : '';
}
function render() {
  if (!state) return;
  document.documentElement.lang = state.preferences.language || 'en';
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent=tr(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach(node => { node.setAttribute('aria-label',tr(node.dataset.i18nLabel)); });
  document.querySelectorAll('[data-i18n-title]').forEach(node => { node.title=tr(node.dataset.i18nTitle); });
  const workspace = currentWorkspace(), accounts = currentAccounts();
  document.documentElement.classList.toggle('ultra',!!state.ultraAccountId);
  document.documentElement.classList.toggle('light', state.preferences.theme === 'light');
  applySidebar(sidebarDrag?.width ?? state.preferences.sidebarWidth ?? 152);
  el('empty-theme').classList.toggle('hidden',accounts.length>0);
  el('empty-theme').setAttribute('aria-checked',state.preferences.theme==='dark');
  el('empty-theme').innerHTML = `<span aria-hidden="true">${glyph('sun')}</span><span aria-hidden="true">${glyph('moon')}</span><i class="theme-thumb"></i>`;
  el('workspace-title').textContent = workspace.name;
  el('workspaces').innerHTML = state.workspaces.map(w => `<button class="workspace-item ${w.id===workspace.id?'active':''}" data-action="workspace" data-id="${esc(w.id)}" title="${esc(w.name)}"><span class="work-icon">${esc(w.name.slice(0,1).toUpperCase())}</span><span class="row-label">${esc(w.name)}</span><span class="workspace-count">${state.accounts.filter(a=>a.workspaceId===w.id).length}</span></button>`).join('');
  el('sidebar-accounts').innerHTML = accounts.map(a => h`<button draggable="true" class="account-link ${a.id===state.selectedAccountId?'active':''}" data-action="select" data-id="${esc(a.id)}" data-account="${esc(a.id)}" title="${esc(a.name)} · ${esc(activityLabel(a))} · ${tr('Arraste para reordenar')}"><span class="color-dot"></span><span class="row-label">${esc(a.name)}</span><span class="mode-icon">${modeIcon(a)}</span></button>`).join('') || h`<div class="sidebar-empty">Crie sua primeira conta.</div>`;
  document.querySelectorAll('.account-link[data-account]').forEach(node=>node.style.setProperty('--account-color',account(node.dataset.account).color));
  const grid=el('grid');
  grid.className='panel-grid '+(accounts.length?workspace.layout:'');
  if (!accounts.length) {
    grid.innerHTML=h`<div class="empty"><img class="empty-mark" src="astria-mark.svg" alt="" aria-hidden="true"><h2>Seu próximo espaço.</h2><p>Adicione um jogo. Cada conta tem seu próprio login e pode ter uma cor e um modo de atividade.</p><button class="primary" data-action="add-account">Criar conta</button></div>`;
    scheduleLayout(); return;
  }
  const shown=state.ultraAccountId?[account(state.ultraAccountId)]:['focus','floating'].includes(workspace.layout)?[accounts.find(a=>a.id===state.selectedAccountId)||accounts[0]]:accounts;
  grid.style.setProperty('--n',shown.length);
  grid.innerHTML=shown.map(a=>{
    const status=statuses[a.id]||{}, paused=a.activity==='suspended';
    return h`<article class="panel ${a.id===state.selectedAccountId?'selected':''}" data-panel="${esc(a.id)}" data-account="${esc(a.id)}">
      <header class="panel-head"><button class="color-button" data-action="select" data-id="${esc(a.id)}" title="${esc(a.name)}" aria-label="${esc(a.name)}"><span class="color-dot"></span></button><button class="panel-title" data-action="select" data-id="${esc(a.id)}" title="${esc(a.name)} · ${esc(host(a.url))}">${esc(a.name)}</button><span class="panel-state ${status.error?'error':status.loading?'loading':''}" title="${esc(status.error||panelStatus(a.id))}">${status.error?'!':status.loading?'◌':''}</span><span class="panel-cost" data-cost="${esc(a.id)}"><span class="metric-ram"></span><span class="metric-cpu"></span></span>${workspace.layout==='floating'&&!paused&&workspace.floating?.length!==0&&accounts.some(other=>other.id!==a.id&&other.activity!=='suspended')?h`<button class="icon-button floating-swap" data-action="floating-swap" title="Trocar com conta flutuante · setas para mover" aria-label="Trocar com conta flutuante · setas para mover">${glyph('swap')}</button>`:''}${audioToggle(a)}<button class="icon-button automation-button" data-action="automation" data-id="${esc(a.id)}" title="Automação" aria-label="Automação" aria-pressed="${!!automationStates[a.id]?.running}">${glyph('target')}</button><button class="icon-button performance-button" data-action="performance" data-id="${esc(a.id)}" title="Desempenho" aria-label="Desempenho">${glyph('tune')}</button><div class="activity-controls" role="group" aria-label="Atividade de ${esc(a.name)}">${Object.entries({always:[glyph('always'),tr('Sempre ativa · desempenho máximo')],eco:[glyph('eco'),a.activity==='eco'?tr('Economia de energia')+' · '+(a.ecoFPS||15)+' FPS':tr('Eco adaptativo')],visible:[glyph('visible'),tr('Ativa quando visível · descarrega após 5 minutos oculta')],suspended:[glyph('pause'),tr('Suspender · liberar RAM')]}).map(([mode,[icon,label]])=>`<button data-action="activity" data-mode="${mode==='eco'&&a.activity!=='eco'?'adaptive':mode}" data-id="${esc(a.id)}" aria-label="${label}" title="${label}" aria-pressed="${a.activity===mode||mode==='eco'&&a.activity==='adaptive'}">${icon}</button>`).join('')}</div><button class="icon-button ultra-button" data-action="ultra" data-id="${esc(a.id)}" title="Modo Ultra" aria-label="Modo Ultra" aria-pressed="${state.ultraAccountId===a.id}">${glyph('ultra')}</button><button class="icon-button layout-button" data-action="layout-menu" title="Layout dos painéis" aria-label="Layout dos painéis" aria-haspopup="menu">${layoutIcons[workspace.layout]}</button>${themeToggle()}<button class="icon-button reload-button" data-action="reload" data-id="${esc(a.id)}" title="Atualizar" aria-label="Atualizar ${esc(a.name)}">${glyph('reload')}</button><button class="icon-button" data-action="account-menu" data-id="${esc(a.id)}" title="Opções da conta" aria-label="Opções de ${esc(a.name)}" aria-haspopup="menu">${glyph('menu')}</button></header>
      <div class="panel-main"><div class="panel-body" ${paused?'':`data-slot="${esc(a.id)}"`}>${paused?h`<div class="panel-placeholder"><span class="sleep-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M9 8v8m6-8v8"/></svg></span><strong>${esc(a.name)} está suspensa</strong><p>A página foi descarregada para liberar RAM. Retomar abre o jogo com o perfil salvo.</p><button class="secondary" data-action="resume" data-id="${esc(a.id)}">Retomar conta</button></div>`:h`<div class="panel-placeholder">Abrindo ${esc(a.name)}…</div>`}</div>${(()=>{const dock=docks[a.id],item=!paused&&dock?.active&&dock.open.find(o=>o.extensionId===dock.active);return item?dockMarkup(a,item):'';})()}</div>
    </article>`;
  }).join('');
  document.querySelectorAll('.panel[data-account]').forEach(node=>node.style.setProperty('--account-color',account(node.dataset.account).color));
  document.querySelectorAll('.ext-dock[data-dock-ext]').forEach(node=>{node.style.width=dockWidth(node.dataset.dockExt)+'px';});
  loadRail();
  updateCosts();
  scheduleLayout();
}
function scheduleLayout() {
  if(sidebarDrag||dockDrag)return;
  if(queuedLayout) return; queuedLayout=true;
  let sent=false;
  const send=()=>{
    if(sent)return;sent=true;clearTimeout(fallback);
    queuedLayout=false;
    const viewport=el('content').getBoundingClientRect();
    const rects=[...document.querySelectorAll('[data-slot]')].map(node=>{
      const r=node.getBoundingClientRect(); const x=Math.max(r.left,viewport.left), y=Math.max(r.top,viewport.top);
      return {id:node.dataset.slot,x,y,width:Math.min(r.right,viewport.right)-x,height:Math.min(r.bottom,viewport.bottom)-y};
    }).filter(r=>r.width>=100&&r.height>=75);
    for(const node of document.querySelectorAll('[data-dock]')){
      const r=node.getBoundingClientRect(),x=Math.max(r.left,viewport.left),y=Math.max(r.top,viewport.top);
      const rect={id:node.dataset.dock,dock:true,x,y,width:Math.min(r.right,viewport.right)-x,height:Math.min(r.bottom,viewport.bottom)-y};
      if(rect.width>=100&&rect.height>=75)rects.push(rect);
    }
    api.layout(rects);
  };
  // Covered windows may receive no animation frames, including after an update.
  const fallback=setTimeout(send,100);
  requestAnimationFrame(send);
}
function modal(markup, ready) {
  modalShowing=true; api.setOverlay(true);
  const root=el('modal-root'); root.classList.remove('hidden');
  root.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${markup}</section>`;
  root.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  ready?.(root.querySelector('.modal'));
  if(!root.contains(document.activeElement)) root.querySelector('input,button')?.focus();
}
function closeModal() {
  const root=el('modal-root'); root.classList.add('hidden'); root.innerHTML=''; modalShowing=false; api.setOverlay(false); scheduleLayout();
  loadRail(true);
}

function openExtensions(a){if(a)window.AstriaExtensionsUI.open({account:a,api,modal,closeModal,tr,toast,esc});}

function openAutomation(a) {
  if(a)window.AstriaAutomationUI.open({account:a,api,modal,closeModal,tr,toast,esc});
}

function chooseFloatingAccounts() {
  const workspace=currentWorkspace(),accounts=currentAccounts().filter(a=>a.id!==state.selectedAccountId);
  const selected=new Set(Array.isArray(workspace.floating)?workspace.floating.map(p=>p.accountId):[accounts.find(a=>a.activity!=='suspended')?.id]);
  modal(h`<h2 id="modal-title">Escolher contas flutuantes</h2><p class="sub">Marque uma ou mais contas para aparecerem sobre a conta principal. Cada janela tem seu próprio tamanho, posição e alfinete.</p><form id="floating-form"><div class="floating-choices">${accounts.map(a=>`<label class="setting-row"><span>${esc(a.name)}${a.activity==='suspended'?`<small>${tr('Retome a conta suspensa primeiro.')}</small>`:''}</span><input type="checkbox" value="${esc(a.id)}" ${selected.has(a.id)&&a.activity!=='suspended'?'checked':''} ${a.activity==='suspended'?'disabled':''}></label>`).join('')}</div><div class="modal-actions"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Aplicar</button></div></form>`,()=>{
    el('floating-form').onsubmit=async event=>{
      event.preventDefault();const ids=[...el('floating-form').querySelectorAll('input:checked:not(:disabled)')].map(input=>input.value);
      if((await call(api.floatingAccounts,ids)).ok)closeModal();
    };
    el('floating-form').querySelector('input:not(:disabled),button')?.focus();
  });
}

function chooseColor(a) {
  let hsv=hexToHsv(a.color)||{h:0,s:1,v:1};
  modal(h`<h2 id="modal-title">Cor de ${esc(a.name)}</h2><p class="sub">Arraste na roda para escolher o tom e ajuste o brilho.</p><form id="color-form"><div class="color-wheel-wrap"><div id="color-wheel" class="color-wheel" role="slider" tabindex="0" aria-label="Matiz e saturação" aria-valuemin="0" aria-valuemax="360"><div class="wheel-shade"></div><span class="wheel-knob"></span></div></div><div class="field"><label for="color-brightness">Brilho</label><input id="color-brightness" type="range" min="0" max="100" value="${Math.round(hsv.v*100)}"></div><div class="color-value-row"><span id="color-preview" class="color-preview"></span><div class="field"><label for="color-hex">Cor hexadecimal</label><input id="color-hex" pattern="#[0-9A-Fa-f]{6}" maxlength="7" required value="${esc(a.color)}" autocomplete="off" spellcheck="false"></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar cor</button></div></form>`,dialog=>{
    const wheel=el('color-wheel'),hex=el('color-hex');
    function update(syncHex=true){
      const value=hsvToHex(hsv.h,hsv.s,hsv.v),r=hsv.h*Math.PI/180;
      wheel.querySelector('.wheel-knob').style.left=(50+Math.cos(r)*hsv.s*50)+'%';
      wheel.querySelector('.wheel-knob').style.top=(50+Math.sin(r)*hsv.s*50)+'%';
      wheel.querySelector('.wheel-shade').style.opacity=1-hsv.v;
      el('color-preview').style.backgroundColor=value;
      el('color-brightness').value=Math.round(hsv.v*100);
      wheel.setAttribute('aria-valuenow',Math.round(hsv.h));
      wheel.setAttribute('aria-valuetext',h`Matiz ${Math.round(hsv.h)} graus, saturação ${Math.round(hsv.s*100)}%`);
      if(syncHex)hex.value=value;
    }
    function point(e){const b=wheel.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2;hsv.h=(Math.atan2(y,x)*180/Math.PI+360)%360;hsv.s=Math.min(1,Math.hypot(x,y)/(b.width/2));update();}
    wheel.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();wheel.focus();wheel.setPointerCapture(e.pointerId);point(e);};
    wheel.onpointermove=e=>{if(wheel.hasPointerCapture(e.pointerId))point(e);};
    wheel.onpointerup=e=>{if(wheel.hasPointerCapture(e.pointerId))wheel.releasePointerCapture(e.pointerId);};
    wheel.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')hsv.h=(hsv.h+355)%360;if(e.key==='ArrowRight')hsv.h=(hsv.h+5)%360;if(e.key==='ArrowUp')hsv.s=Math.min(1,hsv.s+.05);if(e.key==='ArrowDown')hsv.s=Math.max(0,hsv.s-.05);update();};
    el('color-brightness').oninput=e=>{hsv.v=Number(e.target.value)/100;update();};
    hex.oninput=()=>{const next=hexToHsv(hex.value);if(next){hsv=next;update(false);}};
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!hexToHsv(hex.value))return;if((await call(api.accountColor,a.id,hex.value)).ok)closeModal();};
    update();wheel.focus();
  });
}
el('modal-root').addEventListener('click',e=>{if(e.target===el('modal-root'))closeModal();});
function accountForm(existing) {
  const editing=!!existing, defaultURL=existing?.url||currentAccounts()[0]?.url||'';
  modal(h`<h2 id="modal-title">${editing?tr('Editar endereço'):tr('Criar conta')}</h2><p class="sub">Escolha um nome e o endereço do jogo. O login fica separado das outras contas.</p><form id="account-form"><div class="field"><label for="account-name">Nome</label><input id="account-name" maxlength="55" required autocomplete="off" placeholder="Nome do personagem" value="${esc(existing?.name||'')}"></div><div class="field"><label for="account-url">Endereço</label><input id="account-url" maxlength="2048" required autocomplete="off" placeholder="https://site-do-jogo.com" value="${esc(defaultURL)}"></div><div class="modal-actions"><button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">${editing?tr('Salvar'):tr('Criar conta')}</button></div></form>`,dialog=>{
    dialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const data={name:el('account-name').value,url:el('account-url').value};const r=editing?await call(api.accountEdit,existing.id,data):await call(api.accountAdd,data);if(r.ok)closeModal();});
    el('account-name').focus();
  });
}
function renameAccount(a) {
  modal(h`<h2 id="modal-title">Renomear conta</h2><form id="rename-form"><div class="field"><label for="rename-name">Nome da conta</label><input id="rename-name" maxlength="55" required autocomplete="off" value="${esc(a.name)}"></div><div class="modal-actions"><button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar</button></div></form>`,dialog=>{
    dialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if((await call(api.accountRename,a.id,el('rename-name').value)).ok)closeModal();});el('rename-name').select();
  });
}
function workspaceForm(editing=false) {
  const w=currentWorkspace();
  modal(h`<h2 id="modal-title">${editing?tr('Editar espaço'):tr('Novo espaço')}</h2><form id="workspace-form"><div class="field"><label for="workspace-name">Nome</label><input id="workspace-name" maxlength="55" required autocomplete="off" value="${esc(editing?w.name:'')}" placeholder="Nome do jogo ou grupo"></div><div class="modal-actions">${editing?h`<button id="delete-workspace" class="danger" type="button">Excluir</button>`:''}<button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">${editing?tr('Salvar'):tr('Criar espaço')}</button></div></form>`,dialog=>{
    dialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const r=editing?await call(api.workspaceRename,w.id,el('workspace-name').value):await call(api.workspaceAdd,el('workspace-name').value);if(r.ok)closeModal();});
    if(editing)el('delete-workspace').onclick=()=>confirmDelete(w,true);
    el('workspace-name').focus();
  });
}
function confirmDelete(item,workspace=false) {
  modal(h`<h2 id="modal-title">Remover ${esc(item.name)}?</h2><p class="sub">${workspace?tr('Os painéis deste espaço serão removidos.'):tr('O painel será removido.')} Os perfis e logins salvos no computador serão preservados.</p><div class="modal-actions"><button class="secondary" data-close>Cancelar</button><button class="danger" id="confirm-delete">Remover</button></div>`,()=>{el('confirm-delete').onclick=async()=>{if((await call(workspace?api.workspaceDelete:api.accountDelete,item.id)).ok)closeModal();};});
}
function confirmImport() {
  modal(h`<h2 id="modal-title">Importar configuração</h2><p class="sub">Substitui a lista atual de espaços e contas. O arquivo não inclui cookies nem senhas.</p><div class="modal-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="confirm-import">Escolher arquivo</button></div>`,()=>{el('confirm-import').onclick=async()=>{const r=await call(api.import);if(r.ok){closeModal();if(!r.canceled)toast(tr('Configuração importada.'));}};});
}
function performanceHelp(id = state.selectedAccountId) {
  const a=account(id), preset=a?.resolution||'auto';
  modal(h`<h2 id="modal-title">Desempenho</h2>
    <label class="setting-row" for="visual-rest"><span><strong>Descanso visual</strong><small>Contas ocultas: até 2 FPS e áudio silenciado, sem desconectar.</small></span><input id="visual-rest" type="checkbox" role="switch" ${state.preferences.visualRest?'checked':''}></label>
    <p class="small-note">Pausa novas imagens animadas. Imagens já carregadas podem continuar até o próximo carregamento. Timers, rede e workers continuam sob controle do jogo.</p>
    ${a?h`<div class="field"><label for="performance-mode">Atividade de ${esc(a.name)}</label><select id="performance-mode">${[['always',tr('Sempre ativa · desempenho máximo')],['adaptive',tr('Eco adaptativo')],['eco',tr('Economia de energia')],['visible',tr('Ativa quando visível')],['suspended',tr('Suspender · liberar RAM')]].map(([value,label])=>`<option value="${value}" ${a.activity===value?'selected':''}>${label}</option>`).join('')}</select></div>
    <p class="small-note">Eco adaptativo: até 60 FPS na conta em uso. As secundárias usam o limite de economia, até 10 FPS com 4 contas carregadas e 5 FPS com 8.</p>
    <div class="field"><label for="eco-fps">FPS em economia</label><select id="eco-fps">${[1,5,10,15,30].map(fps=>`<option value="${fps}" ${(a.ecoFPS||15)===fps?'selected':''}>${fps} FPS</option>`).join('')}</select></div>
    <div class="field"><label for="resolution">Resolução fixa</label><select id="resolution">${[['auto',tr('Automática')],['720p','720p · 1280 × 720'],['768p','768p · 1366 × 768'],['900p','900p · 1600 × 900'],['1080p','1080p · 1920 × 1080']].map(([value,label])=>`<option value="${value}" ${preset===value?'selected':''}>${label}</option>`).join('')}</select></div>
    <p class="small-note">A resolução virtual se ajusta ao painel. O ganho depende de como o jogo desenha a imagem.</p>
    <button id="cleanup-memory" class="secondary" ${a.activity==='suspended'?'disabled':''}>Limpar memória sem uso</button><p id="cleanup-result" class="small-note" role="status" aria-live="polite">Solicita a coleta de objetos JavaScript sem uso. Preserva dados, sessões e recursos ainda usados pelo jogo.</p>`:''}
    <p class="small-note">Modo Ultra: tela cheia para uma conta; as demais ficam em até 1 FPS. Saia pelo mesmo botão. Modos de economia mantêm a página carregada. Ativa quando visível descarrega após cinco minutos oculta; Suspender descarrega imediatamente.</p>
    <div class="modal-actions"><button class="primary" data-close>Fechar</button></div>`,()=>{
      el('visual-rest').onchange=e=>call(api.visualRest,e.target.checked);
      if(!a)return;
      el('performance-mode').onchange=async e=>{const result=await call(api.accountActivity,a.id,e.target.value);if(result.ok)el('cleanup-memory').disabled=e.target.value==='suspended';};
      el('eco-fps').onchange=e=>call(api.accountEcoFPS,a.id,Number(e.target.value));
      el('resolution').onchange=e=>call(api.accountResolution,a.id,e.target.value);
      el('cleanup-memory').onclick=async e=>{
        const button=e.currentTarget;button.disabled=true;
        const result=await call(api.cleanup,a.id);
        el('cleanup-result')?.replaceChildren(document.createTextNode(result.ok?tr(({collected:'Coleta solicitada. Recursos ainda usados pelo jogo permanecem na memória.',cooldown:'Aguarde dois minutos entre limpezas da mesma página.',debugging:'Feche as ferramentas de desenvolvimento antes de limpar.',busy:'Já existe uma limpeza em andamento.',closed:'A página foi fechada.'})[result.result]):tr('Não foi possível concluir.')));
        button.disabled=account(a.id)?.activity==='suspended';
      };
    });
}
function updateDialog() {
  modal(h`<h2 id="modal-title">Atualizar Astria</h2><p id="update-status" class="sub" role="status">Verificando a última versão no GitHub…</p><p class="small-note">O download é verificado com a assinatura do Astria. Seus perfis e a pasta Save são preservados. Reiniciar desconecta temporariamente os jogos.</p><div class="modal-actions"><button class="secondary" data-close>Fechar</button><button id="update-action" class="primary" disabled>Verificando…</button></div>`, async () => {
    const button=el('update-action'),status=el('update-status');
    const result=await api.updateCheck();
    if(!button.isConnected)return;
    if(!result.ok){status.textContent=result.error;button.textContent=tr('Tentar novamente');button.disabled=false;button.onclick=updateDialog;return;}
    if(!result.available){status.textContent=h`Astria ${result.version} está atualizado.`;button.classList.add('hidden');return;}
    status.textContent=h`Versão ${result.version} disponível · ${(result.size/1048576).toFixed(0)} MB.`;
    button.disabled=false;button.textContent=tr('Baixar atualização');
    button.onclick=async()=>{
      button.disabled=true;button.textContent=tr('Baixando…');status.textContent=tr('Baixando e verificando os arquivos…');
      const result=await api.updateDownload();
      if(!button.isConnected)return;
      if(!result.ok){status.textContent=result.error;button.textContent=tr('Tentar novamente');button.disabled=false;button.onclick=updateDialog;return;}
      status.textContent=h`Versão ${result.version} verificada. A versão anterior ficará em Save/Backups.`;
      button.textContent=tr('Reiniciar e atualizar');button.disabled=false;
      button.onclick=async()=>{button.disabled=true;const result=await call(api.updateInstall);if(!result.ok)button.disabled=false;};
    };
  });
}
function menuFor(id,point) { call(api.accountMenu,id,point); }
el('app-menu').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();call(api.appMenu,{x:r.right,y:r.bottom});};
el('add-workspace').onclick=()=>workspaceForm();
el('add-account').onclick=()=>accountForm();

const resizer=el('sidebar-resizer');
resizer.addEventListener('pointerdown',e=>{
  if(e.button!==0||modalShowing)return;
  e.preventDefault();resizer.focus();
  // Some remote Windows desktops cannot acquire pointer capture. The document
  // handlers below keep dragging functional there without aborting pointerdown.
  try { resizer.setPointerCapture(e.pointerId); } catch { /* document fallback */ }
  const width=el('sidebar-accounts').parentElement.getBoundingClientRect().width;
  sidebarDrag={x:e.clientX,start:width,width,pointer:e.pointerId};
  document.documentElement.classList.add('resizing');
  // Temporarily hide native game surfaces so dragging cannot land inside a game.
  // Views stay loaded; only the final width is persisted and applied to them.
  api.setOverlay(true);
});
document.addEventListener('pointermove',e=>{
  if(sidebarDrag)sidebarDrag.width=applySidebar(sidebarDrag.start+e.clientX-sidebarDrag.x);
  if(dockDrag){dockDrag.width=clampDock(dockDrag.start-(e.clientX-dockDrag.x));dockDrag.node.style.width=dockDrag.width+'px';}
});
// Dragging hides the game and extension surfaces, like the sidebar resizer, so the pointer stays on the interface.
document.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-dock-resizer]');if(!handle||e.button!==0||modalShowing)return;
  const node=handle.nextElementSibling;if(!node)return;
  e.preventDefault();try{handle.setPointerCapture(e.pointerId);}catch{/* document fallback */}
  const start=node.getBoundingClientRect().width;
  dockDrag={x:e.clientX,start,width:start,node,ext:node.dataset.dockExt};
  document.documentElement.classList.add('resizing');api.setOverlay(true);
});
function finishDockDrag(cancel=false){
  if(!dockDrag)return;const drag=dockDrag;dockDrag=undefined;
  document.documentElement.classList.remove('resizing');
  if(cancel)drag.node.style.width=drag.start+'px';
  else{const width=Math.round(drag.node.getBoundingClientRect().width);try{localStorage.setItem(dockKey(drag.ext),String(width));}catch{/* not saved */}}
  api.setOverlay(false);scheduleLayout();
}
document.addEventListener('pointerup',()=>finishDockDrag());
document.addEventListener('pointercancel',()=>finishDockDrag(true));
document.addEventListener('keydown',e=>{
  const handle=e.target.closest?.('[data-dock-resizer]');if(!handle)return;
  const node=handle.nextElementSibling,width=node.getBoundingClientRect().width;
  const next={ArrowLeft:width+(e.shiftKey?64:16),ArrowRight:width-(e.shiftKey?64:16)}[e.key];
  if(next===undefined)return;e.preventDefault();
  node.style.width=clampDock(next)+'px';try{localStorage.setItem(dockKey(node.dataset.dockExt),String(Math.round(node.getBoundingClientRect().width)));}catch{/* not saved */}
  scheduleLayout();
});
async function finishSidebarDrag(cancel=false){
  if(!sidebarDrag)return;
  const drag=sidebarDrag;sidebarDrag=undefined;
  if(resizer.hasPointerCapture(drag.pointer))resizer.releasePointerCapture(drag.pointer);
  document.documentElement.classList.remove('resizing');
  if(cancel)applySidebar(drag.start);
  else await call(api.sidebarWidth,drag.width);
  api.setOverlay(false);scheduleLayout();
}
document.addEventListener('pointerup',()=>finishSidebarDrag());
document.addEventListener('pointercancel',()=>finishSidebarDrag(true));
resizer.addEventListener('lostpointercapture',()=>finishSidebarDrag());
resizer.addEventListener('keydown',e=>{
  const width=Number(resizer.getAttribute('aria-valuenow'));
  const next={ArrowLeft:width-(e.shiftKey?32:8),ArrowRight:width+(e.shiftKey?32:8),Home:44,End:320}[e.key];
  if(next!==undefined){e.preventDefault();call(api.sidebarWidth,clampSidebar(next));}
});
document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b||!state)return;const id=b.dataset.id;
  const actions={extensions:()=>openExtensions(account(id)),automation:()=>openAutomation(account(id)),'floating-swap':()=>call(api.floatingSwap),workspace:()=>call(api.workspaceSelect,id),select:()=>call(api.accountSelect,id),'add-account':()=>accountForm(),reload:()=>call(api.reload,id),mute:()=>call(api.mute,id),ultra:()=>call(api.ultra,id),performance:()=>performanceHelp(id),resume:()=>call(api.accountActivity,id,'visible'),activity:()=>call(api.accountActivity,id,b.dataset.mode),theme:()=>call(api.theme,state.preferences.theme==='dark'?'light':'dark'),'layout-menu':()=>{const r=b.getBoundingClientRect();call(api.layoutMenu,{x:r.left,y:r.bottom});},'account-menu':()=>{const r=b.getBoundingClientRect();menuFor(id,{x:r.right,y:r.bottom});},'rail-extension':()=>railExtension(b),'dock-close':()=>docks[id]?.active&&call(api.extensionsClose,id,docks[id].active),'dock-window':()=>{const item=docks[id]?.open.find(o=>o.extensionId===docks[id].active);if(item?.entryId)call(api.extensionsOpen,id,item.entryId,'window');}};
  actions[b.dataset.action]?.();
});
document.body.addEventListener('contextmenu',e=>{
  const target=e.target.closest('[data-account]');if(target){e.preventDefault();menuFor(target.dataset.account,{x:e.clientX,y:e.clientY});}
});
document.addEventListener('keydown',e=>{
  if(!modalShowing&&e.target.closest('[data-action="floating-swap"]')){const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];if(delta){e.preventDefault();call(api.floatingStep,...delta);return;}}
  if(e.key==='Escape'&&sidebarDrag){finishSidebarDrag(true);return;}
  if(e.key==='Escape'&&dockDrag){finishDockDrag(true);return;}
  if(e.key==='Escape'&&modalShowing){closeModal();return;}
  if(modalShowing){
    if(e.key==='Tab'){const nodes=[...el('modal-root').querySelectorAll('input:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]')];const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    return;
  }
});
window.addEventListener('resize',scheduleLayout);
el('content').addEventListener('scroll',scheduleLayout,{passive:true});
api.onResize(scheduleLayout);
api.onState(next=>{state=next;render();});
api.onDocks(next=>{docks=next||{};if(state)render();});
api.extensionsDocks().then(r=>{if(r?.ok){docks=r.docks;if(state)render();}}).catch(()=>{});
api.onStatus(event=>{
  statuses[event.id]=event;
  const node=document.querySelector(`[data-panel="${event.id}"] .panel-state`);
  if(node&&account(event.id)?.activity!=='suspended'){
    node.textContent=event.error?'!':event.queued?'◷':event.loading?'◌':'';
    node.classList.toggle('error',!!event.error);node.classList.toggle('loading',!!event.loading);node.title=event.error||panelStatus(event.id);
    const placeholder=document.querySelector(`[data-panel="${event.id}"] .panel-placeholder`);
    if(placeholder)placeholder.textContent=event.queued?tr('Aguardando carregamento…'):h`Abrindo ${account(event.id).name}…`;
  }
});
api.onMetrics(next=>{metrics=next;updateCosts();});
api.onAutomation(({id,runtime})=>{automationStates[id]=runtime;for(const node of document.querySelectorAll('[data-action="automation"]'))if(node.dataset.id===id)node.setAttribute('aria-pressed',String(!!runtime.running));});
api.onToast(toast);
api.onUpdateProgress(percent=>{const node=el('update-status');if(node)node.textContent=h`Baixando e verificando os arquivos… ${percent}%`;});
api.onCommand(({type,id})=>{
  const commands={extensions:()=>openExtensions(account(id||state.selectedAccountId)),'auto-clicker':()=>openAutomation(account(id||state.selectedAccountId)),'floating-accounts':chooseFloatingAccounts,'add-account':()=>accountForm(),'rename-account':()=>renameAccount(account(id)),'account-color':()=>chooseColor(account(id)),'edit-account':()=>accountForm(account(id)),'delete-account':()=>confirmDelete(account(id)),'add-workspace':()=>workspaceForm(),'edit-workspace':()=>workspaceForm(true),import:confirmImport,'performance-help':()=>performanceHelp(id),updates:updateDialog};commands[type]?.();
});
window.AstriaAccountOrder.connect({list:el('sidebar-accounts'),workspaceId:()=>state?.activeWorkspaceId,onOrder:(workspaceId,ids)=>call(api.accountOrder,workspaceId,ids)});
api.getState().then(r=>{if(r?.ok){state=r.state;statuses=r.statuses||{};render();}else toast(tr('Não foi possível carregar a configuração.'));});
