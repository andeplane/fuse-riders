/** Structural subset of RTCIceServer usable from the service/worker builds without the DOM lib. */
export interface IceServer { urls:string|string[];username?:string;credential?:string }
/** STUN only (ADR035: no TURN). Two providers so one unreachable STUN host cannot leave a peer host-only. */
export const DEFAULT_ICE_SERVERS:readonly IceServer[]=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}];
/** The service response is validated at the client boundary; an empty or malformed list falls back to the defaults. */
export function parseIceServers(raw:unknown):IceServer[] {
  const list=raw&&typeof raw==='object'?(raw as {iceServers?:unknown}).iceServers:undefined;
  const servers:IceServer[]=[];
  for(const item of Array.isArray(list)?list:[]){
    if(!item||typeof item!=='object')continue;
    const {urls,username,credential}=item as Record<string,unknown>;
    const entries=typeof urls==='string'?[urls]:Array.isArray(urls)?urls.filter((u):u is string=>typeof u==='string'):[];
    if(!entries.length||!entries.every(u=>/^(stun|stuns|turn|turns):[^\s]{1,200}$/.test(u)))continue;
    servers.push({urls:entries,...(typeof username==='string'?{username}:{}),...(typeof credential==='string'?{credential}:{})});
  }
  return servers.length?servers:[...DEFAULT_ICE_SERVERS];
}
/** One fetch per admission; every peer connection awaits the result so none negotiates without STUN (issue #27). */
export class IceConfig {
  servers:IceServer[]=[...DEFAULT_ICE_SERVERS];
  source='default';
  private ready:Promise<void>=Promise.resolve();
  load(fetchRaw:()=>Promise<unknown>):Promise<void> {
    this.ready=fetchRaw().then(raw=>{this.servers=parseIceServers(raw);this.source='service';},()=>{this.servers=[...DEFAULT_ICE_SERVERS];this.source='default (ice fetch failed)';});
    return this.ready;
  }
  async iceServers():Promise<IceServer[]>{await this.ready;return this.servers;}
}
