import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICE_HOLD_MS, StatusNotices } from '../src/online/status-notices.js';

const CONNECTED='Connected · direct game link';
/** The room runtime's real cadence: a 10 ms tick refresh plus an accepted world frame every 50 ms. */
function room(){
  let now=0;
  const emitted:string[]=[];
  const channel=new StatusNotices(()=>now,text=>emitted.push(text));
  const run=(ms:number,frame:string=CONNECTED)=>{
    for(let elapsed=0;elapsed<ms;elapsed+=10){now+=10;channel.refresh();if(now%50===0)channel.recurring(frame);}
  };
  return {channel,emitted,run,shown:()=>emitted.at(-1),now:()=>now};
}

test('a host error reply survives 200 ms of ticks and world frames, then the connection status returns',()=>{
  const f=room();
  f.run(500);
  assert.deepEqual(f.emitted,[CONNECTED]);
  f.channel.notice('Room is full (5 players)');
  f.run(200);
  assert.equal(f.shown(),'Room is full (5 players)');
  assert.deepEqual(f.emitted,[CONNECTED,'Room is full (5 players)']);
  f.run(NOTICE_HOLD_MS);
  assert.equal(f.shown(),CONNECTED);
  assert.deepEqual(f.emitted,[CONNECTED,'Room is full (5 players)',CONNECTED]);
});

test('unchanged recurring status is emitted once however many ticks and frames restate it',()=>{
  const f=room();
  f.run(5000);
  assert.deepEqual(f.emitted,[CONNECTED]);
  f.run(1000,'Paused — host is in the background');
  assert.deepEqual(f.emitted,[CONNECTED,'Paused — host is in the background']);
  f.run(1000);
  assert.deepEqual(f.emitted,[CONNECTED,'Paused — host is in the background',CONNECTED]);
});

test('the recurring status that returns after a notice is the latest one, not the one it replaced',()=>{
  const f=room();
  f.run(100);
  f.channel.notice('Only the host can start the match');
  f.run(2000,'Paused — confirming room authority');
  assert.equal(f.shown(),'Only the host can start the match');
  f.run(NOTICE_HOLD_MS,'Paused — confirming room authority');
  assert.equal(f.shown(),'Paused — confirming room authority');
  assert.deepEqual(f.emitted,[CONNECTED,'Only the host can start the match','Paused — confirming room authority']);
});

test('a join error survives the 500 ms join retry cadence without restating itself',()=>{
  const f=room();
  f.run(100);
  for(let attempt=0;attempt<12;attempt++){
    f.channel.notice('Choose a name');
    f.run(500);
    assert.equal(f.shown(),'Choose a name');
  }
  assert.deepEqual(f.emitted,[CONNECTED,'Choose a name']);
  f.run(NOTICE_HOLD_MS);
  assert.equal(f.shown(),CONNECTED);
});

test('a later notice replaces a live notice and extends the hold',()=>{
  const f=room();
  f.channel.notice('Room action timed out — please try again');
  f.run(1000);
  f.channel.notice('Saved game is incompatible or damaged — a fresh lobby is ready');
  f.run(NOTICE_HOLD_MS-1000);
  assert.equal(f.shown(),'Saved game is incompatible or damaged — a fresh lobby is ready');
  f.run(1000);
  assert.equal(f.shown(),CONNECTED);
  assert.deepEqual(f.emitted,['Room action timed out — please try again','Saved game is incompatible or damaged — a fresh lobby is ready',CONNECTED]);
});

test('a notice raised before any connection status is never replaced by a silent refresh',()=>{
  const f=room();
  f.channel.notice('Waiting for room authority — try again when connected');
  for(let elapsed=0;elapsed<10000;elapsed+=10)f.channel.refresh();
  assert.deepEqual(f.emitted,['Waiting for room authority — try again when connected']);
});

test('a rejected input frame flashes without holding the line or hiding a real error',()=>{
  const f=room();
  f.run(100);
  f.channel.transient('Input tick expired; resync');
  assert.equal(f.shown(),'Input tick expired; resync');
  f.run(50);
  assert.equal(f.shown(),CONNECTED);
  f.channel.notice('Room is full (5 players)');
  for(let attempt=0;attempt<10;attempt++){f.channel.transient('Input scope expired; resync');f.run(100);}
  assert.deepEqual(f.emitted,[CONNECTED,'Input tick expired; resync',CONNECTED,'Room is full (5 players)']);
  f.run(NOTICE_HOLD_MS);
  assert.equal(f.shown(),CONNECTED);
});

test('a terminal notice is never overwritten by recurring status or by later notices',()=>{
  const f=room();
  f.run(100);
  f.channel.notice('Room action timed out — please try again');
  f.channel.terminal('Game protocol changed — reload this page');
  f.run(NOTICE_HOLD_MS*3);
  f.channel.notice('Room is full (5 players)');
  f.channel.recurring('Room authority confirmed');
  f.channel.terminal('This host tab was replaced — use the newer tab');
  f.channel.transient('Input tick expired; resync');
  f.run(NOTICE_HOLD_MS);
  assert.deepEqual(f.emitted,[CONNECTED,'Room action timed out — please try again','Game protocol changed — reload this page']);
});
