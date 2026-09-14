import test from 'node:test';
import assert from 'node:assert/strict';
import { validSignal } from '../src/service/signal.js';
const line='candidate:842163049 1 udp 1677729535 203.0.113.9 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag AbCd network-cost 999';

test('every candidate shape Chrome and Safari emit passes the signalling boundary',()=>{
  const shapes:Record<string,unknown>[]=[
    {candidate:line,sdpMid:'0',sdpMLineIndex:0,usernameFragment:'AbCd'},
    {candidate:'candidate:1 1 udp 2113937151 4f1c2e3a-9b8d-4c1e-a2f0-1b2c3d4e5f60.local 51234 typ host generation 0 ufrag AbCd network-cost 999',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'AbCd'},
    {candidate:'',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'AbCd'},
    {candidate:'',sdpMid:'0',sdpMLineIndex:0,usernameFragment:null},
    {candidate:line,sdpMid:null,sdpMLineIndex:0,usernameFragment:null},
    {candidate:line,sdpMid:'0',sdpMLineIndex:null},
    {candidate:line},
  ];
  for(const candidate of shapes)assert.equal(validSignal({candidate}),true,JSON.stringify(candidate));
});

test('descriptions from localDescription.toJSON() pass; anything else is rejected',()=>{
  assert.equal(validSignal({description:{type:'offer',sdp:'v=0'}}),true);
  assert.equal(validSignal({description:{type:'answer',sdp:'v=0'}}),true);
  for(const raw of [null,'x',[],{},{description:{type:'pranswer',sdp:'v=0'}},{description:{type:'rollback',sdp:''}},{description:{type:'offer'}},{description:{type:'offer',sdp:'v'.repeat(30_001)}},{description:{type:'offer',sdp:'v=0',extra:1}},
    {candidate:null},{candidate:{}},{candidate:{candidate:5}},{candidate:{candidate:line,foo:1}},{candidate:{candidate:'c'.repeat(2049)}},{candidate:{candidate:line,sdpMLineIndex:-1}},{candidate:{candidate:line,sdpMLineIndex:1.5}},{candidate:{candidate:line,usernameFragment:7}},
    {description:{type:'offer',sdp:'v=0'},candidate:{candidate:line}},{type:'world',bombs:[]}])
    assert.equal(validSignal(raw),false,JSON.stringify(raw));
});
