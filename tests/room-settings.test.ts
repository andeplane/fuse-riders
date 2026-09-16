import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRoomSettings, parseRoomSettings, roomPickup, loadRoomSettings } from '../src/shared/room-settings.js';
import { BOMB_MAX_CHARGE_TICKS } from '../src/shared/bomb-launch.js';
import { ARENA_MAP_CHOICES } from '../src/shared/arena-map.js';
test('room settings reject malformed values, restore safe defaults and allow all drops off',()=>{
  const defaults=defaultRoomSettings();assert.deepEqual(parseRoomSettings(defaults),defaults);
  assert.equal(parseRoomSettings({...defaults,length:0}),undefined);
  assert.equal(parseRoomSettings({...defaults,weights:{shell:Infinity}}),undefined);
  assert.equal(parseRoomSettings({...defaults,weights:{bad:2}}),undefined);
  assert.equal(roomPickup(.5,{}),undefined);
  assert.equal(roomPickup(.1,{shell:1,gun:3}),'shell');assert.equal(roomPickup(.9,{shell:1,gun:3}),'gun');
  assert.deepEqual(loadRoomSettings({getItem:()=>'{broken'}),defaults);
});
test('the arena map validates, and a preference saved before maps existed opts into the rotation',()=>{
  const defaults=defaultRoomSettings();
  assert.equal(defaults.map,'rotate','a new room rotates the maps rather than hiding them behind a setting');
  for(const map of ARENA_MAP_CHOICES)assert.equal(parseRoomSettings({...defaults,map})?.map,map,map);
  for(const bad of ['atlantis','','rotates',1,null])assert.equal(parseRoomSettings({...defaults,map:bad}),undefined,String(bad));
  // The migration this exists for: a blob saved before maps reaches what a new room would choose, not the classic arena.
  const {map:_map,...older}=defaults;
  assert.deepEqual(parseRoomSettings(older),{...defaults,map:'rotate'});
  assert.equal(loadRoomSettings({getItem:()=>JSON.stringify(older)}).map,'rotate');
  assert.equal(loadRoomSettings({getItem:()=>JSON.stringify({...defaults,map:'city'})}).map,'city','an explicit choice is kept');
});
test('bomb aim time, chain reaction and aim bounce validate, and older saved preferences get the defaults',()=>{
  const defaults=defaultRoomSettings();
  for(const bad of [0,1.5,41,'8'])assert.equal(parseRoomSettings({...defaults,bombChargeTicks:bad}),undefined,String(bad));
  assert.equal(parseRoomSettings({...defaults,chainReaction:'yes'}),undefined);assert.equal(parseRoomSettings({...defaults,aimBounce:1}),undefined);
  const {bombChargeTicks:_charge,chainReaction:_chain,aimBounce:_bounce,...older}=defaults;
  assert.deepEqual(parseRoomSettings(older),{...defaults,bombChargeTicks:BOMB_MAX_CHARGE_TICKS,chainReaction:true,aimBounce:true});
  assert.deepEqual(loadRoomSettings({getItem:()=>JSON.stringify({...older,bombChargeTicks:24,chainReaction:false})}),{...defaults,bombChargeTicks:24,chainReaction:false});
});
