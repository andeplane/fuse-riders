import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

interface Profile { name:string; delay:number; jitter:number; loss:number; reorder:number; kbps:number; outageMs:number }
const profiles:Profile[]=[
  {name:'direct',delay:0,jitter:0,loss:0,reorder:0,kbps:10000,outageMs:0},
  {name:'regional',delay:40,jitter:10,loss:.01,reorder:.01,kbps:2000,outageMs:0},
  {name:'poor-asymmetric',delay:75,jitter:30,loss:.03,reorder:.05,kbps:500,outageMs:3000},
];
interface Injection {
  attempted:number; delivered:number; dropped:number; expired:number; reordered:number; bytes:number; queueBytes:number; maxQueueBytes:number; relayAttempts:number; blockedUntil:number;
  windows:Record<string,number>; active:boolean; frameMs:number[]; events:unknown[]; eventsTruncated:number;
}
declare global { interface Window { __networkBench: Injection } }
/** Application-message impairment before the real SCTP send, deliberately NOT IP shaping. */
function installImpairment({profile,seed,host}:{profile:Profile;seed:number;host:boolean}) {
  const state:Injection={attempted:0,delivered:0,dropped:0,expired:0,reordered:0,bytes:0,queueBytes:0,maxQueueBytes:0,relayAttempts:0,blockedUntil:0,windows:{},active:false,frameMs:[],events:[],eventsTruncated:0};
  Object.assign(window,{__networkBench:state});
  window.addEventListener('fuse-benchmark',event=>{if(!state.active)return;const detail=(event as CustomEvent<unknown>).detail;if(state.events.length>=20000){state.eventsTruncated++;return;}state.events.push(detail);});
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let bandwidthAt=0;
  const original=RTCDataChannel.prototype.send;
  const maxQueue=256*1024,maxAge=800;
  RTCDataChannel.prototype.send=function(data:string|Blob|ArrayBuffer|ArrayBufferView<ArrayBuffer>) {
    if(!state.active){Reflect.apply(original,this,[data]);return;}
    const now=performance.now();state.attempted++;
    // The current wire is JSON strings. Refuse to silently mismeasure a changed binary protocol.
    if(typeof data!=='string')throw new Error('Benchmark only supports current JSON RTC wire');
    const bytes=new TextEncoder().encode(data).byteLength;
    if(now<state.blockedUntil||random()<profile.loss||state.queueBytes+bytes>maxQueue){state.dropped++;return;}
    const extra=random()<profile.reorder?150:0;if(extra)state.reordered++;
    // One sender budget shared by all host edges; host has higher egress than each guest.
    const kbps=profile.kbps*(host?4:1);
    bandwidthAt=Math.max(now,bandwidthAt)+bytes*8/kbps;
    const due=bandwidthAt+Math.max(0,profile.delay+(random()*2-1)*profile.jitter)+extra;
    state.queueBytes+=bytes;state.maxQueueBytes=Math.max(state.maxQueueBytes,state.queueBytes);
    const channel=this;
    setTimeout(()=>{
      state.queueBytes-=bytes;
      if(performance.now()-now>maxAge||performance.now()<state.blockedUntil||channel.readyState!=='open'){state.expired++;return;}
      Reflect.apply(original,channel,[data]);state.delivered++;state.bytes+=bytes;
      const second=Math.floor(performance.now()/1000);state.windows[second]=(state.windows[second]??0)+bytes;
      const keys=Object.keys(state.windows);if(keys.length>3600)delete state.windows[keys[0]!];
    },Math.max(0,due-now));
  };
  const wsSend=WebSocket.prototype.send;
  WebSocket.prototype.send=function(data){
    if(typeof data==='string'){try{if(JSON.parse(data).type==='relay')state.relayAttempts++;}catch{}}
    return wsSend.call(this,data);
  };
  let previous=performance.now();function frame(){const now=performance.now();if(state.active){state.frameMs.push(now-previous);if(state.frameMs.length>120000)state.frameMs.shift();}previous=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
const baseUrl=new URL(process.env.ONLINE_URL??'http://localhost:8787/');baseUrl.searchParams.set('benchmark','1');const base=baseUrl.href;
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// An isolated local fixture is the default; never silently automate an occupied public match.
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)&&process.env.BENCH_ALLOW_REMOTE!=='1')throw new Error('Remote benchmark requires BENCH_ALLOW_REMOTE=1 and an isolated authorized fixture');
const html=await(await fetch(base)).text();
const entryAssets=await Promise.all([...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(async match=>{const asset=new URL(match[1]!,base);return {path:asset.pathname,sha256:createHash('sha256').update(Buffer.from(await(await fetch(asset)).arrayBuffer())).digest('hex')};}));
const duration=Number(process.env.BENCH_SECONDS??30);
assert.ok(Number.isFinite(duration)&&duration>=10&&duration<=1800);
const selected=profiles.filter(p=>!process.env.BENCH_PROFILE||p.name===process.env.BENCH_PROFILE);assert.ok(selected.length,'Unknown profile');
const results:unknown[]=[];
const browser=await chromium.launch({headless:true});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const quantiles=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)]??0,p95:sorted[Math.floor((sorted.length-1)*.95)]??0,p99:sorted[Math.floor((sorted.length-1)*.99)]??0,max:sorted.at(-1)??0};};
function inspectApplicationEvents(events:unknown[]) {
  const ticks=new Map<string,number>();let snapshots=0,regressions=0;
  const corrections:number[]=[];
  for(const event of events){
    if(!event||typeof event!=='object')continue;
    const sample=event as Record<string,unknown>;
    if(sample.kind!=='snapshot'||typeof sample.authorityScope!=='string'||typeof sample.tick!=='number')continue;
    snapshots++;const previous=ticks.get(sample.authorityScope);
    if(previous!==undefined&&sample.tick<previous)regressions++;
    ticks.set(sample.authorityScope,sample.tick);
    if(typeof sample.correction==='number')corrections.push(sample.correction);
  }
  return {snapshots,acceptedTickRegressions:regressions,correctionSamples:quantiles(corrections)};
}
let failed:unknown;
try {
  for(const profile of selected){
    console.log(`Starting ${profile.name}`);
    const contexts:BrowserContext[]=[],pages:Page[]=[],errors:string[]=[];
    const samples:unknown[]=[];let result:Record<string,unknown>={profile,seed:12345,samples};results.push(result);
    try{
      for(let i=0;i<6;i++){
        const context=await browser.newContext({viewport:i===5?{width:1280,height:720}:{width:844,height:390},isMobile:i!==5,hasTouch:i!==5});context.setDefaultTimeout(45000);contexts.push(context);
        await context.addInitScript({content:`(() => { const __name = (fn) => fn; (${installImpairment.toString()})(${JSON.stringify({profile,seed:12345+i,host:i===0})}); })();`});
        const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
      }
      const host=pages[0]!;await host.goto(base);await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();await host.waitForURL(/room=/);const hostBenchmarkUrl=new URL(host.url());hostBenchmarkUrl.searchParams.set('benchmark','1');await host.goto(hostBenchmarkUrl.href);
      // Build invite from room code only; never copy creator capability query parameters.
      const invite=new URL(base);invite.searchParams.set('room',new URL(host.url()).searchParams.get('room')!);
      for(let i=0;i<5;i++){
        const page=pages[i]!;if(i)await page.goto(invite.href);
        await page.getByPlaceholder('Your name').fill(`Bench ${i}`);await page.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();
        await host.locator('.online-roster').getByText(`Bench ${i}`,{exact:false}).waitFor();
      }
      invite.searchParams.set('display','1');await pages[5]!.goto(invite.href);await pages[5]!.locator('.online-roster').getByText('Bench 0',{exact:false}).waitFor();
      await host.getByRole('button',{name:'ROOM SETTINGS',exact:true}).click();await host.getByLabel('Match length').fill('20');await host.getByRole('button',{name:'SAVE SETTINGS',exact:true}).click();
      await Promise.all(pages.map(page=>page.evaluate(()=>{const state=window.__networkBench;state.active=true;})));
      await host.getByRole('button',{name:'START RACE',exact:true}).click();console.log(`${profile.name}: six contexts ready, impairment active`);
      const started=Date.now();let outage=false;
      while(Date.now()-started<duration*1000){
        const elapsed=Date.now()-started;
        if(profile.outageMs&&!outage&&elapsed>duration*500){outage=true;await pages[1]!.evaluate(ms=>{const state=window.__networkBench;state.blockedUntil=performance.now()+ms;},profile.outageMs);}
        // Real pointer changes on all five controllers. These are workload, not an AI survival guarantee.
        await Promise.all(pages.slice(0,5).map(async(page,i)=>{
          const control=page.getByRole('button',{name:(Math.floor(elapsed/1000)+i)%3===0?'HOLD TO FIRE':i%2?'◀':'▶',exact:true});
          if(await control.isVisible()){const bounds=await control.boundingBox();if(bounds){await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();}}
        }));
        await delay(160);await Promise.all(pages.slice(0,5).map(page=>page.mouse.up()));
        const peers=await Promise.all(pages.map(page=>page.evaluate(()=>({at:performance.now(),metrics:document.querySelector<HTMLElement>('#app')?.dataset.metrics,status:document.querySelector('.online-header span')?.textContent,notice:document.querySelector('.online-notice')?.textContent,queueBytes:window.__networkBench.queueBytes}))));
        samples.push({elapsed,peers});await delay(340);
      }
      const injection=await Promise.all(pages.map(page=>page.evaluate(()=>window.__networkBench)));
      result={...result,injection,frameDistributions:injection.map(s=>quantiles(s.frameMs)),errors};results[results.length-1]=result;
      assert.equal(errors.length,0,'Browser error');assert.ok(injection.slice(0,5).every(s=>s.attempted>0),'Every controller must exercise RTC');assert.ok(injection.every(s=>s.relayAttempts===0),'Gameplay WSS relay attempted');assert.ok(injection.every(s=>s.maxQueueBytes<=256*1024),'Injection queue exceeded bound');
      const finalMetrics=await Promise.all(pages.map(page=>page.evaluate(()=>JSON.parse(document.querySelector<HTMLElement>('#app')?.dataset.metrics??'{}') as {direct?:number})));
      result.finalMetrics=finalMetrics;assert.ok(finalMetrics.slice(1).every(m=>(m.direct??0)>=1),'Every guest and TV must regain a healthy direct link by end of run');
      result.applicationDiagnostics=injection.map(s=>({...inspectApplicationEvents(s.events),truncated:s.eventsTruncated}));
      assert.ok(injection.every(s=>inspectApplicationEvents(s.events).snapshots>0),'Hook-enabled build required: no accepted snapshot diagnostics');
      assert.ok(injection.every(s=>inspectApplicationEvents(s.events).acceptedTickRegressions===0),'Accepted snapshot tick regressed within scope');
      result.passed=true;
    }catch(error){result.failure=error instanceof Error?error.message:String(error);throw error;}
    finally{await Promise.all(contexts.map(context=>context.close()));}
  }
}catch(error){failed=error;}finally{await browser.close();}
await mkdir('artifacts',{recursive:true});
const report={date:new Date().toISOString(),revision:sourceRevision,entryAssets,durationSeconds:duration,method:'Six isolated Chromium contexts: five human-controller workloads plus display; real RTC with seeded application-message send impairment. Not OS wire shaping, packet-loss emulation, physical devices, or certification. Setup is unimpaired. Reliable ordered SCTP messages are deliberately dropped/reordered BEFORE SCTP, exercising application boundaries rather than reproducing TCP/SCTP loss recovery.',limits:['Frame samples are headless desktop animation frames, not phone GPU acceptance.','JSON payload bytes exclude SCTP/DTLS/IP overhead.','UI ack/correction values are sampled latest values, not event distributions.','Accepted snapshot diagnostics check monotonic tick per authority scope; shot identities and host action application are not exposed, so no claim of zero duplicate shots or complete outcome consistency.','Controls may die before the run ends; this is not yet a sustained five-active-rider soak.'],results};
await writeFile('artifacts/online-network-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:'artifacts/online-network-benchmark.json',profiles:results.length,passed:!failed}));if(failed)throw failed;
