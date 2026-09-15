import { chromium,webkit } from 'playwright';
import assert from 'node:assert/strict';
import { smokeTimeout } from './smoke-timeout.js';
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});a.setDefaultTimeout(smokeTimeout(30000));const host=await a.newPage();
  host.on('pageerror',error=>console.error('HOST ERROR',error));
  await host.goto(process.env.ONLINE_URL??'http://localhost:8787/');await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);
  // Keep UI room creation coverage. Explicit CI fallback avoids six software-GL views
  // competing for one runner; dedicated Phaser gates test the intended renderer.
  if(process.env.ROOM_RENDERER==='canvas'){await host.getByPlaceholder('Your name').waitFor();const target=new URL(host.url());target.searchParams.set('renderer','canvas');await host.goto(target.href);}
  const url=host.url();
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});b.setDefaultTimeout(smokeTimeout(30000));const guest=await b.newPage();guest.on('pageerror',error=>console.error('GUEST ERROR',error));
  // A joiner gets its own page: name + head + JOIN, never the host's PREPARING ROOM card or the QR lobby.
  await guest.goto(url);await guest.locator('.room-join').waitFor({state:'visible'});assert.equal(await guest.locator('.room-boot').count(),0,'joiner never mounts the boot card');assert.equal(await guest.locator('.shared-lobby').isVisible(),false,'joiner never sees the QR lobby');assert.equal(await guest.locator('.room-join .avatar-option').count(),10,'joiner picks a head before joining');
  await guest.getByPlaceholder('Your name').fill('Guest');await guest.getByRole('button',{name:/^Avatar · .*, change$/}).click();await guest.getByRole('button',{name:'Fox',exact:true}).click();await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();await host.locator(':is(.online-roster,.room-riders):visible .avatar-portrait[data-avatar-id=fox]').waitFor();console.log('Guest roster confirmed');
  // A browser carrying a guest identity under the old host key (previous builds saved every visitor there) must land on the joiner page with that identity kept, not on the host shell.
  {const code=new URL(url).searchParams.get('room')!,stale='ab'.repeat(32);const c=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});c.setDefaultTimeout(smokeTimeout(30000));await c.addInitScript(([code,stale])=>{if(!localStorage.getItem(`fuse-peer-${code}`))localStorage.setItem(`fuse-room-${code}`,stale);},[code,stale] as const);const page=await c.newPage();
   await page.goto(url);await page.locator('.room-join').waitFor({state:'visible'});await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(code=>[localStorage.getItem(`fuse-room-${code}`),localStorage.getItem(`fuse-peer-${code}`)],code),[null,stale],'stale host key migrates to the peer identity');assert.equal(await page.locator('.room-boot').count(),0);await c.close();console.log('Stale host key migrated');}
  // Six WebKit views overload a CI runner (the host's frame time triples); SMOKE_RIDERS trims the roster there.
  const riders=Number(process.env.SMOKE_RIDERS??5);
  for(let i=2;i<riders;i++){const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});context.setDefaultTimeout(smokeTimeout(30000));const page=await context.newPage();await page.goto(url);await page.getByPlaceholder('Your name').fill(`Rider ${i}`);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator(':is(.online-roster,.room-riders):visible').getByText(`Rider ${i}`,{exact:false}).waitFor();}
  console.log(`${riders} riders joined`);
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.includes('READY'));await guest.locator('.mobile-play').waitFor({state:'visible'});
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
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).click();
  // Back in the lobby a joined phone shows the lobby screen with the riders and the wait explained, not the controller (#134).
  await guest.waitForFunction(()=>document.querySelector('.online-notice')?.textContent?.startsWith('Waiting for the host'));await guest.locator('.phone-lobby').waitFor();assert.equal(await guest.locator('.mobile-play').count(),0,'a joined phone in the lobby is a lobby screen');
  await guest.locator('.room-riders').getByText('Guest',{exact:false}).waitFor();
  console.log('Settings/reset confirmed');await guest.reload();
  // A lobby reload frees the seat, so the rider confirms the remembered name and head instead of being joined silently.
  await guest.locator('.room-join').waitFor({state:'visible'});assert.equal(await guest.getByPlaceholder('Your name').inputValue(),'Guest','remembered name prefills the join card');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await guest.locator('.phone-lobby .room-riders').getByText('Guest',{exact:false}).waitFor(); // The rejoined phone lands on the lobby screen (#134).
  console.log('Guest refresh confirmed');await host.reload();
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Guest',{exact:false}).waitFor();console.log('Guest roster confirmed');
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByRole('radio',{name:'Shared TV + phone controls',exact:true}).check();await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await guest.locator('.online-arena').waitFor({state:'hidden'});
  const displayContext=await browser.newContext();displayContext.setDefaultTimeout(smokeTimeout(30000));const display=await displayContext.newPage();await display.goto(url+'&display=1');await display.locator(':is(.online-roster,.room-riders):visible').getByText('Host',{exact:false}).waitFor();
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);await display.locator('.shared-lobby').waitFor({state:'visible'});await display.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.shared-lobby img');return image?.complete&&image.naturalWidth>0;});
  await host.getByRole('button',{name:'START RACE',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'hidden'});await display.locator('.online-arena').waitFor({state:'visible'});await host.getByRole('button',{name:'BACK TO LOBBY',exact:true}).click();await display.locator('.shared-lobby').waitFor({state:'visible'});
  console.log('Online smoke passed: room creation, guest join, host permissions, start, settings, reset, full phone view.');
}catch(error){
  for(const [index,context] of browser.contexts().entries())for(const page of context.pages()){
    console.error(`ROOM DIAGNOSTIC ${index}`,await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.online-arena');let savedMode:unknown;try{savedMode=JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')??'{}').mode;}catch{}return {body:document.body.innerText,metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,linkDiagnostics:document.querySelector<HTMLElement>('#app')?.dataset.linkDiagnostics,canvas:{hidden:canvas?.hidden,parentClass:canvas?.parentElement?.className,renderer:canvas?.dataset.renderer},savedMode};}).catch(()=>'<page closed>'));
  }
  throw error;
}finally{await browser.close();}
