import test from 'node:test';
import assert from 'node:assert/strict';
import { BotController, botRandom, botDifficulty, botDisplayName, rollBotDifficulty, BOT_DIFFICULTIES, BOT_NAMES, BOT_TIERS, type BotDifficulty } from '../src/shared/bot-controller.js';
import { createGame, addPlayer, startMatch, step, SLOT_COLORS, type GameState } from '../src/shared/game.js';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { CHECKPOINT_VERSION } from '../src/online/checkpoint.js';
function fixture(){
  const game=createGame('bot-fixture');
  addPlayer(game,{id:'bot:1',name:'AI',slot:0,color:SLOT_COLORS[0]});addPlayer(game,{id:'human',name:'Player',slot:1,color:SLOT_COLORS[1]});
  startMatch(game);for(let i=0;i<60;i++)step(game,new Map());
  Object.assign(game.players.get('bot:1')!,{x:400,y:450,angle:0});Object.assign(game.players.get('human')!,{x:1100,y:450,angle:Math.PI});
  return game;
}
const room=()=>new HostSession('host',defaultRoomSettings(),{token:()=>crypto.randomUUID(),botRandom:()=>.25});
const aiCommand={type:'bot',action:'add'} as const;

test('AI is deterministic, uses its injected random stream and never mutates the observed world',()=>{
  const game=fixture(),before=structuredClone(game);let calls=0;
  const bot=new BotController({random:()=>{calls++;return.5;}});
  assert.deepEqual(bot.input(game,'bot:1'),bot.input(game,'bot:1'));assert.equal(calls,1,'one draw per decision, and the reaction window reuses it');assert.deepEqual(game,before);
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
    if(powerup==='targetBombArmed'){
      const aim=press.aim!;assert.ok(aim.x>=0&&aim.x<=1&&aim.y>=0&&aim.y<=1,'aim stays inside the arena');
      assert.ok(Math.abs(aim.x*game.width-600)<=BOT_TIERS[botDifficulty('AI')].aimError&&Math.abs(aim.y*game.height-450)<=BOT_TIERS[botDifficulty('AI')].aimError,'aim misses by at most the AI error');
    }
    step(game,new Map([[player.id,press]]));step(game,new Map([[player.id,bot.input(game,player.id)]]));
    const release=bot.input(game,player.id);assert.equal(release.bombCommands?.[0]?.action,'release');
    step(game,new Map([[player.id,release]]));assert.equal(player[powerup],false);
  }
});

test('AI holds longer for a distant bomb when the room uses a slower aim time',()=>{
  const game=fixture(),bot=new BotController(),player=game.players.get('bot:1')!;
  game.players.get('human')!.x=800;
  player.bombChargeStartedTick=game.tick-8;
  game.settings={...defaultRoomSettings(),bombChargeTicks:24};
  assert.equal(bot.input(game,player.id).bombCommands,undefined,'eight ticks is still charging at the slower pace');
  game.settings={...game.settings,bombChargeTicks:8};
  assert.equal(bot.input(game,player.id).bombCommands?.[0]?.action,'release','eight ticks reaches full distance at the fast pace');
});

test('Host alone can manage AI, five shared slots are enforced, and a solo host can start',()=>{
  const session=room();session.command('host',{type:'join',name:'Host'});
  assert.match(session.command('guest',aiCommand)!,/host/);
  for(let i=0;i<4;i++)assert.equal(session.command('host',aiCommand),undefined);
  session.advance();assert.equal(session.game.players.size,5);assert.match(session.command('host',aiCommand)!,/full/);
  assert.match(session.command('bot:1',{type:'input',seq:1,left:true,right:false,bomb:true})!,/controlled/);
  assert.match(session.command('guest',{type:'bot',action:'remove',id:'bot:1'})!,/host/);
  assert.equal(session.command('host',{type:'action',action:'start'}),undefined);session.advance();assert.equal(session.game.phase,'countdown');
  assert.match(session.command('host',{type:'bot',action:'remove',id:'bot:1'})!,/between rounds/);
});

test('AI arriving during a match waits and appears in the next round without a timed click',()=>{
  const session=room();session.command('host',{type:'join',name:'Host'});session.command('host',aiCommand);session.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)session.advance();session.command('host',aiCommand);session.advance();
  const newcomer=session.snapshot().players.find(player=>player.id==='bot:2')!;assert.equal(newcomer.waitingForNextRound,true);assert.equal(newcomer.alive,false);
  for(let i=0;i<1200&&session.game.round===1;i++)session.advance();
  assert.ok(session.game.round>1);assert.equal(session.game.players.get('bot:2')!.connected,true);assert.equal(session.game.players.get('bot:2')!.alive,true);
});

test('AI removal/reset frees its slot without converting humans or reusing old bot identity',()=>{
  const session=room();session.command('host',{type:'join',name:'Host'});session.command('host',aiCommand);session.advance();
  session.disconnect('bot:1');assert.equal(session.game.players.get('bot:1')!.connected,true);
  assert.match(session.command('host',{type:'bot',action:'remove',id:'host'})!,/not found/);
  assert.equal(session.command('host',{type:'bot',action:'remove',id:'bot:1'}),undefined);session.advance();assert.equal(session.game.players.size,1);
  session.command('host',aiCommand);session.advance();assert.ok(session.game.players.has('bot:2'));
  session.command('host',{type:'action',action:'start'});session.command('host',{type:'action',action:'lobby'});session.advance();assert.ok(session.game.players.has('bot:2'));
});

test('Checkpoint v3 restores only validated bot ownership and rejects malformed registries atomically',()=>{
  const session=room();session.command('host',{type:'join',name:'Host'});session.command('human',{type:'join',name:'Friend'});session.command('host',aiCommand);session.advance();
  const raw=session.checkpoint(),encoded=JSON.parse(raw);assert.equal(encoded.version,CHECKPOINT_VERSION);
  const restored=room();assert.equal(restored.restore(raw),true);assert.equal(restored.game.players.get('bot:1')!.connected,true);assert.equal(restored.game.players.get('host')!.connected,false);assert.equal(restored.game.players.get('human')!.connected,false);
  const before=restored.checkpoint();
  for(const ids of [['human'],['host'],['bot:missing'],['bot:1','bot:1'],['bot:1',7],null]){assert.equal(restored.restore(JSON.stringify({...encoded,botIds:ids})),false);assert.equal(restored.checkpoint(),before);}
  assert.equal(restored.restore(JSON.stringify({...encoded,version:2})),false);
  assert.equal(restored.command('bot:1',{type:'join',name:'Spoof'}),'AI riders are controlled by the host');
});

test('An AI that values space refuses a dead end it could not turn around inside',()=>{
  const decide=(difficulty:BotDifficulty,capped:boolean)=>{
    const game=fixture(),rider=game.players.get('bot:1')!,other=game.players.get('human')!;
    Object.assign(rider,{x:400,y:450,angle:0,trail:[],name:botDisplayName('Ada',difficulty)});
    Object.assign(other,{x:400,y:80,alive:false,trail:[]});
    game.pickups=[];game.bombs.clear();game.blasts=[];
    const wall=(x1:number,y1:number,x2:number,y2:number)=>{
      const steps=Math.ceil(Math.hypot(x2-x1,y2-y1)/8);
      for(let i=0;i<steps;i++)other.trail.push({x1:x1+(x2-x1)*i/steps,y1:y1+(y2-y1)*i/steps,x2:x1+(x2-x1)*(i+1)/steps,y2:y1+(y2-y1)*(i+1)/steps,createdTick:0,expiresAtTick:game.tick+999});
    };
    // A 100px corridor: narrower than the ~107px a rider needs to turn around, so the capped one is fatal to enter.
    wall(430,400,900,400);wall(430,500,900,500);if(capped)wall(900,400,900,500);
    const input=new BotController().input(game,rider.id);return input.left||input.right;
  };
  for(const difficulty of ['medium','hard'] as const){
    assert.equal(decide(difficulty,true),true,`${difficulty} must refuse a dead end while there is still room to turn`);
    assert.equal(decide(difficulty,false),false,`${difficulty} must still enter a corridor that leads somewhere`);
  }
  assert.equal(decide('easy',true),false,'the easy rider weighs no space at all and drives into it');
});

test('Every AI is rolled a difficulty that shows in its name and steers its own controller',()=>{
  assert.deepEqual([0,.34,.67,.99].map(rollBotDifficulty),['easy','medium','hard','hard']);
  for(const base of BOT_NAMES)for(const difficulty of BOT_DIFFICULTIES){
    const name=botDisplayName(base,difficulty);
    assert.equal(botDifficulty(name),difficulty,`${name} must read back its own tier`);
    assert.ok(name.length<=20,`${name} must fit the 20 character rider name the action log accepts`);
  }
  assert.equal(botDifficulty('Ada'),'medium','a name carrying no tier falls back to the middle');
  const [easy,medium,hard]=BOT_DIFFICULTIES.map(difficulty=>BOT_TIERS[difficulty]);
  assert.ok(easy!.aimError>medium!.aimError&&medium!.aimError>hard!.aimError,'a harder AI aims better');
  assert.ok(easy!.reactionTicks>medium!.reactionTicks&&medium!.reactionTicks>hard!.reactionTicks,'a harder AI answers sooner');
  assert.ok(hard!.lookaheadTicks>=medium!.lookaheadTicks&&medium!.lookaheadTicks>easy!.lookaheadTicks,'a harder AI looks further');
});

test('AI target-bomb aim misses by a bounded amount that stays fixed for one shot',()=>{
  const game=fixture(),bot=new BotController(),player=game.players.get('bot:1')!,enemy=game.players.get('human')!;
  enemy.x=600;player.targetBombArmed=true;
  const press=bot.input(game,player.id),aim=press.aim!;
  const miss={x:aim.x*game.width-enemy.x,y:aim.y*game.height-enemy.y};
  assert.ok(miss.x!==0&&miss.y!==0,'a real random stream never aims perfectly');
  assert.ok(Math.abs(miss.x)<=BOT_TIERS[botDifficulty('AI')].aimError&&Math.abs(miss.y)<=BOT_TIERS[botDifficulty('AI')].aimError,'the miss stays within the AI error');
  step(game,new Map([[player.id,press]]));
  const holding=bot.input(game,player.id)!;
  const held={x:holding.aim!.x*game.width-enemy.x,y:holding.aim!.y*game.height-enemy.y};
  assert.ok(Math.abs(held.x-miss.x)<1e-6&&Math.abs(held.y-miss.y)<1e-6,'the same shot keeps the same miss while charging');
  assert.deepEqual(new BotController({random:()=>.5}).input(game,player.id).aim,{x:enemy.x/game.width,y:enemy.y/game.height},'a centred stream aims dead on');
});

test('Adding an AI rolls its difficulty and shows it on the roster',()=>{
  const session=room();session.command('host',{type:'join',name:'Host'});session.command('host',aiCommand);session.advance();
  const bot=session.game.players.get('bot:1')!;
  assert.equal(bot.name,botDisplayName('Turing','easy'),'the injected roll lands on easy and the roster says so');
  assert.equal(botDifficulty(bot.name),'easy');
});
