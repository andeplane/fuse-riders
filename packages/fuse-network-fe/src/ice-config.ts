import { DEFAULT_ICE_SERVERS, parseIceServers, type IceServer } from 'fuse-network-protocol';
export { DEFAULT_ICE_SERVERS, parseIceServers, type IceServer };
export const ICE_FETCH_TIMEOUT_MS=3000;
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
