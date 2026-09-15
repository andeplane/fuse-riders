/** Structural subset of RTCIceServer usable from the service/worker builds without the DOM lib. */
export interface IceServer { urls:string|string[];username?:string;credential?:string }
/** STUN only (ADR035: no TURN). Two providers so one unreachable STUN host cannot leave a peer host-only. */
export const DEFAULT_ICE_SERVERS:readonly IceServer[]=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}];
export const ICE_FETCH_TIMEOUT_MS=3000;
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
/** One fetch per admission; every peer connection awaits the result so none negotiates without STUN (issue #27). */
export class IceConfig {
  servers:IceServer[]=[...DEFAULT_ICE_SERVERS];
  source='default';
  private ready:Promise<void>=Promise.resolve();
  /** A hung fetch must not block every link: the abort signal bounds it even when the injected fetch ignores the signal. */
  load(fetchRaw:(signal:AbortSignal)=>Promise<unknown>,signal:AbortSignal=AbortSignal.timeout(ICE_FETCH_TIMEOUT_MS)):Promise<void> {
    const aborted=new Promise<never>((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    this.ready=(signal.aborted?aborted:Promise.race([fetchRaw(signal),aborted])).then(raw=>{const parsed=parseIceServers(raw);this.servers=parsed??[...DEFAULT_ICE_SERVERS];this.source=parsed?'service':'default (service list invalid)';},()=>{this.servers=[...DEFAULT_ICE_SERVERS];this.source='default (ice fetch failed)';});
    return this.ready;
  }
  async iceServers():Promise<IceServer[]>{await this.ready;return this.servers;}
}
