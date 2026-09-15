/** Every key the game itself claims, grouped for the ? dialog (#168). Pure text: the handlers live in ui.ts,
 *  game-audio.ts and controller-keyboard.ts, and this list is what a player is told they can press. */
export interface ShortcutGroup { title:string; entries:readonly (readonly [keys:string,action:string])[] }
export interface ShortcutContext { mac:boolean; canConfigure:boolean; solo:boolean }
/** ⌘ on a Mac only where the handler accepts it: the radio keys require a real Ctrl, so they stay Ctrl everywhere. */
export function keyboardShortcuts({mac,canConfigure,solo}:ShortcutContext):ShortcutGroup[]{
  const groups:ShortcutGroup[]=[
    {title:'Driving',entries:[['← / A','Steer left'],['→ / D','Steer right'],['Space','Hold to charge, release to fire']]},
    {title:'Menus',entries:[
      ...(canConfigure?[[mac?'⌘P':'Ctrl+P','Configure power-ups (takes over the browser print dialog)'] as const]:[]),
      ['Esc','Close the open dialog'],
    ]},
    {title:'Radio',entries:[['Ctrl+A','Open the radio'],['Ctrl+M','Mute everything'],['Ctrl+Alt+M','Mute music'],['Ctrl+Alt+E','Mute effects']]},
    {title:'Diagnostics',entries:solo?[]:[
      ['—','Network stats and link diagnostics live in the ROOM dialog'],
      ['—','?stats=1 in the address bar opens the network panel on load'],
    ]},
    {title:'Left to the browser',entries:[[mac?'⌥⌘I':'F12 · Ctrl+Shift+I','Developer tools'],[mac?'⌘R':'Ctrl+R',solo?'Reload — a solo run starts over':'Reload — a room rejoins by itself']]},
  ];
  return groups.filter(group=>group.entries.length>0); // a solo run has neither a room dialog nor a network panel, so that group goes entirely
}
