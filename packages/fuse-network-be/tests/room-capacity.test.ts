import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRoomDatabase, RoomError, RoomStore } from '../src/index.js';

const token=(n:number)=>n.toString(16).padStart(64,'0');
async function fill(store:RoomStore,guests:number):Promise<string>{
  const code=await store.createAvailable(token(1));
  for(let n=0;n<guests;n++)await store.admit(code,token(10+n),'gateway');
  return code;
}
test('capacity is configurable and always keeps the creator a seat',async()=>{
  let ids=0;const store=new RoomStore(new MemoryRoomDatabase(),{now:()=>1000,id:()=>`id-${++ids}`,maxGuests:2,fullMessage:'Table is full'});
  const code=await fill(store,2);
  await assert.rejects(store.admit(code,token(99),'gateway'),(error:unknown)=>error instanceof RoomError&&error.status===429&&error.message==='Table is full');
  assert.equal((await store.admit(code,token(1),'gateway')).member.host,true);
});
test('default capacity is the creator plus five with neutral wording',async()=>{
  let ids=0;const store=new RoomStore(new MemoryRoomDatabase(),{now:()=>1000,id:()=>`id-${++ids}`});
  const code=await fill(store,5);
  await assert.rejects(store.admit(code,token(99),'gateway'),(error:unknown)=>error instanceof RoomError&&error.message==='Room full');
});
