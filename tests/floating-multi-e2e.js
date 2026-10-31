'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {_electron:electron}=require('playwright');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'astria-multi-float-'));
let app,page;const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<200;i++){const result=await fn();if(result)return result;await delay(50);}throw Error('Multi-floating timeout: '+label);}
const server=http.createServer((req,res)=>{const id=new URL(req.url,'http://local').searchParams.get('id');res.setHeader('content-type','text/html');res.end(`<!doctype html><script>window.instance=crypto.randomUUID();window.initialWidth=innerWidth;localStorage.setItem('identity','${id}');document.cookie='identity=${id};path=/';</script><h1>${id}</h1>`);});
async function state(){return (await page.evaluate(()=>window.multiNest.getState())).state;}
async function layers(){return app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.map(v=>({url:v.webContents?.getURL(),bounds:v.getBounds(),onScreen:!!v.onScreen,visible:v.getVisible()})));}
async function helper(name){return until(async()=>{for(const p of app.context().pages().filter(p=>p.url().endsWith('/floating.html')))if(await p.locator('#name').textContent().catch(()=>null)==='Account '+name)return p;},'helper '+name);}
async function documents(){return app.evaluate(async({webContents})=>Promise.all(webContents.getAllWebContents().filter(w=>/^http:/.test(w.getURL())).map(async w=>({url:w.getURL(),...await w.executeJavaScript('({instance,width:innerWidth,identity:localStorage.getItem("identity"),cookie:document.cookie,bridge:typeof multiNest,control:typeof floating})')}))));}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({activeWorkspaceId:'games',selectedAccountId:'a',workspaces:[{id:'games',name:'Games',layout:'floating',floating:{accountId:'b',x:.3,y:.4,width:.25,pinned:true}},{id:'other',name:'Other',layout:'floating',floating:[{accountId:'v'}]}],accounts:[...['a','b','c','d','e','f'].map(id=>({id,workspaceId:'games',name:'Account '+id,url:base+'/?id='+id,activity:'always'})),...['u','v'].map(id=>({id,workspaceId:'other',name:'Account '+id,url:base+'/?id='+id,activity:'visible'}))],preferences:{language:'en'}}));
 const env={...process.env,MULTINEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch({executablePath:process.env.MULTINEST_TEST_EXE||require('electron'),args:process.env.MULTINEST_TEST_EXE?['--user-data-dir='+profile]:[root],env});
 app=await launch();page=await app.firstWindow();await page.waitForSelector('.panel');
 assert.equal(await page.evaluate(()=>typeof window.multiNest.floatingAccounts),'function','account selection API exists');
 await until(async()=>(await documents()).length===6,'six isolated sessions');
 assert.deepEqual((await state()).workspaces[0].floating,[{accountId:'b',x:.3,y:.4,width:.25,pinned:true}],'old single-window settings migrate without loss');
 const initial=await documents();
 assert.equal((await page.evaluate(()=>window.multiNest.floatingAccounts(['b','c','d']))).ok,true);
 await until(async()=>(await layers()).filter(v=>v.onScreen).length===4,'main plus three live windows');
 const b=await helper('b'),c=await helper('c'),d=await helper('d');
 assert.equal(await b.locator('#pin').getAttribute('aria-pressed'),'true');
 assert.equal((await page.evaluate(()=>window.multiNest.floatingAccounts(['b','b']))).ok,false,'duplicates rejected');
 assert.equal((await page.evaluate(()=>window.multiNest.floatingAccounts(['a']))).ok,false,'primary cannot also float');
 assert.equal((await page.evaluate(()=>window.multiNest.floatingAccounts(['missing']))).ok,false,'unknown account rejected');
 assert.equal((await page.evaluate(()=>window.multiNest.floatingAccounts(['v']))).ok,false,'another workspace is rejected');
 const before=(await state()).workspaces[0].floating;
 await c.locator('#larger').click();await c.locator('#corner').click();await c.locator('#pin').click();
 const changed=(await state()).workspaces[0].floating;
 assert.deepEqual(changed[0],before[0],'resizing another window preserves first slot');assert.deepEqual(changed[2],before[2],'resizing another window preserves third slot');assert.ok(changed[1].width>0&&changed[1].pinned,'second slot changes independently');
 await c.locator('#card').click({position:{x:65,y:60}});await until(async()=>(await state()).selectedAccountId==='c','clicked window becomes main');
 assert.deepEqual((await state()).workspaces[0].floating.map(p=>p.accountId),['b','a','d'],'only clicked slot swaps');assert.equal(await (await helper('a')).locator('#pin').getAttribute('aria-pressed'),'true','slot pin survives swap');
 for(const doc of await documents()){assert.equal(doc.instance,initial.find(old=>old.url===doc.url).instance,'no game reload');assert.equal(doc.width,initial.find(old=>old.url===doc.url).width,'adding and resizing windows preserves virtual viewports');assert.equal(doc.identity,new URL(doc.url).searchParams.get('id'));assert.ok(doc.cookie.includes('identity='+doc.identity));assert.equal(doc.bridge,'undefined');assert.equal(doc.control,'undefined');}
 await app.evaluate(({Menu})=>{Menu.prototype.popup=function(){globalThis.testMenu=this;};});await page.locator('.layout-button').click();
 await app.evaluate(({BaseWindow})=>{const item=globalThis.testMenu.items.find(item=>item.label==='Floating accounts…');if(!item)throw Error('Floating accounts menu missing');item.click(item,BaseWindow.getAllWindows()[0],{});});
 await page.waitForSelector('#floating-form');assert.equal(await page.locator('#floating-form input[type=checkbox]').count(),5);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','floating-picker-en.png')});
 await page.locator('#floating-form [data-close]').click();await page.evaluate(async()=>{await window.multiNest.workspaceLayout('focus');await window.multiNest.language('pt-BR');});await page.locator('.layout-button').click();
 await app.evaluate(({BaseWindow})=>{const item=globalThis.testMenu.items.find(item=>item.label==='Flutuante');item.click(item,BaseWindow.getAllWindows()[0],{});});await page.waitForSelector('#floating-form');assert.equal(await page.locator('#modal-title').textContent(),'Escolher contas flutuantes','Floating automatically opens the picker in the selected language');await page.screenshot({path:path.join(root,'test-results','floating-picker-pt.png')});
 await page.locator('#floating-form input[value="b"]').uncheck();await page.locator('#floating-form input[value="a"]').uncheck();await page.locator('#floating-form button[type=submit]').click();
 await until(async()=>(await layers()).filter(v=>v.url.endsWith('/floating.html')).length===1,'removing selections releases extra helpers');
 await page.evaluate(()=>window.multiNest.language('en'));
 assert.deepEqual((await state()).workspaces[0].floating.map(p=>p.accountId),['d']);
 await page.evaluate(()=>window.multiNest.floatingAccounts(['a','b','d']));await until(async()=>(await layers()).filter(v=>v.onScreen).length===4,'add windows again');
 await page.click('#add-account');await until(async()=>(await layers()).every(v=>!v.onScreen&&!v.url.endsWith('/floating.html')||v.url.endsWith('/floating.html')&&!v.visible),'modal hides every floating control');await page.keyboard.press('Escape');
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());await until(async()=>(await layers()).every(v=>!v.url.endsWith('/floating.html')||!v.visible),'minimize hides every floating control');await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].restore());await until(async()=>(await layers()).filter(v=>v.onScreen).length===4,'restore shows all selected windows');
 const previousControls=app.context().pages().filter(p=>p.url().endsWith('/floating.html'));
 await page.evaluate(()=>window.multiNest.workspaceSelect('other'));await helper('v');assert.ok(previousControls.every(p=>p.isClosed()),'controls from another workspace cannot act on the new workspace');
 await page.evaluate(()=>window.multiNest.workspaceSelect('games'));await until(async()=>(await layers()).filter(v=>v.onScreen).length===4,'workspace restores all windows');
 const saved=(await state()).workspaces[0].floating;await app.close();app=await launch();page=await app.firstWindow();await page.waitForSelector('.panel');assert.deepEqual((await state()).workspaces[0].floating,saved,'all geometries and selections survive restart');
 await page.evaluate(()=>window.multiNest.floatingAccounts(['a','b','d','e','f']));await until(async()=>(await layers()).filter(v=>v.onScreen).length===6,'five selected miniatures');
 const five=await layers(),cards=five.filter(v=>v.url.endsWith('/floating.html')).map(v=>v.bounds);assert.equal(new Set(cards.map(card=>JSON.stringify(card))).size,5,'new windows do not fully coincide');
 await page.evaluate(()=>window.multiNest.ultra('c'));await until(async()=>(await layers()).filter(v=>v.onScreen).length===6,'Ultra retains every selected window');assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen()),true);await page.evaluate(()=>window.multiNest.ultra('c'));
 await page.evaluate(()=>window.multiNest.accountDelete('c'));const promoted=await state();assert.ok(!promoted.workspaces[0].floating.some(p=>p.accountId===promoted.selectedAccountId),'promoted main is removed from floating slots');
 const last=promoted.workspaces[0].floating.at(-1).accountId;await (await helper(last)).locator('#card').click({position:{x:65,y:60}});await until(async()=>(await state()).selectedAccountId===last,'swap after deleting main');assert.equal(new Set((await state()).workspaces[0].floating.map(p=>p.accountId)).size,4,'swap retains four distinct slots');
 const dormant=(await state()).workspaces[0].floating;await page.evaluate(async()=>{await window.multiNest.workspaceLayout('focus');await window.multiNest.workspaceSelect('other');await window.multiNest.workspaceSelect('games');});assert.deepEqual((await state()).workspaces[0].floating,dormant,'inactive floating settings survive focus-layout workspace reentry');
 const previousMain=(await state()).selectedAccountId;await page.evaluate(()=>window.multiNest.workspaceLayout('floating'));
 await app.evaluate(({ipcMain,BaseWindow},id)=>{
   const w=BaseWindow.getAllWindows()[0],ui=w.webContents,old=w.contentView.children.find(v=>v.webContents?.getURL().endsWith('id='+id));
   ipcMain.emit('layout:update',{sender:ui,senderFrame:ui.mainFrame},[{id,x:160,y:80,width:900,height:600}]);
   old?.webContents.emit('focus');
 },previousMain);
 assert.deepEqual((await state()).workspaces[0].floating,dormant,'stale focus-layout rectangles cannot reselect the old main or alter saved slots');
 await page.evaluate(()=>window.multiNest.floatingAccounts([]));await until(async()=>(await layers()).every(v=>!v.url.endsWith('/floating.html')),'empty selection releases helpers');assert.deepEqual((await state()).workspaces[0].floating,[]);
 await page.evaluate(()=>window.multiNest.workspaceLayout('focus'));
 await app.close();const legacy=JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8'));legacy.selectedAccountId='a';legacy.activeWorkspaceId='games';legacy.workspaces[0].layout='floating';legacy.workspaces[0].floating={accountId:'b',x:.3,y:.4,width:.25,pinned:true};legacy.accounts.find(a=>a.id==='b').activity='suspended';fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify(legacy));
 app=await launch();page=await app.firstWindow();await page.waitForSelector('.panel');assert.equal((await state()).workspaces[0].floating[0]?.accountId,'d','legacy unavailable choice falls back while keeping geometry');assert.equal(await (await helper('d')).locator('#pin').getAttribute('aria-pressed'),'true');
 await app.close();const asleep=JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8'));asleep.workspaces[0].floating=legacy.workspaces[0].floating;for(const a of asleep.accounts)if(a.workspaceId==='games'&&a.id!=='a')a.activity='suspended';fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify(asleep));
 app=await launch();page=await app.firstWindow();await page.waitForSelector('.panel');assert.deepEqual((await state()).workspaces[0].floating,[{accountId:'b',x:.3,y:.4,width:.25,pinned:true}],'migration keeps geometry when all secondary accounts are suspended');await page.evaluate(()=>window.multiNest.accountActivity('b','always'));assert.equal(await (await helper('b')).locator('#pin').getAttribute('aria-pressed'),'true','resuming a suspended legacy account restores its pinned window');
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results','floating-multi-e2e.json'),JSON.stringify({passed:true,checks:['legacy migration','four isolated live games','multiple selected windows','independent resize/pin','targeted click swap','selection validation','picker dialog','helper cleanup','workspace/modal hiding','restart persistence']},null,2));
 console.log('PASS: multiple floating accounts, selection dialog, independent geometry/pins, targeted swaps, isolation and persistence');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();server.close();});
