import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
// #13: a joined phone shows one controller presentation (full-screen thirds, hint labels, ☰ MENU pill) in lobby, countdown, playing and matchOver.
const base=process.env.HOME_URL??'http://127.0.0.1:4188/';const results:object[]=[];await mkdir('artifacts',{recursive:true});
const PHASES=['lobby','countdown','playing','matchOver'] as const;
for(const [name,type] of [['chrome',chromium],['webkit',webkit]] as const){const browser=await type.launch({headless:true});const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(20000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack??e.message));
 // One round ends the match, so matchOver is reachable without a long solo run.
 await page.addInitScript(()=>localStorage.setItem('fuse-riders-room-settings-v1',JSON.stringify({version:1,mode:'devices',match:'rounds',length:1,weights:{}})));
 const notice=(pattern:RegExp,timeout=20000)=>page.waitForFunction(source=>new RegExp(source).test(document.querySelector('.online-notice')?.textContent??''),pattern.source,{timeout});
 const capture=async(phase:string)=>{await page.screenshot({path:`artifacts/mobile-phase-${phase}-${name}.png`});return page.evaluate(()=>[...document.querySelectorAll('.mobile-play .online-controls>button,.mobile-play>.mobile-control-hints>span,.mobile-play>.mobile-tools-toggle')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,className:e.className.replace(/\bactive\b/,'').trim(),label:(e as HTMLElement).dataset.hint??(s.fontSize==='0px'?'':e.textContent),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),display:s.display,pointerEvents:s.pointerEvents};}));};
 const tools=async(open:boolean)=>{await page.locator('.mobile-tools-toggle').click();assert.equal(await page.locator('.mobile-tools-open').count(),open?1:0);};
 try{await page.goto(new URL('?solo=1',base).href);await page.locator('.mobile-play').waitFor();await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.renderer?.startsWith('phaser-'));
  const seen:Record<string,unknown>={};
  await tools(true);await page.getByRole('button',{name:'MAIN MENU',exact:true}).click();await notice(/^Join your friends/);
  assert.equal(await page.locator('.online-roster:visible>span').count(),5,'lobby roster reachable behind MENU');assert.equal(await page.locator('.shared-lobby').isVisible(),false);await tools(false);seen.lobby=await capture('lobby');
  await tools(true);await page.getByRole('button',{name:'START RACE',exact:true}).click();await notice(/^READY/);assert.equal(await page.locator('.mobile-tools-open').count(),0,'countdown closes the tools overlay');seen.countdown=await capture('countdown');
  await notice(/^$/);seen.playing=await capture('playing');
  await notice(/MATCH COMPLETE/,180000);await page.getByRole('button',{name:'CLOSE',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});seen.matchOver=await capture('matchOver');
  await tools(true);assert.equal(await page.locator('.online-roster:visible>span').count(),5,'match results roster reachable behind MENU');await page.getByRole('button',{name:'REMATCH',exact:true}).waitFor({state:'visible'});await page.screenshot({path:`artifacts/mobile-phase-menu-${name}.png`});await tools(false);
  assert.equal((seen.lobby as unknown[]).length,7,'3 zones + 3 labels + MENU pill');for(const phase of PHASES)assert.deepEqual(seen[phase],seen.lobby,`${phase} controls must match the lobby controls`);
  assert.deepEqual(errors,[]);results.push({browser:name,passed:true,controls:seen.lobby,phases:PHASES,errors});console.log(`PASS ${name} one controller across phases`);
 }catch(error){results.push({browser:name,passed:false,error:String(error),errors});throw error;}finally{await browser.close();await writeFile('artifacts/mobile-phase-smoke.json',JSON.stringify(results,null,2));}
}
