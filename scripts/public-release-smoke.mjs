import { chromium, webkit } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const root=new URL('../artifacts/',import.meta.url).pathname;await mkdir(root,{recursive:true});const results=[];
for(const [name,type] of [['chrome',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true});const errors=[];const requests=[];const result={browser:name};
 try{
 const hostContext=await browser.newContext({viewport:{width:1440,height:1000}}),guestContext=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const host=await hostContext.newPage(),guest=await guestContext.newPage();
 for(const page of [host,guest]){page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('response',r=>{if(r.status()>=400)requests.push({status:r.status(),path:new URL(r.url()).pathname});});}
 const release=await hostContext.request.get('https://andeplane.github.io/fuse-riders/release.json');result.release=await release.json();
 await host.goto('https://andeplane.github.io/fuse-riders/');await host.getByRole('button',{name:'CREATE ROOM',exact:true}).click();await host.waitForURL(/room=/);const invite=host.url();result.created=true;
 await host.getByPlaceholder('Your name').fill('Public host');await host.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator('.online-roster').getByText('Public host',{exact:false}).waitFor();
 await host.getByRole('button',{name:'ADD AI',exact:true}).click();await host.getByRole('button',{name:/Remove AI/}).waitFor();result.aiAdded=true;
 await guest.goto(invite);await guest.getByPlaceholder('Your name').fill('Public guest');await guest.getByRole('button',{name:'JOIN AS PLAYER',exact:true}).click();await host.locator('.online-roster').getByText('Public guest',{exact:false}).waitFor();result.guestJoined=true;
 await host.getByRole('button',{name:'START RACE',exact:true}).click();await guest.locator('.online-notice').filter({hasText:/READY/}).waitFor();result.countdownReceived=true;
 await host.waitForFunction(()=>JSON.parse(document.querySelector('#app')?.dataset.metrics??'{}').tick>65);await host.waitForFunction(()=>document.querySelector('canvas')?.dataset.renderer==='phaser-webgl');
 result.metrics=await guest.locator('#app').getAttribute('data-metrics');result.renderer=await host.locator('canvas').getAttribute('data-renderer');await host.screenshot({path:`${root}/public-phaser-${name}.png`});result.screenshot=`artifacts/public-phaser-${name}.png`;
 await host.locator('.online-roster').getByText(/ · [1-9] wins/).first().waitFor({timeout:25000});result.scoring=true;
 result.pass=true;
 }catch(e){result.pass=false;result.error=String(e);for(const [i,context] of browser.contexts().entries())for(const page of context.pages()){result[`body${i}`]=await page.locator('body').innerText().catch(()=>'<closed>');await page.screenshot({path:`${root}/public-failure-${name}-${i}.png`}).catch(()=>{});}}
 finally{result.errors=errors;result.failedRequests=requests;await browser.close();results.push(result);await writeFile(`${root}/public-acceptance.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(result));}
}
