export interface MobilePlayState {joined:boolean;phase:string;displayOnly:boolean}
export function mobilePlayPolicy(state:MobilePlayState,touch:boolean,width:number,height:number){
 const active=touch&&Math.min(width,height)<=700&&state.joined&&!state.displayOnly&&['countdown','playing','roundOver'].includes(state.phase);
 return {active,blocked:active&&height>width};
}
