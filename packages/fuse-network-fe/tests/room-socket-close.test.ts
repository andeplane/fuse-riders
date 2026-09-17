import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRoomSocketClose,type RoomSocketCloseActions } from '../src/room-socket-close.js';
function fixture(){let stopped=false;const calls:string[]=[];const actions:RoomSocketCloseActions={stopped:()=>stopped,stop:()=>{stopped=true;calls.push('stop');},revoked:()=>calls.push('revoked'),ended:()=>calls.push('ended'),retry:()=>calls.push('retry'),status:message=>calls.push(message),terminated:message=>calls.push(`terminal:${message}`)};return{actions,calls};}
test('expired room stops before clearing runtime and never retries a reused public code',()=>{const f=fixture();handleRoomSocketClose(4004,f.actions);handleRoomSocketClose(1006,f.actions);assert.deepEqual(f.calls,['stop','ended','terminal:Room ended']);});
test('temporary network failure retries while replaced host is terminal separately',()=>{const f=fixture();handleRoomSocketClose(1006,f.actions);assert.deepEqual(f.calls,['Signalling disconnected · retrying','retry']);f.calls.length=0;handleRoomSocketClose(4001,f.actions);assert.deepEqual(f.calls,['stop','revoked']);});
