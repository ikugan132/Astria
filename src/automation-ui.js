'use strict';
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AstriaAutomationUI = api;
})(typeof window === 'object' ? window : globalThis, root => {
  let active;
  const clone = value => JSON.parse(JSON.stringify(value));

  async function open({ account, api, modal, closeModal, tr, toast, esc }) {
    active?.dispose();
    const keys = root.AstriaMacroKeys;
    const session = { dispose };
    active = session;
    let settings = { targets: [] }, runtime = {}, dialog, observer, unsubscribe, targetId;
    let dirty = false, busy = false, picking = false, disposed = false, error = '';
    let operations = 0, startVersion = 0, focusAfter;
    const t = text => esc(tr(text));
    const uid = () => root.crypto.randomUUID();
    const target = () => settings.targets.find(item => item.id === targetId);

    function dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.(); observer?.disconnect();
      if (active === session) active = null;
    }
    function fail(message) {
      error = tr(message || 'Não foi possível concluir.');
      const node = dialog?.querySelector('[data-error]');
      if (node) { node.textContent = error; node.hidden = false; }
    }
    async function call(name, ...args) {
      const result = await api[name](account.id, ...args);
      if (!result?.ok) throw new Error(result?.error || 'Não foi possível concluir.');
      return result;
    }
    function changed() {
      dirty = true;
      const node = dialog?.querySelector('[data-dirty]');
      if (node) node.textContent = tr('Alterações não salvas');
    }
    function option(value, label, selected, translate = true) {
      return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${translate ? t(label) : esc(label)}</option>`;
    }
    function field(scope, name, label, value, options = {}) {
      const id = `automation-${scope}-${name}`;
      return `<div class="field"><label for="${id}">${t(label)}</label><input id="${id}" data-scope="${scope}" data-field="${name}" type="${options.type || 'number'}" value="${esc(value)}" ${options.type === 'text' ? 'maxlength="80" autocomplete="off"' : `min="${options.min ?? 0}" max="${options.max ?? 86400}" step="${options.integer ? 1 : 'any'}"`} required></div>`;
    }
    function select(scope, name, label, value, choices, translate = true) {
      const id = `automation-${scope}-${name}`;
      return `<div class="field"><label for="${id}">${t(label)}</label><select id="${id}" data-scope="${scope}" data-field="${name}">${choices.map(([v, label]) => option(v, label, value, translate)).join('')}</select></div>`;
    }
    function check(scope, name, label, value) {
      return `<label class="automation-check"><input type="checkbox" data-scope="${scope}" data-field="${name}"${value ? ' checked' : ''}>${t(label)}</label>`;
    }
    function button(action, label, kind = 'secondary', extra = '') {
      return `<button type="button" class="${kind}" data-do="${action}" ${extra}>${t(label)}</button>`;
    }
    function combo(scope, value) {
      return `<div class="automation-grid">${select(scope, 'key', 'Tecla enviada', value.key, keys.KEY_NAMES.map(name => [name, name]))}<div class="field"><span class="automation-label">${t('Modificadores')}</span><div class="automation-mods">${keys.MOD_ORDER.map(mod => `<label class="automation-check"><input type="checkbox" data-scope="${scope}" data-mod="${mod}"${value.mods.includes(mod) ? ' checked' : ''}>${esc(mod)}</label>`).join('')}</div></div></div>`;
    }
    function pointControls(scope, point) {
      const text = point ? `${Math.floor(point.x * point.width)}, ${Math.floor(point.y * point.height)} · ${point.width} × ${point.height}` : tr('Nenhum ponto selecionado');
      return `<div class="automation-point"><span class="small-note">${esc(text)}</span><div class="automation-buttons">${button('pick-' + scope, 'Escolher ponto')}${button('preview-' + scope, 'Ver marcador', 'secondary', point ? '' : 'disabled')}</div></div>`;
    }
    function targetEditor() {
      const item = target();
      if (!item) return `<p class="small-note automation-empty">${t('Adicione um alvo e escolha um ponto na página do jogo.')}</p>`;
      return `<div class="automation-grid">${field('target', 'name', 'Nome do alvo', item.name, { type: 'text' })}${field('target', 'interval', 'Intervalo (s)', item.interval, { min: 0.05 })}</div>${check('target', 'enabled', 'Alvo ativado', item.enabled)}${select('action', 'type', 'Entrada enviada ao ponto', item.action.type, [['mouse', 'Clique do mouse'], ['key', 'Tecla']])}${item.action.type === 'key' ? combo('action', item.action) : select('action', 'button', 'Botão', item.action.button, [['left', 'Esquerdo'], ['right', 'Direito'], ['middle', 'Do meio']])}${pointControls('target', item.point)}<div class="automation-marker-options">${check('target', 'showMarker', 'Mostrar círculo', item.showMarker !== false)}<div class="field"><label for="automation-target-markerColor">${t('Cor do círculo')}</label><input id="automation-target-markerColor" data-scope="target" data-field="markerColor" type="color" value="${esc(item.markerColor || '#ff0000')}"></div></div><p class="small-note">${t('Círculo com 50% de opacidade. Ocultar não interrompe as ações.')}</p><p class="small-note">${t('Cada alvo tem seu próprio intervalo. A entrada é enviada ao ponto da página, sem mover o mouse do computador.')}</p>`;
    }
    function clickerPanel() {
      return `<div class="automation-toolbar"><h3>${t('Alvos independentes')}</h3>${button('add-target', 'Adicionar alvo', 'secondary', settings.targets.length >= 100 ? 'disabled' : '')}</div><div class="automation-target-list">${settings.targets.map(item => `<div class="automation-target-row"><label class="automation-check"><input type="checkbox" data-target-enable="${esc(item.id)}" aria-label="${t('Ativar alvo')}: ${esc(item.name)}"${item.enabled ? ' checked' : ''}></label><button type="button" class="automation-target${targetId === item.id ? ' selected' : ''}" data-do="select-target" data-id="${esc(item.id)}" aria-pressed="${targetId === item.id}"><span data-target-name="${esc(item.id)}">${esc(item.name)}</span><small>${esc(item.interval)} s · ${t(item.action.type === 'key' ? 'Tecla' : 'Clique')}</small></button></div>`).join('')}</div><div class="automation-editor">${targetEditor()}${target() ? `<div class="automation-delete">${button('delete-target', 'Remover alvo', 'danger')}</div>` : ''}</div>`;
    }
    function status() {
      const node = dialog?.querySelector('[data-runtime]');
      if (!node) return;
      const running = !!runtime.running;
      let text = tr(running ? 'Em execução' : 'Parado');
      text = 'Auto Clicker · ' + text;
      if (runtime.error) text += ' · ' + tr(runtime.error);
      node.textContent = text;
    }
    function setBusy(value) {
      busy = value;
      if (!dialog?.isConnected) return;
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelectorAll('[data-lock]').forEach(node => { node.disabled = value; });
      if (!value && focusAfter) { dialog.querySelector(focusAfter)?.focus(); focusAfter = undefined; }
    }
    function show(focus) {
      if (disposed) return;
      modal(`<div class="automation-heading"><h2 id="modal-title">Auto Clicker</h2><span>${esc(account.name)}</span></div><p class="small-note automation-scope">${t('Somente nesta conta. Os pontos acompanham o tamanho da página.')}</p><p data-error class="automation-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</p><fieldset data-lock class="automation-controls"><div id="automation-panel">${clickerPanel()}</div></fieldset><div class="automation-footer"><div><p class="small-note" data-runtime role="status" aria-live="polite"></p><span class="small-note" data-dirty>${dirty ? t('Alterações não salvas') : t('Configuração salva')}</span></div><div class="automation-buttons">${button('stop', 'Parar', 'danger')}${button('save', 'Salvar', 'secondary', 'data-lock')}${button('start', 'Iniciar alvos', 'primary', 'data-lock')}${button('close', 'Fechar')}</div></div>`, node => {
        dialog = node;
        node.classList.add('automation-modal');
        node.onclick = onClick;
        node.oninput = onInput;
        node.onchange = onChange;
        node.onkeydown = onKey;
        status(); setBusy(busy);
        const first = '[data-do="add-target"]';
        if (busy) focusAfter = focus || first;
        else node.querySelector(focus || first)?.focus();
      });
    }
    function onInput(event) {
      const input = event.target, scope = input.dataset.scope;
      if (!scope) return;
      const object = { target: target(), action: target()?.action }[scope];
      if (!object) return;
      if (input.dataset.mod) object.mods = keys.MOD_ORDER.filter(mod => mod === input.dataset.mod ? input.checked : object.mods.includes(mod));
      else {
        const key = input.dataset.field;
        object[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
      }
      changed();
      if (scope === 'target' && input.dataset.field === 'name') dialog.querySelectorAll('[data-target-name]').forEach(node => { if (node.dataset.targetName === targetId) node.textContent = input.value; });
      if (scope === 'target' && input.dataset.field === 'enabled') dialog.querySelectorAll('[data-target-enable]').forEach(node => { if (node.dataset.targetEnable === targetId) node.checked = input.checked; });
    }
    function onChange(event) {
      const input = event.target;
      if (input.dataset.targetEnable) { settings.targets.find(item => item.id === input.dataset.targetEnable).enabled = input.checked; changed(); show(); }
      if (input.dataset.scope === 'action' && input.dataset.field === 'type') {
        target().action = input.value === 'key' ? { type: 'key', key: 'Space', mods: [] } : { type: 'mouse', button: 'left' };
        changed(); show('#automation-action-type');
      }
    }
    function onKey(event) {
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.tabIndex >= 0 && node.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }
    function validate() {
      const invalid = [...dialog.querySelectorAll('input,select,textarea')].find(input => !input.checkValidity());
      if (invalid) { invalid.reportValidity(); return false; }
      for (const item of settings.targets) {
        if (!item.point) throw new Error('Escolha um ponto para cada alvo antes de salvar.');
        if (!item.name.trim()) throw new Error('Informe um nome para cada alvo.');
        if (!(Number.isFinite(item.interval) && item.interval >= 0.05 && item.interval <= 86400)) throw new Error('Intervalo inválido. Use de 0,05 a 86400 segundos.');
        if (item.action.type === 'key') item.action = { type: 'key', ...keys.makeCombo(item.action.key, item.action.mods) };
      }
      return true;
    }
    async function save() {
      if (!validate()) return false;
      await call('automationSave', clone(settings));
      if (disposed) return false;
      dirty = false;
      const node = dialog?.querySelector('[data-dirty]');
      if (node) node.textContent = tr('Configuração salva');
      return true;
    }
    async function pick() {
      const item = target();
      picking = true;
      closeModal();
      try {
        const result = await call('automationPick', item.point || undefined);
        if (result.cancelled || disposed) return;
        item.point = result.point;
        changed();
      } finally {
        picking = false;
        show('[data-do="pick-target"]');
      }
    }
    async function preview() {
      picking = true;
      closeModal();
      try {
        await call('automationPreview', { ...target().point, markerColor: target().markerColor || '#ff0000' });
        await new Promise(resolve => root.setTimeout(resolve, 1600));
      } finally {
        picking = false;
        if (!disposed) show('[data-do="preview-target"]');
      }
    }
    async function perform(action, node) {
      switch (action) {
        case 'close': dispose(); closeModal(); return;
        case 'select-target': targetId = node.dataset.id; show('[data-do="select-target"].selected'); return;
        case 'add-target': {
          if (settings.targets.length >= 100) return;
          const item = { id: uid(), name: tr('Alvo') + ' ' + (settings.targets.length + 1), enabled: true, showMarker: true, markerColor: '#ff0000', interval: 5, action: { type: 'mouse', button: 'left' }, point: null };
          settings.targets.push(item); targetId = item.id; changed(); show('#automation-target-name'); return;
        }
        case 'delete-target': {
          const index = settings.targets.findIndex(item => item.id === targetId);
          settings.targets.splice(index, 1); targetId = settings.targets[Math.min(index, settings.targets.length - 1)]?.id;
          changed(); show('[data-do="add-target"]'); return;
        }
        case 'pick-target': await pick(); return;
        case 'preview-target': await preview(); return;
        case 'save': if (await save()) toast(tr('Automação salva.')); return;
        case 'stop': await call('automationStop'); runtime = { ...runtime, running: false }; status(); return;
        case 'start': {
          const request = startVersion;
          if (!settings.targets.some(item => item.enabled)) throw new Error('Ative pelo menos um alvo.');
          if (!(await save())) return;
          if (request !== startVersion) return;
          const result = await call('automationStart', { kind: 'clicker' });
          runtime = result.runtime || runtime; status(); return;
        }
      }
    }
    async function onClick(event) {
      const node = event.target.closest('[data-do]');
      if (disposed || !node || node.disabled || busy && !['close', 'stop'].includes(node.dataset.do)) return;
      error = '';
      const errorNode = dialog.querySelector('[data-error]'); errorNode.hidden = true;
      if (['save', 'start'].includes(node.dataset.do)) {
        const invalid = [...dialog.querySelectorAll('input,select,textarea')].find(input => !input.checkValidity());
        if (invalid) { invalid.reportValidity(); return; }
      }
      if (node.dataset.do === 'stop') startVersion++;
      operations++; setBusy(true);
      try { await perform(node.dataset.do, node); }
      catch (cause) { if (!disposed) fail(cause.message); }
      finally { operations--; setBusy(operations > 0); }
    }
    try {
      const result = await call('automationGet');
      if (disposed) return;
      settings = clone(result.settings); runtime = result.runtime || {};
      targetId = settings.targets[0]?.id;
      unsubscribe = api.onAutomation(event => {
        if (event.id !== account.id || disposed) return;
        runtime = event.runtime || {}; status();
      });
      show();
      observer = new root.MutationObserver(() => { if (!picking && !dialog?.isConnected) dispose(); });
      observer.observe(root.document.body, { childList: true, subtree: true });
    } catch (cause) { dispose(); toast(tr(cause.message)); }
  }
  return { open };
});
