'use strict';
const fs=require('node:fs'),path=require('node:path');
const MAX_BYTES=8*1024*1024;
class Automation {
  constructor({directory,account,view,notify,engine=require('./automation-engine')}) {
    Object.assign(this,{directory,account,view,notify,engine});
    this.runs=new Map();this.statuses=new Map();this.requests=new Map();
  }
  file(id) {
    if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw Error('Conta não encontrada.');
    this.account(id);return path.join(this.directory,id+'.json');
  }
  runtime(id) {return structuredClone(this.statuses.get(id)||{running:false,phase:'stopped',targets:[]});}
  get(id) {
    const file=this.file(id);let raw;
    if(fs.existsSync(file)){
      if(fs.statSync(file).size>MAX_BYTES)throw Error('Arquivo muito grande.');
      try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Configuração de automação inválida.');}
    }
    return {settings:this.engine.normalizeSettings(raw),runtime:this.runtime(id)};
  }
  async save(id,raw) {
    const file=this.file(id),settings=this.engine.normalizeSettings(raw),text=JSON.stringify(settings,null,2);
    if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Arquivo muito grande.');
    await this.stop(id);
    this.file(id);
    fs.mkdirSync(this.directory,{recursive:true});fs.writeFileSync(file+'.tmp',text,{mode:0o600});fs.renameSync(file+'.tmp',file);
    return settings;
  }
  update(id,patch) {
    const runtime={...this.runtime(id),...patch};this.statuses.set(id,runtime);this.notify(id,structuredClone(runtime));
  }
  async start(id,request) {
    const account=this.account(id),view=this.view(id),settings=this.get(id).settings;
    if(account.activity==='suspended')throw Error('Retome a conta suspensa primeiro.');
    if(!view?.rendererReady||view.closing||view.webContents.isDestroyed()||!/^https?:/.test(view.webContents.getURL()))throw Error('Aguarde o carregamento da página.');
    if(request?.kind!=='clicker')throw Error('Opção inválida.');
    if(!settings.targets.some(t=>t.enabled))throw Error('Adicione e ative um alvo primeiro.');
    const token=(this.requests.get(id)||0)+1;this.requests.set(id,token);
    await this.stop(id,true);
    if(this.requests.get(id)!==token)return this.runtime(id);
    this.account(id);
    if(this.view(id)!==view||view.closing||view.webContents.isDestroyed())throw Error('A página foi fechada.');
    const entry={controller:new AbortController(),driver:null};let ready,failed;
    const initialized=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
    this.runs.set(id,entry);this.update(id,{running:true,kind:request.kind,phase:'starting',error:'',targets:[]});
    entry.done=(async()=>{
      let error;
      try{
        entry.driver=await this.engine.createDriver(view.webContents);
        ready();
        if(entry.controller.signal.aborted)return;
        const options={driver:entry.driver,signal:entry.controller.signal,onState:patch=>{if(this.runs.get(id)===entry&&!entry.controller.signal.aborted)this.update(id,patch);}};
        await this.engine.runClicker(settings.targets,options);
      }catch(failure){
        failed(failure);
        if(!entry.controller.signal.aborted)error=failure.message||String(failure);
      }finally{
        try{await entry.driver?.dispose();}catch(failure){if(!entry.controller.signal.aborted)error ||= failure.message||String(failure);}
        if(this.runs.get(id)===entry){
          this.runs.delete(id);
          this.update(id,{running:false,phase:error?'error':entry.controller.signal.aborted?'stopped':'completed',error:error||'',targets:[]});
        }
      }
    })();
    await initialized;
    return this.runtime(id);
  }
  async stop(id,preserveRequest=false) {
    if(!preserveRequest)this.requests.set(id,(this.requests.get(id)||0)+1);
    const entry=this.runs.get(id);if(!entry)return;
    entry.controller.abort();await entry.done;
  }
  async stopAll() {await Promise.all([...new Set([...this.runs.keys(),...this.requests.keys()])].map(id=>this.stop(id)));}
}
module.exports={Automation};
