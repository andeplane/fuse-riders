/** Service identity may survive RTC recreation; callback ownership must use object identity. */
export function isCurrentLinkCallback<T extends {channel?:unknown}>(current:T|undefined,captured:T,channel?:unknown):boolean {
 return current===captured&&(channel===undefined||captured.channel===channel);
}

interface PulseLink {
 channel?: { readyState: string }; fast?: { readyState: string }; fastBinding?: object;
 gate: { draining: boolean }; fastGate: { draining: boolean };
}
/** Application callbacks may replace a binding or association before returning their proof. */
export function isCurrentPulseCallback<T extends PulseLink>(current:T|undefined,captured:T,fast:unknown,binding:object,wasActivated:boolean):boolean {
 return wasActivated&&current===captured&&captured.fast===fast&&captured.fastBinding===binding&&captured.fast?.readyState==='open'&&captured.channel?.readyState==='open'&&!captured.fastGate.draining&&!captured.gate.draining;
}
