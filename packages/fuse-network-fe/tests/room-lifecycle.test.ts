import test from 'node:test';
import assert from 'node:assert/strict';
import { installRoomLifecycle,type RoomLifecycleEvents } from '../src/room-lifecycle.js';
function fixture(){const listeners=new Map<string,(event:{persisted:boolean})=>void>();const calls:string[]=[];const events:RoomLifecycleEvents={addEventListener:(type,listener)=>{listeners.set(type,listener);}};installRoomLifecycle(events,{stop:()=>calls.push('stop'),destroy:()=>calls.push('destroy'),reload:()=>calls.push('reload')});return{calls,emit:(type:'pagehide'|'pageshow',persisted:boolean)=>listeners.get(type)!({persisted})};}
test('ordinary initial show is inert and permanent departure disposes the room',()=>{const f=fixture();f.emit('pageshow',false);assert.deepEqual(f.calls,[]);f.emit('pagehide',false);assert.deepEqual(f.calls,['stop','destroy']);});
test('BFCache restoration reloads stopped room exactly once instead of reviving its transport',()=>{const f=fixture();f.emit('pagehide',true);assert.deepEqual(f.calls,['stop']);f.emit('pageshow',true);f.emit('pageshow',true);assert.deepEqual(f.calls,['stop','reload']);});
