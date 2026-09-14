import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, webkit, type Page } from 'playwright';

const url = process.env.ONLINE_URL ?? 'http://localhost:8812/';
const cycles=Number(process.env.MESH_CYCLES??1);
assert.ok(Number.isInteger(cycles)&&cycles>=1&&cycles<=20,'MESH_CYCLES must be between 1 and 20');
await writeFile('dist/mesh-fixture.html','<!doctype html><title>Mesh transport fixture</title>');
const response = await fetch(new URL('/api/rooms', url), { method: 'POST' });
assert.ok(response.ok);
const room = await response.json() as { code: string; token: string };
const bundle = await build({ stdin: { contents: `
import {PeerTransport} from './src/online/peer-transport.ts';
import {packMessage,unpackMessage} from './src/online/action-replication.ts';
globalThis.startMesh=(code,token)=>{
 const peers=new Set(), bound=new Set(), got=[], controls=[], errors=[], statuses=[];
 // Browser impairment harness only: retain locally created channels to inject stale data/closure.
 const channels=[], trail=[], tracked=new WeakSet(), originalCreate=RTCPeerConnection.prototype.createDataChannel;
 const record=entry=>{trail.push({at:performance.now(),...entry});if(trail.length>100)trail.shift();};
 const membershipTrail=[],OriginalSocket=WebSocket;
 globalThis.WebSocket=class extends OriginalSocket {constructor(...args){super(...args);this.addEventListener('message',event=>{try{const m=JSON.parse(event.data);if(m.type==='welcome'||m.type==='peer'){membershipTrail.push({at:performance.now(),type:m.type,id:m.id,connectionId:m.connectionId,peers:m.peers,online:m.online});if(membershipTrail.length>30)membershipTrail.shift();}}catch{}});}};
 const track=(channel,pc)=>{if(tracked.has(channel))return;tracked.add(channel);for(const event of ['open','closing','close','error'])channel.addEventListener(event,()=>record({event,label:channel.label,state:channel.readyState,pc:pc.connectionState,sctp:pc.sctp?.state}));};
 const OriginalPeer=RTCPeerConnection;
 globalThis.RTCPeerConnection=class extends OriginalPeer {constructor(...args){super(...args);this.addEventListener('datachannel',event=>track(event.channel,this));}};
 RTCPeerConnection.prototype.createDataChannel=function(...args){const channel=originalCreate.apply(this,args);channels.push(channel);track(channel,this);return channel;};
 // Synthetic buffer pressure tests the native adapter's gate, not actual SCTP congestion.
 let fastBuffered=false,reliableBuffered=false,lastReliablePause;const pauseEvents=[];const buffered=Object.getOwnPropertyDescriptor(RTCDataChannel.prototype,'bufferedAmount');
 Object.defineProperty(RTCDataChannel.prototype,'bufferedAmount',{...buffered,get(){return reliableBuffered&&this.label==='game'?5000:fastBuffered&&this.label==='actions'?1:buffered.get.call(this);}});
 let dropFast=false;const originalSend=RTCDataChannel.prototype.send;
 RTCDataChannel.prototype.send=function(data){if(dropFast&&this.label==='actions')return;if(this.label==='game'&&typeof data!=='string'){try{const p=unpackMessage(new Uint8Array(data.buffer??data,data.byteOffset??0,data.byteLength));if(p?.[2]===12)lastReliablePause={channel:this,data:new Uint8Array(data)};}catch{}}record({event:'send',label:this.label,state:this.readyState,buffered:this.bufferedAmount,bytes:typeof data==='string'?data.length:data.byteLength,stack:new Error().stack});return originalSend.call(this,data);};
 let blockCoordinator=false;
 const transport=new PeerTransport(code,token,{
  welcome:()=>{},peer:(id,online)=>{if(online)peers.add(id);else{peers.delete(id);bound.delete(id);}},linkReset:id=>bound.delete(id),
  paused:(id,alias)=>pauseEvents.push({from:id,kind:'pause',alias}),
  message:(id,message)=>{if(message?.type==='pauseMarker'){pauseEvents.push({from:id,kind:message.marker??'marker'});return;}if(blockCoordinator&&id===transport.hostId)return;if(Array.isArray(message)){controls.push({from:id,packet:message});return;}if(message?.type==='bind'&&message.segment===7){if(transport.bindFast(id,7,{actions:[1],receipts:[]})){bound.add(id);transport.send(id,{type:'bound',segment:7});}}else if(message?.type==='bound'&&message.segment===7){if(transport.bindFast(id,7,{actions:[1],receipts:[]}))bound.add(id);}},
  fast:(id,bytes)=>{if(blockCoordinator&&id===transport.hostId)return;got.push({from:id,packet:unpackMessage(bytes)});},
  status:message=>{statuses.push(message);if(statuses.length>30)statuses.shift();if(/exceeded|protocol changed|replaced/i.test(message))errors.push(message);},
 },{mesh:true});
 const pump=setInterval(()=>{for(const id of peers){if(blockCoordinator&&id===transport.hostId)continue;if(!bound.has(id))transport.send(id,{type:'bind',segment:7});}},100);
 transport.connect();
 globalThis.mesh={
  snapshot:async()=>({id:transport.id,host:transport.hostId,peers:[...peers],bound:[...bound],got,controls,errors,statuses,membershipTrail,stats:await transport.stats(),diagnostics:await transport.diagnostics()}),
  ready:(count=5)=>bound.size===count&&[...peers].every(id=>transport.fastReady(id)&&transport.boundReady(id)),
  members:()=>[...peers],
  checkpoint:to=>{
   fastBuffered=true;
   const blocked=transport.sendCheckpoint(to,{type:'checkpointFixture',data:new Uint8Array(2000)});
   fastBuffered=false;
   return {blocked,resumed:transport.sendCheckpoint(to,{type:'checkpointFixture',data:new Uint8Array(2000)})};
  },
  blackhole:value=>{dropFast=value;},
  pauseEvents:()=>pauseEvents,
  pauseBlocked:to=>{reliableBuffered=true;dropFast=true;transport.deactivatePulse(to,7);return {rebound:transport.bindFast(to,8,{actions:[1],receipts:[]}),sent:transport.send(to,{type:'pauseMarker'}),activated:transport.activatePulse(to,8)};},
  pauseRelease:(to,marker='marker')=>{reliableBuffered=false;return transport.send(to,{type:'pauseMarker',marker});},
  rebind:to=>transport.bindFast(to,8,{actions:[1],receipts:[]}),
  replayPause:()=>{if(!lastReliablePause)return false;originalSend.call(lastReliablePause.channel,lastReliablePause.data);return true;},
  received:()=>got.length,
  controlCount:()=>controls.length,
  boundControl:to=>transport.sendBound(to,[1,7,'time',1,100.125]),
  staleControl:to=>transport.sendBound(to,[1,6,'time',1,100.125]),
  unknownControl:to=>transport.sendBound(to,[1,7,'other',1]),
  rawControl:()=>{let sent=0;for(const c of channels)if(c.label==='game'&&c.readyState==='open'){c.send(packMessage([1,6,'time',1,100.125]));c.send(packMessage([1,7,'other',1]));sent+=2;}return sent;},
  trail:()=>trail,
  send:(to,sequence)=>transport.sendFast(to,packMessage([1,7,1,[[sequence,66+sequence,0,sequence%4]],null])),
  stale:to=>transport.sendFast(to,packMessage([1,6,1,[[1,67,0,1]],null])),
  block:(value=true)=>{blockCoordinator=value;},
  rawStale:()=>{let sent=0;for(const c of channels)if(c.label==='actions'&&c.readyState==='open'){c.send(packMessage([1,6,1,[[1,67,0,1]],null]));sent++;}return sent;},
  closeFast:()=>{channels.find(c=>c.label==='actions'&&c.readyState==='open').close();},
  stop:()=>{clearInterval(pump);transport.close();},
 };
};`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_API_ORIGIN': 'undefined' } });
interface Snapshot { id: string; host: string; peers: string[]; bound: string[]; got: { from: string; packet: unknown }[]; controls: {from:string;packet:unknown}[]; errors: string[]; stats: { direct: number; relayed: number; buffered: number } }
const snapshot = (page: Page) => page.evaluate(async () => (globalThis as unknown as { mesh: { snapshot(): Promise<Snapshot> } }).mesh.snapshot());
const browsers = [await chromium.launch({ headless: true }), await webkit.launch({ headless: true })];
const pages: Page[] = [], errors: string[] = [], samples: Snapshot[][] = [];
let phase='bootstrap', recoveryMs:number|undefined;
let failed=false;
const errorTrails:unknown[]=[];
let releaseHeldIce:(()=>void)|undefined;
const tokens=Array.from({length:6},(_,i)=>i===0?room.token:randomBytes(32).toString('hex'));
const start=async(page:Page,index:number)=>{
  await page.goto(new URL('/mesh-fixture.html',url).href);await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(({code,token})=>(globalThis as unknown as {startMesh(code:string,token:string):void}).startMesh(code,token),{code:room.code,token:tokens[index]});
};
const waitReady=async()=>{for(const page of pages)await page.waitForFunction(()=>(globalThis as unknown as {mesh:{ready():boolean}}).mesh.ready(),undefined,{timeout:30_000});};
try {
  for (let i = 0; i < 6; i++) {
    const context = await browsers[i % 2].newContext(); const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => {const detail=`peer ${i} ${i%2?'webkit':'chromium'} ${phase}: ${error.stack||error.message}`;errors.push(detail);console.log('Browser error',detail);void page.evaluate(()=>(globalThis as unknown as {mesh:{trail():unknown}}).mesh.trail()).then(trail=>errorTrails.push({detail,trail})).catch(()=>{});});
    // An actual local HTTP response preserves browser local-network address-space checks.
    // Synthetic route.fulfill documents can lose that classification in Chromium.
    await start(page,i);
  }
  await waitReady();
  const ready = await Promise.all(pages.map(snapshot)); samples.push(ready);
  assert.ok(ready.every(m => m.stats.direct === 5 && m.stats.relayed === 0));
  console.log('Six peers established fifteen direct links with both channel types.');
  for(let source=0;source<6;source++) {
    const result=await pages[source].evaluate(to=>(globalThis as unknown as {mesh:{checkpoint(to:string):{blocked:boolean;resumed:boolean}}}).mesh.checkpoint(to),ready[(source+1)%6].id);
    assert.deepEqual(result,{blocked:false,resumed:true},'Checkpoint waits for action buffer drain');
  }
  console.log('Chromium and WebKit checkpoint sends yield to synthetic fast-buffer pressure and resume after drain.');
  for (let source = 0; source < 6; source++) for (let target = 0; target < 6; target++) if (source !== target) {
    const sent = await pages[source].evaluate(to => (globalThis as unknown as { mesh: { send(to: string, sequence: number): boolean } }).mesh.send(to, 1), ready[target].id);
    assert.ok(sent, `Peer ${source} sends directly to peer ${target}`);
  }
  for (const page of pages) await page.waitForFunction(() => (globalThis as unknown as { mesh: { received(): number } }).mesh.received() === 5);
  for (let source=0;source<6;source++) for(let target=0;target<6;target++) if(source!==target) {
    assert.equal(await pages[source].evaluate(to=>(globalThis as unknown as {mesh:{boundControl(to:string):boolean}}).mesh.boundControl(to),ready[target].id),true);
  }
  for(const page of pages) await page.waitForFunction(()=>(globalThis as unknown as {mesh:{controlCount():number}}).mesh.controlCount()===5);
  assert.equal(await pages[0].evaluate(to=>(globalThis as unknown as {mesh:{staleControl(to:string):boolean}}).mesh.staleControl(to),ready[1].id),false);
  assert.equal(await pages[0].evaluate(to=>(globalThis as unknown as {mesh:{unknownControl(to:string):boolean}}).mesh.unknownControl(to),ready[1].id),false);
  console.log('All thirty directions delivered bound compact reliable control; stale/unknown outbound tuples were rejected.');
  samples.push(await Promise.all(pages.map(snapshot)));
  const initiator=ready.findIndex(m=>m.id===[...ready.map(m=>m.id)].sort()[0]);
  phase='fast-send blackhole';
  await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{blackhole(value:boolean):void}}).mesh.blackhole(true));
  await pages[initiator].waitForTimeout(3000);
  assert.equal(await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{ready():boolean}}).mesh.ready()),false);
  const recoveryStart=performance.now();
  await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{blackhole(value:boolean):void}}).mesh.blackhole(false));
  await waitReady();recoveryMs=performance.now()-recoveryStart;assert.ok(recoveryMs<=2000,`Path recovery ${recoveryMs} ms`);
  console.log('Compact liveness restored fast delivery after a three-second send blackhole in',Math.round(recoveryMs),'ms.');
  phase='stale ingress';
  assert.equal(await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{rawStale():number}}).mesh.rawStale()),5);
  assert.equal(await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{rawControl():number}}).mesh.rawControl()),10);
  // Negative receive check on real SCTP; this wait is observation time, not a unit-test clock.
  await pages[initiator].waitForTimeout(250);
  assert.deepEqual((await Promise.all(pages.map(snapshot))).map(m=>m.got.length),samples.at(-1)!.map(m=>m.got.length));
  assert.deepEqual((await Promise.all(pages.map(snapshot))).map(m=>m.controls.length),samples.at(-1)!.map(m=>m.controls.length));
  for(const page of pages)await page.evaluate(()=>(globalThis as unknown as {mesh:{block(value:boolean):void}}).mesh.block(false));
  phase='action channel closure';
  await pages[initiator].evaluate(()=>(globalThis as unknown as {mesh:{closeFast():void}}).mesh.closeFast());
  await pages[initiator].waitForFunction(() => !(globalThis as unknown as {mesh:{ready():boolean}}).mesh.ready());
  await waitReady();samples.push(await Promise.all(pages.map(snapshot)));
  console.log('Remote stale aliases ignored; closing the action channel drains sends and rebuilds the required link.');

  for(let cycle=0;cycle<cycles;cycle++)for(const mode of ['replace','remove'] as const){
  phase=`ICE membership ${mode}`;
  let releaseIce!:()=>void, observedIce!:()=>void;
  const heldIce=new Promise<void>(resolve=>{releaseIce=resolve;}), iceRequested=new Promise<void>(resolve=>{observedIce=resolve;});
  releaseHeldIce=releaseIce;
  await pages[2].route('**/api/rooms/*/ice?*',async route=>{observedIce();await heldIce;await route.continue();});
  await pages[2].evaluate(()=>(globalThis as unknown as {mesh:{stop():void}}).mesh.stop());
  await start(pages[2],2);
  const requestDeadline=setTimeout(()=>releaseIce(),2500);
  await Promise.race([iceRequested,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('ICE route was not exercised')),3000);timer.unref();})]);
  clearTimeout(requestDeadline);
  assert.equal(await pages[2].evaluate(()=>(globalThis as unknown as {mesh:{members():string[]}}).mesh.members().length),5,'Admission publishes membership before ICE resolves');
  await pages[1].evaluate(()=>(globalThis as unknown as {mesh:{stop():void}}).mesh.stop());
  if(mode==='replace')await start(pages[1],1);
  else await pages[2].waitForFunction(removed=>!(globalThis as unknown as {mesh:{members():string[]}}).mesh.members().includes(removed),ready[1].id);
  releaseIce();
  if(mode==='remove'){
    await pages[2].waitForFunction(()=>(globalThis as unknown as {mesh:{ready(count:number):boolean}}).mesh.ready(4));
    assert.equal(await pages[2].evaluate(removed=>(globalThis as unknown as {mesh:{members():string[]}}).mesh.members().includes(removed),ready[1].id),false);
    await start(pages[1],1);
  }
  await waitReady();samples.push(await Promise.all(pages.map(snapshot)));
  await pages[2].unroute('**/api/rooms/*/ice?*');
  console.log('Peer',mode,'while another peer awaits ICE preserves current membership and restores fifteen healthy links.');
  }
  const beforeBlocked=(await Promise.all(pages.map(snapshot))).map(m=>m.got.length);
  phase='coordinator application blocked';
  for (const page of pages.slice(1)) await page.evaluate(() => (globalThis as unknown as { mesh: { block(): void } }).mesh.block());
  for (let source = 1; source < 6; source++) for (let target = 1; target < 6; target++) if (source !== target) {
    assert.ok(await pages[source].evaluate(to => (globalThis as unknown as { mesh: { send(to: string, sequence: number): boolean } }).mesh.send(to, 2), ready[target].id));
  }
  for (let i=1;i<pages.length;i++) await pages[i].waitForFunction(expected => (globalThis as unknown as { mesh: { received(): number } }).mesh.received() === expected,beforeBlocked[i]+4);
  assert.equal(await pages[1].evaluate(to => (globalThis as unknown as { mesh: { stale(to: string): boolean } }).mesh.stale(to), ready[2].id), false);
  samples.push(await Promise.all(pages.map(snapshot)));
  assert.deepEqual(errors, []); assert.ok(samples.flat().every(m => m.errors.length === 0));
  console.log('All thirty directions delivered compact actions; twenty guest directions delivered with coordinator application traffic blocked. Stale alias send rejected.');
  phase='reliable pause after dropped fast copy and blocked first enqueue';
  for(const page of pages)await page.evaluate(()=>(globalThis as unknown as {mesh:{block(value:boolean):void}}).mesh.block(false));
  for(const [source,target] of [[0,5],[1,4]]) {
    const from=(await snapshot(pages[source])).id,to=(await snapshot(pages[target])).id;
    const result=await pages[source].evaluate(to=>(globalThis as unknown as {mesh:{pauseBlocked(to:string):unknown}}).mesh.pauseBlocked(to),to);
    assert.deepEqual(result,{rebound:true,sent:false,activated:false},'An unqueued pause survives rebinding and blocks management/activation');
    await pages[source].waitForFunction(to=>(globalThis as unknown as {mesh:{pauseRelease(to:string):boolean}}).mesh.pauseRelease(to),to);
    await pages[target].waitForFunction(from=>(globalThis as unknown as {mesh:{pauseEvents():{from:string;kind:string}[]}}).mesh.pauseEvents().some(e=>e.from===from&&e.kind==='marker'),from);
    const events=await pages[target].evaluate(from=>(globalThis as unknown as {mesh:{pauseEvents():{from:string;kind:string;alias?:number}[]}}).mesh.pauseEvents().filter(e=>e.from===from),from);
    assert.deepEqual(events.slice(0,2),[{from,kind:'pause',alias:7},{from,kind:'marker'}],'Reliable pause precedes management after all fast copies were dropped');
    assert.equal(await pages[target].evaluate(from=>(globalThis as unknown as {mesh:{rebind(from:string):boolean}}).mesh.rebind(from),from),true);
    assert.equal(await pages[source].evaluate(()=>(globalThis as unknown as {mesh:{replayPause():boolean}}).mesh.replayPause()),true);
    // A distinct ordered marker proves the stale replay has already been processed.
    await pages[source].waitForFunction(to=>(globalThis as unknown as {mesh:{pauseRelease(to:string,marker:string):boolean}}).mesh.pauseRelease(to,'afterReplay'),to);
    await pages[target].waitForFunction(from=>(globalThis as unknown as {mesh:{pauseEvents():{from:string;kind:string}[]}}).mesh.pauseEvents().some(e=>e.from===from&&e.kind==='afterReplay'),from);
    assert.equal(await pages[target].evaluate(from=>(globalThis as unknown as {mesh:{pauseEvents():{from:string;kind:string}[]}}).mesh.pauseEvents().filter(e=>e.from===from&&e.kind==='pause').length,from),1,'Retired-alias pause cannot stop the new binding');
  }
  console.log('Chrome and WebKit reliably deliver pause before management despite dropped fast copies, blocked enqueue and sender rebinding; stale replay is ignored.');

} catch (error) {
  failed=true;
  const failureSnapshots=await Promise.all(pages.map(snapshot));samples.push(failureSnapshots);console.log('Failure diagnostics',JSON.stringify(failureSnapshots));throw error;
} finally {
  phase='teardown';
  releaseHeldIce?.();
  for (const page of pages) await page.evaluate(() => (globalThis as unknown as { mesh?: { stop(): void } }).mesh?.stop()).catch(() => {});
  await Promise.all(browsers.map(browser => browser.close()));
  await rm('dist/mesh-fixture.html',{force:true});
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/direct-mesh-browser.json', JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).length > 0,
    method: 'Local Worker, actual PeerTransport, six mixed Chromium/WebKit contexts, fifteen direct links, unordered maxRetransmits=0 action channel. Coordinator application callbacks/handshake pump blocked for the second guest traffic phase; transport lease and liveness probes remain. Browser channel instrumentation injects stale aliases and a channel close; an ICE HTTP request is held while another membership reconnects. This validates transport, not integrated gameplay, IP packet loss, finality horizon or physical-phone latency.', outcome:failed||errors.length?'failed':'passed', cycles, recoveryMs, samples, errors, errorTrails }, null, 2) + '\n');
  if(!failed)assert.deepEqual(errors,[],'Browser errors including teardown');
}
