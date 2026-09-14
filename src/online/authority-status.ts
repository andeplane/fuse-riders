/**
 * Recovery changes status once; healthy ticks must preserve command errors and other notices. Authority is
 * re-checked on every 10 ms tick, so only a real transition may produce text: losing authority announces the
 * pause once, regaining it announces the recovery once, and steady state (permitted or not) stays silent.
 */
export function authorityTransitionStatus(wasActive:boolean,permitted:boolean):string|undefined {
 if(!permitted)return wasActive?'Paused — confirming room authority':undefined;
 if(!wasActive)return 'Room authority confirmed';
}
