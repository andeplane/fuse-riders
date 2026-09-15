import { createAvatarPicker } from '../client/avatar-heads.js';
import type { AvatarId } from '../shared/avatars.js';
const NAME_KEY='fuse-riders-player-name';
/** Name, head and JOIN. Every rider confirms these before taking a seat: a remembered name prefills the field, it never joins by itself. */
export function createJoinForm(storage:Storage,onJoin:(name:string,avatarId:AvatarId)=>void){
  const form=document.createElement('form');form.className='online-join';
  const name=document.createElement('input');name.placeholder='Your name';name.maxLength=20;name.required=true;name.setAttribute('autocomplete','nickname');name.setAttribute('aria-label','Your name');
  try{name.value=storage.getItem(NAME_KEY)??'';}catch{}
  const picker=createAvatarPicker(storage);
  const button=document.createElement('button');button.textContent='JOIN AS PLAYER';button.disabled=true;
  form.append(name,button,picker.element);
  form.onsubmit=event=>{event.preventDefault();const value=name.value.trim();if(!value){name.focus();return;}try{storage.setItem(NAME_KEY,value);}catch{}onJoin(value,picker.selected());};
  return {element:form,picker,name:()=>name.value.trim(),ready(ready:boolean){button.disabled=!ready;}};
}
