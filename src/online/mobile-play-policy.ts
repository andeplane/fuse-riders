export interface MobilePlayState {joined:boolean;phase:string;displayOnly:boolean;host?:boolean;ended?:boolean}
/** A phone (touch, short side ≤ 700) in the lobby gets the lobby screen (#134): the room code, riders and actions in either orientation, no controller.
 *  Once a joined phone leaves the lobby it is the landscape thirds controller for countdown, playing, roundOver and matchOver (#13).
 *  An ended room is neither, so the header status and MAIN MENU are readable without ☰ MENU (#44). */
export function mobilePlayPolicy(state:MobilePlayState,touch:boolean,width:number,height:number){
 const phone=touch&&Math.min(width,height)<=700&&!state.displayOnly&&!state.ended;
 const lobby=phone&&state.phase==='lobby';
 const active=phone&&state.joined&&!lobby;
 return {phone,lobby,active,blocked:active&&height>width};
}
