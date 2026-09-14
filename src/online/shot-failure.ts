/** A failed state resend is not a failed fire gesture. Never flash every network tick. */
export function isShotTransition(command:unknown):boolean {
 if(!command||typeof command!=='object')return false;
 const value=command as {type?:unknown;bombAction?:unknown};
 return value.type==='input'&&(value.bombAction==='press'||value.bombAction==='release');
}
export const SHOT_FAILURE_TEXT='Shot not accepted — check the connection and tap FIRE again.';
/** Independent of recurring connection/world status updates; injected monotonic clock. */
export class ShotFailureNotice {
 private until=-Infinity;
 constructor(private now:()=>number){}
 show():void{this.until=this.now()+3000;}
 message():string|undefined{return this.now()<this.until?SHOT_FAILURE_TEXT:undefined;}
}
