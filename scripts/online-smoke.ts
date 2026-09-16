import { chromium,webkit,type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { smokeTimeout } from './smoke-timeout.js';
// Online gate: create, joins through the join card, start, three rounds on the shared log, guest and creator refresh
// mid-round, settings and the phone lobby, a lobby reload that re-confirms the seat, an AI rider, and shared-TV mode
// with controller phones steering riders the TV simulates — in Chromium and WebKit.
interface Snapshot { kind:'snapshot';at:number;matchId:string;round:number;tick:number;phase:string;playerId:string;players:Array<{id:string;alive:boolean;angle:number}> }
await mkdir('artifacts',{recursive:true});
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const base=process.env.ONLINE_URL??'http://localhost:8787/';
const phone={viewport:{width:844,height:390},isMobile:true,hasTouch:true} as const;
const latest=(page:Page)=>page.evaluate(()=>(Reflect.get(window,'__snapshots') as Snapshot[]|undefined)?.at(-1));
const recording=(page:Page)=>page.addInitScript(()=>{const list:unknown[]=[];Reflect.set(window,'__snapshots',list);window.addEventListener('fuse-benchmark',event=>{const detail=(event as CustomEvent).detail;if(detail?.kind==='snapshot'){list.push(detail);if(list.length>400)list.shift();}});});
const waitPhase=(page:Page,phases:string[],timeout=30000)=>page.waitForFunction(wanted=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&wanted.includes(state.phase);},phases,{timeout:smokeTimeout(timeout)});
const waitRound=(page:Page,round:number,timeout=90000)=>page.waitForFunction(wanted=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&(state.round>=wanted);},round,{timeout:smokeTimeout(timeout)});
const joinAs=async(page:Page,name:string,url:string)=>{await recording(page);await page.goto(url+'&benchmark=1');await page.getByPlaceholder('Your name').fill(name);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();};
const rosterHas=(page:Page,name:string)=>page.locator(':is(.online-roster,.room-riders):visible').getByText(name,{exact:false}).waitFor();
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});a.setDefaultTimeout(smokeTimeout(30000));const host=await a.newPage();
  // WebKit reports a send on a channel whose transport just died as a page error (the transport gates on connection state, but the last task hop can still race),
  // and a spurious same-origin access-control failure from Phaser's asset loader that Chromium never raises.
  const benign=(error:Error)=>/Error sending (binary data|string) through RTCDataChannel|due to access control checks/.test(error.message);
  const pageErrors:string[]=[];const watch=(page:Page,label:string)=>page.on('pageerror',error=>{if(benign(error))return;pageErrors.push(`${label}: ${error.message}`);console.error(`${label.toUpperCase()} ERROR`,error);});
  watch(host,'host');await recording(host);await host.goto(base);await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);
  // Keep UI room creation coverage. Phaser Canvas in CI avoids six software-GL views competing for one runner; dedicated Phaser gates test the intended renderer.
  await host.getByPlaceholder('Your name').waitFor();const target=new URL(host.url());if(process.env.ROOM_RENDERER==='phaser-canvas')target.searchParams.set('renderer','phaser-canvas');target.searchParams.set('benchmark','1');await host.goto(target.href);
  const url=host.url().replace(/&benchmark=1/,'');
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext(phone);b.setDefaultTimeout(smokeTimeout(30000));const guest=await b.newPage();watch(guest,'guest');
  // A joiner gets its own page: name + head + JOIN, never the host's PREPARING ROOM card or the QR lobby.
  await recording(guest);await guest.goto(url+'&benchmark=1');await guest.locator('.room-join').waitFor({state:'visible'});assert.equal(await guest.locator('.room-boot').count(),0,'joiner never mounts the boot card');assert.equal(await guest.locator('.shared-lobby').isVisible(),false,'joiner never sees the QR lobby');assert.equal(await guest.locator('.room-join .avatar-option').count(),10,'joiner picks a head before joining');
  await guest.getByPlaceholder('Your name').fill('Guest');await guest.getByRole('button',{name:/^Avatar · .*, change$/}).click();await guest.getByRole('button',{name:'Fox',exact:true}).click();await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await rosterHas(host,'Guest');await host.locator(':is(.online-roster,.room-riders):visible .avatar-portrait[data-avatar-id=fox]').waitFor();console.log('Guest roster confirmed');
  // A browser carrying a guest identity under the old host key (previous builds saved every visitor there) must land on the joiner page with that identity kept, not on the host shell.
  {const code=new URL(url).searchParams.get('room')!,stale='ab'.repeat(32);const c=await browser.newContext(phone);c.setDefaultTimeout(smokeTimeout(30000));await c.addInitScript(([code,stale])=>{if(!localStorage.getItem(`fuse-peer-${code}`))localStorage.setItem(`fuse-room-${code}`,stale);},[code,stale] as const);const page=await c.newPage();
   await page.goto(url);await page.locator('.room-join').waitFor({state:'visible'});await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(code=>[localStorage.getItem(`fuse-room-${code}`),localStorage.getItem(`fuse-peer-${code}`)],code),[null,stale],'stale host key migrates to the peer identity');assert.equal(await page.locator('.room-boot').count(),0);await c.close();console.log('Stale host key migrated');}
  // Six WebKit views overload a CI runner (the host's frame time triples); SMOKE_RIDERS trims the roster there.
  const riderCount=Number(process.env.SMOKE_RIDERS??5);const riders:Page[]=[];
  for(let i=2;i<riderCount;i++){const context=await browser.newContext(phone);context.setDefaultTimeout(smokeTimeout(30000));const page=await context.newPage();watch(page,`rider ${i}`);await joinAs(page,`Rider ${i}`,url);await rosterHas(host,`Rider ${i}`);riders.push(page);}
  console.log(`${riderCount} riders joined`);
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.includes('READY'));await guest.locator('.mobile-play').waitFor({state:'visible'});
  if(process.env.ROOM_RENDERER==='phaser-canvas')await host.locator('.online-arena[data-renderer="phaser-canvas"]').waitFor();
  await host.screenshot({path:'artifacts/online-host.png'});await guest.screenshot({path:'artifacts/online-phone.png'});
  assert.equal(await guest.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);
  // #68 flattened every visual style to one thin rim in both renderers, so the two modes became
  // indistinguishable and the room had no way to switch. Both must stay reachable and distinct.
  {
   const style=host.getByRole('button',{name:/^Visual style: /});
   const applied=()=>host.evaluate(()=>document.documentElement.dataset.theme);
   const before=await style.getAttribute('aria-label');const themeBefore=await applied();
   assert.ok(themeBefore,'the room applies a visual style');
   await style.click();
   await host.waitForFunction(id=>document.documentElement.dataset.theme!==id,themeBefore);
   const after=await style.getAttribute('aria-label');
   assert.notEqual(after,before,'STYLE relabels itself with the style now showing');
   await style.click();
   await host.waitForFunction(id=>document.documentElement.dataset.theme===id,themeBefore);
   assert.equal(await style.getAttribute('aria-label'),before,'STYLE cycles back through the registry');
   console.log(`Visual style switched and cycled back (${before} -> ${after})`);
  }
  // Idle riders drive into the walls, so rounds end on their own: three rounds of the same match on every device.
  await waitPhase(host,['playing']);await waitRound(host,3);await waitRound(guest,3);
  const hostRound=await latest(host),guestRound=await latest(guest);assert.ok(hostRound&&guestRound&&hostRound.matchId===guestRound.matchId,'one match on every device');
  console.log('Three rounds played on the shared log');
  // The first match may have ended by now: the results dialog opens on its own and must be closed before the room actions.
  const closeRecap=async(page:Page)=>{if(await page.locator('dialog[open]').count())await page.getByRole('button',{name:'CLOSE',exact:true}).click();};
  // A rematch keeps the refresh checks inside a running match whichever rider won three rounds first.
  const ensurePlaying=async()=>{if((await latest(host))!.phase==='matchOver'){await closeRecap(host);await host.getByRole('button',{name:'REMATCH',exact:true}).click();}await waitPhase(host,['playing'],60000);};
  await ensurePlaying();const running=await latest(host);
  // Guest refresh mid-round: a reload comes back into the running match with the seat it held, without the join card.
  await guest.reload();await guest.locator('.online-roster:visible').getByText('Guest',{exact:false}).waitFor();
  await guest.waitForFunction(()=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&state.phase!=='lobby'&&state.players.some(player=>player.id===state.playerId);},undefined,{timeout:smokeTimeout(30000)});
  const afterGuest=await latest(guest);assert.equal(afterGuest!.matchId,running!.matchId,'the guest rejoined the running match');
  console.log('Guest refresh mid-round confirmed');
  // Creator refresh mid-round: the creator recovers the running world from a peer instead of opening a fresh lobby.
  await ensurePlaying();const beforeHost=await latest(host);await host.reload();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();
  await host.waitForFunction(()=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&state.phase!=='lobby';},undefined,{timeout:smokeTimeout(30000)});
  const afterHost=await latest(host);assert.equal(afterHost!.matchId,beforeHost!.matchId,'the creator rejoined the running match');assert.ok(afterHost!.tick>beforeHost!.tick);
  await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).waitFor({state:'visible'});
  console.log('Creator refresh mid-round confirmed');
  await closeRecap(host);await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).click();
  // Back in the lobby a joined phone shows the lobby screen with the riders and the wait explained, not the controller (#134).
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Waiting for the host'));await guest.locator('.phone-lobby').waitFor();assert.equal(await guest.locator('.mobile-play').count(),0,'a joined phone in the lobby is a lobby screen');
  await guest.locator('.room-riders').getByText('Guest',{exact:false}).waitFor();
  console.log('Settings/reset confirmed');await guest.reload();
  // A lobby reload frees the seat, so the rider confirms the remembered name and head instead of being joined silently.
  await guest.locator('.room-join').waitFor({state:'visible'});assert.equal(await guest.getByPlaceholder('Your name').inputValue(),'Guest','remembered name prefills the join card');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await guest.locator('.phone-lobby .room-riders').getByText('Guest',{exact:false}).waitFor(); // The rejoined phone lands on the lobby screen (#134).
  console.log('Guest lobby reload confirmed');await host.reload();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});console.log('Creator lobby reload confirmed');
  // One rider leaves so an AI rider can take the seat; a match with a bot runs on every replica alike.
  const leaver=riders.pop();if(leaver){const name=`Rider ${riders.length+2}`;await leaver.context().close();await host.waitForFunction(gone=>!document.querySelector('.online-roster')?.textContent?.includes(gone),name,{timeout:smokeTimeout(20000)});}
  await host.getByRole('button',{name:'ADD AI',exact:true}).click();await host.getByRole('button',{name:/Remove AI/}).waitFor();
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await waitPhase(host,['countdown','playing']);await waitPhase(guest,['countdown','playing']);
  await waitRound(host,2,60000);const withBot=await latest(guest);assert.ok(withBot!.players.some(player=>player.id.startsWith('bot:')),'the AI rider is in the guest world');
  console.log('AI rider round confirmed');
  await closeRecap(host);await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Waiting for the host'));
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByRole('radio',{name:'Shared TV + phone controls',exact:true}).check();await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  const phones=[guest,...riders].slice(0,2);for(const page of phones)await page.locator('.online-arena').waitFor({state:'hidden'});
  const displayContext=await browser.newContext();displayContext.setDefaultTimeout(smokeTimeout(30000));const display=await displayContext.newPage();watch(display,'display');await recording(display);await display.goto(url+'&display=1&benchmark=1');await display.locator(':is(.online-roster,.room-riders):visible').getByText('Host',{exact:false}).waitFor();
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);await display.locator('.shared-lobby').waitFor({state:'visible'});await display.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.shared-lobby img');return image?.complete&&image.naturalWidth>0;});
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'hidden'});await display.locator('.online-arena').waitFor({state:'visible'});
  // Controller phones steer riders the TV simulates: a held left third turns each rider on the display.
  await waitPhase(display,['playing'],40000);
  for(const [index,page] of phones.entries()){
    const name=index===0?'Guest':'Rider 2';
    assert.equal(await page.locator('.controller-only').count(),1,`${name} is a controller-only phone`);
    const before=await latest(display),phoneState=await latest(page);const rider=before!.players.find(player=>player.id===phoneState!.playerId);assert.ok(rider,`${name} rider on the display`);
    const box=await page.locator('.online-controls>button').first().boundingBox();assert.ok(box);
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await page.evaluate(()=>{const left=document.querySelector<HTMLButtonElement>('.online-controls>button');left?.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'touch',bubbles:true,clientX:20,clientY:200}));});
    await display.waitForFunction(([id,angle])=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);const player=state?.players.find(p=>p.id===id);return !!player&&(!player.alive||Math.abs(player.angle-(angle as number))>.05);},[rider.id,rider.angle] as [string,number],{timeout:smokeTimeout(15000)});
    await page.evaluate(()=>{const left=document.querySelector<HTMLButtonElement>('.online-controls>button');left?.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'touch',bubbles:true,clientX:20,clientY:200}));});
  }
  console.log(`Shared TV with ${phones.length} controller phone(s) confirmed`);
  await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'visible'});
  assert.deepEqual(pageErrors,[]);
  console.log('Online smoke passed: room creation, joins, start, three rounds, guest and creator refresh mid-round, settings, phone lobby, lobby reloads, AI rider, shared TV with controller phones.');
}catch(error){
  for(const [index,context] of browser.contexts().entries())for(const page of context.pages()){
    console.error(`ROOM DIAGNOSTIC ${index}`,await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.online-arena');let savedMode:unknown;try{savedMode=JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')??'{}').mode;}catch{}return {body:document.body.innerText,metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,linkDiagnostics:document.querySelector<HTMLElement>('#app')?.dataset.linkDiagnostics,canvas:{hidden:canvas?.hidden,parentClass:canvas?.parentElement?.className,renderer:canvas?.dataset.renderer},savedMode,latest:(Reflect.get(window,'__snapshots') as unknown[]|undefined)?.at(-1)};}).catch(()=>'<page closed>'));
  }
  throw error;
}finally{await browser.close();}
