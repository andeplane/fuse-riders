/** Structural subset of RTCIceServer usable from the service/worker builds without the DOM lib. */
export interface IceServer { urls:string|string[];username?:string;credential?:string }
/** STUN only (ADR035: no TURN). Two providers so one unreachable STUN host cannot leave a peer host-only. */
export const DEFAULT_ICE_SERVERS:readonly IceServer[]=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}];
/** The service response is validated at the client boundary; undefined means nothing usable, so the caller substitutes the defaults. */
export function parseIceServers(raw:unknown):IceServer[]|undefined {
  const list=raw&&typeof raw==='object'?(raw as {iceServers?:unknown}).iceServers:undefined;
  const servers:IceServer[]=[];
  for(const item of Array.isArray(list)?list:[]){
    if(!item||typeof item!=='object')continue;
    const {urls,username,credential}=item as Record<string,unknown>;
    const entries=typeof urls==='string'?[urls]:Array.isArray(urls)?urls.filter((u):u is string=>typeof u==='string'):[];
    if(!entries.length||!entries.every(u=>/^(stun|stuns):[^\s]{1,200}$/.test(u)))continue;
    servers.push({urls:entries});
  }
  return servers.length?servers:undefined;
}
