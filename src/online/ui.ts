import { startAttract } from './attract.js';
import { LocalRuntime } from './local-runtime.js';
import type { Callbacks } from './runtime.js';
import { installRoomLifecycle } from './room-lifecycle.js';
import { isShotTransition, ShotFailureNotice } from './shot-failure.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import { mountArenaPresentation } from '../client/phaser/presentation.js';
import { apiUrl, appUrl } from './endpoints.js';
import { ControllerInputState } from '../client/controller-state.js';
import { ControllerPointerBindings } from '../client/controller-pointers.js';
import { LocalPrediction, RemoteWorldBuffer } from './prediction.js';
import { drawArena } from '../client/main.js';
import { createAvatarPicker } from '../client/avatar-heads.js';
import { defaultTheme, loadThemeSprites } from '../client/themes.js';
import { createGameAudio } from '../client/game-audio.js';
import { defaultRoomSettings, loadRoomSettings, SETTINGS_KEY, type RoomSettings } from '../shared/room-settings.js';
import type { PickupType } from '../shared/game.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { RoomRuntime } from './runtime.js';
import type { AvatarId } from '../shared/avatars.js';
import QRCode from 'qrcode';
import './online.css';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const e=document.createElement(tag);e.textContent=text;e.className=className;return e;};
const labels:Record<string,string>={blast:'Blast radius',triple:'Triple shot',five:'Five shot',gun:'Cannon',shell:'Shell',target:'Target bomb',beer:'Beer',ink:'Ink',stopwatch:'Stopwatch',orbitShield:'Shield',portal:'Portal',star:'Star'};
const read=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
const save=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
const secret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
export async function startOnline():Promise<void>{
  const app=document.querySelector<HTMLElement>('#app')!;app.className='online-app';
  const url=new URL(location.href);const solo=url.searchParams.get('solo')==='1';const code=solo?'SOLO':url.searchParams.get('room')?.toUpperCase();
  if(!code){
    app.classList.add('landing-app');
    const card=node('main','','landing');
    card.innerHTML=`<canvas class="landing-arena" aria-hidden="true"></canvas><div class="landing-shade"></div>
      <header class="landing-top"><a class="landing-brand" href="${appUrl()}">FUSE<span>RIDERS</span></a><span class="landing-tag">TINY RIDERS. BIG TROUBLE.</span></header>
      <section class="landing-content"><p class="landing-eyebrow"><span></span> A NEON ARENA PARTY GAME</p>
      <h1>LEAVE A TRAIL.<br>MAKE A <em>MESS.</em></h1>
      <p class="landing-intro">Outrun your friends. Blow up their plans.<br>One arena. Five riders. Absolutely no brakes.</p>
      <a class="solo-cta" href="${appUrl('?solo=1')}"><span>▶ &nbsp; PLAY SOLO</span><small>YOU VS. FOUR AI RIVALS</small></a>
      <div class="landing-multiplayer"><p class="landing-section-label">OR BRING YOUR FRIENDS</p></div>
      <p class="landing-hint">Phones are your controllers. A TV can be your arena.<br>On the same Wi-Fi? Even better.</p></section>
      <aside class="landing-live"><span class="live-dot"></span> LIVE AI FREE-FOR-ALL <small>Real riders. Real explosions.</small></aside>
      <footer class="landing-footer"><span>STEER. CHARGE. RELEASE. SURVIVE.</span><button class="attract-toggle" type="button">Ⅱ PAUSE BACKGROUND</button></footer>`;
    const form=card.querySelector<HTMLElement>('.landing-multiplayer')!;
    const mode=node('select');for(const [value,label] of [['devices','Everyone plays on their device'],['shared','We share a TV / big screen']]){const option=node('option',label);option.value=value!;mode.append(option);}mode.value=loadRoomSettings(localStorage).mode;
    const create=node('button','CREATE ROOM'),join=node('button','JOIN ROOM'),input=node('input');input.placeholder='Room code';input.maxLength=10;input.autocapitalize='characters';
    const error=node('p');
    create.onclick=async()=>{create.disabled=true;try{const response=await fetch(apiUrl('/api/rooms'),{method:'POST'});const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not create room');save(`fuse-room-${body.code}`,body.token);const settings=loadRoomSettings(localStorage);settings.mode=mode.value as RoomSettings['mode'];save(SETTINGS_KEY,JSON.stringify(settings));location.href=appUrl(`?room=${body.code}`);}catch(e){error.textContent=String(e);create.disabled=false;}};
    join.onclick=()=>{const value=input.value.trim().toUpperCase();if(/^[A-Z0-9]{10}$/.test(value))location.href=appUrl(`?room=${value}`);else error.textContent='Enter the 10-character room code';};
    mode.setAttribute('aria-label','Where will you play?');input.setAttribute('aria-label','Room code');error.setAttribute('role','alert');
    const createRow=node('div','','landing-create');createRow.append(mode,create);
    const joinRow=node('div','','landing-join');joinRow.append(input,join);input.onkeydown=event=>{if(event.key==='Enter')join.click();};
    form.append(createRow,joinRow,error);app.replaceChildren(card);
    let cleanup:(()=>void)|undefined,ended=false;
    window.addEventListener('pagehide',()=>{ended=true;cleanup?.();},{once:true});
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
    void startAttract(card.querySelector('canvas')!,card.querySelector('.attract-toggle')!).then(stop=>{if(ended)stop();else cleanup=stop;}).catch(()=>{card.querySelector('.landing-live')?.remove();});return;
  }
  if(!solo&&!/^[A-Z0-9]{10}$/.test(code)){app.textContent='Invalid room code';return;}
  const identityKey=`fuse-room-${code}`;const token=solo?'':displayOnlyToken();
  function displayOnlyToken(){if(url.searchParams.has('display'))return secret();const token=read(identityKey)??secret();save(identityKey,token);return token;}
  let id='',isHost=false,joined=false,avatar:AvatarId|undefined,settings=loadRoomSettings(localStorage),snapshot:ViewSnapshot|undefined;
  const prediction=new LocalPrediction(()=>performance.now());const frameTimes:number[]=[];const inputTimes:number[]=[];let previousFrame=performance.now(),inputAt=0;const worldBuffer=new RemoteWorldBuffer();
  let seq=0,lastRecap='';
  const responseBenchmark=url.searchParams.get('responseBenchmark')==='1';
  const benchmark=url.searchParams.get('benchmark')==='1'||responseBenchmark;let benchmarkInput:{seq:number;at:number}|undefined,lastBenchmarkRender=0,lastControls='';
  const sample=(detail:object)=>{if(benchmark)window.dispatchEvent(new CustomEvent('fuse-benchmark',{detail}));};
  const displayOnly=!solo&&url.searchParams.has('display');
  const header=node('header','','online-header');const title=node('strong',solo?'FUSE RIDERS · SOLO':`FUSE RIDERS · ${code}`),status=node('span','Connecting…'),audioButton=node('button','♫ AUDIO'),menu=node('button','MENU');
  header.append(title,status,audioButton,menu);
  let canvas=node('canvas','','online-arena');let renderScope=code;const presentation=mountArenaPresentation(canvas,drawArena,replacement=>{canvas=replacement;});const sprites=await loadThemeSprites(defaultTheme);
  const notice=node('div','','online-notice');
  const joinPanel=node('form','','online-join');const name=node('input');name.placeholder='Your name';name.maxLength=20;const previousName=read('fuse-riders-player-name');name.value=previousName??'';
  const joinButton=node('button','JOIN AS PLAYER');joinPanel.append(name,joinButton);joinButton.disabled=true;
  const controls=node('div','','online-controls');const leftButton=node('button','◀'),fireButton=node('button','HOLD TO FIRE'),rightButton=node('button','▶');controls.append(leftButton,fireButton,rightButton);
  for(const [button,key,label] of [[leftButton,'ArrowLeft','Steer left'],[fireButton,'Space','Hold to charge, release to fire'],[rightButton,'ArrowRight','Steer right']] as const){button.setAttribute('aria-keyshortcuts',key);button.title=`${label} (${key})`;}
  const roster=node('div','','online-roster');const hostControls=node('div','','online-host');const start=node('button','START RACE'),reset=node('button','MAIN MENU'),settingsButton=node('button','ROOM SETTINGS'),share=node('button','INVITE / TV'),addAI=node('button','ADD AI');hostControls.append(start,reset,settingsButton,share,addAI);
  const rosterEntries=new Map<string,{entry:HTMLElement;label:HTMLElement;remove:HTMLButtonElement}>();
  const avatarButton=node('button','HEAD'),fullscreen=node('button','⛶');fullscreen.setAttribute('aria-label','Fullscreen');fullscreen.onclick=()=>void document.documentElement.requestFullscreen?.();header.append(avatarButton,fullscreen);
  const dialog=node('dialog','','game-dialog');dialog.setAttribute('aria-label','Game menu');const close=node('button','✕  CLOSE');close.type='button';close.setAttribute('aria-label','CLOSE');close.onclick=()=>dialog.close();const dialogBar=node('header','','dialog-bar');dialogBar.append(node('strong','GAME MENU'),close);const dialogBody=node('div','','dialog-body');dialog.append(dialogBar,dialogBody);dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  const shotNotice=node('p','','online-shot-error');shotNotice.setAttribute('role','alert');shotNotice.hidden=true;const shotFailure=new ShotFailureNotice(()=>performance.now());const updateShotNotice=()=>{const message=shotFailure.message();shotNotice.hidden=!message;if(message&&shotNotice.textContent!==message)shotNotice.textContent=message;};
  const scoreboard=node('div','','online-scoreboard');scoreboard.append(notice,roster);
  const footer=node('footer','','online-footer');footer.append(controls,hostControls);
  app.replaceChildren(header,canvas,scoreboard,shotNotice,joinPanel,footer,dialog);
  const audio=createGameAudio();audioButton.onclick=()=>{audio.unlock();audio.controls.setAttribute('open','');dialogBody.replaceChildren(node('h2','Music & sound'),audio.controls);dialog.showModal();};
  const callbacks:Callbacks={
    ready:(peerId,host)=>{id=peerId;isHost=host;joinButton.disabled=false;hostControls.hidden=!host;if((joined||previousName)&&!displayOnly)runtime.command({type:'join',name:name.value,avatarId:avatar});},
    shotFailed:()=>{shotFailure.show();updateShotNotice();},
    status:text=>{status.textContent=text;},
    event:(event,matchId,round,tick)=>audio.director.message({type:'event',matchId,round,tick,event}),
    clock:clockSample=>{const accepted=prediction.observeClock(clockSample);if(responseBenchmark)sample({kind:'response-clock',epochAt:performance.timeOrigin+performance.now(),accepted,sample:clockSample,diagnostics:prediction.clock.diagnostics()});},
    state:(state,rules,ack,matchId,motion)=>{
      if(snapshot&&snapshot.phase!==state.phase)bindings.clear(true,true);
      snapshot=state;const nextRenderScope=`${runtime.transport.grant?.incarnation}:${runtime.transport.grant?.epoch}:${matchId}:${state.round}`;if(nextRenderScope!==renderScope)prediction.resetExternalScope();renderScope=nextRenderScope;settings=rules;if(ack>=seq){seq=ack+1;inputState.setNextSequence(seq);}prediction.accept(state,id,ack,motion,renderScope);
      worldBuffer.push(state,renderScope);
      sample({kind:'snapshot',at:performance.now(),presentationDelayTicks:prediction.clock.presentationDelayTicks(),authorityScope:renderScope,matchId,round:state.round,tick:state.tick,phase:state.phase,playerId:id,players:state.players.map(p=>({id:p.id,alive:p.alive,x:p.x,y:p.y})),leaderboard:state.leaderboard,motionResults:motion?.results,correction:prediction.correction,ackMs:prediction.ackMs});
      audio.director.message({type:'snapshot',matchId,round:state.round,tick:state.tick,state});
      const player=state.players.find(player=>player.id===id);
      if(state.phase==='matchOver'&&state.tick>=(state.phaseEndsAtTick??0)&&lastRecap!==String(state.phaseEndsAtTick)){
        lastRecap=String(state.phaseEndsAtTick);dialogBody.replaceChildren(node('h2','Match statistics'));
        for(const stats of state.matchStats){const row=node('section');row.append(node('h3',stats.name));for(const [key,value] of Object.entries(stats)){if(typeof value==='number')row.append(node('p',`${key.replace(/([A-Z])/g,' $1')}: ${Number.isInteger(value)?value:value.toFixed(1)}`));}dialogBody.append(row);}dialog.showModal();
      }
      if(state.phase==='lobby')lastRecap='';joined=Boolean(player);joinPanel.hidden=joined||displayOnly;controls.hidden=!joined||displayOnly;
      canvas.hidden=settings.mode==='shared'&&!displayOnly&&joined;
      inputState.configureTargetAim(player?.targetBombArmed&&!player.gunArmed&&!player.shellArmed?{x:player.x/state.width,y:player.y/state.height}:undefined);
      if(player){app.style.setProperty('--player-color',player.color);const remaining=Math.max(0,player.bombReadyAtTick-state.tick);fireButton.textContent=remaining?`${Math.ceil(remaining/20)}s RECHARGE`:player.targetBombArmed?'SLIDE TO AIM':player.gunArmed?'FIRE CANNON':player.shellArmed?'FIRE SHELL':inputState.isHeld('bomb')?'RELEASE!':'HOLD TO FIRE';}
      notice.textContent=state.phase==='lobby'?'Join your friends, then start the race':state.phase==='countdown'?`READY · ${Math.max(0,Math.ceil(((state.phaseEndsAtTick??state.tick)-state.tick)/20))}`:state.phase==='roundOver'?`${state.players.find(p=>p.id===state.roundWinnerId)?.name??'Nobody'} wins this round`:state.phase==='matchOver'?`${state.players.find(p=>p.id===state.matchWinnerId)?.name??'Tie'} · MATCH COMPLETE`:player?.waitingForNextRound?'You’re in — joining next round':!player?.alive&&joined?'Eliminated — next round soon':'';
      for(const [playerId,row] of rosterEntries)if(!state.players.some(p=>p.id===playerId)){row.entry.remove();rosterEntries.delete(playerId);}
      for(const p of state.players){
        let row=rosterEntries.get(p.id);
        if(!row){const entry=node('span'),label=node('span'),remove=node('button','×');entry.append(label,remove);remove.onclick=()=>runtime.command({type:'bot',action:'remove',id:p.id});row={entry,label,remove};rosterEntries.set(p.id,row);roster.append(entry);}
        const label=`${p.name} · ${p.roundWins} wins${p.waitingForNextRound?' · next round':p.connected?'':' · offline'}`;if(row.label.textContent!==label)row.label.textContent=label;row.entry.style.color=p.color;
        row.remove.hidden=!isHost||!p.id.startsWith(BOT_ID_PREFIX);row.remove.disabled=!['lobby','roundOver','matchOver'].includes(state.phase);row.remove.setAttribute('aria-label',`Remove ${p.name}`);row.remove.title=row.remove.disabled?'Remove AI between rounds or return to menu':'Remove AI rider';
      }
      addAI.disabled=state.players.length>=5;
      const startLabel=state.phase==='matchOver'?'REMATCH':'START RACE';if(start.textContent!==startLabel)start.textContent=startLabel;start.disabled=state.players.filter(p=>p.connected).length<2||!['lobby','matchOver'].includes(state.phase);
      hostControls.hidden=!isHost;reset.disabled=state.phase==='lobby';
    }
  };
  const runtime=solo?new LocalRuntime(settings,callbacks):new RoomRuntime(code,token,settings,callbacks);
  if(solo){share.hidden=true;joinButton.textContent='PLAY SOLO';}
  joinPanel.onsubmit=event=>{event.preventDefault();save('fuse-riders-player-name',name.value);runtime.command({type:'join',name:name.value,avatarId:avatar});};
  start.onclick=()=>{void audio.unlock();runtime.command({type:'action',action:snapshot?.phase==='matchOver'?'rematch':'start'});};
  addAI.onclick=()=>runtime.command({type:'bot',action:'add'});
  reset.onclick=()=>runtime.command({type:'action',action:'lobby'});menu.onclick=()=>{dialogBody.replaceChildren(node('p','Leave this room?'));const leave=node('button','LEAVE ROOM');leave.onclick=()=>{runtime.stop();location.href=appUrl();};dialogBody.append(leave);dialog.showModal();};
  avatarButton.onclick=()=>{dialogBody.replaceChildren(node('h2','Choose your head'));const picker=createAvatarPicker(localStorage,chosen=>{avatar=chosen;if(joined)runtime.command({type:'avatar',avatarId:chosen});dialog.close();});dialogBody.append(picker.element);dialog.showModal();};
  share.onclick=async()=>{const link=new URL(appUrl(`?room=${code}`),location.origin).href;dialogBody.replaceChildren(node('h2',`Room ${code}`),node('p',link));const qr=node('img');qr.src=await QRCode.toDataURL(link);qr.alt='Scan to join';dialogBody.append(qr);const tv=node('a','OPEN TV VIEW');tv.href=appUrl(`?room=${code}&display=1`);tv.target='_blank';dialogBody.append(tv);dialog.showModal();};
  settingsButton.onclick=()=>{
    const draft=structuredClone(settings);dialogBody.replaceChildren(node('h2','Room settings'));
    const mode=node('select');for(const [value,label] of [['devices','Full game on each device'],['shared','Shared TV + phone controls']]){const option=node('option',label);option.value=value!;mode.append(option);}mode.value=draft.mode;mode.disabled=solo;mode.setAttribute('aria-label','Screen layout');
    const format=node('select');for(const [value,label] of [['wins','First to N wins'],['rounds','Play N rounds']]){const option=node('option',label);option.value=value!;format.append(option);}format.value=draft.match;format.setAttribute('aria-label','Match format');
    const length=node('input');length.type='number';length.min='1';length.max='20';length.value=String(draft.length);length.setAttribute('aria-label','Match length');dialogBody.append(mode,format,length,node('p','Powerup weights: 0 disables. Changes apply next round; match length applies next match.'));
    const percentages=new Map<string,HTMLElement>();
    const recalc=()=>{const total=Object.values(draft.weights).reduce((a,b)=>a+(b??0),0);for(const [type,el] of percentages)el.textContent=`${total?((draft.weights[type as PickupType]??0)/total*100).toFixed(1):'0'}%`;};
    for(const [type,label] of Object.entries(labels)){
      const row=node('label',label);const input=node('input');input.type='number';input.min='0';input.max='10000';input.value=String(draft.weights[type as PickupType]??0);const percent=node('span');percentages.set(type,percent);input.oninput=()=>{draft.weights[type as PickupType]=Number(input.value);recalc();};row.append(input,percent);dialogBody.append(row);
    }
    recalc();const apply=node('button','SAVE SETTINGS');apply.onclick=()=>{draft.mode=mode.value as RoomSettings['mode'];draft.match=format.value as RoomSettings['match'];draft.length=Number(length.value);if(runtime.command({type:'settings',settings:draft})){save(SETTINGS_KEY,JSON.stringify(draft));dialog.close();}};dialogBody.append(apply);dialog.showModal();
  };
  const inputState=new ControllerInputState({send:message=>{seq=message.seq+1;const controlsKey=`${message.left}:${message.right}:${message.bomb}`;if(controlsKey!==lastControls){inputAt=performance.now();benchmarkInput={seq:message.seq,at:inputAt};lastControls=controlsKey;}const scheduled=prediction.input(message.seq,message.left,message.right);if(!scheduled){if(isShotTransition(message)){shotFailure.show();updateShotNotice();}return false;}return runtime.command({...message,...scheduled});}});
  const bindings=new ControllerPointerBindings(inputState,[[leftButton,'left'],[fireButton,'bomb'],[rightButton,'right']],window,()=>{},(x,y)=>{
    const target=document.elementFromPoint(x,y);return [leftButton,fireButton,rightButton].find(button=>target===button||Boolean(target&&button.contains(target)));
  });
  bindings.bindKeyboard(window,()=>joined&&!displayOnly&&!dialog.open&&!document.hidden&&!document.activeElement?.closest('input,textarea,select,[contenteditable]'));
  window.addEventListener('blur',()=>bindings.clear(true,true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)bindings.clear(true,true);});
  window.addEventListener('pagehide',()=>bindings.clear(true,true));
  setInterval(()=>{if(joined)inputState.resend();audio.director.update();updateShotNotice();},50);
  runtime.start();
  setInterval(()=>{void runtime.transport.stats().then(connection=>{
    const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
    app.dataset.metrics=JSON.stringify({...connection,sentBytes:runtime.transport.sentBytes,frameP95:percentile(frameTimes,.95),inputP95:percentile(inputTimes,.95),ackMs:prediction.ackMs,correction:prediction.correction,tick:snapshot?.tick??0});
  });},1000);
  function frame(){const now=performance.now();frameTimes.push(now-previousFrame);previousFrame=now;if(frameTimes.length>300)frameTimes.shift();if(inputAt){inputTimes.push(now-inputAt);inputAt=0;if(inputTimes.length>100)inputTimes.shift();}const delayTicks=prediction.clock.presentationDelayTicks();const buffered=worldBuffer.render(prediction.clock.estimate()?.tick,delayTicks);if(buffered&&!canvas.hidden){const predicted=prediction.render(buffered,id);presentation.render(predicted,now,defaultTheme,sprites,renderScope);if(responseBenchmark&&canvas.dataset.renderer?.startsWith('phaser-')&&canvas.dataset.rendererStatus!=='context-lost')sample({kind:'response-render',delayTicks,clock:prediction.clock.diagnostics(),epochAt:performance.timeOrigin+performance.now(),scope:renderScope,phase:predicted.phase,tick:predicted.tick,powerupsDisabled:Object.values(settings.weights).every(weight=>weight===0),players:predicted.players.map(p=>({id:p.id,angle:p.angle,alive:p.alive,drunkUntilTick:p.drunkUntilTick,invulnerableUntilTick:p.invulnerableUntilTick,portalCooldownUntilTick:p.portalCooldownUntilTick,shielded:p.shielded}))});if(benchmark&&(benchmarkInput||now-lastBenchmarkRender>=100)){const p=predicted.players.find(p=>p.id===id);sample({kind:'prediction',renderAt:now,tick:predicted.tick,inputSeq:benchmarkInput?.seq,inputAt:benchmarkInput?.at,pose:p?{x:p.x,y:p.y,angle:p.angle}:undefined});benchmarkInput=undefined;lastBenchmarkRender=now;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  installRoomLifecycle(window,{stop:()=>runtime.stop(),destroy:()=>presentation.destroy(),reload:()=>location.reload()});
}
