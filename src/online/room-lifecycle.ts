export interface RoomLifecycleEvents {
 addEventListener(type:'pagehide'|'pageshow',listener:(event:{persisted:boolean})=>void):void;
}
export interface RoomLifecycleActions {stop():void;destroy():void;reload():void}
/** A BFCache page contains a stopped runtime: reconstruct from saved credentials, never revive stale authority. */
export function installRoomLifecycle(events:RoomLifecycleEvents,actions:RoomLifecycleActions):void {
 let reloadRequested=false;
 events.addEventListener('pagehide',event=>{actions.stop();if(!event.persisted)actions.destroy();});
 events.addEventListener('pageshow',event=>{if(event.persisted&&!reloadRequested){reloadRequested=true;actions.reload();}});
}
