import { Firestore, Timestamp } from '@google-cloud/firestore';
import { parseRoomRecord, type RoomDatabase, type RoomRecord } from '../room-store.js';

/** The operation callback is pure and may be retried by Firestore. */
export class FirestoreRoomDatabase implements RoomDatabase {
  constructor(private firestore:Firestore,private prefix:string){}
  private room(code:string){return this.firestore.collection(`${this.prefix}-rooms`).doc(code);}
  private parse(value:unknown):RoomRecord|undefined{if(value===undefined)return;const room=parseRoomRecord(value);if(!room)throw new Error('Stored room schema is incompatible');return room;}
  async read(code:string):Promise<RoomRecord|undefined>{return this.parse((await this.room(code).get()).data());}
  async transact<T>(code:string,operation:(current:RoomRecord|undefined)=>{room?:RoomRecord;result:T}):Promise<T>{
    const ref=this.room(code);
    return this.firestore.runTransaction(async transaction=>{
      const snapshot=await transaction.get(ref),next=operation(this.parse(snapshot.data()));
      if(next.room)transaction.set(ref,{...next.room,cleanupAt:Timestamp.fromMillis(next.room.expiresAt)});
      return next.result;
    },{maxAttempts:5});
  }
  watch(code:string,listener:(room:RoomRecord|undefined)=>void,failed:(error:Error)=>void):()=>void{
    return this.room(code).onSnapshot(snapshot=>{try{listener(this.parse(snapshot.data()));}catch(error){failed(error instanceof Error?error:new Error('Room metadata failure'));}},failed);
  }
  async allowance(key:string,now:number,limit:number):Promise<boolean>{
    const ref=this.firestore.collection(`${this.prefix}-creation-limits`).doc(key),hour=Math.floor(now/3600000);
    return this.firestore.runTransaction(async transaction=>{
      const data=(await transaction.get(ref)).data();const count=data?.hour===hour&&Number.isSafeInteger(data.count)?Number(data.count)+1:1;
      if(count>limit)return false;
      transaction.set(ref,{hour,count,cleanupAt:Timestamp.fromMillis(now+3600000)});return true;
    },{maxAttempts:5});
  }
}
