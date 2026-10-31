'use strict';
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AstriaAutomationUI = api;
})(typeof window === 'object' ? window : globalThis, root => {
  let active;
  const clone = value => JSON.parse(JSON.stringify(value));

  async function open({ account, api, modal, closeModal, tr, toast, esc, initialTab }) {
    active?.dispose();
    const core = root.AstriaMacroCore, keys = root.AstriaMacroKeys;
    const session = { dispose };
    active = session;
    let settings = { macros: [], targets: [] }, runtime = {}, dialog, observer, unsubscribe;
    let tab = initialTab === 'macro' ? 'macro' : 'clicker', targetId, macroId, stepIndex = 0;
    let dirty = false, busy = false, picking = false, disposed = false, error = '';
    let operations = 0, startVersion = 0, focusAfter;
    const t = text => esc(tr(text));
    const uid = () => root.crypto.randomUUID();
    const target = () => settings.targets.find(item => item.id === targetId);
    const macro = () => settings.macros.find(item => item.id === macroId);
    const step = () => macro()?.profile.steps[stepIndex];
    const typeNames = { key: 'Tecla', mouse: 'Clique', move: 'Mover mouse', scroll: 'Rolar', text: 'Digitar texto', wait: 'Esperar' };

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
    function select(scope, name, label, value, choices) {
      const id = `automation-${scope}-${name}`;
      return `<div class="field"><label for="${id}">${t(label)}</label><select id="${id}" data-scope="${scope}" data-field="${name}">${choices.map(([v, label]) => option(v, label, value, scope !== 'selection')).join('')}</select></div>`;
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
    function stepPoint(item, record) {
      if (!record?.viewport) return null;
      const { width, height } = record.viewport;
      return { x: item.x / width, y: item.y / height, width, height };
    }
    function stepEditor() {
      const item = step(), record = macro();
      if (!item) return `<p class="small-note automation-empty">${t('Adicione passos na ordem em que devem ser executados.')}</p>`;
      let fields = check('step', 'enabled', 'Passo ativado', item.enabled);
      if (item.type === 'key') fields += select('step', 'action', 'Ação', item.action, [['tap', 'Apertar'], ['down', 'Segurar'], ['up', 'Soltar']]) + combo('step', item) + field('step', 'hold', 'Segurar por (s)', item.hold, { max: 60 });
      if (item.type === 'mouse') fields += `<div class="automation-grid">${select('step', 'action', 'Ação', item.action, [['click', 'Clique'], ['double', 'Clique duplo'], ['down', 'Segurar'], ['up', 'Soltar']])}${select('step', 'button', 'Botão', item.button, [['left', 'Esquerdo'], ['right', 'Direito'], ['middle', 'Do meio']])}</div>`;
      if (item.type === 'scroll') fields += `<div class="automation-grid">${select('step', 'direction', 'Direção', item.direction, [['down', 'Baixo'], ['up', 'Cima']])}${field('step', 'amount', 'Quantidade', item.amount, { min: 1, max: 100, integer: true })}</div>`;
      if (['mouse', 'scroll'].includes(item.type)) fields += check('step', 'at_point', 'Usar ponto escolhido', item.at_point);
      if (item.type === 'move' || item.at_point) fields += `<div class="automation-grid">${field('step', 'x', 'X da página', item.x, { max: 100000, integer: true })}${field('step', 'y', 'Y da página', item.y, { max: 100000, integer: true })}</div>${pointControls('step', stepPoint(item, record))}`;
      if (['mouse', 'move'].includes(item.type)) fields += field('step', 'glide', 'Deslizar (s)', item.glide, { max: 10 });
      if (item.type === 'text') fields += `<div class="field"><label for="automation-step-text">${t('Texto enviado')}</label><textarea id="automation-step-text" data-scope="step" data-field="text" rows="3" maxlength="5000">${esc(item.text)}</textarea></div>${field('step', 'char_delay', 'Intervalo entre letras (s)', item.char_delay, { max: 5 })}`;
      if (item.type === 'wait') fields += `<div class="automation-grid">${field('step', 'seconds', 'Tempo (s)', item.seconds)}${field('step', 'random', 'Extra aleatório (s)', item.random)}</div>`;
      else fields += field('step', 'after', 'Esperar depois (s)', item.after);
      return `<h3>${t('Passo')} ${stepIndex + 1} · ${t(typeNames[item.type])}</h3>${fields}<div class="automation-buttons">${button('step-up', 'Mover para cima', 'secondary', stepIndex === 0 ? 'disabled' : '')}${button('step-down', 'Mover para baixo', 'secondary', stepIndex === record.profile.steps.length - 1 ? 'disabled' : '')}${button('delete-step', 'Remover passo', 'danger')}</div>`;
    }
    function stepSummary(item) {
      if (item.type === 'key') return [...item.mods, item.key].join(' + ');
      if (item.type === 'wait') return `${item.seconds} s`;
      if (item.type === 'text') return item.text.slice(0, 45);
      return item.type === 'move' || item.at_point ? `${item.x}, ${item.y}` : tr('Posição atual na página');
    }
    function macroPanel() {
      const record = macro(), profile = record?.profile;
      return `<div class="automation-toolbar">${select('selection', 'macro', 'Perfil de macro', macroId, settings.macros.map(item => [item.id, item.name]))}${button('add-macro', 'Novo perfil', 'secondary', settings.macros.length >= 100 ? 'disabled' : '')}</div><div class="automation-buttons automation-file-actions">${button('import', 'Importar macro')}${button('export', 'Exportar macro', 'secondary', record ? '' : 'disabled')}</div>${record ? `<div class="automation-grid">${field('macro', 'name', 'Nome do perfil', record.name, { type: 'text' })}${field('profile', 'repeat', 'Repetições (0 = contínuo)', profile.repeat, { max: 10000000, integer: true })}${field('profile', 'start_delay', 'Atraso para começar (s)', profile.start_delay, { max: 600 })}${field('profile', 'loop_delay', 'Pausa entre repetições (s)', profile.loop_delay)}</div><div class="automation-toolbar">${select('new', 'type', 'Tipo do novo passo', 'key', Object.entries(typeNames))}${button('add-step', 'Adicionar passo', 'secondary', profile.steps.length >= core.MAX_STEPS ? 'disabled' : '')}</div><div class="automation-step-layout"><ol class="automation-steps">${profile.steps.map((item, index) => `<li><button type="button" class="automation-step${stepIndex === index ? ' selected' : ''}" data-do="select-step" data-index="${index}" aria-pressed="${stepIndex === index}"><span>${index + 1}. ${t(typeNames[item.type])}${item.enabled ? '' : ' · ' + t('Desativado')}</span><small>${esc(stepSummary(item))}</small></button></li>`).join('')}</ol><div class="automation-editor">${stepEditor()}</div></div><div class="automation-delete">${button('delete-macro', 'Remover perfil', 'danger')}</div>` : `<p class="small-note automation-empty">${t('Crie um perfil ou importe um arquivo do Macro Maker.')}</p>`}`;
    }
    function status() {
      const node = dialog?.querySelector('[data-runtime]');
      if (!node) return;
      const running = !!runtime.running;
      let text = tr(running ? 'Em execução' : 'Parado');
      if (runtime.kind) text = (runtime.kind === 'clicker' ? 'Auto Clicker' : 'Macro Maker') + ' · ' + text;
      if (running && runtime.cycle != null) text += ` · ${tr('Repetição')} ${runtime.cycle}`;
      if (running && runtime.step != null && runtime.step >= 0) text += ` · ${tr('Passo')} ${runtime.step + 1}`;
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
      modal(`<div class="automation-heading"><h2 id="modal-title">${t('Automação')}</h2><span>${esc(account.name)}</span></div><div class="automation-tabs" role="tablist" aria-label="${t('Ferramentas de automação')}">${[['clicker', 'Auto Clicker'], ['macro', 'Macro Maker']].map(([kind, label]) => `<button id="automation-tab-${kind}" type="button" role="tab" aria-selected="${kind === tab}" tabindex="${kind === tab ? 0 : -1}" aria-controls="automation-panel" data-do="tab" data-tab="${kind}">${label}</button>`).join('')}</div><p class="small-note automation-scope">${t('Somente nesta conta. Os pontos acompanham o tamanho da página. Iniciar uma ferramenta para a outra nesta conta.')}</p><p data-error class="automation-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</p><fieldset data-lock class="automation-controls"><div id="automation-panel" role="tabpanel" aria-labelledby="automation-tab-${tab}">${tab === 'clicker' ? clickerPanel() : macroPanel()}</div></fieldset><div class="automation-footer"><div><p class="small-note" data-runtime role="status" aria-live="polite"></p><span class="small-note" data-dirty>${dirty ? t('Alterações não salvas') : t('Configuração salva')}</span></div><div class="automation-buttons">${button('stop', 'Parar', 'danger')}${button('save', 'Salvar', 'secondary', 'data-lock')}${tab === 'macro' ? button('once', 'Uma vez', 'secondary', 'data-lock') : ''}${button('start', tab === 'macro' ? 'Iniciar repetições' : 'Iniciar alvos', 'primary', 'data-lock')}${button('close', 'Fechar')}</div></div>`, node => {
        dialog = node;
        node.classList.add('automation-modal');
        node.onclick = onClick;
        node.oninput = onInput;
        node.onchange = onChange;
        node.onkeydown = onKey;
        status(); setBusy(busy);
        if (busy) focusAfter = focus || '#automation-tab-' + tab;
        else node.querySelector(focus || '#automation-tab-' + tab)?.focus();
      });
    }
    function onInput(event) {
      const input = event.target, scope = input.dataset.scope;
      if (!scope || ['selection', 'new'].includes(scope)) return;
      const object = { target: target(), action: target()?.action, macro: macro(), profile: macro()?.profile, step: step() }[scope];
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
      if (input.dataset.scope === 'selection') { macroId = input.value; stepIndex = 0; show('#automation-selection-macro'); }
      if (input.dataset.scope === 'action' && input.dataset.field === 'type') {
        target().action = input.value === 'key' ? { type: 'key', key: 'Space', mods: [] } : { type: 'mouse', button: 'left' };
        changed(); show('#automation-action-type');
      }
      if (input.dataset.scope === 'step' && input.dataset.field === 'at_point') show('[data-field="at_point"]');
    }
    function onKey(event) {
      if (event.target.getAttribute('role') === 'tab' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (busy) return;
        tab = event.key === 'Home' ? 'clicker' : event.key === 'End' ? 'macro' : tab === 'clicker' ? 'macro' : 'clicker';
        show('#automation-tab-' + tab); return;
      }
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
        if (!item.name.trim()) throw new Error('Informe um nome para cada alvo e perfil.');
        if (!(Number.isFinite(item.interval) && item.interval >= 0.05 && item.interval <= 86400)) throw new Error('Intervalo inválido. Use de 0,05 a 86400 segundos.');
        if (item.action.type === 'key') item.action = { type: 'key', ...keys.makeCombo(item.action.key, item.action.mods) };
      }
      for (const item of settings.macros) {
        if (!item.name.trim()) throw new Error('Informe um nome para cada alvo e perfil.');
        item.profile = core.cleanProfile(item.profile);
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
    async function pick(scope) {
      const item = scope === 'target' ? target() : step(), record = macro();
      const initial = scope === 'target' ? item.point : stepPoint(item, record);
      picking = true;
      closeModal();
      try {
        const result = await call('automationPick', initial || undefined);
        if (result.cancelled || disposed) return;
        const point = result.point;
        if (scope === 'target') item.point = point;
        else {
          record.viewport ||= { width: point.width, height: point.height };
          item.x = Math.min(record.viewport.width - 1, Math.floor(point.x * record.viewport.width));
          item.y = Math.min(record.viewport.height - 1, Math.floor(point.y * record.viewport.height));
          item.at_point = true;
        }
        changed();
      } finally {
        picking = false;
        show(`[data-do="pick-${scope}"]`);
      }
    }
    async function preview(scope) {
      const point = scope === 'target' ? target().point : stepPoint(step(), macro());
      picking = true;
      closeModal();
      try {
        await call('automationPreview', scope === 'target' ? { ...point, markerColor: target().markerColor || '#ff0000' } : point);
        await new Promise(resolve => root.setTimeout(resolve, 1600));
      } finally {
        picking = false;
        if (!disposed) show(`[data-do="preview-${scope}"]`);
      }
    }
    async function perform(action, node) {
      switch (action) {
        case 'close': dispose(); closeModal(); return;
        case 'tab': tab = node.dataset.tab; show('#automation-tab-' + tab); return;
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
        case 'add-macro': {
          if (settings.macros.length >= 100) return;
          const item = { id: uid(), name: tr('Novo perfil') + ' ' + (settings.macros.length + 1), profile: core.newProfile() };
          settings.macros.push(item); macroId = item.id; stepIndex = 0; changed(); show('#automation-macro-name'); return;
        }
        case 'delete-macro': {
          const index = settings.macros.findIndex(item => item.id === macroId);
          settings.macros.splice(index, 1); macroId = settings.macros[Math.min(index, settings.macros.length - 1)]?.id; stepIndex = 0;
          changed(); show('[data-do="add-macro"]'); return;
        }
        case 'select-step': stepIndex = Number(node.dataset.index); show('[data-do="select-step"].selected'); return;
        case 'add-step': {
          if (macro().profile.steps.length >= core.MAX_STEPS) return;
          const item = core.defaultStep(dialog.querySelector('#automation-new-type').value);
          stepIndex = macro().profile.steps.length; macro().profile.steps.push(item);
          changed(); show('[data-do="select-step"].selected'); return;
        }
        case 'delete-step': macro().profile.steps.splice(stepIndex, 1); stepIndex = Math.max(0, Math.min(stepIndex, macro().profile.steps.length - 1)); changed(); show(); return;
        case 'step-up': case 'step-down': {
          const steps = macro().profile.steps, next = stepIndex + (action === 'step-up' ? -1 : 1);
          if (next < 0 || next >= steps.length) return;
          [steps[stepIndex], steps[next]] = [steps[next], steps[stepIndex]]; stepIndex = next;
          changed(); show('[data-do="select-step"].selected'); return;
        }
        case 'pick-target': case 'pick-step': await pick(action.slice(5)); return;
        case 'preview-target': case 'preview-step': await preview(action.slice(8)); return;
        case 'save': if (await save()) toast(tr('Automação salva.')); return;
        case 'stop': await call('automationStop'); runtime = { ...runtime, running: false }; status(); return;
        case 'start': case 'once': {
          const request = startVersion;
          if (tab === 'clicker' && !settings.targets.some(item => item.enabled)) throw new Error('Ative pelo menos um alvo.');
          if (tab === 'macro' && !macro()?.profile.steps.some(item => item.enabled)) throw new Error('Adicione pelo menos um passo ativado.');
          if (!(await save())) return;
          if (request !== startVersion) return;
          const result = await call('automationStart', tab === 'macro' ? { kind: 'macro', macroId, once: action === 'once' } : { kind: 'clicker' });
          runtime = result.runtime || runtime; status(); return;
        }
        case 'import': {
          if (dirty && !(await save())) return;
          const result = await call('automationImport');
          if (!result.cancelled && result.settings) { settings = clone(result.settings); macroId = settings.macros.at(-1)?.id; stepIndex = 0; dirty = false; show(); }
          return;
        }
        case 'export': if (await save()) await call('automationExport', macroId); return;
      }
    }
    async function onClick(event) {
      const node = event.target.closest('[data-do]');
      if (disposed || !node || node.disabled || busy && !['close', 'stop'].includes(node.dataset.do)) return;
      error = '';
      const errorNode = dialog.querySelector('[data-error]'); errorNode.hidden = true;
      if (['save', 'start', 'once', 'export', 'import'].includes(node.dataset.do)) {
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
      targetId = settings.targets[0]?.id; macroId = settings.macros[0]?.id;
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
