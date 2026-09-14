/** Boot-card copy while a room links up: plain progress first, then the network hint once ICE has failed or plainly stalled. */
export function connectHint(status:string,elapsedMs:number):string{
 if(/ICE failed|NAT|relay|unreachable/i.test(status)||elapsedMs>=20000)
  return 'No link to the host yet. This phone is probably on a different network — join the host’s Wi-Fi, then reload.';
 if(elapsedMs>=6000)return 'Still reaching the host…';
 return 'Warming up the arena…';
}
