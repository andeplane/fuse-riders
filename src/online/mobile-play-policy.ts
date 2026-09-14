export interface MobilePlayState {joined:boolean;phase:string;displayOnly:boolean}
/** A joined phone is a landscape thirds controller in every phase (lobby, countdown, playing, roundOver, matchOver); phase only drives layout transitions. */
export function mobilePlayPolicy(state:MobilePlayState,touch:boolean,width:number,height:number){
 const active=touch&&Math.min(width,height)<=700&&state.joined&&!state.displayOnly;
 return {active,blocked:active&&height>width};
}
