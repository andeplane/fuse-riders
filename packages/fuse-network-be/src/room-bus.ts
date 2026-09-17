import type { Member } from './room-store.js';
export interface RoutedMessage { id:string;code:string;incarnation:string;destination:string;from:Member;to:Member;expiresAt:number;wire:{type:'signal';from:string;connectionId:string;data:unknown} }
export interface RoomBus {
  start(receive:(message:RoutedMessage)=>Promise<void>,failed:(error:Error)=>void):Promise<void>;
  publish(message:RoutedMessage):Promise<void>;
  stop():Promise<void>;
}
export const BUS_FRAME_MAX_BYTES=40_000;
export const BUS_FRAME_TTL_MS=10_000;
export function parseRoutedMessage(raw:unknown):RoutedMessage|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
  const m=raw as Record<string,unknown>;
  if(!['id','code','incarnation','destination'].every(k=>typeof m[k]==='string'&&m[k].length>0&&m[k].length<=128)||typeof m.expiresAt!=='number'||!Number.isFinite(m.expiresAt))return;
  const member=(v:unknown):v is Member=>{
    if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=v as Record<string,unknown>;
    return ['id','connectionId','gatewayId'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<=128)&&typeof p.host==='boolean'&&typeof p.expiresAt==='number'&&Number.isFinite(p.expiresAt);
  };
  if(!member(m.from)||!member(m.to)||m.to.gatewayId!==m.destination||!m.wire||typeof m.wire!=='object')return;
  const w=m.wire as Record<string,unknown>;
  if(w.type!=='signal'||w.from!==m.from.id||w.connectionId!==m.from.connectionId)return;
  return m as unknown as RoutedMessage;
}
