import { chromium,webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const errors:string[]=[];const watch=(page:Page,label:string)=>page.on('pageerror',error=>{errors.push(`${label}: ${error.message}`);console.error(label,error);});
const directReady=(page:Page,simulator:boolean)=>page.waitForFunction(expected=>{const raw=document.querySelector<HTMLElement>('#app')?.dataset.metrics;if(!raw)return false;const r=JSON.parse(raw).replication;return r?.mode==='direct'&&r.simulator===expected&&!r.barrier&&!r.recoveryRequired;},simulator);
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});a.setDefaultTimeout(30000);const host=await a.newPage();
  watch(host,'HOST ERROR');
  await host.goto(process.env.ONLINE_URL??'http://localhost:8787/');await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);
  // Keep UI room creation coverage. Explicit CI fallback avoids six software-GL views
  // competing for one runner; dedicated Phaser gates test the intended renderer.
  if(process.env.ROOM_RENDERER==='canvas'){await host.getByPlaceholder('Your name').waitFor();const target=new URL(host.url());target.searchParams.set('renderer','canvas');await host.goto(target.href);}
  const url=host.url();
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});b.setDefaultTimeout(30000);const guest=await b.newPage();watch(guest,'GUEST ERROR');
  await guest.goto(url);await guest.getByPlaceholder('Your name').fill('Guest');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();console.log('Guest roster confirmed');
  for(let i=2;i<5;i++){const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});context.setDefaultTimeout(30000);const page=await context.newPage();watch(page,`RIDER ${i} ERROR`);await page.goto(url);await page.getByPlaceholder('Your name').fill(`Rider ${i}`);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator(':is(.online-roster,.room-riders):visible').getByText(`Rider ${i}`,{exact:false}).waitFor();}
  const players=browser.contexts().flatMap(context=>context.pages());await Promise.all(players.map(page=>directReady(page,true)));
  console.log('Five riders joined; every personal screen simulates directly');
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.includes('READY'));await guest.locator('.mobile-play').waitFor({state:'visible'});
  await host.screenshot({path:'artifacts/online-host.png'});await guest.screenshot({path:'artifacts/online-phone.png'});
  assert.equal(await guest.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();
  // A joined phone keeps the thirds controller in the lobby (#13); its roster is reachable behind ☰ MENU.
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Join your friends'));await guest.locator('.mobile-play').waitFor({state:'visible'});assert.equal(await guest.locator('.shared-lobby').isVisible(),false);
  console.log('Settings/reset confirmed');await guest.reload();
  await guest.locator('.mobile-tools-toggle').click();await guest.locator('.online-roster:visible').getByText('Guest',{exact:false}).waitFor();await guest.locator('.mobile-tools-toggle').click();
  console.log('Guest refresh confirmed');await host.reload();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();console.log('Guest roster confirmed');
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByRole('radio',{name:'Shared TV + phone controls',exact:true}).check();await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await guest.locator('.online-arena').waitFor({state:'hidden'});await Promise.all(players.map(page=>directReady(page,false)));
  const displayContext=await browser.newContext();displayContext.setDefaultTimeout(30000);const display=await displayContext.newPage();watch(display,'DISPLAY ERROR');await display.goto(url+'&display=1');await display.locator(':is(.online-roster,.room-riders):visible').getByText('Host',{exact:false}).waitFor();
  await directReady(display,true);await Promise.all(players.map(page=>directReady(page,false)));
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);await display.locator('.shared-lobby').waitFor({state:'visible'});await display.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.shared-lobby img');return image?.complete&&image.naturalWidth>0;});
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'hidden'});await display.locator('.online-arena').waitFor({state:'visible'});await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
  console.log('Online smoke passed: room creation, guest join, host permissions, start, settings, reset, full phone view.');
}catch(error){
  for(const [index,context] of browser.contexts().entries())for(const page of context.pages()){
    console.error(`ROOM DIAGNOSTIC ${index}`,await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.online-arena');let savedMode:unknown;try{savedMode=JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')??'{}').mode;}catch{}return {body:document.body.innerText,metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,linkDiagnostics:document.querySelector<HTMLElement>('#app')?.dataset.linkDiagnostics,canvas:{hidden:canvas?.hidden,parentClass:canvas?.parentElement?.className,renderer:canvas?.dataset.renderer},savedMode};}).catch(()=>'<page closed>'));
  }
  throw error;
}finally{await browser.close();}
