import { chromium,webkit,type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
// Phase 4 gate: create, five joins, start, three rounds with an AI rider, settings change, guest refresh mid-round,
// creator refresh mid-round, and shared-TV mode with two controller phones, in Chromium and WebKit.
interface Snapshot { kind:'snapshot';at:number;matchId:string;round:number;tick:number;phase:string;playerId:string;players:Array<{id:string;alive:boolean;angle:number}> }
await mkdir('artifacts',{recursive:true});
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const base=process.env.ONLINE_URL??'http://localhost:8787/';
const latest=(page:Page)=>page.evaluate(()=>(Reflect.get(window,'__snapshots') as Snapshot[]|undefined)?.at(-1));
const recording=(page:Page)=>page.addInitScript(()=>{const list:unknown[]=[];Reflect.set(window,'__snapshots',list);window.addEventListener('fuse-benchmark',event=>{const detail=(event as CustomEvent).detail;if(detail?.kind==='snapshot'){list.push(detail);if(list.length>400)list.shift();}});});
const waitPhase=(page:Page,phases:string[],timeout=30000)=>page.waitForFunction(wanted=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&wanted.includes(state.phase);},phases,{timeout});
const waitRound=(page:Page,round:number,timeout=90000)=>page.waitForFunction(wanted=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&(state.round>=wanted);},round,{timeout});
const joinAs=async(page:Page,name:string,url:string)=>{await recording(page);await page.goto(url+'&benchmark=1');await page.getByPlaceholder('Your name').fill(name);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();};
const rosterHas=(page:Page,name:string)=>page.locator(':is(.online-roster,.room-riders):visible').getByText(name,{exact:false}).waitFor();
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});a.setDefaultTimeout(30000);const host=await a.newPage();
  // WebKit reports a send on a channel whose transport just died as a page error; the transport gates on connection state, but the last task hop can still race.
  const benign=(error:Error)=>/Error sending (binary data|string) through RTCDataChannel/.test(error.message);
  const pageErrors:string[]=[];host.on('pageerror',error=>{if(benign(error))return;pageErrors.push(`host: ${error.message}`);console.error('HOST ERROR',error);});
  await recording(host);await host.goto(base);await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);
  // Keep UI room creation coverage. Explicit CI fallback avoids six software-GL views competing for one runner; dedicated Phaser gates test the intended renderer.
  await host.getByPlaceholder('Your name').waitFor();const target=new URL(host.url());if(process.env.ROOM_RENDERER==='canvas')target.searchParams.set('renderer','canvas');target.searchParams.set('benchmark','1');await host.goto(target.href);
  const url=host.url().replace(/&benchmark=1/,'');
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});b.setDefaultTimeout(30000);const guest=await b.newPage();guest.on('pageerror',error=>{if(benign(error))return;pageErrors.push(`guest: ${error.message}`);console.error('GUEST ERROR',error);});
  await joinAs(guest,'Guest',url);
  await rosterHas(host,'Guest');console.log('Guest roster confirmed');
  const riders:Page[]=[];
  for(let i=2;i<5;i++){const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});context.setDefaultTimeout(30000);const page=await context.newPage();page.on('pageerror',error=>{if(!benign(error))pageErrors.push(`rider ${i}: ${error.message}`);});await joinAs(page,`Rider ${i}`,url);await rosterHas(host,`Rider ${i}`);riders.push(page);}
  console.log('Five riders joined');
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.includes('READY'));await guest.locator('.mobile-play').waitFor({state:'visible'});
  await host.screenshot({path:'artifacts/online-host.png'});await guest.screenshot({path:'artifacts/online-phone.png'});
  assert.equal(await guest.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);
  // Idle riders drive into the walls, so rounds end on their own: three rounds of the same match on every device.
  await waitPhase(host,['playing']);await waitRound(host,3);await waitRound(guest,3);
  const hostRound=await latest(host),guestRound=await latest(guest);assert.ok(hostRound&&guestRound&&hostRound.matchId===guestRound.matchId,'one match on every device');
  console.log('Three rounds played on the shared log');
  // The first match may have ended by now: the results dialog opens on its own and must be closed before the room actions.
  const closeRecap=async(page:Page)=>{if(await page.locator('dialog[open]').count())await page.getByRole('button',{name:'CLOSE',exact:true}).click();};
  // A rematch keeps the refresh checks inside a running match whichever rider won three rounds first.
  const ensurePlaying=async()=>{if((await latest(host))!.phase==='matchOver'){await closeRecap(host);await host.getByRole('button',{name:'REMATCH',exact:true}).click();}await waitPhase(host,['playing'],60000);};
  await ensurePlaying();const running=await latest(host);
  // Guest refresh mid-round: a reload comes back into the running match with the seat it held.
  await guest.reload();await guest.locator('.online-roster:visible').getByText('Guest',{exact:false}).waitFor();
  await guest.waitForFunction(()=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&state.phase!=='lobby'&&state.players.some(player=>player.id===state.playerId);},undefined,{timeout:30000});
  const afterGuest=await latest(guest);assert.equal(afterGuest!.matchId,running!.matchId,'the guest rejoined the running match');
  console.log('Guest refresh mid-round confirmed');
  // Creator refresh mid-round: the creator recovers the running world from a peer instead of opening a fresh lobby.
  await ensurePlaying();const beforeHost=await latest(host);await host.reload();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();
  await host.waitForFunction(()=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);return !!state&&state.phase!=='lobby';},undefined,{timeout:30000});
  const afterHost=await latest(host);assert.equal(afterHost!.matchId,beforeHost!.matchId,'the creator rejoined the running match');assert.ok(afterHost!.tick>beforeHost!.tick);
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).waitFor({state:'visible'});
  console.log('Creator refresh mid-round confirmed');
  await closeRecap(host);await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();
  // A joined phone keeps the thirds controller in the lobby (#13); returning to the lobby opens the tools overlay so the wait is explained and the roster is in view.
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Waiting for the host'));await guest.locator('.mobile-play').waitFor({state:'visible'});assert.equal(await guest.locator('.shared-lobby').isVisible(),false);
  await guest.locator('.online-roster:visible').getByText('Guest',{exact:false}).waitFor();
  console.log('Settings/reset confirmed');
  // One rider leaves so an AI rider can take the seat; a match with a bot runs on every replica alike.
  await riders[2]!.context().close();riders.pop();
  await host.waitForFunction(()=>!document.querySelector('.online-roster')?.textContent?.includes('Rider 4'),undefined,{timeout:20000});
  await host.getByRole('button',{name:'ADD AI',exact:true}).click();await host.getByRole('button',{name:/Remove AI/}).waitFor();
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await waitPhase(host,['countdown','playing']);await waitPhase(guest,['countdown','playing']);
  await waitRound(host,2,60000);const withBot=await latest(guest);assert.ok(withBot!.players.some(player=>player.id.startsWith('bot:')),'the AI rider is in the guest world');
  console.log('AI rider round confirmed');
  await closeRecap(host);await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Waiting for the host'));
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByRole('radio',{name:'Shared TV + phone controls',exact:true}).check();await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await guest.locator('.online-arena').waitFor({state:'hidden'});await riders[0]!.locator('.online-arena').waitFor({state:'hidden'});
  const displayContext=await browser.newContext();displayContext.setDefaultTimeout(30000);const display=await displayContext.newPage();display.on('pageerror',error=>{if(!benign(error))pageErrors.push(`display: ${error.message}`);});await recording(display);await display.goto(url+'&display=1&benchmark=1');await display.locator(':is(.online-roster,.room-riders):visible').getByText('Host',{exact:false}).waitFor();
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);await display.locator('.shared-lobby').waitFor({state:'visible'});await display.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.shared-lobby img');return image?.complete&&image.naturalWidth>0;});
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'hidden'});await display.locator('.online-arena').waitFor({state:'visible'});
  // Two controller phones steer riders the TV simulates: a held left third turns each rider on the display.
  await waitPhase(display,['playing'],40000);
  for(const [phone,name] of [[guest,'Guest'],[riders[0]!,'Rider 2']] as const){
    assert.equal(await phone.locator('.controller-only').count(),1,`${name} is a controller-only phone`);
    const before=await latest(display),phoneState=await latest(phone);const rider=before!.players.find(player=>player.id===phoneState!.playerId);assert.ok(rider,`${name} rider on the display`);
    const box=await phone.locator('.online-controls>button').first().boundingBox();assert.ok(box);
    await phone.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await phone.evaluate(()=>{const left=document.querySelector<HTMLButtonElement>('.online-controls>button');left?.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'touch',bubbles:true,clientX:20,clientY:200}));});
    await display.waitForFunction(([id,angle])=>{const list=Reflect.get(window,'__snapshots') as Snapshot[]|undefined;const state=list?.at(-1);const player=state?.players.find(p=>p.id===id);return !!player&&(!player.alive||Math.abs(player.angle-(angle as number))>.05);},[rider.id,rider.angle] as [string,number],{timeout:15000});
    await phone.evaluate(()=>{const left=document.querySelector<HTMLButtonElement>('.online-controls>button');left?.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'touch',bubbles:true,clientX:20,clientY:200}));});
  }
  console.log('Shared TV with two controller phones confirmed');
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'visible'});
  assert.deepEqual(pageErrors,[]);
  console.log('Online smoke passed: room creation, five joins, start, three rounds, guest and creator refresh mid-round, settings, AI rider, shared TV with two phones.');
}catch(error){
  for(const [index,context] of browser.contexts().entries())for(const page of context.pages()){
    console.error(`ROOM DIAGNOSTIC ${index}`,await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.online-arena');let savedMode:unknown;try{savedMode=JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')??'{}').mode;}catch{}return {body:document.body.innerText,metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,linkDiagnostics:document.querySelector<HTMLElement>('#app')?.dataset.linkDiagnostics,canvas:{hidden:canvas?.hidden,parentClass:canvas?.parentElement?.className,renderer:canvas?.dataset.renderer},savedMode,latest:(Reflect.get(window,'__snapshots') as unknown[]|undefined)?.at(-1)};}).catch(()=>'<page closed>'));
  }
  throw error;
}finally{await browser.close();}
