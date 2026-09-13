import { chromium,webkit } from 'playwright';
import assert from 'node:assert/strict';
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});a.setDefaultTimeout(30000);const host=await a.newPage();
  host.on('pageerror',error=>console.error('HOST ERROR',error));
  await host.goto(process.env.ONLINE_URL??'http://localhost:8787/');await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);
  // Keep UI room creation coverage. Explicit CI fallback avoids six software-GL views
  // competing for one runner; dedicated Phaser gates test the intended renderer.
  if(process.env.ROOM_RENDERER==='canvas'){await host.getByPlaceholder('Your name').waitFor();const target=new URL(host.url());target.searchParams.set('renderer','canvas');await host.goto(target.href);}
  const url=host.url();
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});b.setDefaultTimeout(30000);const guest=await b.newPage();guest.on('pageerror',error=>console.error('GUEST ERROR',error));
  await guest.goto(url);await guest.getByPlaceholder('Your name').fill('Guest');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await host.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();console.log('Guest roster confirmed');
  for(let i=2;i<5;i++){const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});context.setDefaultTimeout(30000);const page=await context.newPage();await page.goto(url);await page.getByPlaceholder('Your name').fill(`Rider ${i}`);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator('.online-roster').getByText(`Rider ${i}`,{exact:false}).waitFor();}
  console.log('Five riders joined');
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.locator('.online-notice').getByText('READY',{exact:false}).waitFor();
  await host.screenshot({path:'artifacts/online-host.png'});await guest.screenshot({path:'artifacts/online-phone.png'});
  assert.equal(await guest.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();
  await guest.getByText('Join your friends, then start the race',{exact:true}).waitFor();
  console.log('Settings/reset confirmed');await guest.reload();
  await guest.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();
  console.log('Guest refresh confirmed');await host.reload();
  await host.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();console.log('Guest roster confirmed');
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.locator('dialog select').first().selectOption('shared');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await guest.locator('.online-arena').waitFor({state:'hidden'});
  const displayContext=await browser.newContext();displayContext.setDefaultTimeout(30000);const display=await displayContext.newPage();await display.goto(url+'&display=1');await display.locator('.online-roster').getByText('Host',{exact:false}).waitFor();
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);assert.equal(await display.locator('.online-arena').isVisible(),true);
  console.log('Online smoke passed: room creation, guest join, host permissions, start, settings, reset, full phone view.');
}catch(error){
  for(const [index,context] of browser.contexts().entries())for(const page of context.pages()){
    console.error(`ROOM DIAGNOSTIC ${index}`,await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.online-arena');let savedMode:unknown;try{savedMode=JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')??'{}').mode;}catch{}return {body:document.body.innerText,metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,canvas:{hidden:canvas?.hidden,parentClass:canvas?.parentElement?.className,renderer:canvas?.dataset.renderer},savedMode};}).catch(()=>'<page closed>'));
  }
  throw error;
}finally{await browser.close();}
