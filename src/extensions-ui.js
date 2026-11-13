'use strict';
(function(root){
  root.AstriaExtensionsUI={async open({account,api,modal,closeModal,tr,toast,esc}){
    let dialog,entries=[],notice='',busy=false;
    const t=text=>esc(tr(text));
    const button=(action,label,id='',disabled=false,title='')=>`<button type="button" class="secondary" data-extension-action="${action}" data-id="${esc(id)}"${title?` title="${esc(title)}"`:''}${disabled?' disabled':''}>${t(label)}</button>`;
    function render(){
      modal(`<h2 id="modal-title">${t('Extensões')} · ${esc(account.name)}</h2><p class="small-note">${t('Somente nesta conta. Instale uma pasta com manifest.json; os arquivos acompanham a pasta Save.')}</p><p class="small-note">${t('A compatibilidade depende das APIs usadas pela extensão.')}</p><p class="extension-notice" role="status">${esc(notice)}</p><div class="extension-list">${entries.map(entry=>{
        const permissions=[entry.manifest?.permissions,entry.manifest?.host_permissions].flatMap(values=>Array.isArray(values)?values.filter(value=>typeof value==='string'):[]);
        return `<section class="extension-item"><div class="extension-heading"><div><strong>${esc(entry.name)}</strong><span class="small-note">${esc(entry.version)} · ${t(entry.enabled?(entry.loaded?'Ativada':'Não carregada'):'Desativada')}</span></div><label class="automation-check"><input type="checkbox" data-extension-enabled="${esc(entry.id)}" aria-label="${t('Ativar extensão')}: ${esc(entry.name)}"${entry.enabled?' checked':''}>${t('Ativada')}</label></div>${entry.error?`<p class="extension-error">${esc(entry.error)}</p>`:''}${permissions.length?`<details><summary>${t('Permissões solicitadas')}</summary><ul>${permissions.map(permission=>`<li>${esc(permission)}</li>`).join('')}</ul></details>`:''}<div class="automation-buttons">${button('open','Abrir painel',entry.id,!entry.enabled||!entry.loaded)}${button('update','Atualizar extensão',entry.id,false,entry.source||tr('Escolha a pasta da extensão'))}${button('remove','Remover extensão',entry.id)}</div></section>`;
      }).join('')||`<p class="small-note">${t('Nenhuma extensão instalada nesta conta.')}</p>`}</div><p class="small-note">${t('Depois de instalar, ativar ou remover, recarregue a conta para aplicar os scripts da página. Isso reconecta o jogo e para a automação.')}</p><div class="modal-actions extension-actions">${button('install','Instalar pasta…')}${button('reload','Recarregar conta','',account.activity==='suspended')}${button('close','Fechar')}</div>`,node=>{
        dialog=node;node.classList.add('extensions-modal');
        node.onclick=event=>{const target=event.target.closest('[data-extension-action]');if(target)perform(target.dataset.extensionAction,target.dataset.id);};
        node.onchange=event=>{if(event.target.dataset.extensionEnabled)perform('enable',event.target.dataset.extensionEnabled,event.target.checked);};
        setBusy(busy);
      });
    }
    function setBusy(value){busy=value;if(!dialog?.isConnected)return;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('button,input').forEach(node=>{const entry=entries.find(entry=>entry.id===node.dataset.id);if(node.dataset.extensionAction!=='close')node.disabled=value||node.dataset.extensionAction==='open'&&(!entry?.loaded||!entry.enabled)||node.dataset.extensionAction==='reload'&&account.activity==='suspended';});}
    async function call(name,...args){const result=await api[name](account.id,...args);if(!result?.ok)throw Error(result?.error||tr('Não foi possível concluir.'));return result;}
    async function load(){const result=await call('extensionsList');entries=result.extensions;}
    async function perform(action,id,enabled){
      if(action==='close'){closeModal();return;}
      if(busy)return;setBusy(true);
      try{
        if(action==='open'){closeModal();await call('extensionsOpen',id);return;}
        if(action==='reload'){await call('reload');closeModal();return;}
        const result=action==='install'?await call('extensionsInstall'):action==='update'?await call('extensionsUpdate',id):action==='enable'?await call('extensionsEnable',id,enabled):await call('extensionsRemove',id);
        if(!result.cancelled)notice=(action==='update'?tr('Extensão atualizada para a versão ')+result.version+'. ':'')+tr('Alterações salvas. Recarregue a conta para aplicar os scripts.');
        await load();if(dialog?.isConnected)render();
      }catch(error){if(dialog?.isConnected){notice=error.message;render();}else toast(error.message);}
      finally{setBusy(false);}
    }
    render();setBusy(true);
    try{await load();if(dialog?.isConnected)render();}catch(error){if(dialog?.isConnected){notice=error.message;render();}}
    finally{setBusy(false);}
  }};
})(window);
