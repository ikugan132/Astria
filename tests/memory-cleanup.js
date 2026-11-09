'use strict';
const assert = require('node:assert/strict');
const { collectPageMemory } = require('../src/memory-cleanup');
let attached=false, detached=0, commands=0, fail=false;
const page={isDestroyed:()=>false,debugger:{on(){},removeListener(){},isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;detached++;},sendCommand:async command=>{assert.equal(command,'HeapProfiler.collectGarbage');commands++;if(fail)throw Error('fixture');}}};
(async()=>{
  attached=true;assert.equal(await collectPageMemory(page),'debugging');assert.equal(detached,0);
  attached=false;fail=true;await assert.rejects(collectPageMemory(page),/fixture/);assert.equal(attached,false,'detach on failure');
  fail=false;assert.equal(await collectPageMemory(page),'collected');assert.equal(attached,false);
  assert.equal(await collectPageMemory(page),'cooldown');assert.equal(commands,2);
  assert.equal(await collectPageMemory({isDestroyed:()=>true}),'closed');
  // A running Auto Clicker or extension shares the connection: cleanup works and leaves it attached.
  const {lease}=require('../src/debugger-share'),other={...page,debugger:{...page.debugger}},held=lease(other);detached=0;
  assert.equal(await collectPageMemory(other),'collected');assert.equal(attached,true);assert.equal(detached,0);held.release();assert.equal(attached,false);
  console.log('PASS: manual garbage collection preserves debugger ownership, retries failures and rate limits success');
})().catch(error=>{console.error(error);process.exitCode=1;});
