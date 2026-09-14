export interface MobilePlayState {joined:boolean;phase:string;displayOnly:boolean;host?:boolean;ended?:boolean}
/** A joined phone is a landscape thirds controller in every phase (lobby, countdown, playing, roundOver, matchOver); phase only drives layout transitions.
 *  An ended room is no longer joined play: the phone leaves the controller so the header status and MAIN MENU are readable without opening ☰ MENU (#44). */
export function mobilePlayPolicy(state:MobilePlayState,touch:boolean,width:number,height:number){
 const active=touch&&Math.min(width,height)<=700&&state.joined&&!state.displayOnly&&!state.ended;
 return {active,blocked:active&&height>width};
}
