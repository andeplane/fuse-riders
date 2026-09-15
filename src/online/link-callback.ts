/** Service identity may survive RTC recreation; callback ownership must use object identity. */
export function isCurrentLinkCallback<T extends object>(current:T|undefined,captured:T,channel?:unknown):boolean {
 return current===captured&&(channel===undefined||(captured as {channel?:unknown}).channel===channel);
}
