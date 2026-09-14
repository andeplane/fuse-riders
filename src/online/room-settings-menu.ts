import type { RoomSettings } from '../shared/room-settings.js';
import type { PickupType } from '../shared/game.js';
import './room-settings-menu.css';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const result=document.createElement(tag);result.textContent=text;return result;};
/** One draft survives submenu navigation; only Save publishes it. */
export function showRoomSettings(body:HTMLElement,settings:RoomSettings,solo:boolean,labels:Record<string,string>,save:(draft:RoomSettings)=>boolean,close:()=>void):void{
  const draft=structuredClone(settings);
  const choices=<T extends string>(title:string,value:T,options:readonly (readonly [T,string])[],change:(value:T)=>void,disabled=false)=>{
    const group=element('fieldset');group.className='room-choice';group.disabled=disabled;group.append(element('legend',title));
    for(const [key,text] of options){const label=element('label'),input=element('input');input.type='radio';input.name=title;input.value=key;input.checked=value===key;input.onchange=()=>change(key);label.append(input,element('span',text));group.append(label);}return group;
  };
  const main=()=>{
    body.replaceChildren(element('h2','Room settings'));
    body.append(choices('Screen layout',draft.mode,[['devices','Full game on each device'],['shared','Shared TV + phone controls']],value=>{draft.mode=value;},solo),choices('Match format',draft.match,[['wins','First to N wins'],['rounds','Play N rounds']],value=>{draft.match=value;}));
    const lengthLabel=element('label','Match length'),length=element('input');length.type='number';length.min='1';length.max='20';length.value=String(draft.length);length.setAttribute('aria-label','Match length');length.oninput=()=>{draft.length=Number(length.value);};lengthLabel.append(length);body.append(lengthLabel);
    const configure=element('button','CONFIGURE POWERUPS');configure.onclick=powerups;body.append(configure,element('p','Gameplay changes apply next round. Match length applies next match.'));
    const error=element('p');error.setAttribute('role','alert');const apply=element('button','SAVE SETTINGS');apply.onclick=()=>{if(!Number.isInteger(draft.length)||draft.length<1||draft.length>20){error.textContent='Choose a match length from 1 to 20.';return;}if(save(draft))close();else error.textContent='Could not save settings. Check the room connection and try again.';};body.append(error,apply);body.scrollTop=0;
  };
  const powerups=()=>{
    body.replaceChildren(element('h2','Configure powerups'));const back=element('button','← BACK TO ROOM SETTINGS');back.onclick=main;body.append(back,element('p','Set a weight to 0 to disable a powerup. Higher weights make it more common.'));
    const percentages=new Map<string,HTMLElement>();const recalc=()=>{const total=Object.values(draft.weights).reduce((sum,weight)=>sum+(weight??0),0);for(const [type,output] of percentages)output.textContent=`${total?((draft.weights[type as PickupType]??0)/total*100).toFixed(1):'0'}%`;};
    for(const [type,title] of Object.entries(labels)){const label=element('label',title),input=element('input'),percent=element('span');input.type='number';input.min='0';input.max='10000';input.value=String(draft.weights[type as PickupType]??0);input.oninput=()=>{draft.weights[type as PickupType]=Math.max(0,Math.min(10000,Math.round(Number(input.value)||0)));recalc();};label.append(input,percent);percentages.set(type,percent);body.append(label);}recalc();body.scrollTop=0;
  };
  main();
}
