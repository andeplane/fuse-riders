import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const base=process.env.HOME_URL??'http://127.0.0.1:4188/';
interface Snapshot {kind:string;phase:string;authorityScope:string;tick:number;heldMotion?:{left:boolean;right:boolean};players:Array<{id:string;angle:number;alive:boolean;bombReadyAtTick:number;bombChargeStartedTick?:number}>}
const results:object[]=[];await mkdir('artifacts',{recursive:true});
const bundle=await readFile('dist/index.html','utf8');
const assetPath=bundle.match(/type="module"[^>]*src="([^"]+)"/)?.[1];
const asset=assetPath?await readFile(`dist/${assetPath.replace(/^\//,'')}`):undefined;
const identity={assetPath,assetSha256:asset?createHash('sha256').update(asset).digest('hex'):undefined,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),htmlSha256:createHash('sha256').update(bundle).digest('hex'),date:new Date().toISOString(),base};
for(const [name,type] of [['chrome',chromium],['webkit',webkit]] as const){
 const browser=await type.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[],snapshots:Snapshot[]=[];
 page.on('pageerror',e=>errors.push(e.stack??e.message));await page.exposeFunction('recordKeyboardSnapshot',(s:Snapshot)=>{if(s.kind==='snapshot')snapshots.push(s);});
 await page.addInitScript(()=>{localStorage.setItem('fuse-riders-room-settings-v1',JSON.stringify({version:1,mode:'devices',match:'wins',length:3,weights:{}}));window.addEventListener('fuse-benchmark',event=>{void Reflect.get(window,'recordKeyboardSnapshot')((event as CustomEvent).detail);});});
 const latest=()=>snapshots.at(-1)!;const actor=()=>latest().players.find(p=>p.id==='solo')!;
 const wait=async(predicate:()=>boolean)=>{const deadline=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<deadline,'timed out waiting for authoritative keyboard outcome');await page.waitForTimeout(25);}};
 const turn=async(key:string,sign:number)=>{
  await page.keyboard.down(key);
  try {
   // Browser event delivery and scheduled simulation input are separate boundaries.
   // Start measuring only once the authority reports this direction as applied.
   await wait(()=>latest().heldMotion?.left===(sign<0)&&latest().heldMotion?.right===(sign>0));
   const before=actor().angle,tick=latest().tick,scope=latest().authorityScope;
   await wait(()=>latest().tick>=tick+3);
   assert.equal(latest().phase,'playing','steering trial must stay in play');
   assert.equal(latest().authorityScope,scope,'steering trial must stay in the same round');
   assert.ok(actor().alive,'actor died during steering trial');
   const delta=Math.atan2(Math.sin(actor().angle-before),Math.cos(actor().angle-before));
   assert.ok(delta*sign>0.02,`${key} must turn authoritative pose: ${delta}`);
   return{key,fromTick:tick,toTick:latest().tick,delta};
  } finally {
   await page.keyboard.up(key);
   await wait(()=>latest().heldMotion?.left===false&&latest().heldMotion?.right===false);
  }
 };
 try{
  await page.goto(new URL('?solo=1&benchmark=1',base).href);await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.renderer?.startsWith('phaser-'));await wait(()=>snapshots.length>0&&latest().phase==='playing');
  const steering=[await turn('ArrowLeft',-1),await turn('ArrowRight',1)];
  const freshRound=async()=>{const scope=latest().authorityScope;await page.getByRole('button',{name:'MAIN MENU',exact:true}).click();await wait(()=>latest().phase==='lobby');await page.getByRole('button',{name:'START RACE',exact:true}).click();await wait(()=>latest().phase==='playing'&&latest().authorityScope!==scope);const playingTick=latest().tick;await wait(()=>latest().tick>=playingTick+2);};
  await freshRound();
  const beforeShot=actor().bombReadyAtTick,shotScope=latest().authorityScope;
  const fire=page.locator('.online-controls button').nth(1);
  await page.keyboard.down('Space');await fire.getByText('RELEASE!',{exact:true}).waitFor();await page.keyboard.down('Space');await wait(()=>actor().bombChargeStartedTick!==undefined);await page.keyboard.up('Space');await wait(()=>snapshots.some(s=>s.authorityScope===shotScope&&s.players.some(p=>p.id==='solo'&&p.bombReadyAtTick>beforeShot)));
  // Reset through the real menu action to obtain a fresh bomb cooldown and safe spawn.
  await freshRound();const beforeCancel=actor().bombReadyAtTick,cancelScope=latest().authorityScope;
  await page.keyboard.down('Space');await fire.getByText('RELEASE!',{exact:true}).waitFor();await wait(()=>actor().bombChargeStartedTick!==undefined);await page.getByRole('button',{name:'MENU',exact:true}).click();await page.keyboard.up('Space');await page.getByRole('button',{name:'CLOSE',exact:true}).click();const cancelTick=latest().tick;await wait(()=>latest().tick>=cancelTick+6);assert.equal(latest().authorityScope,cancelScope);assert.ok(actor().alive);assert.equal(actor().bombReadyAtTick,beforeCancel,'opening modal must cancel, not fire');
  await page.getByRole('button',{name:'MAIN MENU',exact:true}).click();await page.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();const length=page.getByLabel('Match length');await length.fill('12');await length.press('ArrowLeft');await length.press('Backspace');assert.equal(await length.inputValue(),'2','editable input must retain ordinary arrow/delete editing');await page.keyboard.press('Space');assert.ok(!(await fire.textContent())?.includes('RELEASE'),'editable Space must not charge');
  assert.deepEqual(errors,[]);results.push({browser:name,passed:true,steering,spaceChargeRelease:true,modalCancelWithoutShot:true,editableKeys:true,errors});console.log(`PASS ${name} desktop keyboard`);
 }catch(error){results.push({browser:name,passed:false,error:String(error),errors,snapshots:snapshots.slice(-20)});throw error;}
 finally{await browser.close();await writeFile('artifacts/keyboard-smoke.json',JSON.stringify({identity,results},null,2));}
}
