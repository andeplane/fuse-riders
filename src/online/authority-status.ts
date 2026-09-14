/** Recovery changes status once; healthy ticks must preserve command errors and other notices. */
export function authorityTransitionStatus(wasActive:boolean,permitted:boolean):string|undefined {
 if(!permitted)return 'Paused — confirming room authority';
 if(!wasActive)return 'Room authority confirmed';
}
