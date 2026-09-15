import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardShortcuts } from '../src/online/keyboard-shortcuts.js';
const keysOf=(groups:ReturnType<typeof keyboardShortcuts>)=>groups.flatMap(group=>group.entries.map(([keys])=>keys));
test('every group carries entries and no key is listed twice',()=>{
  const groups=keyboardShortcuts({mac:false,canConfigure:true,solo:false});
  assert.ok(groups.length>=4);
  for(const group of groups)assert.ok(group.entries.length>0,`${group.title} is empty`);
  const keys=keysOf(groups).filter(key=>key!=='—');
  assert.deepEqual(keys,[...new Set(keys)]);
});
test('the power-up key is offered only to whoever may change settings',()=>{
  assert.ok(keysOf(keyboardShortcuts({mac:false,canConfigure:true,solo:true})).includes('Ctrl+P'));
  assert.ok(!keysOf(keyboardShortcuts({mac:false,canConfigure:false,solo:false})).some(key=>key.endsWith('+P')));
});
test('a Mac shows ⌘ only where the handler accepts it',()=>{
  const mac=keyboardShortcuts({mac:true,canConfigure:true,solo:false});
  assert.ok(keysOf(mac).includes('⌘P'),'power-ups accepts ⌘');
  assert.ok(keysOf(mac).includes('Ctrl+A'),'the radio keys require a real Ctrl');
});
test('a solo run does not point at a room dialog it has no room for',()=>{
  const entries=keyboardShortcuts({mac:false,canConfigure:true,solo:true}).flatMap(group=>group.entries.map(([,action])=>action));
  assert.ok(!entries.some(action=>action.includes('ROOM dialog')));
});
