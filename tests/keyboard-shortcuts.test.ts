import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardShortcuts } from '../src/online/keyboard-shortcuts.js';
import { radioShortcut } from '../src/client/radio.js';
const keysOf=(groups:ReturnType<typeof keyboardShortcuts>)=>groups.flatMap(group=>group.entries.map(([keys])=>keys));
const titlesOf=(groups:ReturnType<typeof keyboardShortcuts>)=>groups.map(group=>group.title);
test('a room host sees every group, and no key is listed twice',()=>{
  const groups=keyboardShortcuts({mac:false,canConfigure:true,solo:false});
  assert.deepEqual(titlesOf(groups),['Driving','Menus','Radio','Diagnostics','Left to the browser']);
  for(const group of groups)assert.ok(group.entries.length>0,`${group.title} is empty`);
  const keys=keysOf(groups).filter(key=>key!=='—');
  assert.deepEqual(keys,[...new Set(keys)]);
});
test('the power-up key is offered only to whoever may change settings',()=>{
  assert.ok(keysOf(keyboardShortcuts({mac:false,canConfigure:true,solo:true})).includes('Ctrl+P'));
  for(const mac of [false,true])assert.ok(!keysOf(keyboardShortcuts({mac,canConfigure:false,solo:false})).some(key=>/P$/.test(key)),`${mac?'mac':'pc'} joiner is offered a key it cannot use`);
});
test('a Mac shows ⌘ only where the handler accepts it',()=>{
  const mac=keyboardShortcuts({mac:true,canConfigure:true,solo:false});
  assert.ok(keysOf(mac).includes('⌘P'),'power-ups accepts ⌘');
  assert.ok(keysOf(mac).includes('Ctrl+A'),'the radio keys require a real Ctrl');
});
test('a solo run is not pointed at a room dialog or a network panel it does not have',()=>{
  const groups=keyboardShortcuts({mac:false,canConfigure:true,solo:true});
  assert.ok(!titlesOf(groups).includes('Diagnostics'),'an empty group is dropped rather than shown');
  const actions=groups.flatMap(group=>group.entries.map(([,action])=>action));
  assert.ok(!actions.some(action=>action.includes('ROOM dialog')||action.includes('?stats=1')));
  assert.ok(actions.some(action=>action.includes('a solo run starts over')),'reload is described for solo');
});
// The list is hand-written prose; this is what keeps it honest about the keys the audio handler actually claims.
test('every advertised radio key is one the radio handler answers',()=>{
  const radio=keyboardShortcuts({mac:false,canConfigure:true,solo:false}).find(group=>group.title==='Radio')!;
  const expected:Record<string,string>={'Ctrl+A':'radio','Ctrl+M':'muteAll','Ctrl+Alt+M':'muteMusic','Ctrl+Alt+E':'muteEffects'};
  assert.deepEqual(radio.entries.map(([keys])=>keys),Object.keys(expected),'the advertised radio keys are the ones checked here');
  for(const [keys] of radio.entries){
    const parts=keys.split('+');
    const event={code:`Key${parts[parts.length-1]}`,ctrlKey:parts.includes('Ctrl'),altKey:parts.includes('Alt'),shiftKey:parts.includes('Shift'),metaKey:false,repeat:false,preventDefault(){}};
    assert.equal(radioShortcut(event),expected[keys],`${keys} is advertised as "${expected[keys]}" but the handler answers differently`);
  }
});
