import { chromium,webkit,type Page,type Locator,type Browser } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const base=process.env.HOME_URL??'http://127.0.0.1:4188/';
// WebKit on the CI runner sometimes reports a same-origin sprite XHR as an access-control failure; Phaser retries and the page is fine.
const results:object[]=[];await mkdir('artifacts',{recursive:true});
async function inside(page:Page,locator:Locator){await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox(),v=page.viewportSize()!;assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,`Control outside ${v.width}x${v.height}: ${JSON.stringify(r)}`);}
async function ready(page:Page){await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-renderer')?.startsWith('phaser-'));}
async function frames(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>{let count=0;const next=()=>{if(++count===12)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);}));}
async function rapidNavigation(browser:Browser,browserName:string){
 const context=await browser.newContext({viewport:{width:320,height:568}}),page=await context.newPage();page.setDefaultTimeout(20000);const errors:string[]=[];let delayed=0,cancelled=0;
 page.on('pageerror',e=>{if(!/access control checks/.test(e.message))errors.push(e.stack??e.message);});page.on('requestfailed',r=>{if(r.resourceType()==='xhr')cancelled++;});
 await page.route('**/themes/**',async route=>{if(route.request().resourceType()==='xhr'){delayed++;await new Promise(resolve=>setTimeout(resolve,300));}await route.continue().catch(()=>{});});
 try{const pending=page.waitForRequest(r=>r.resourceType()==='xhr'&&new URL(r.url()).pathname.includes('/themes/'));await page.goto(base);await pending;await page.getByRole('link',{name:/PLAY SOLO/}).click();await page.locator('.online-controls').waitFor({state:'visible'});await page.reload();await ready(page);assert.ok(delayed>0,'must exercise pending preloads');assert.deepEqual(errors,[]);results.push({browser:browserName,case:'rapid-navigation-with-pending-XHR',passed:true,delayed,cancelled});console.log(`PASS ${browserName} rapid navigation`);}
 catch(error){results.push({browser:browserName,case:'rapid-navigation-with-pending-XHR',passed:false,error:String(error),errors,delayed,cancelled});throw error;}
 finally{await context.close();await writeFile('artifacts/home-mobile-smoke.json',JSON.stringify(results,null,2));}
}
for(const [browserName,type] of [['chrome',chromium],['webkit',webkit]] as const){
 const browser=await type.launch({headless:true});
 try{for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(20000);const errors:string[]=[],api:string[]=[];let sockets=0,rtcTotal=0;
  page.on('pageerror',e=>{if(!/access control checks/.test(e.message))errors.push(e.stack??e.message);});page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(new URL(r.url()).pathname);});page.on('websocket',()=>sockets++);
  await page.addInitScript('window.__name = value => value');await page.exposeFunction('recordRtcConstruction',()=>{rtcTotal++;});
  await page.addInitScript(()=>{let rtc=0;const original=window.RTCPeerConnection;window.RTCPeerConnection=new Proxy(original,{construct(target,args){rtc++;void Reflect.get(window,'recordRtcConstruction')();return Reflect.construct(target,args);}});Object.defineProperty(window,'__rtcCount',{get:()=>rtc});});
  const tag=`${browserName}-${viewport.width}x${viewport.height}`;
  try{
   await page.goto(base);await ready(page);await page.waitForFunction(()=>Number(document.querySelector('canvas')?.getAttribute('data-attract-tick'))>2);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'landing horizontal overflow');
   // The landing clips overflow, so a crowded top bar hides controls instead of scrolling: each must be fully on screen.
   for(const control of ['.landing-brand','.landing-top .audio-controls summary','.landing-audio'])await inside(page,page.locator(control));
   const guide=page.getByRole('region',{name:'POWER-UPS'});assert.equal(await guide.getByRole('listitem').count(),12,'power-up guide lists every pickup');
   await guide.getByText('STAR',{exact:true}).scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('.landing-powerups img')].every(image=>image.complete&&image.naturalWidth>0),undefined,{timeout:10000});
   const soloBox=await page.getByRole('link',{name:/PLAY SOLO/}).boundingBox(),createBox=await page.getByRole('button',{name:'CREATE ROOM'}).boundingBox(),guideBox=await guide.boundingBox();
   assert.ok(soloBox&&createBox&&guideBox&&soloBox.y<guideBox.y&&createBox.y<guideBox.y,'play and room actions stay above the power-up guide');
   await page.evaluate(()=>scrollTo(0,0));
   await page.getByRole('button',{name:/PAUSE BACKGROUND/}).click();await frames(page);const paused=await page.locator('canvas').getAttribute('data-attract-tick');await frames(page);assert.equal(await page.locator('canvas').getAttribute('data-attract-tick'),paused);
   await page.getByRole('button',{name:/PLAY BACKGROUND/}).click();await page.waitForFunction(t=>document.querySelector('canvas')?.getAttribute('data-attract-tick')!==t,paused);
   await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:/PLAY BACKGROUND/}).waitFor();await frames(page);const reduced=await page.locator('canvas').getAttribute('data-attract-tick');await frames(page);assert.equal(await page.locator('canvas').getAttribute('data-attract-tick'),reduced);
   await page.screenshot({path:`artifacts/home-${tag}.png`});
   await page.getByRole('link',{name:/PLAY SOLO/}).click();await page.locator('.online-roster').getByText('You',{exact:false}).waitFor({state:'attached'});assert.equal(await page.locator('.online-roster>span').count(),5);assert.equal(await page.getByRole('button',{name:/Remove AI/,includeHidden:true}).count(),4);await page.locator('.online-controls').waitFor({state:'visible'});await ready(page);
   // Avoid spontaneous end-of-match recaps while reviewing modal layouts.
   if(await page.locator('.mobile-tools-toggle').isVisible())await page.locator('.mobile-tools-toggle').click();
   await page.getByRole('button',{name:'MAIN MENU',exact:true}).click();
   for(const name of ['ROOM SETTINGS','♫ RADIO','HEAD','MENU']){
    await page.getByRole('button',{name,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});await inside(page,dialog);assert.ok(await page.locator('.dialog-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'dialog body horizontal overflow');
    if(name==='ROOM SETTINGS'){
      assert.equal(await dialog.locator('select').count(),0,'room settings use styled choices');
      assert.equal(await dialog.getByText('Blast radius',{exact:true}).count(),0,'powerups belong in submenu');
      await page.getByLabel('Match length').fill('7');
      const aim=page.getByLabel('Bomb aim time (seconds)');assert.equal(await aim.inputValue(),'0.4');await inside(page,aim);await aim.fill('1.2');
      await page.getByRole('button',{name:'CONFIGURE POWERUPS',exact:true}).click();
      const blast=dialog.locator('label').filter({hasText:'Blast radius'}).locator('input');await blast.fill('42');
      await inside(page,page.getByRole('button',{name:'CLOSE',exact:true}));
      await page.getByRole('button',{name:'← BACK TO ROOM SETTINGS',exact:true}).click();
      assert.equal(await page.getByLabel('Match length').inputValue(),'7','draft survives submenu navigation');
      assert.equal(await aim.inputValue(),'1.2','aim time survives submenu navigation');
      await page.getByRole('button',{name:'CONFIGURE POWERUPS',exact:true}).click();assert.equal(await blast.inputValue(),'42');
      await page.getByRole('button',{name:'← BACK TO ROOM SETTINGS',exact:true}).click();
      await page.getByLabel('Match length').fill('0');await page.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();assert.equal(await dialog.isVisible(),true);await dialog.getByRole('alert').getByText('Choose a match length from 1 to 20.').waitFor();
      await page.getByLabel('Match length').fill('7');
      for(const invalid of ['0','2.05','0.125']){await aim.fill(invalid);await page.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();await dialog.getByRole('alert').getByText('Choose a bomb aim time from 0.1 to 2 seconds in steps of 0.05.').waitFor();}
      // Off-grid text must survive the powerups submenu and still be rejected, not silently rounded and saved.
      await aim.fill('0.37');await page.getByRole('button',{name:'CONFIGURE POWERUPS',exact:true}).click();await page.getByRole('button',{name:'← BACK TO ROOM SETTINGS',exact:true}).click();
      assert.equal(await aim.inputValue(),'0.37','off-grid aim text survives submenu navigation');await page.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();assert.equal(await dialog.isVisible(),true,'off-grid aim time is not saved after submenu navigation');await dialog.getByRole('alert').getByText('Choose a bomb aim time from 0.1 to 2 seconds in steps of 0.05.').waitFor();
      await aim.fill('1.2');await page.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();await dialog.waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fuse-riders-room-settings-v1')!).bombChargeTicks),24);
      await page.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();assert.equal(await page.getByLabel('Match length').inputValue(),'7');
      assert.equal(await aim.inputValue(),'1.2','saved aim time reopens');
      await page.getByRole('button',{name:'CONFIGURE POWERUPS',exact:true}).click();assert.equal(await blast.inputValue(),'42');await page.getByRole('button',{name:'← BACK TO ROOM SETTINGS',exact:true}).click();
    }
    if(name==='HEAD'){for(const option of await dialog.locator('.avatar-option').all()){await inside(page,option);assert.ok(await option.evaluate(e=>{const text=e.lastElementChild!,a=e.getBoundingClientRect(),b=text.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1&&text.scrollWidth<=text.clientWidth+1;}),'avatar name clipped');}}
    if(name==='♫ RADIO'){await page.locator('.audio-panel').waitFor({state:'visible'});for(const slider of await page.locator('.audio-panel input[type=range]').all())await inside(page,slider);}
    await page.locator('.dialog-body').evaluate(e=>{e.scrollTop=e.scrollHeight;});await inside(page,page.getByRole('button',{name:'CLOSE',exact:true}));await page.screenshot({path:`artifacts/menu-${tag}-${name==='♫ RADIO'?'audio':name.replaceAll(' ','-')}.png`});await page.getByRole('button',{name:'CLOSE',exact:true}).click();await dialog.waitFor({state:'hidden'});
   }
   await page.reload();await page.locator('.online-controls').waitFor({state:'visible'});await ready(page);assert.equal(await page.locator('.online-roster>span').count(),5);
   const solo=new URL(base);solo.search='?solo=1&display=1';await page.goto(solo.href);await page.locator('.online-controls').waitFor({state:'visible'});await ready(page);assert.equal(await page.locator('.online-arena').isVisible(),true);
   assert.equal(await page.evaluate(()=>Reflect.get(window,'__rtcCount')),0);assert.equal(rtcTotal,0);assert.deepEqual(api,[]);assert.equal(sockets,0);assert.deepEqual(errors,[]);results.push({browser:browserName,viewport,passed:true,network:{apiCalls:0,webSockets:0,rtcConstructors:0}});console.log(`PASS ${tag}`);
  }catch(error){await page.screenshot({path:`artifacts/home-failure-${tag}.png`});results.push({browser:browserName,viewport,passed:false,error:String(error),errors,api,sockets});throw error;}
  finally{await context.close();await writeFile('artifacts/home-mobile-smoke.json',JSON.stringify(results,null,2));}
 }await rapidNavigation(browser,browserName);}finally{await browser.close();}
}
