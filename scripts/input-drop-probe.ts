import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

/**
 * Counts, per guest input, whether it was rejected locally, sent but never applied by the
 * authority, or applied. Default: local host + one touch guest with application-message
 * delay (snapshots 100–300 ms late). PROBE_ROOM=<code> joins an existing room (for example a
 * real phone hosting on the deployed URL) as the instrumented guest instead; the host must
 * start the race. Never point this at an occupied match.
 */
const base=new URL(process.env.ONLINE_URL??'http://localhost:8787/');
const seconds=Number(process.env.PROBE_SECONDS??60),room=process.env.PROBE_ROOM?.toUpperCase();
const impairment={downDelay:Number(process.env.PROBE_DOWN_DELAY_MS??(room?0:100)),downJitter:Number(process.env.PROBE_DOWN_JITTER_MS??(room?0:200)),upDelay:Number(process.env.PROBE_UP_DELAY_MS??(room?0:30))};
const hideMs=Number(process.env.PROBE_HIDE_MS??(room?0:1500)),maxLocalRejectPercent=Number(process.env.PROBE_MAX_LOCAL_REJECT_PCT??2);
assert.ok(seconds>=10&&seconds<=1800,'PROBE_SECONDS must be 10–1800');
if(!['localhost','127.0.0.1'].includes(base.hostname)&&process.env.BENCH_ALLOW_REMOTE!=='1')throw new Error('Remote probe requires BENCH_ALLOW_REMOTE=1 and an isolated authorized room');

interface InputSample {kind:'input';at:number;seq:number;left:boolean;right:boolean;bomb:boolean;bombAction?:string;scheduled:boolean;intendedTick?:number;sent:boolean;estimate?:{lower:number;upper:number;tick:number};baseTick?:number;pending:number}
interface SnapshotSample {kind:'snapshot';at:number;tick:number;phase:string;authorityScope:string;motionResults?:Array<{seq:number;status:string;appliedTick?:number}>}
type Sample=InputSample|SnapshotSample;
/** Ordered per-channel application send delay: a slow but in-order path, not IP shaping. */
function installDelay(config:{delay:number;jitter:number;seed:number}){
 let seed=config.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const original=RTCDataChannel.prototype.send,due=new WeakMap<RTCDataChannel,number>();
 RTCDataChannel.prototype.send=function(data:string|Blob|ArrayBuffer|ArrayBufferView<ArrayBuffer>){
  if(typeof data!=='string'||config.delay+config.jitter<=0){Reflect.apply(original,this,[data]);return;}
  const now=performance.now(),at=Math.max(now+config.delay+random()*config.jitter,due.get(this)??0);due.set(this,at);
  const channel=this;setTimeout(()=>{if(channel.readyState==='open')Reflect.apply(original,channel,[data]);},at-now);
 };
}
function installGuestHooks(){
 let hidden=false;
 Object.defineProperty(document,'hidden',{get:()=>hidden,configurable:true});
 Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible',configurable:true});
 Object.assign(window,{__probeSetHidden:(value:boolean)=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));}});
 window.addEventListener('fuse-benchmark',event=>{
  const detail=(event as CustomEvent<Record<string,unknown>>).detail;if(!detail||typeof detail!=='object')return;
  if(detail.kind==='input')void Reflect.get(window,'recordProbe')(detail);
  else if(detail.kind==='snapshot')void Reflect.get(window,'recordProbe')({kind:'snapshot',at:detail.at,tick:detail.tick,phase:detail.phase,authorityScope:detail.authorityScope,motionResults:detail.motionResults});
 });
}
const prelude=(fn:(config:never)=>void,config:unknown)=>({content:`globalThis.__name=(f)=>f;(${fn.toString()})(${JSON.stringify(config)});`});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Real multi-touch through CDP so steer and fire can be held at the same time. */
class Touch {
 private active=new Map<number,{x:number;y:number}>();
 constructor(private readonly cdp:CDPSession){}
 private points(){return [...this.active].map(([id,point])=>({id,...point}));}
 async down(id:number,x:number,y:number){this.active.set(id,{x,y});await this.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:this.points()});}
 async up(id:number){this.active.delete(id);await this.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:this.points()});}
 async clear(){for(const id of [...this.active.keys()])await this.up(id);}
}
const samples:Sample[]=[];const shotNotices:number[]=[];const statuses=new Map<string,number>();
let hiddenWindow:{from:number;to:number}|undefined;
const browser=await chromium.launch({headless:true});
const contexts:BrowserContext[]=[];const errors:string[]=[];
const newContext=async(options:Parameters<typeof browser.newContext>[0],page?:(page:Page)=>Promise<void>)=>{const context=await browser.newContext(options);context.setDefaultTimeout(45000);contexts.push(context);const created=await context.newPage();created.on('pageerror',error=>errors.push(error.message));if(page)await page(created);return created;};
let report:Record<string,unknown>={date:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:base.href,seconds,room:room??null,impairment,hideMs};
try{
 let host:Page|undefined,url:URL;
 if(room){url=new URL(base);url.searchParams.set('room',room);}
 else{
  host=await newContext({viewport:{width:1280,height:720}},async page=>{await page.addInitScript(prelude(installDelay,{delay:impairment.downDelay,jitter:impairment.downJitter,seed:11}));});
  await host.goto(base.href);await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();await host.waitForURL(/room=/);
  url=new URL(host.url());url.searchParams.set('renderer','canvas');await host.goto(url.href);
  await host.getByPlaceholder('Your name').fill('Host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
  url=new URL(base);url.searchParams.set('room',new URL(host.url()).searchParams.get('room')!);
 }
 url.searchParams.set('benchmark','1');url.searchParams.set('renderer','canvas');
 const guestContext=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});guestContext.setDefaultTimeout(45000);contexts.push(guestContext);
 await guestContext.addInitScript(prelude(installDelay,{delay:impairment.upDelay,jitter:0,seed:7}));
 await guestContext.addInitScript(prelude(installGuestHooks,{}));
 const guest=await guestContext.newPage();guest.on('pageerror',error=>errors.push(error.message));
 await guest.exposeFunction('recordProbe',(sample:Sample)=>{samples.push(sample);});
 await guest.goto(url.href);await guest.getByPlaceholder('Your name').fill('Probe');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
 if(host){
  await host.locator(':is(.online-roster,.room-riders):visible').getByText('Probe',{exact:false}).waitFor();
  for(let i=0;i<2;i++)await host.getByRole('button',{name:'ADD AI',exact:true}).click();
  await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByLabel('Match length').fill('20');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
  await host.getByRole('button',{name:'START RACE',exact:true}).click();
 }else console.log(`Guest "Probe" joined room ${room}; start the race from the host within 5 minutes.`);
 await guest.locator('.mobile-play').waitFor({state:'visible',timeout:room?300000:45000});
 const latest=()=>samples.filter((sample):sample is SnapshotSample=>sample.kind==='snapshot').at(-1);
 while(latest()?.phase!=='playing')await sleep(50);
 const buttons=await guest.locator('.online-controls button').all();assert.equal(buttons.length,3);
 const centers=await Promise.all(buttons.map(async button=>{const box=await button.boundingBox();assert.ok(box);return {x:box.x+box.width/2,y:box.y+box.height/2};}));
 const [left,fire,right]=centers as [typeof centers[0],typeof centers[0],typeof centers[0]];
 const touch=new Touch(await guestContext.newCDPSession(guest));
 const startedAt=Date.now();let cycles=0,restarts=0;
 const poll=setInterval(()=>{void guest.evaluate(()=>({shot:!document.querySelector<HTMLElement>('.online-shot-error')?.hidden,status:document.querySelector('.online-header>span')?.textContent??''})).then(({shot,status})=>{if(shot&&(shotNotices.at(-1)===undefined||Date.now()-shotNotices.at(-1)!>3000))shotNotices.push(Date.now());statuses.set(status,(statuses.get(status)??0)+1);}).catch(()=>{});},100);
 try{
  while(Date.now()-startedAt<seconds*1000){
   const elapsed=Date.now()-startedAt;
   if(host&&(await host.locator('.online-notice').textContent())?.includes('MATCH COMPLETE')){await touch.clear();await host.keyboard.press('Escape');await host.getByRole('button',{name:'MAIN MENU',exact:true}).click();await host.getByText('Join your friends, then start the race',{exact:true}).waitFor();await host.getByRole('button',{name:'START RACE',exact:true}).click();restarts++;}
   if(hideMs&&!hiddenWindow&&elapsed>seconds*500){
    await touch.clear();hiddenWindow={from:await guest.evaluate(()=>performance.now()),to:0};
    const cdp=await guestContext.newCDPSession(guest);
    await guest.evaluate(()=>Reflect.get(window,'__probeSetHidden')(true));
    try{await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await sleep(hideMs);await cdp.send('Page.setWebLifecycleState',{state:'active'});}catch{await sleep(hideMs);}
    await guest.evaluate(()=>Reflect.get(window,'__probeSetHidden')(false));hiddenWindow.to=await guest.evaluate(()=>performance.now());await cdp.detach();
   }
   // Phone-like cadence: steer holds, a fire tap while steering, then a charge-and-release.
   await touch.down(0,left.x,left.y);await sleep(500);await touch.up(0);await sleep(150);
   await touch.down(1,right.x,right.y);await sleep(150);await touch.down(2,fire.x,fire.y);await sleep(350);await touch.up(2);await sleep(100);await touch.up(1);await sleep(200);
   await touch.down(3,fire.x,fire.y);await sleep(300);await touch.up(3);await sleep(300);
   cycles++;
  }
 }finally{clearInterval(poll);await touch.clear();}
 await sleep(2500);
 const inputs=samples.filter((sample):sample is InputSample=>sample.kind==='input'),snapshots=samples.filter((sample):sample is SnapshotSample=>sample.kind==='snapshot');
 const results=new Map<number,{status:string;appliedTick?:number;at:number}>();
 for(const snapshot of snapshots)for(const result of snapshot.motionResults??[])if(!results.has(result.seq))results.set(result.seq,{...result,at:snapshot.at});
 const phaseAt=(at:number)=>snapshots.filter(snapshot=>snapshot.at<=at).at(-1)?.phase??'none';
 const reason=(input:InputSample)=>input.baseTick===undefined?'no-base':!input.estimate?'no-estimate':input.estimate.upper-input.estimate.lower>4?'uncertain-clock':Math.floor(input.estimate.tick)+1>input.baseTick+4?'ahead-of-snapshot':'other';
 const classify=(input:InputSample)=>{if(!input.scheduled)return `local-rejected:${reason(input)}`;if(!input.sent)return 'send-failed';const result=results.get(input.seq);return result?`host-${result.status}`:'sent-unreported';};
 const bucket=(list:InputSample[])=>{const counts:Record<string,number>={};for(const input of list){const key=classify(input);counts[key]=(counts[key]??0)+1;}return counts;};
 const playing=inputs.filter(input=>phaseAt(input.at)==='playing'&&!(hiddenWindow&&input.at>=hiddenWindow.from&&input.at<=hiddenWindow.to+500));
 const fireEdges=playing.filter(input=>input.bombAction==='press'||input.bombAction==='release');
 const summary={cycles,restarts,inputs:inputs.length,playingInputs:playing.length,playing:bucket(playing),fireEdges:fireEdges.length,fire:bucket(fireEdges),afterHidden:hiddenWindow?{phase:phaseAt(hiddenWindow.to),...bucket(inputs.filter(input=>input.at>hiddenWindow!.to&&input.at<=hiddenWindow!.to+3000&&phaseAt(input.at)==='playing'))}:null,otherPhases:bucket(inputs.filter(input=>!playing.includes(input))),shotNotices:shotNotices.length,statuses:Object.fromEntries(statuses),errors};
 const localRejected=Object.entries(summary.playing).filter(([key])=>key.startsWith('local-rejected')).reduce((sum,[,count])=>sum+count,0);
 const localRejectPercent=playing.length?100*localRejected/playing.length:0;
 const quantiles=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)]??0,p95:sorted[Math.floor((sorted.length-1)*.95)]??0,max:sorted.at(-1)??0};};
 const appliedReportMs=quantiles(playing.flatMap(input=>{const result=results.get(input.seq);return result?.status==='applied'?[result.at-input.at]:[];}));
 report={...report,summary,localRejectPercent,appliedReportMs,hiddenWindow,samplesRetained:samples.length};
 console.log(JSON.stringify({...summary,localRejectPercent:Number(localRejectPercent.toFixed(2)),appliedReportMs},null,1));
 assert.equal(errors.length,0,'Browser errors');
 assert.ok(playing.length>=100,'Probe needs at least 100 playing-phase inputs');
 assert.ok(localRejectPercent<=maxLocalRejectPercent,`Local rejection ${localRejectPercent.toFixed(1)}% exceeds ${maxLocalRejectPercent}% while connected`);
 report.passed=true;
}catch(error){report.failure=error instanceof Error?error.message:String(error);throw error;}
finally{await mkdir('artifacts',{recursive:true});await writeFile('artifacts/input-drop-probe.json',JSON.stringify({...report,samples:samples.slice(-6000)},null,1)+'\n');await Promise.all(contexts.map(context=>context.close()));await browser.close();}
