/** Service identity may survive RTC recreation; callback ownership must use object identity. */
export function isCurrentLinkCallback<T extends {channel?:unknown}>(current:T|undefined,captured:T,channel?:unknown):boolean {
 return current===captured&&(channel===undefined||captured.channel===channel);
}
