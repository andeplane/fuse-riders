import test from 'node:test';
import assert from 'node:assert/strict';
import { BotController, botRandom } from '../src/shared/bot-controller.js';
import { createGame, addPlayer, startMatch, step, SLOT_COLORS, type GameState } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { applyTick, createRoomState, freeSlot, type StreamEntries } from '../src/shared/apply-tick.js';
import { ACTION, BOT, JOIN, STEER, type Entry } from '../src/shared/input-log.js';
function fixture(){
  const game=createGame('bot-fixture');
  addPlayer(game,{id:'bot:1',name:'AI',slot:0,color:SLOT_COLORS[0]});addPlayer(game,{id:'human',name:'Player',slot:1,color:SLOT_COLORS[1]});
  startMatch(game);for(let i=0;i<60;i++)step(game,new Map());
  Object.assign(game.players.get('bot:1')!,{x:400,y:450,angle:0});Object.assign(game.players.get('human')!,{x:1100,y:450,angle:Math.PI});
  return game;
}
function logged(){
  const state=createRoomState('bots',defaultRoomSettings()),bots=new BotController();let seq=0;
  const tick=(...entries:[string,unknown[]][])=>applyTick(state,'host',new Map<string,StreamEntries>(entries.map(([id,body])=>[id,{generation:1,entries:[[++seq,state.game.tick+1,...body] as Entry]}])),bots);
  return {state,tick};
}

test('AI is deterministic, uses its injected random stream and never mutates the observed world',()=>{
  const game=fixture(),before=structuredClone(game);let calls=0;
  const bot=new BotController({random:()=>{calls++;return.5;}});
  assert.deepEqual(bot.input(game,'bot:1'),bot.input(game,'bot:1'));assert.equal(calls,2);assert.deepEqual(game,before);
  assert.equal(botRandom(42,'bot:1',17),botRandom(42,'bot:1',17));assert.notEqual(botRandom(42,'bot:1',17),botRandom(42,'bot:2',17));
});

test('AI is neutral when absent, dead, disconnected or waiting for next round',()=>{
  const game=fixture(),bot=new BotController();const neutral={left:false,right:false,bomb:false};
  assert.deepEqual(bot.input(game,'missing'),neutral);
  game.players.get('bot:1')!.alive=false;assert.deepEqual(bot.input(game,'bot:1'),neutral);
  game.players.get('bot:1')!.alive=true;game.players.get('bot:1')!.connected=false;assert.deepEqual(bot.input(game,'bot:1'),neutral);
  game.players.get('bot:1')!.connected=true;game.phase='countdown';assert.deepEqual(bot.input(game,'bot:1'),neutral);
});

test('AI turns away from imminent walls, trails and rider paths',()=>{
  const bot=new BotController({random:()=>.25});
  for(const hazard of ['wall','trail','rider'] as const){
    const game=fixture(),player=game.players.get('bot:1')!,other=game.players.get('human')!;
    if(hazard==='wall'){player.x=game.width-50;}
    if(hazard==='trail')other.trail=[{x1:440,y1:435,x2:440,y2:465,createdTick:0,expiresAtTick:999}];
    if(hazard==='rider'){other.x=490;other.angle=Math.PI;}
    const input=bot.input(game,player.id);assert.ok(input.left||input.right,`${hazard} should provoke avoidance`);
  }
});

test('AI considers expired and recent own trails, pickups, blasts, shells and drunk heading without changing physics',()=>{
  const game=fixture(),player=game.players.get('bot:1')!,bot=new BotController({random:()=>.75});
  player.trail=[{x1:player.x,y1:player.y,x2:player.x,y2:player.y,createdTick:game.tick,expiresAtTick:game.tick+160}];
  game.pickups=[{id:1,type:'shell',x:500,y:550,expiresAtTick:999}];
  game.blasts=[{bombId:1,ownerId:'human',circle:{x:475,y:450,radius:30},expiresAtTick:999}];
  game.bombs.set(1,{id:1,ownerId:'human',x:490,y:480,launchX:490,launchY:480,placedTick:60,launchedTick:60,landsAtTick:999,explodeAtTick:999,flightPath:[],blastRange:0,shell:{vx:-450,vy:0}});
  player.drunkStartedTick=game.tick-5;player.drunkUntilTick=game.tick+50;
  const before=structuredClone(game);assert.equal(typeof bot.input(game,player.id).left,'boolean');assert.deepEqual(game,before);
  game.blasts[0]!.expiresAtTick=0;player.trail[0]!.expiresAtTick=0;game.bombs.get(1)!.shell=undefined;game.bombs.get(1)!.explodeAtTick=game.tick+2;game.bombs.get(1)!.blastRange=50;
  assert.equal(typeof bot.input(game,player.id).right,'boolean');
});

test('AI presses, holds and releases ordinary bombs through the same charge/cooldown rules',()=>{
  const game=fixture(),bot=new BotController(),player=game.players.get('bot:1')!;
  game.players.get('human')!.x=660;
  const press=bot.input(game,player.id);assert.equal(press.bombCommands?.[0]?.action,'press');step(game,new Map([[player.id,press]]));
  assert.notEqual(player.bombChargeStartedTick,undefined);
  const holding=bot.input(game,player.id);assert.equal(holding.bomb,true);assert.equal(holding.bombCommands,undefined);
  for(let i=0;i<24&&!game.bombs.size&&game.phase==='playing';i++)step(game,new Map([[player.id,bot.input(game,player.id)]]));
  assert.ok([...game.bombs.values()].some(bomb=>bomb.ownerId===player.id),'normal simulation must launch the AI bomb');
  assert.ok(player.bombReadyAtTick>game.tick);assert.equal(bot.input(game,player.id).bomb,false);
});

test('AI target/gun/shell shots use normal input actions and target aim is bounded',()=>{
  for(const powerup of ['targetBombArmed','gunArmed','shellArmed'] as const){
    const game=fixture(),bot=new BotController(),player=game.players.get('bot:1')!;
    game.players.get('human')!.x=600;player[powerup]=true;
    const press=bot.input(game,player.id);assert.equal(press.bombCommands?.[0]?.action,'press');
    if(powerup==='targetBombArmed')assert.deepEqual(press.aim,{x:600/game.width,y:450/game.height});
    step(game,new Map([[player.id,press]]));step(game,new Map([[player.id,bot.input(game,player.id)]]));
    const release=bot.input(game,player.id);assert.equal(release.bombCommands?.[0]?.action,'release');
    step(game,new Map([[player.id,release]]));assert.equal(player[powerup],false);
  }
});

test('AI riders are logged by the creator, take the five shared slots, and never steer from a stream of their own',()=>{
  const {state,tick}=logged();tick(['host',[JOIN,'host','Host',0,'fox',1]]);
  for(let i=1;i<=4;i++)tick(['host',[BOT,'add',`bot:${i}`,`AI ${i}`,freeSlot(state.game)]]);
  assert.equal(state.game.players.size,5);assert.equal(freeSlot(state.game),-1);
  tick(['host',[BOT,'add','bot:5','AI 5',4]]);assert.equal(state.game.players.size,5,'an occupied slot is rejected without throwing');
  const heading=state.game.players.get('bot:1')!.angle;tick(['bot:1',[STEER,1]]);assert.equal(state.game.players.get('bot:1')!.angle,heading,'a stream named after a bot is ignored');
  tick(['guest',[BOT,'remove','bot:1']]);assert.equal(state.game.players.has('bot:1'),true,'only the creator manages AI');
  tick(['host',[ACTION,'start','m']]);assert.equal(state.game.phase,'countdown');
  tick(['host',[BOT,'remove','bot:1']]);assert.equal(state.game.players.has('bot:1'),true,'removal waits for a round boundary');
});

test('AI arriving during a match waits and appears in the next round; removal between rounds frees its slot',()=>{
  const {state,tick}=logged();tick(['host',[JOIN,'host','Host',0,'fox',1]]);tick(['host',[BOT,'add','bot:1','AI Ada',1]]);tick(['host',[ACTION,'start','m']]);
  for(let i=0;i<60;i++)tick();tick(['host',[BOT,'add','bot:2','AI Turing',2]]);
  const newcomer=state.game.players.get('bot:2')!;assert.equal(newcomer.alive,false);assert.equal(state.game.roundParticipants.has('bot:2'),false);
  for(let i=0;i<1200&&state.game.round===1;i++)tick();
  assert.ok(state.game.round>1);assert.equal(state.game.players.get('bot:2')!.connected,true);assert.equal(state.game.players.get('bot:2')!.alive,true);
  tick(['host',[ACTION,'lobby','m2']]);assert.ok(state.game.players.has('bot:2'));
  tick(['host',[BOT,'remove','bot:2']]);assert.equal(state.game.players.has('bot:2'),false);assert.equal(freeSlot(state.game),2);
  tick(['host',[BOT,'add','bot:3','AI Hopper',2]]);assert.ok(state.game.players.has('bot:3'),'a removed bot identity is not reused');
});
