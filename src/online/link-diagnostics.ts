import type { SignalCounts } from './remote-signal.js';
/** Redacted per-link view: candidate types, states and counts only; never addresses, tokens or links. */
export interface LinkDiagnostic {
  peer:'host'|'guest';
  local:Partial<Record<string,number>>;
  remote:Partial<Record<string,number>>;
  gathering:string;ice:string;connection:string;signaling:string;channel:string;
  selected?:{local:string;remote:string;protocol:string};
  dtls?:string;sctp?:string;
  signalling:SignalCounts&{offersOut:number;offersIn:number;answersOut:number;answersIn:number;candidatesOut:number;relayFailed:number};
  restarts:{attempts:number;max:number;exhausted:boolean};
  healthy:boolean;ageMs:number;lastFailure?:string;
}
const NAT='candidates exchanged, ICE failed — likely symmetric NAT/CGNAT on one side (no TURN relay; try the host\'s Wi-Fi)';
export function explainLink(d:LinkDiagnostic):string {
  const total=(record:Partial<Record<string,number>>)=>Object.entries(record).reduce((sum,[type,count])=>sum+(type==='end'?0:count??0),0);
  if(d.healthy)return 'direct link healthy';
  // Chrome stops gathering once a pair connects, so a connected LAN link legitimately shows host candidates only.
  if(d.connection==='connected'&&d.channel==='open')return 'direct link connected — waiting for gameplay probe acknowledgements';
  if(d.connection==='connected')return `ICE connected, data channel ${d.channel} (DTLS ${d.dtls??'?'}, SCTP ${d.sctp??'?'})`;
  if(d.peer==='host'&&d.signalling.offersIn===0)return 'no offer received from host — signalling never delivered the offer';
  if(d.peer==='guest'&&d.signalling.offersOut===0)return 'offer not sent yet — waiting for the room service';
  if(!d.local.srflx&&!d.local.relay&&d.gathering!=='new')return 'no reflexive candidate from STUN — this device cannot reach the STUN servers (UDP blocked?)';
  if(d.peer==='guest'&&d.signalling.answersIn===0)return 'no answer received from guest — signalling never delivered the answer';
  if(total(d.remote)===0)return 'no remote candidates — signalling delivered no ICE candidates';
  if(!d.remote.srflx&&!d.remote.relay)return 'peer sent no reflexive candidate — the peer cannot reach STUN (UDP blocked?)';
  if(d.restarts.exhausted)return `gave up after ${d.restarts.attempts} ICE restarts: ${NAT}`;
  if(d.ice==='failed'||d.ice==='disconnected'||d.connection==='failed')return NAT;
  if(d.ice==='checking'&&d.ageMs>=8000)return `ICE still checking after ${Math.round(d.ageMs/1000)}s — ${NAT}`;
  return `ICE ${d.ice}, gathering ${d.gathering}`;
}
export function formatLinkDiagnostics(links:LinkDiagnostic[],ice:{servers:number;source:string},socket:string):string {
  const types=(record:Partial<Record<string,number>>)=>Object.entries(record).map(([type,count])=>`${type}×${count}`).join(' ')||'none';
  const lines=[`room service: ${socket} · STUN servers: ${ice.servers} (${ice.source})`];
  if(!links.length)lines.push('no peer links yet');
  for(const [index,d] of links.entries()){
    const s=d.signalling;
    lines.push(`link ${index+1} (${d.peer}): ${explainLink(d)}`,
      `  local ${types(d.local)} · remote ${types(d.remote)} · pair ${d.selected?`${d.selected.local}→${d.selected.remote}/${d.selected.protocol}`:'none'}`,
      `  ice ${d.ice} · gathering ${d.gathering} · pc ${d.connection} · signaling ${d.signaling} · channel ${d.channel} · dtls ${d.dtls??'?'} · sctp ${d.sctp??'?'}`,
      `  signalling offers ${s.offersOut}↑ ${s.offersIn}↓ · answers ${s.answersOut}↑ ${s.answersIn}↓ · candidates ${s.candidatesOut}↑ ${s.candidates}↓ (applied ${s.applied}, buffered ${s.buffered}, rejected ${s.rejected}, dropped ${s.dropped}, relay failed ${s.relayFailed})`,
      `  restarts ${d.restarts.attempts}/${d.restarts.max}${d.restarts.exhausted?' (exhausted)':''} · age ${Math.round(d.ageMs/1000)}s${d.lastFailure?` · last failure: ${d.lastFailure}`:''}`);
  }
  return lines.join('\n');
}
