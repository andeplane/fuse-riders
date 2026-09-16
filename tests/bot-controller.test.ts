import test from 'node:test';
import assert from 'node:assert/strict';
import { BotController, botRandom, botDifficulty, botDisplayName, rollBotDifficulty, BOT_DIFFICULTIES, BOT_TIERS } from '../src/shared/bot-controller.js';
import { createGame, addPlayer, startMatch, step, SLOT_COLORS, OVERTIME_START_TICK, type GameState } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { applyTick, createRoomState, freeSlot, BOT_NAMES, type StreamEntries } from '../src/shared/apply-tick.js';
import { ACTION, BOT, JOIN, STEER, MAX_NAME_LENGTH, type Entry } from '../src/shared/input-log.js';
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

function steeringFixture(){
  const game=fixture();
  game.nextPickupSpawnTick=Number.MAX_SAFE_INTEGER;
  for(const player of game.players.values()){
    player.trail=[];
    player.bombReadyAtTick=Number.MAX_SAFE_INTEGER;
  }
  // Keep the other rider alive so an early round ending cannot hide a bot crash.
  Object.assign(game.players.get('human')!,{x:1200,y:650,angle:0,invulnerableUntilTick:game.tick+300});
  return game;
}

function steerFor(game:GameState,ticks:number){
  const bot=new BotController();
  for(let tick=0;tick<ticks;tick++){
    step(game,new Map([['bot:1',bot.input(game,'bot:1')]]));
    assert.equal(game.players.get('bot:1')!.alive,true,`bot crashed after ${tick+1} ticks`);
    assert.equal(game.phase,'playing','the full steering scenario must actually run');
  }
}

test('AI escapes an approaching corner and keeps surviving its own fresh trails',()=>{
  const game=steeringFixture();
  Object.assign(game.players.get('bot:1')!,{x:1470,y:770,angle:Math.PI/4});
  steerFor(game,240);
});

test('AI escapes a corner as overtime starts shrinking the walls',()=>{
  const game=steeringFixture(),inset=game.boundaryInset;
  game.roundStartedTick=game.tick-OVERTIME_START_TICK+10;
  Object.assign(game.players.get('bot:1')!,{x:1470,y:770,angle:Math.PI/4});
  steerFor(game,120);
  assert.ok(game.boundaryInset>inset);
});

test('AI keeps escaping corners and its own trails at full round speed',()=>{
  const game=steeringFixture();
  game.roundStartedTick=game.tick-OVERTIME_START_TICK;
  Object.assign(game.players.get('bot:1')!,{x:1470,y:770,angle:Math.PI/4});
  steerFor(game,240);
});

test('AI avoids the trail a crossing rider will leave, including active and expiring boosts',()=>{
  for(const boostTicks of [0,4,240]){
    const game=steeringFixture();
    Object.assign(game.players.get('human')!,{x:500,y:boostTicks?400:410,angle:Math.PI/2});
    if(boostTicks)for(const player of game.players.values())player.boostUntilTick=game.tick+boostTicks;
    // An expiring boost case covers the crossing and speed transition; the
    // sustained cases also exercise several seconds of subsequent steering.
    steerFor(game,boostTicks===4?40:120);
  }
});

test('steering replay from a restored world needs no hidden planner state',()=>{
  const game=steeringFixture();
  Object.assign(game.players.get('human')!,{x:500,y:410,angle:Math.PI/2});
  steerFor(game,40);
  const restored=structuredClone(game);
  steerFor(game,80);
  steerFor(restored,80);
  assert.deepEqual(restored,game);
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
    if(powerup==='targetBombArmed'){
      const aim=press.aim!;assert.ok(aim.x>=0&&aim.x<=1&&aim.y>=0&&aim.y<=1,'aim stays inside the arena');
      const error=BOT_TIERS[botDifficulty(player.name)].aimError;
      assert.ok(Math.abs(aim.x*game.width-600)<=error&&Math.abs(aim.y*game.height-450)<=error,'aim misses by at most this tier\'s error');
    }
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

test('Every AI is rolled a difficulty that shows in its name and steers its own controller',()=>{
  assert.deepEqual([0,.34,.67,.99].map(rollBotDifficulty),['easy','medium','hard','hard']);
  for(const base of BOT_NAMES)for(const difficulty of BOT_DIFFICULTIES){
    const name=botDisplayName(base,difficulty);
    assert.equal(botDifficulty(name),difficulty,`${name} must read back its own tier`);
    assert.ok(name.length<=MAX_NAME_LENGTH,`${name} must fit the rider name the log accepts`);
  }
  assert.equal(botDifficulty('Ada'),'hard','a name carrying no tier is full strength, never a quiet downgrade');
  const [easy,medium,hard]=BOT_DIFFICULTIES.map(difficulty=>BOT_TIERS[difficulty]);
  assert.ok(easy!.aimError>medium!.aimError&&medium!.aimError>hard!.aimError,'a harder AI aims better');
  assert.equal(hard!.aimError,0,'the top tier is exactly the shipped controller, never a quiet downgrade of it');
  assert.ok(easy!.blunderRate>medium!.blunderRate&&medium!.blunderRate>hard!.blunderRate,'a harder AI lapses less');
  assert.ok(hard!.lookaheadTicks>medium!.lookaheadTicks&&medium!.lookaheadTicks>easy!.lookaheadTicks,'a harder AI plans further');
});

test('A weak rider lapses on a schedule the tick decides, so a rollback replays the same mistake',()=>{
  const game=fixture(),player=game.players.get('bot:1')!;
  // Rigged so the lapse always fires and always swerves right; the tier is the only thing that changes.
  const rigged={random:(_seed:number,id:string)=>id.endsWith(':lapse')?0:id.endsWith(':swerve')?.9:.5};
  player.name=botDisplayName('Ada','easy');
  const lapsed=new BotController(rigged).input(game,player.id);
  assert.deepEqual(lapsed,new BotController(rigged).input(game,player.id),'a fresh controller replays the same lapse from the same tick');
  assert.equal(lapsed.right,true,'a lapse swerves instead of steering well');
  player.name=botDisplayName('Ada','hard');
  const sober=new BotController(rigged).input(game,player.id);
  assert.notDeepEqual({left:sober.left,right:sober.right},{left:lapsed.left,right:lapsed.right},'the top tier never lapses');
});

test('GRIP bots plan tighter turns and survive a corner using ordinary simulation inputs', () => {
  const game = steeringFixture();
  Object.assign(game.players.get('bot:1')!, { x: 1500, y: 800, angle: Math.PI / 4, grip: true });
  steerFor(game, 120);
});


test('an upgraded bot ignores nearby GRIP drops and continues toward useful pickups', () => {
  const game = steeringFixture(), player = game.players.get('bot:1')!;
  player.grip = true;
  const bot = new BotController({ random: () => .25 });
  game.pickups = [{ id: 1, type: 'power', x: 460, y: 550, expiresAtTick: 999 }];
  const useful = bot.input(game, player.id);
  assert.equal(useful.right, true, 'the useful pickup lies to the right');
  game.pickups.push({ id: 2, type: 'grip', x: 430, y: 420, expiresAtTick: 999 });
  assert.deepEqual(bot.input(game, player.id), useful, 'uncollectible GRIP must not distract the bot');
  player.grip = false;
  assert.equal(bot.input(game, player.id).left, true, 'an eligible bot still pursues GRIP');
});
