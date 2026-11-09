'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {_electron:electron}=require('playwright');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'astria-auto-background-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const soak=Math.max(4000,Number(process.env.ASTRIA_AUTOMATION_SOAK_MS)||4000);
let app,page;
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><script>window.instance=crypto.randomUUID();window.clicks=0;window.presses=0;addEventListener("click",e=>{if(e.isTrusted)clicks++});addEventListener("keydown",e=>{if(e.isTrusted&&e.key==="F1")presses++});</script><p>Background automation fixture</p>');});
async function until(fn,label){for(let n=0;n<200;n++){if(await fn())return;await wait(50);}throw Error('Background automation timeout: '+label);}
const runtime=id=>page.evaluate(id=>window.multiNest.automationGet(id),id).then(result=>result.runtime);
const stats=id=>app.evaluate(async({webContents},id)=>{
 const contents=webContents.getAllWebContents().find(w=>w.getURL().endsWith('id='+id));
 return contents?.executeJavaScript('({instance,clicks,presses,visibility:document.visibilityState})');
},id);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({activeWorkspaceId:'games',selectedAccountId:'b',workspaces:[{id:'games',name:'Background test',layout:'focus'},{id:'other',name:'Other',layout:'focus'}],accounts:['a','b','c'].map(id=>({id,name:id,workspaceId:'games',url:url+'/?id='+id,activity:id==='c'?'eco':'always'})),preferences:{language:'en'}}));
 const env={...process.env,MULTINEST_USER_DATA:profile,ASTRIA_IDLE_MS:'1500'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:process.env.MULTINEST_TEST_EXE||require('electron'),args:process.env.MULTINEST_TEST_EXE?['--user-data-dir='+profile]:[root],env});page=await app.firstWindow();await page.waitForSelector('.panel');
 await until(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>/^http:/.test(w.getURL())&&!w.isLoading()).length===3),'fixture pages');
 for(const id of ['a','b','c']){
   const settings={targets:[{id:'point',name:'Point',enabled:true,interval:.15,point:{x:.5,y:.5,width:1000,height:800},action:id==='b'?{type:'key',key:'F1',mods:[]}:{type:'mouse',button:'left'}}]};
   assert.equal((await page.evaluate(({id,settings})=>window.multiNest.automationSave(id,settings),{id,settings})).ok,true);
   assert.equal((await page.evaluate(id=>window.multiNest.automationStart(id,{kind:'clicker'}),id)).ok,true);
 }
 await page.evaluate(async()=>{await window.multiNest.accountActivity('b','visible');await window.multiNest.accountSelect('a');});
 const initial=await Promise.all(['a','b','c'].map(stats));
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());
 await wait(soak);
 for(const [index,id] of ['a','b','c'].entries()){
   const status=await runtime(id),now=await stats(id);
   assert.equal(status.running,true,id+': background automation must not stop at the hidden-account idle timeout');
   assert.equal(now?.instance,initial[index].instance,id+': running page must stay loaded');
   assert.ok(now.clicks+now.presses>initial[index].clicks+initial[index].presses+2,id+': trusted input continues while minimized');
 }
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].restore());
 await page.evaluate(()=>window.multiNest.workspaceSelect('other'));await wait(2000);
 for(const id of ['a','b','c'])assert.equal((await runtime(id)).running,true,id+': changing workspace must not stop automation');
 await page.evaluate(()=>window.multiNest.automationStop('b'));const stopped=await stats('b');await wait(500);
 assert.equal((await runtime('b')).running,false,'explicit Stop stops input');assert.equal((await stats('b')).presses,stopped.presses,'no key presses after Stop');
 await wait(1700);
 if(!process.env.MULTINEST_TEST_EXE)assert.equal(await stats('b'),undefined,'visible-only account can unload again after its automation stops');
 for(const id of ['a','c'])assert.equal((await runtime(id)).running,true,'stopping another account has no effect');
 await page.evaluate(()=>window.multiNest.automationStopAll());
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results','automation-background-e2e.json'),JSON.stringify({passed:true,soakMs:soak,checks:['Always/Visible/Eco background input','minimize','idle timeout does not unload active automation','workspace change','explicit Stop','normal idle unload restored after Stop']},null,2));
 console.log('PASS: continuous background mouse/key input, minimized window, idle protection, workspace changes and explicit Stop ('+soak+' ms soak)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();server.close();});
