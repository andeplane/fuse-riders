import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { headingResponse,type ResponseFrame,type ResponsePointer,type ResponseResult } from '../src/online/response-measurement';
interface Attempt {pointer?:ResponsePointer;local?:ResponseResult;tv?:ResponseResult;oneDegree?:{local:ResponseResult;tv:ResponseResult};status?:string;at?:number}
interface Renderer {renderer?:string;hidden?:boolean;timeOrigin:number}
interface Capture {frames:ResponseFrame[];pointers:ResponsePointer[];actorId:string;truncated:number}
declare global {interface Window {__responseBench:Capture}}
function install(hidden:boolean){
 const state:Capture={frames:[],pointers:[],actorId:'',truncated:0};window.__responseBench=state;
 if(hidden){const hide=()=>{for(const canvas of document.querySelectorAll('canvas'))if(!canvas.hidden)canvas.hidden=true;};new MutationObserver(hide).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});hide();}
 window.addEventListener('fuse-benchmark',event=>{const detail=(event as CustomEvent).detail;if(detail.kind==='snapshot')state.actorId=detail.playerId??state.actorId;if(detail.kind==='response-render'){if(state.frames.length>=12000){state.frames.shift();state.truncated++;}state.frames.push(detail);}});
 window.addEventListener('pointerdown',event=>{const text=(event.target as Element)?.closest('button')?.textContent?.trim();if(text!=='◀'&&text!=='▶')return;state.pointers.push({epochAt:performance.timeOrigin+event.timeStamp,actorId:state.actorId,direction:text==='◀'?-1:1,trusted:event.isTrusted});},true);
}
const base=new URL(process.env.ONLINE_URL??'http://localhost:8787/');base.searchParams.set('responseBenchmark','1');
if(!['localhost','127.0.0.1'].includes(base.hostname)&&process.env.BENCH_ALLOW_REMOTE!=='1')throw new Error('Remote run requires explicit BENCH_ALLOW_REMOTE=1');
const duration=Number(process.env.BENCH_SECONDS??60);if(!Number.isFinite(duration)||duration<30||duration>60)throw new Error('BENCH_SECONDS must be 30–60');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const html=await(await fetch(base)).text();const assets=await Promise.all([...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(async m=>{const u=new URL(m[1]!,base);return{path:u.pathname,sha256:createHash('sha256').update(Buffer.from(await(await fetch(u)).arrayBuffer())).digest('hex')};}));
const browser=await chromium.launch({headless:true});const errors:string[]=[],attempts:Attempt[]=[];let failure:string|undefined;
const quantiles=(v:number[])=>{v.sort((a,b)=>a-b);return{count:v.length,p50:v[Math.ceil(v.length*.5)-1]??null,p95:v[Math.ceil(v.length*.95)-1]??null,p99:v[Math.ceil(v.length*.99)-1]??null,max:v.at(-1)??null};};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let captures:Capture[]=[];let renderers:Renderer[]=[];
try{
 const pages=[];for(let i=0;i<3;i++){const context=await browser.newContext({viewport:i===1?{width:390,height:844}:{width:1280,height:720}});context.setDefaultTimeout(20000);await context.addInitScript({content:`(()=>{const __name=(fn)=>fn;(${install.toString()})(${i===0});})();`});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);}
 const [host,guest,tv]=pages;if(!host||!guest||!tv)throw new Error('Missing views');
 await host.goto(base.href);await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();await host.waitForURL(/room=/);const hu=new URL(host.url());hu.searchParams.set('responseBenchmark','1');await host.goto(hu.href);
 const invite=new URL(base);invite.searchParams.set('room',hu.searchParams.get('room')!);
 for(const [page,name] of [[host,'Response host'],[guest,'Response actor']] as const){if(page===guest)await page.goto(invite.href);await page.getByPlaceholder('Your name').fill(name);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator('.online-roster').getByText(name,{exact:false}).waitFor();}
 invite.searchParams.set('display','1');await tv.goto(invite.href);await tv.locator('.online-roster').getByText('Response actor',{exact:false}).waitFor();
 await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();const dialog=host.getByRole('dialog');for(const input of await dialog.locator('label input[type="number"]').all())await input.fill('0');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
 await host.getByRole('button',{name:'START RACE',exact:true}).click();
 const started=Date.now();let iteration=0;
 while(Date.now()-started<duration*1000){
  if((await host.locator('.online-notice').textContent())?.includes('MATCH COMPLETE')){await host.keyboard.press('Escape');await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();await host.getByText('Join your friends, then start the race',{exact:true}).waitFor();await host.getByRole('button',{name:'START RACE',exact:true}).click();}
  await delay(450);const button=guest.getByRole('button',{name:iteration++%2?'◀':'▶',exact:true});const bounds=await button.boundingBox();if(!bounds){attempts.push({status:'unavailable-control',at:Date.now()});continue;}
  const previous=await guest.evaluate(()=>window.__responseBench.pointers.length);await guest.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await guest.mouse.down();await delay(120);await guest.mouse.up();await delay(750);
  const pointer=await guest.evaluate(i=>window.__responseBench.pointers[i],previous);if(!pointer){attempts.push({status:'missing-pointer',at:Date.now()});continue;}
  const windows=await Promise.all([guest,tv].map(page=>page.evaluate(at=>window.__responseBench.frames.filter(f=>f.epochAt>=at-250&&f.epochAt<=at+800),pointer.epochAt)));
  const result:Attempt={pointer,local:headingResponse(pointer,windows[0]!),tv:headingResponse(pointer,windows[1]!),oneDegree:{local:headingResponse(pointer,windows[0]!,800,Math.PI/180),tv:headingResponse(pointer,windows[1]!,800,Math.PI/180)}};
  const baselines=windows.map(frames=>frames.filter(f=>f.epochAt<=pointer.epochAt).at(-1));
  if(baselines[0]?.scope!==baselines[1]?.scope){for(const view of ['local','tv'] as const){result[view]={status:'rejected',reason:'cross-view-scope-mismatch',frames:windows[view==='local'?0:1]!};result.oneDegree![view]=result[view]!;}}
  attempts.push(result);
 }
 captures=await Promise.all(pages.map(p=>p.evaluate(()=>window.__responseBench)));renderers=await Promise.all(pages.map(p=>p.evaluate(()=>({renderer:document.querySelector('canvas')?.dataset.renderer,hidden:document.querySelector('canvas')?.hidden,timeOrigin:performance.timeOrigin}))));
}catch(e){failure=e instanceof Error?e.message:String(e);}finally{await browser.close();}
const summaries=Object.fromEntries((['local','tv'] as const).map(view=>{const results=attempts.flatMap(a=>a[view]?[a[view]!]:[]);const distribution=quantiles(results.filter(r=>r.status==='changed').map(r=>r.latencyMs!));const secondary=attempts.flatMap(a=>a.oneDegree?[a.oneDegree[view]]:[]);return[view,{...distribution,rejected:results.filter(r=>r.status==='rejected').length,timeouts:results.filter(r=>r.status==='timeout').length,reasons:results.filter(r=>r.reason).map(r=>r.reason),candidateLimitMs:view==='local'?33:100,passed:results.every(r=>r.status!=='timeout')&&distribution.count>=10&&distribution.p95!==null&&distribution.p95<=(view==='local'?33:100),oneDegree:{...quantiles(secondary.filter(r=>r.status==='changed').map(r=>r.latencyMs!)),rejected:secondary.filter(r=>r.status==='rejected').length,timeouts:secondary.filter(r=>r.status==='timeout').length}}];}));
const passed=!failure&&!errors.length&&Object.values(summaries).every(s=>s.passed)&&renderers.length===3&&renderers.slice(1).every(r=>r.renderer?.startsWith('phaser-')&&!r.hidden)&&captures.every(c=>c.truncated===0);
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/response-benchmark.json',JSON.stringify({date:new Date().toISOString(),revision,assets,durationSeconds:duration,method:'Trusted DOM pointer to first actual submitted Phaser heading departure >=0.0001 rad; secondary >=1 degree. Two visible renderers: guest390x844 and TV1280x720; host renderer hidden. Same machine performance.timeOrigin clocks, direct RTC without impairment. Not physical touch-to-photon, scanout, phone hardware, or WAN qualification.',renderers,errors,failure,summaries,attempts,truncated:captures.map(c=>c.truncated),passed},null,2)+'\n');console.log(JSON.stringify({report:'artifacts/response-benchmark.json',summaries,passed}));if(!passed)process.exitCode=1;
