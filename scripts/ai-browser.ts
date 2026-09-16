import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../src/server/index.js';
const browser=await(process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const onlineUrl=process.env.ONLINE_URL??'http://localhost:8793/';
await mkdir('artifacts',{recursive:true});
try{
  for(const [name,viewport] of [['desktop',{width:1600,height:900}],['phone',{width:390,height:844}]] as const){
    const context=await browser.newContext({viewport,...(name==='phone'?{isMobile:true,hasTouch:true}:{})});const page=await context.newPage();
    await page.goto(onlineUrl);await page.getByRole('button',{name:'CREATE ROOM',exact:true}).click();await page.waitForURL(/room=/);
    await page.getByPlaceholder('Your name').fill('Solo host');await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
    await page.locator('.room-riders').getByText('Solo host',{exact:true}).waitFor();
    await page.getByRole('button',{name:'ADD AI',exact:true}).click();await page.locator('.room-riders').getByText('AI Turing',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Remove AI Turing',exact:true}).click();await page.locator('.room-riders').getByText('AI Turing',{exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:'ADD AI',exact:true}).click();await page.locator('.room-riders').getByText('AI Turing',{exact:true}).waitFor();
    await page.screenshot({path:`artifacts/ai-online-${name}.png`});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone host controls must fit without horizontal scrolling');
    await page.getByRole('button',{name:'START RACE',exact:true}).click();await page.locator('.online-notice').filter({hasText:/READY/}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Remove AI Turing',exact:true,includeHidden:true}).isDisabled(),true);
    await page.locator('.online-roster [aria-label]').filter({hasText:/ · [1-9]/}).first().waitFor({state:'attached',timeout:25000});
    console.log(`PASS ${name}: solo host added/removed AI, started a real round and normal scoring occurred`);
    await context.close();
  }
  const app=await createGameServer({port:0,hostname:'127.0.0.1',lanAddress:'127.0.0.1',manualTicks:true,buildDirectory:process.env.BUILD_DIRECTORY??'artifacts/ai-dist'});
  try{
    const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();await page.goto(app.hostUrl);
    await page.getByRole('button',{name:'ADD AI',exact:true}).click();await page.getByRole('button',{name:'Remove AI Ada',exact:true}).waitFor();
    await page.getByRole('button',{name:'ADD AI',exact:true}).click();await page.getByRole('button',{name:'Remove AI Turing',exact:true}).waitFor();
    await page.getByRole('button',{name:'Remove AI Ada',exact:true}).click();await page.getByRole('button',{name:'Remove AI Ada',exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:'ADD AI',exact:true}).click();
    await page.getByRole('button',{name:'START RACE',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.announcement')?.textContent?.includes('3'));
    app.advance(65);assert.equal(app.game.phase,'playing');assert.equal(app.game.players.size,2);
    await page.screenshot({path:'artifacts/ai-lan.png'});console.log('PASS LAN: authenticated TV added/removed AI and started normal gameplay');await context.close();
  }finally{await app.close();}
}finally{await browser.close();}
