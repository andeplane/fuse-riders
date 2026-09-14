import test from 'node:test';
import assert from 'node:assert/strict';
import { recipientAcknowledgements } from '../src/online/recipient-ack.js';
import { WorldEncoder,WorldDecoder } from '../src/online/world-codec.js';
import { KeyframeDelivery } from '../src/online/keyframe-delivery.js';
import { createGame,toSnapshot } from '../src/shared/game.js';

test('serialized recipient acknowledgement preserves own zero and negative sequences without other seats',()=>{
  const ack={host:19,alice:0,bob:-1};
  assert.deepEqual(JSON.parse(JSON.stringify(recipientAcknowledgements(ack,'alice'))),{alice:0});
  assert.deepEqual(recipientAcknowledgements(ack,'bob'),{bob:-1});
  assert.deepEqual(recipientAcknowledgements(ack,'display'),{});
  assert.deepEqual(recipientAcknowledgements(ack,'toString'),{});
  const own=recipientAcknowledgements(ack,'alice');own.alice=99;
  assert.equal(ack.alice,0);
});

test('recipient ack envelopes preserve complete keyframe retry and unchanged world decoding',()=>{
  const snapshot=toSnapshot(createGame('ack-test')),acks={alice:7,bob:8};
  for(const recipient of ['alice','bob','display']){
    const encoder=new WorldEncoder(1),frame=encoder.encode(snapshot,'match',1,0);
    const decoder=new WorldDecoder(),world={type:'world',frame,ack:recipientAcknowledgements(acks,recipient)};
    const serialized=JSON.parse(JSON.stringify(world)) as typeof world;
    assert.deepEqual(decoder.decode(serialized.frame),{status:'accepted',state:snapshot});
    const delivery=new KeyframeDelivery<typeof world>();delivery.hold(world,0);
    const sent:typeof world[]=[];delivery.pump(0,value=>{sent.push(value);return true;});
    world.ack[recipient]=999;delivery.pump(500,value=>{sent.push(value);return true;});
    assert.deepEqual(sent[1]!.ack,serialized.ack);
    const next=encoder.encode({...snapshot,boundaryInset:1},'match',1,1);
    assert.equal(next.base,frame.seq);
    assert.deepEqual(decoder.decode(next),{status:'accepted',state:{...snapshot,boundaryInset:1}});
  }
});
