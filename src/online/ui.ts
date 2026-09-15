import { showRoomSettings } from './room-settings-menu.js';
import { validRoomCode } from '../shared/room-code.js';
import { startAttract } from './attract.js';
import { LocalRuntime } from './local-runtime.js';
import type { Callbacks } from './runtime.js';
import { installRoomLifecycle } from './room-lifecycle.js';
import { isShotTransition, ShotFailureNotice } from './shot-failure.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import { mountArenaPresentation } from '../client/phaser/presentation.js';
import { apiUrl, appUrl } from './endpoints.js';
import { ControllerInputState } from '../client/controller-state.js';
import { ControllerKeyboardBindings } from '../client/controller-keyboard.js';
import { ControllerPointerBindings } from '../client/controller-pointers.js';
import { LocalPrediction, RemoteWorldBuffer } from './prediction.js';
import { drawArena } from '../client/main.js';
import { createAvatarPicker, createAvatarPortrait } from '../client/avatar-heads.js';
import { defaultTheme, loadThemeSprites } from '../client/themes.js';
import { createGameAudio } from '../client/game-audio.js';
import { defaultRoomSettings, loadRoomSettings, SETTINGS_KEY, type RoomSettings } from '../shared/room-settings.js';
import type { PickupType } from '../shared/game.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { MatchPlayerStats } from '../shared/match-stats.js';
import { COMPARISON_COLUMNS, COMPARISON_KEY, RECAP_EMPTY_MESSAGE, RECAP_KICKER, RECAP_TITLE, buildMatchRecap } from '../shared/match-recap.js';
import { RoomRuntime } from './runtime.js';
import type { AvatarId } from '../shared/avatars.js';
import QRCode from 'qrcode';
import './online.css';
import { installMobilePlayLayout } from './mobile-play-layout.js';
import { formatLinkDiagnostics } from './link-diagnostics.js';
import { connectHint } from './connect-hint.js';
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
    const mode=node('fieldset','','landing-mode');mode.setAttribute('aria-label','Where will you play?');mode.append(node('legend','Where will you play?'));let selectedMode=loadRoomSettings(localStorage).mode;
    for(const [value,label] of [['devices','Each device'],['shared','Shared TV']] as const){const option=node('label'),radio=node('input');radio.type='radio';radio.name='landing-mode';radio.value=value;radio.checked=selectedMode===value;radio.onchange=()=>{selectedMode=value;};option.append(radio,node('span',label));mode.append(option);}
    const create=node('button','CREATE ROOM'),join=node('button','JOIN ROOM'),input=node('input');input.placeholder='Room code';input.maxLength=10;input.autocapitalize='characters';
    const error=node('p');
    create.onclick=async()=>{create.disabled=true;try{const response=await fetch(apiUrl('/api/rooms'),{method:'POST'});const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not create room');save(`fuse-room-${body.code}`,body.token);const settings=loadRoomSettings(localStorage);settings.mode=selectedMode;save(SETTINGS_KEY,JSON.stringify(settings));location.href=appUrl(`?room=${body.code}`);}catch(e){error.textContent=String(e);create.disabled=false;}};
    join.onclick=()=>{const value=input.value.trim().toUpperCase();if(validRoomCode(value))location.href=appUrl(`?room=${value}`);else error.textContent='Enter a room code, for example AB42';};
    mode.setAttribute('aria-label','Where will you play?');input.setAttribute('aria-label','Room code');error.setAttribute('role','alert');
    const createRow=node('div','','landing-create');createRow.append(mode,create);
    const joinRow=node('div','','landing-join');joinRow.append(input,join);input.onkeydown=event=>{if(event.key==='Enter')join.click();};
    form.append(createRow,joinRow,error);app.replaceChildren(card);
    let cleanup:(()=>void)|undefined,ended=false;
    window.addEventListener('pagehide',()=>{ended=true;cleanup?.();},{once:true});
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
    void startAttract(card.querySelector('canvas')!,card.querySelector('.attract-toggle')!).then(stop=>{if(ended)stop();else cleanup=stop;}).catch(()=>{card.querySelector('.landing-live')?.remove();});return;
  }
  if(!solo&&!validRoomCode(code)){app.textContent='Invalid room code';return;}
  const identityKey=`fuse-room-${code}`;const token=solo?'':displayOnlyToken();
  function displayOnlyToken(){if(url.searchParams.has('display'))return secret();const token=read(identityKey)??secret();save(identityKey,token);return token;}
  let id='',isHost=false,joined=false,avatar:AvatarId|undefined,settings=loadRoomSettings(localStorage),snapshot:ViewSnapshot|undefined;
  const prediction=new LocalPrediction(()=>performance.now());const frameTimes:number[]=[];const inputTimes:number[]=[];let previousFrame=performance.now(),inputAt=0;const worldBuffer=new RemoteWorldBuffer();
  let seq=0,lastRecap='';
  const responseBenchmark=url.searchParams.get('responseBenchmark')==='1';
  const benchmark=url.searchParams.get('benchmark')==='1'||responseBenchmark;let benchmarkInput:{seq:number;at:number}|undefined,lastBenchmarkRender=0,lastControls='';
  const sample=(detail:object)=>{if(benchmark)window.dispatchEvent(new CustomEvent('fuse-benchmark',{detail}));};
  const displayOnly=!solo&&url.searchParams.has('display');
  // A terminal room close (4004) freezes this client: no further snapshots are applied and no input may leave, whatever a stale pointer or key does next.
  let roomEnded=false;
  const header=node('header','','online-header');const title=node('strong','','room-brand'),status=node('span','Connecting…','online-status'),audioButton=node('button','♫ AUDIO'),results=node('button','RESULTS'),menu=node('button','MENU');
  title.append(node('span','FUSE'),node('span','RIDERS'));title.setAttribute('aria-label',`Fuse Riders · ${code}`);results.hidden=true;results.title='Reopen the match results';header.append(title,status,audioButton,results,menu);
  const booting=node('div','','room-boot'),bootNote=node('p','Warming up the arena…','room-boot-note');booting.setAttribute('role','status');booting.append(node('p','PREPARING ROOM','room-boot-title'),node('strong',code,'shared-room-code'),bootNote);
  // A room that never sends a snapshot must stop claiming progress: the note escalates to the same-network hint once the link stalls or ICE fails.
  const bootAt=performance.now();const bootTick=()=>{bootNote.textContent=connectHint(status.textContent??'',performance.now()-bootAt);};
  const bootPoll=setInterval(bootTick,1000);
  const bootDone=()=>{if(booting.isConnected){clearInterval(bootPoll);booting.remove();app.classList.remove('booting');}};
  const overCard=node('div','','room-boot room-over-card'),overNote=node('p','Room ended — return to menu to start again','room-boot-note'),overHome=node('a','BACK TO MENU','room-over-home');
  overCard.setAttribute('role','status');overHome.href=appUrl();overCard.append(node('p','ROOM CLOSED','room-boot-title'),node('strong',code,'shared-room-code'),overNote,overHome);
  app.classList.add('booting');
  app.replaceChildren(header,booting);
  let canvas=node('canvas','','online-arena');let renderScope=code,controlEpoch="";const presentation=mountArenaPresentation(canvas,drawArena,replacement=>{canvas=replacement;});const sprites=await loadThemeSprites(defaultTheme);
  const notice=node('div','','online-notice');
  const sharedLobby=node('section','','shared-lobby room-lobby');sharedLobby.hidden=true;
  const lobbyCopy=node('div','','room-lobby-copy');const lobbyHeading=node('h1');lobbyHeading.innerHTML='SCAN.<br>STEER.<br>SURVIVE.';
  lobbyCopy.append(node('p','PHONE PARTY // 2–5 RIDERS','room-eyebrow'),lobbyHeading,node('p','Pick your head. Grab your phone. Carve neon trails and blow up your friends’ plans.','room-intro'),node('p','STEER  ◀ ▶     HOLD · AIM · RELEASE','room-howto'));
  const qrCard=node('div','','room-qr-card'),lobbyQr=node('img');lobbyQr.alt='Scan to join this room';qrCard.append(lobbyQr,node('p','SCAN TO JOIN'),node('strong',code,'shared-room-code'));
  const lobbyRiders=node('div','','room-riders');const lobbyEmpty=node('p','Your crew belongs here. Share the code to get started.','room-empty');lobbyRiders.append(lobbyEmpty);
  const lobbyFooter=node('footer','','room-lobby-footer'),lobbyCount=node('span','Waiting for riders');lobbyFooter.append(lobbyCount);
  sharedLobby.append(lobbyCopy,qrCard,lobbyRiders,lobbyFooter);
  const lobbyEntries=new Map<string,{entry:HTMLElement;head:HTMLElement;name:HTMLElement;status:HTMLElement;avatar:AvatarId}>();
  if(!solo)void QRCode.toDataURL(new URL(appUrl(`?room=${code}`),location.origin).href).then(data=>{lobbyQr.src=data;}).catch(()=>{lobbyQr.hidden=true;});
  const joinPanel=node('form','','online-join');const name=node('input');name.placeholder='Your name';name.maxLength=20;const previousName=read('fuse-riders-player-name');name.value=previousName??'';
  const joinButton=node('button','JOIN AS PLAYER');joinPanel.append(name,joinButton);joinButton.disabled=true;
  const controls=node('div','','online-controls');const leftButton=node('button','◀'),fireButton=node('button','HOLD TO FIRE'),rightButton=node('button','▶');controls.append(leftButton,fireButton,rightButton);controls.addEventListener('selectstart',event=>event.preventDefault());controls.addEventListener('contextmenu',event=>event.preventDefault());
  for(const [button,key,label] of [[leftButton,'ArrowLeft A','Steer left'],[fireButton,'Space','Hold to charge, release to fire'],[rightButton,'ArrowRight D','Steer right']] as const){button.setAttribute('aria-keyshortcuts',key);button.title=`${label} (${key})`;}
  const roster=node('div','','online-roster');const hostControls=node('div','','online-host');const start=node('button','START RACE'),reset=node('button','MAIN MENU'),settingsButton=node('button','ROOM SETTINGS'),share=node('button','INVITE / TV'),addAI=node('button','ADD AI');hostControls.append(start,reset,settingsButton,share,addAI);
  const rosterEntries=new Map<string,{entry:HTMLElement;label:HTMLElement;head:HTMLElement;avatar:AvatarId;remove:HTMLButtonElement}>();
  const help=node('button','?','desktop-help');help.setAttribute('aria-label','Keyboard controls');help.title='Keyboard controls';
  const avatarButton=node('button','HEAD'),fullscreen=node('button','⛶');fullscreen.setAttribute('aria-label','Fullscreen');fullscreen.onclick=()=>void document.documentElement.requestFullscreen?.();header.append(avatarButton,help,fullscreen);
  const dialog=node('dialog','','game-dialog');dialog.setAttribute('aria-label','Game menu');const close=node('button','✕  CLOSE');close.type='button';close.setAttribute('aria-label','CLOSE');close.onclick=()=>dialog.close();const dialogBar=node('header','','dialog-bar'),dialogTitle=node('strong','GAME MENU');dialogBar.append(dialogTitle,close);const dialogBody=node('div','','dialog-body');dialog.append(dialogBar,dialogBody);dialog.addEventListener('close',()=>{dialog.classList.remove('recap-dialog');dialogTitle.textContent='GAME MENU';dialog.setAttribute('aria-label','Game menu');});dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  const shotNotice=node('p','','online-shot-error');shotNotice.setAttribute('role','alert');shotNotice.hidden=true;const shotFailure=new ShotFailureNotice(()=>performance.now());const updateShotNotice=()=>{const message=shotFailure.message();shotNotice.hidden=!message;if(message&&shotNotice.textContent!==message)shotNotice.textContent=message;};
  const scoreboard=node('div','','online-scoreboard');scoreboard.append(notice,roster);
  const footer=node('footer','','online-footer');footer.append(controls,hostControls);
  app.replaceChildren(header,booting,canvas,sharedLobby,scoreboard,shotNotice,joinPanel,footer,dialog);
  help.onclick=()=>{dialogBody.replaceChildren(node('h2','Keyboard controls'),node('p','← / A — steer left'),node('p','→ / D — steer right'),node('p','SPACE — hold to charge, release to fire'));dialog.showModal();};
  // Move the existing actions, keeping their handlers and mobile/lobby destinations intact.
  const desktopQuery=matchMedia('(min-width: 1000px) and (hover: hover) and (pointer: fine)');
  const updateDesktopLayout=()=>{
    const desktop=desktopQuery.matches&&!app.classList.contains('mobile-play')&&!app.classList.contains('controller-only')&&sharedLobby.hidden;
    app.classList.toggle('desktop-game',desktop);
    const rosterParent=desktop?header:scoreboard;
    if(roster.parentElement!==rosterParent){if(desktop)header.insertBefore(roster,audioButton);else scoreboard.append(roster);}
    const actionsParent=!sharedLobby.hidden?lobbyFooter:desktop?header:footer;
    if(hostControls.parentElement!==actionsParent){if(desktop)header.insertBefore(hostControls,audioButton);else actionsParent.append(hostControls);}
    const noticeParent=desktop?header:scoreboard;
    if(notice.parentElement!==noticeParent)noticeParent.append(notice);
  };
  window.addEventListener('resize',updateDesktopLayout);
  desktopQuery.addEventListener('change',updateDesktopLayout);

  const audio=createGameAudio('Game');audioButton.onclick=()=>{audio.unlock();audio.controls.setAttribute('open','');dialogBody.replaceChildren(node('h2','Music & sound'),audio.controls);dialog.showModal();};
  /** Podium, totals, awards and rider comparison built from the authoritative match statistics. */
  const renderRecap=(stats:ReadonlyArray<MatchPlayerStats>)=>{
    const recap=buildMatchRecap(stats);const root=node('section','','match-recap-report');
    const heading=node('header','','recap-heading'),copy=node('div');copy.append(node('p',RECAP_KICKER,'kicker'),node('h2',RECAP_TITLE));heading.append(copy);root.append(heading);
    if(!recap.comparison.length){root.append(node('p',RECAP_EMPTY_MESSAGE,'recap-empty'));return root;}
    const podium=node('div','','recap-podium');for(const entry of recap.podium){const card=node('article','',`podium-card podium-place-${entry.placement}`);card.style.setProperty('--player-color',entry.color);card.append(node('span',entry.placeLabel,'podium-place'),node('strong',entry.name),node('small',entry.winsLabel));podium.append(card);}
    const totals=node('div','','recap-totals');for(const total of recap.totals){const cell=node('div','','recap-total');cell.append(node('strong',total.value),node('small',total.label));totals.append(cell);}
    const awards=node('div','','recap-awards');for(const award of recap.awards){const card=node('article','','award-card');card.append(node('span',award.icon,'award-icon'),node('small',award.title),node('strong',award.winnerText),node('em',award.detail));awards.append(card);}
    const comparison=node('div','','recap-comparison');comparison.append(node('p',COMPARISON_KEY,'comparison-key'));const columns=node('div','','comparison-row comparison-header');for(const label of ['RIDER',...COMPARISON_COLUMNS.map(column=>column.label)])columns.append(node('span',label));comparison.append(columns);
    for(const entry of recap.comparison){const row=node('div','','comparison-row');row.style.setProperty('--player-color',entry.color);const rider=node('span','','comparison-rider'),riderCopy=node('span');riderCopy.append(node('b',entry.riderLabel),node('small',entry.riderNote));rider.append(node('i'),riderCopy);row.append(rider);for(const column of COMPARISON_COLUMNS)row.append(node(column.key==='wins'?'strong':'span',entry[column.key],column.key==='pickups'?'pickup-counts':column.key==='deaths'?'death-counts':''));comparison.append(row);}
    root.append(podium,totals);if(recap.awards.length)root.append(awards);root.append(comparison);return root;
  };
  const openRecap=()=>{if(!snapshot)return;dialogBody.replaceChildren(renderRecap(snapshot.matchStats));dialogTitle.textContent='MATCH RESULTS';dialog.setAttribute('aria-label','Match results');dialog.classList.add('recap-dialog');dialog.showModal();dialogBody.scrollTop=0;};
  results.onclick=openRecap;
  const callbacks:Callbacks={
    ready:(peerId,host)=>{id=peerId;isHost=host;joinButton.disabled=false;hostControls.hidden=!host;if((joined||previousName)&&!displayOnly)runtime.command({type:'join',name:name.value,avatarId:avatar});},
    shotFailed:()=>{shotFailure.show();updateShotNotice();},
    status:text=>{status.textContent=text;status.title=text;if(booting.isConnected)bootTick();if(roomEnded){notice.textContent=text;overNote.textContent=text;}},
    ended:()=>{bootDone();roomEnded=true;clearControls();controls.hidden=true;joinPanel.hidden=true;hostControls.hidden=true;app.classList.add('room-over');if(canvas.isConnected)canvas.after(overCard);else app.append(overCard);mobileLayout.update({joined,phase:snapshot?.phase??'lobby',displayOnly,host:isHost,ended:true});},
    event:(event,matchId,round,tick)=>audio.director.message({type:'event',matchId,round,tick,event}),
    clock:clockSample=>{const accepted=prediction.observeClock(clockSample);if(responseBenchmark)sample({kind:'response-clock',epochAt:performance.timeOrigin+performance.now(),accepted,sample:clockSample,diagnostics:prediction.clock.diagnostics()});},
    state:(state,rules,ack,matchId,motion)=>{
      if(roomEnded)return;
      bootDone();
      if(snapshot&&snapshot.phase!==state.phase)clearControls();
      snapshot=state;const nextRenderScope=`${runtime.transport.grant?.incarnation}:${runtime.transport.grant?.epoch}:${matchId}:${state.round}`;if(nextRenderScope!==renderScope)prediction.resetExternalScope();renderScope=nextRenderScope;settings=rules;if(ack>=seq){seq=ack+1;inputState.setNextSequence(seq);}if(motion&&motion.scope.controlEpoch!==controlEpoch){controlEpoch=motion.scope.controlEpoch;inputState.forgetFinishedGesture();}prediction.accept(state,id,ack,motion,renderScope);
      worldBuffer.push(state,renderScope);
      sample({kind:'snapshot',at:performance.now(),presentationDelayTicks:prediction.clock.presentationDelayTicks(),authorityScope:renderScope,matchId,round:state.round,tick:state.tick,phase:state.phase,playerId:id,players:state.players.map(p=>({id:p.id,alive:p.alive,x:p.x,y:p.y,angle:p.angle,bombReadyAtTick:p.bombReadyAtTick,bombChargeStartedTick:p.bombChargeStartedTick})),leaderboard:state.leaderboard,motionResults:motion?.results,controlEpoch:motion?.scope.controlEpoch,heldMotion:motion?.held,correction:prediction.correction,ackMs:prediction.ackMs});
      audio.director.message({type:'snapshot',matchId,round:state.round,tick:state.tick,state});
      const player=state.players.find(player=>player.id===id);
      // The final-round pause keeps the arena visible until phaseEndsAtTick; the report opens once per match afterwards and stays reopenable.
      const recapReady=state.phase==='matchOver'&&state.tick>=(state.phaseEndsAtTick??0);results.hidden=!recapReady;
      if(recapReady&&lastRecap!==String(state.phaseEndsAtTick)){lastRecap=String(state.phaseEndsAtTick);openRecap();}
      if(state.phase==='lobby')lastRecap='';joined=Boolean(player);mobileLayout.update({joined,phase:state.phase,displayOnly,host:isHost});joinPanel.hidden=joined||displayOnly;controls.hidden=!joined||displayOnly;
      sharedLobby.hidden=solo||state.phase!=='lobby'||(settings.mode==='shared'&&joined&&!displayOnly)||mobileLayout.active();app.classList.toggle('room-waiting',!sharedLobby.hidden);
      lobbyCount.textContent=`${state.players.filter(p=>p.connected).length} riders ready`;lobbyEmpty.hidden=state.players.length>0;
      for(const [playerId,row] of lobbyEntries)if(!state.players.some(p=>p.id===playerId)){row.entry.remove();lobbyEntries.delete(playerId);}
      for(const p of state.players){let row=lobbyEntries.get(p.id);if(!row){const entry=node('div','','room-rider'),head=createAvatarPortrait(p.avatarId),name=node('strong'),status=node('small'),info=node('div');info.append(name,status);entry.append(head,info);row={entry,head,name,status,avatar:p.avatarId};lobbyEntries.set(p.id,row);lobbyRiders.append(entry);}if(row.avatar!==p.avatarId){const head=createAvatarPortrait(p.avatarId);row.head.replaceWith(head);row.head=head;row.avatar=p.avatarId;}row.entry.style.setProperty('--rider-color',p.color);if(row.name.textContent!==p.name)row.name.textContent=p.name;row.status.textContent=p.connected?'READY':'OFFLINE';}
      roster.hidden=!sharedLobby.hidden;
      const controllerOnly=settings.mode==='shared'&&!displayOnly&&joined;app.classList.toggle('controller-only',controllerOnly);
      canvas.hidden=!sharedLobby.hidden||controllerOnly;updateDesktopLayout();
      inputState.configureTargetAim(player?.targetBombArmed&&!player.gunArmed&&!player.shellArmed?{x:player.x/state.width,y:player.y/state.height}:undefined);
      if(player){app.style.setProperty('--player-color',player.color);const remaining=Math.max(0,player.bombReadyAtTick-state.tick);fireButton.textContent=remaining?`${Math.ceil(remaining/20)}s RECHARGE`:player.targetBombArmed?'SLIDE TO AIM':player.gunArmed?'FIRE CANNON':player.shellArmed?'FIRE SHELL':inputState.isHeld('bomb')?'RELEASE!':'HOLD TO FIRE';}
      notice.textContent=state.phase==='lobby'?(joined&&!isHost?'Waiting for the host to start':'Join your friends, then start the race'):state.phase==='countdown'?`READY · ${Math.max(0,Math.ceil(((state.phaseEndsAtTick??state.tick)-state.tick)/20))}`:state.phase==='roundOver'?`${state.players.find(p=>p.id===state.roundWinnerId)?.name??'Nobody'} wins this round`:state.phase==='matchOver'?`${state.players.find(p=>p.id===state.matchWinnerId)?.name??'Tie'} · MATCH COMPLETE`:player?.waitingForNextRound?'You’re in — joining next round':!player?.alive&&joined?'Eliminated — next round soon':'';
      for(const [playerId,row] of rosterEntries)if(!state.players.some(p=>p.id===playerId)){row.entry.remove();rosterEntries.delete(playerId);}
      for(const p of state.players){
        let row=rosterEntries.get(p.id);
        if(!row){const entry=node('span','','online-score-card'),label=node('span'),head=createAvatarPortrait(p.avatarId),remove=node('button','×');entry.append(head,label,remove);remove.onclick=()=>runtime.command({type:'bot',action:'remove',id:p.id});row={entry,label,head,avatar:p.avatarId,remove};rosterEntries.set(p.id,row);roster.append(entry);}
        const label=`${p.name} · ${p.roundWins}${p.waitingForNextRound?' · next round':p.connected?'':' · offline'}`;if(row.label.textContent!==label)row.label.textContent=label;row.label.title=`${p.name} · ${p.roundWins} round wins`;row.label.setAttribute('aria-label',row.label.title);row.entry.style.color=p.color;row.entry.style.setProperty('--rider-color',p.color);row.entry.classList.toggle('out',!p.alive&&!['lobby','countdown'].includes(state.phase));
        if(row.avatar!==p.avatarId){const head=createAvatarPortrait(p.avatarId);row.head.replaceWith(head);row.head=head;row.avatar=p.avatarId;}
        const removeParent=sharedLobby.hidden?row.entry:lobbyEntries.get(p.id)!.entry;if(row.remove.parentElement!==removeParent)removeParent.append(row.remove);
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
  reset.onclick=()=>runtime.command({type:'action',action:'lobby'});menu.onclick=()=>{dialogBody.replaceChildren(node('p',solo?'End this solo run?':isHost?'End this room for everyone?':'Leave this room?'));const leave=node('button',solo?'BACK TO MENU':isHost?'END ROOM':'LEAVE ROOM');leave.onclick=async()=>{leave.disabled=true;leave.textContent='LEAVING…';runtime.stop();if(isHost&&!solo){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2500);try{await fetch(apiUrl(`/api/rooms/${code}/end`),{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:controller.signal,keepalive:true});}catch{/* Host heartbeat expiry also closes the room if the network is unavailable. */}finally{clearTimeout(timer);}}location.href=appUrl();};dialogBody.append(leave);
    if(!solo){const diagnostics=node('pre','','link-diagnostics');diagnostics.textContent=app.dataset.linkDiagnostics??'collecting link diagnostics…';dialogBody.append(node('p','LINK DIAGNOSTICS (redacted: candidate types and states, no addresses)'),diagnostics);const refresh=setInterval(()=>{if(!dialog.open){clearInterval(refresh);return;}diagnostics.textContent=app.dataset.linkDiagnostics??diagnostics.textContent;},1000);}
    dialog.showModal();};
  avatarButton.onclick=()=>{dialogBody.replaceChildren(node('h2','Choose your head'));const picker=createAvatarPicker(localStorage,chosen=>{avatar=chosen;if(joined)runtime.command({type:'avatar',avatarId:chosen});dialog.close();});dialogBody.append(picker.element);dialog.showModal();};
  share.onclick=async()=>{const link=new URL(appUrl(`?room=${code}`),location.origin).href;dialogBody.replaceChildren(node('h2',`Room ${code}`),node('p',link));const qr=node('img');qr.src=await QRCode.toDataURL(link);qr.alt='Scan to join';dialogBody.append(qr);const tv=node('a','OPEN TV VIEW');tv.href=appUrl(`?room=${code}&display=1`);tv.target='_blank';dialogBody.append(tv);dialog.showModal();};
  settingsButton.onclick=()=>{
    showRoomSettings(dialogBody,settings,solo,labels,draft=>{if(!runtime.command({type:'settings',settings:draft}))return false;save(SETTINGS_KEY,JSON.stringify(draft));return true;},()=>dialog.close());
    dialog.showModal();
  };
  const inputState=new ControllerInputState({send:message=>{if(roomEnded)return false;seq=message.seq+1;const controlsKey=`${message.left}:${message.right}:${message.bomb}`;if(controlsKey!==lastControls){inputAt=performance.now();benchmarkInput={seq:message.seq,at:inputAt};lastControls=controlsKey;}const scheduled=prediction.input(message.seq,message.left,message.right);const sent=scheduled?runtime.command({...message,...scheduled}):false;if(scheduled&&!sent)prediction.discard(message.seq);if(benchmark)sample({kind:'input',at:performance.now(),seq:message.seq,left:message.left,right:message.right,bomb:message.bomb,bombAction:message.bombAction,scheduled:Boolean(scheduled),intendedTick:scheduled?.intendedTick,sent,...prediction.diagnostics()});if(!scheduled&&isShotTransition(message)){shotFailure.show();updateShotNotice();}return sent;}});
  const bindings=new ControllerPointerBindings(inputState,[[leftButton,'left'],[fireButton,'bomb'],[rightButton,'right']],window,()=>{},(x,y)=>{
    const target=document.elementFromPoint(x,y);return [leftButton,fireButton,rightButton].find(button=>target===button||Boolean(target&&button.contains(target)));
  });
  const keyboard=new ControllerKeyboardBindings(inputState,()=>joined&&!roomEnded&&!mobileLayout.blocked()&&!dialog.open&&!document.hidden&&!leftButton.disabled&&!Boolean(document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')),()=>{for(const [button,control] of [[leftButton,'left'],[fireButton,'bomb'],[rightButton,'right']] as const)button.classList.toggle('active',inputState.isHeld(control));});
  window.addEventListener('keydown',event=>keyboard.down(event));
  window.addEventListener('keyup',event=>keyboard.up(event));
  const clearControls=()=>{keyboard.clear();bindings.clear(true,true);};
  const mobileLayout=installMobilePlayLayout(app,clearControls);
  window.addEventListener('blur',clearControls);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearControls();});
  dialog.addEventListener('focusin',clearControls);
  document.addEventListener('focusin',()=>{if(document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))keyboard.clear();});
  new MutationObserver(()=>{if(dialog.open)clearControls();}).observe(dialog,{attributes:true,attributeFilter:['open']});
  window.addEventListener('pagehide',clearControls);
  setInterval(()=>{if(joined&&!roomEnded)inputState.resend();audio.director.update();updateShotNotice();},50);
  runtime.start();
  setInterval(()=>{void runtime.transport.stats().then(connection=>{
    const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
    app.dataset.metrics=JSON.stringify({...connection,sentBytes:runtime.transport.sentBytes,frameP95:percentile(frameTimes,.95),inputP95:percentile(inputTimes,.95),ackMs:prediction.ackMs,correction:prediction.correction,tick:snapshot?.tick??0});
    return runtime instanceof RoomRuntime?runtime.transport.diagnostics():undefined;
  }).then(report=>{if(report)app.dataset.linkDiagnostics=formatLinkDiagnostics(report.links,report.ice,report.socket);});},1000);
  function frame(){const now=performance.now();frameTimes.push(now-previousFrame);previousFrame=now;if(frameTimes.length>300)frameTimes.shift();if(inputAt){inputTimes.push(now-inputAt);inputAt=0;if(inputTimes.length>100)inputTimes.shift();}const delayTicks=prediction.clock.presentationDelayTicks();const buffered=worldBuffer.render(prediction.clock.estimate()?.tick,delayTicks);if(buffered&&(!canvas.hidden||(!sharedLobby.hidden&&!canvas.dataset.renderer))){const predicted=prediction.render(buffered,id);presentation.render(predicted,now,defaultTheme,sprites,renderScope);if(responseBenchmark&&canvas.dataset.renderer?.startsWith('phaser-')&&canvas.dataset.rendererStatus!=='context-lost')sample({kind:'response-render',delayTicks,clock:prediction.clock.diagnostics(),epochAt:performance.timeOrigin+performance.now(),scope:renderScope,phase:predicted.phase,tick:predicted.tick,powerupsDisabled:Object.values(settings.weights).every(weight=>weight===0),players:predicted.players.map(p=>({id:p.id,angle:p.angle,alive:p.alive,drunkUntilTick:p.drunkUntilTick,invulnerableUntilTick:p.invulnerableUntilTick,portalCooldownUntilTick:p.portalCooldownUntilTick,shielded:p.shielded}))});if(benchmark&&(benchmarkInput||now-lastBenchmarkRender>=100)){const p=predicted.players.find(p=>p.id===id);sample({kind:'prediction',renderAt:now,tick:predicted.tick,inputSeq:benchmarkInput?.seq,inputAt:benchmarkInput?.at,pose:p?{x:p.x,y:p.y,angle:p.angle}:undefined});benchmarkInput=undefined;lastBenchmarkRender=now;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  installRoomLifecycle(window,{stop:()=>runtime.stop(),destroy:()=>presentation.destroy(),reload:()=>location.reload()});
}
