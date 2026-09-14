import './mobile-play-layout.css';
import {mobilePlayPolicy,type MobilePlayState} from './mobile-play-policy.js';
export function installMobilePlayLayout(app:HTMLElement,clearControls:()=>void){
 let state:MobilePlayState={joined:false,phase:'lobby',displayOnly:false};
 const compact=document.createElement('button');compact.className='mobile-tools-toggle';compact.textContent='☰ MENU';compact.setAttribute('aria-expanded','false');
 const gate=document.createElement('section');gate.className='mobile-rotate-gate';gate.setAttribute('role','status');
 const heading=document.createElement('h2');heading.textContent='Rotate your phone';const description=document.createElement('p');description.textContent='Play in landscape. Turn your phone sideways to see the whole arena.';
 const fullscreen=document.createElement('button');fullscreen.textContent='TRY FULLSCREEN';fullscreen.onclick=()=>{
  // Both calls start within this user gesture; unsupported iOS APIs simply leave the rotate guidance visible.
  void document.documentElement.requestFullscreen?.().catch(()=>{});
  const orientation=screen.orientation as ScreenOrientation&{lock?:(mode:string)=>Promise<void>};void orientation?.lock?.('landscape').catch(()=>{});
 };
 gate.append(heading,description,fullscreen);
 // Labels render from attributes via CSS generated content: no text node exists for iOS long-press selection or Copy/Look Up callouts.
 const hints=document.createElement('div');hints.className='mobile-control-hints';for(const text of ['HOLD LEFT','HOLD TO FIRE · RELEASE TO LAUNCH','HOLD RIGHT']){const hint=document.createElement('span');hint.dataset.hint=text;hints.append(hint);}
 app.append(gate,hints,compact);
 for(const type of ['selectstart','contextmenu'])app.addEventListener(type,event=>{const target=event.target as Node;const element=target instanceof Element?target:target.parentElement;if(app.classList.contains('mobile-play')&&!element?.closest('dialog,input,textarea,select'))event.preventDefault();});
 const closeTools=()=>{app.classList.remove('mobile-tools-open');compact.setAttribute('aria-expanded','false');};const openTools=()=>{clearControls();app.classList.add('mobile-tools-open');compact.setAttribute('aria-expanded','true');};
 compact.onclick=()=>{clearControls();const open=app.classList.toggle('mobile-tools-open');compact.setAttribute('aria-expanded',String(open));};
 const update=()=>{const previous=app.classList.contains('mobile-play'),blocked=app.classList.contains('mobile-portrait');const next=mobilePlayPolicy(state,navigator.maxTouchPoints>0||matchMedia('(pointer: coarse)').matches,innerWidth,innerHeight);if(previous!==next.active||blocked!==next.blocked){clearControls();closeTools();}app.classList.toggle('mobile-play',next.active);app.classList.toggle('mobile-portrait',next.blocked);app.classList.toggle('mobile-lobby',state.phase==='lobby');};
 window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);
 // Closing a dialog returns to the live thirds mid-round; in lobby/results the roster and actions stay open.
 app.querySelector('dialog')?.addEventListener('close',()=>{if(['countdown','playing'].includes(state.phase))closeTools();});
 // Phase transitions: entering countdown/play closes the tools overlay and restarts the hint fade (re-appending restarts the CSS animation);
 // entering lobby/matchOver as host opens the overlay so START RACE / REMATCH / MAIN MENU are in view instead of hidden behind ☰ MENU.
 const enter=()=>{if(['countdown','playing'].includes(state.phase)){closeTools();hints.remove();app.append(hints);}else if(state.host&&['lobby','matchOver'].includes(state.phase))openTools();};
 return {update(next:MobilePlayState){const entered=next.phase!==state.phase||!app.classList.contains('mobile-play');state=next;update();if(entered&&app.classList.contains('mobile-play'))enter();},active:()=>app.classList.contains('mobile-play'),blocked:()=>app.classList.contains('mobile-portrait')||app.classList.contains('mobile-tools-open')};
}
