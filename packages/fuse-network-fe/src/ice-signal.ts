/** Pure SDP/candidate readers; no addresses are retained, only types and session identifiers. */
export type CandidateType='host'|'srflx'|'prflx'|'relay'|'end'|'unknown';
export function candidateType(candidate:string|null|undefined):CandidateType {
  if(!candidate)return 'end';
  const type=/\styp\s+(\w+)/.exec(candidate)?.[1];
  return type==='host'||type==='srflx'||type==='prflx'||type==='relay'?type:'unknown';
}
export function sdpUfrags(sdp:string|undefined):string[] { return [...(sdp??'').matchAll(/^a=ice-ufrag:(\S+)/gm)].map(m=>m[1]!); }
export function sdpFingerprint(sdp:string|undefined):string|undefined { return /^a=fingerprint:(.+)$/m.exec(sdp??'')?.[1]?.trim(); }
/** A restart offer from the same RTCPeerConnection keeps its DTLS certificate; a fresh connection changes it. */
export function sameCertificate(previousSdp:string|undefined,nextSdp:string):boolean {
  if(previousSdp===undefined)return true;
  const previous=sdpFingerprint(previousSdp);
  return previous!==undefined&&previous===sdpFingerprint(nextSdp);
}
/** Candidates name their ICE generation by ufrag; an unmatched ufrag belongs to another offer and must wait or be dropped. */
export function ufragMatches(candidate:{usernameFragment?:string|null;candidate?:string|null},sdp:string):boolean {
  const ufrag=candidate.usernameFragment??/\sufrag\s+(\S+)/.exec(candidate.candidate??'')?.[1];
  return !ufrag||sdpUfrags(sdp).includes(ufrag);
}
