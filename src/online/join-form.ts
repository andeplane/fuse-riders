import { createAvatarPicker } from '../client/avatar-heads.js';
import type { SafeStorage } from '../client/safe-storage.js';
import type { AvatarId } from '../shared/avatars.js';
const NAME_KEY='fuse-riders-player-name';
type Storage=Pick<SafeStorage,'getItem'|'setItem'>;
/** Name, head and JOIN. Every rider confirms these before taking a seat: a remembered name prefills the field, it never joins by itself. */
export function createJoinForm(storage:Storage,onJoin:(name:string,avatarId:AvatarId)=>void){
  const form=document.createElement('form');form.className='online-join';
  const name=document.createElement('input');name.placeholder='Your name';name.maxLength=20;name.required=true;name.setAttribute('autocomplete','nickname');name.setAttribute('aria-label','Your name');name.value=storage.getItem(NAME_KEY)??'';
  const picker=createAvatarPicker(storage);
  const button=document.createElement('button');button.textContent='JOIN AS PLAYER';button.disabled=true;
  form.append(name,button,picker.element);
  form.onsubmit=event=>{event.preventDefault();const value=name.value.trim();if(!value){name.focus();return;}storage.setItem(NAME_KEY,value);onJoin(value,picker.selected());};
  return {element:form,picker,ready(){button.disabled=false;}};
}
/** The joiner's whole pre-seat page: room code over the form. Hosts get the bare form inside their lobby instead. */
export function createJoinCard(code:string,form:HTMLElement,note:HTMLElement):HTMLElement{
  const card=document.createElement('section');card.className='room-join';card.setAttribute('aria-label',`Join room ${code}`);
  const eyebrow=document.createElement('p');eyebrow.className='room-eyebrow';eyebrow.textContent='JOIN THE ROOM';
  const roomCode=document.createElement('strong');roomCode.className='shared-room-code';roomCode.textContent=code;
  card.append(eyebrow,roomCode,form,note);return card;
}
