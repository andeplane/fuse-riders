import { chromium,webkit } from 'playwright';
import assert from 'node:assert/strict';
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
  const a=await browser.newContext({viewport:{width:1000,height:700}});const host=await a.newPage();
  host.on('pageerror',error=>console.error('HOST ERROR',error));
  await host.goto(process.env.ONLINE_URL??'http://localhost:8787/');await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();
  await host.waitForURL(/room=/);const url=host.url();
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  const b=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const guest=await b.newPage();guest.on('pageerror',error=>console.error('GUEST ERROR',error));
  await guest.goto(url);await guest.getByPlaceholder('Your name').fill('Guest');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  await host.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();
  for(let i=2;i<5;i++){const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const page=await context.newPage();await page.goto(url);await page.getByPlaceholder('Your name').fill(`Rider ${i}`);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator('.online-roster').getByText(`Rider ${i}`,{exact:false}).waitFor();}
  const startButton=host.getByRole('button',{name:'START RACE',exact:true});const startBounds=await startButton.boundingBox();assert.ok(startBounds);await host.mouse.move(startBounds.x+startBounds.width/2,startBounds.y+startBounds.height/2);await host.mouse.down();await new Promise(resolve=>setTimeout(resolve,180));await host.mouse.up();
  await guest.locator('.online-notice').getByText('READY',{exact:false}).waitFor();
  await host.screenshot({path:'artifacts/online-host.png'});await guest.screenshot({path:'artifacts/online-phone.png'});
  assert.equal(await guest.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();
  await host.getByLabel('Match length').fill('2');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();
  await guest.getByText('Join your friends, then start the race',{exact:true}).waitFor();
  await guest.reload();
  await guest.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();
  await host.reload();
  await host.locator('.online-roster').getByText('Guest',{exact:false}).waitFor();
  await host.getByRole('button',{name:'START RACE',exact:true}).waitFor({state:'visible'});
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.locator('dialog select').first().selectOption('shared');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await guest.locator('.online-arena').waitFor({state:'hidden'});
  const displayContext=await browser.newContext();const display=await displayContext.newPage();await display.goto(url+'&display=1');await display.locator('.online-roster').getByText('Host',{exact:false}).waitFor();
  assert.equal(await display.getByRole('button',{name:'ROOM SETTINGS',exact:true}).isVisible(),false);assert.equal(await display.locator('.online-arena').isVisible(),true);
  console.log('Online smoke passed: room creation, guest join, host permissions, start, settings, reset, full phone view.');
}finally{await browser.close();}
