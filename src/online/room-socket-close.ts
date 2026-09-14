export interface RoomSocketCloseActions {stopped:()=>boolean;stop:()=>void;revoked:()=>void;ended:()=>void;retry:()=>void;status:(message:string)=>void}
/** Terminal room expiry must never retry a public short code that can later belong to another session. */
export function handleRoomSocketClose(code:number,actions:RoomSocketCloseActions):void{
 if(code===4004){actions.stop();actions.ended();actions.status('Room ended — return to menu to start again');return;}
 if(code===4001){actions.stop();actions.revoked();return;}
 if(!actions.stopped()){actions.status('Signalling disconnected · retrying');actions.retry();}
}
