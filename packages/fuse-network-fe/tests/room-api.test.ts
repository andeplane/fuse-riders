import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, endRoom, memberToken } from '../src/room-api.js';

const apiUrl=(path:string)=>`https://rooms.test${path}`;
type Call={url:string;init?:RequestInit};
const fetcher=(calls:Call[],response:Response):typeof fetch=>async(input,init)=>{calls.push({url:String(input),init});return response;};

test('createRoom posts to the room service and returns validated credentials',async()=>{
  const calls:Call[]=[];
  assert.deepEqual(await createRoom(apiUrl,fetcher(calls,Response.json({code:'AB42',token:'t',extra:1},{status:201}))),{code:'AB42',token:'t'});
  assert.deepEqual(calls.map(call=>[call.url,call.init?.method]),[['https://rooms.test/api/rooms','POST']]);
  await assert.rejects(createRoom(apiUrl,fetcher([],Response.json({error:'Room creation limit; try later'},{status:429}))),/Room creation limit/);
  await assert.rejects(createRoom(apiUrl,fetcher([],new Response('oops',{status:503}))),/Could not create room/);
  await assert.rejects(createRoom(apiUrl,fetcher([],Response.json({code:7}))),/Could not create room/);
});
test('endRoom authenticates with the creator token and keeps the caller\'s abort signal',async()=>{
  const calls:Call[]=[],signal=new AbortController().signal;
  await endRoom(apiUrl,'AB42','secret',{signal,keepalive:true},fetcher(calls,Response.json({ok:true})));
  assert.equal(calls[0]!.url,'https://rooms.test/api/rooms/AB42/end');
  assert.deepEqual([calls[0]!.init?.method,calls[0]!.init?.signal,calls[0]!.init?.keepalive,new Headers(calls[0]!.init?.headers).get('authorization')],['POST',signal,true,'Bearer secret']);
  await assert.rejects(endRoom(apiUrl,'AB42','nope',{},fetcher([],Response.json({error:'Only the host can end this room'},{status:403}))),/Only the host/);
});
test('memberToken is a fresh 64-hex identity the room service accepts',()=>{
  const a=memberToken(),b=memberToken();
  assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);
});
