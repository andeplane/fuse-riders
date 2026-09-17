import { FieldValue, Firestore, Timestamp } from '@google-cloud/firestore';
import { parseRoomRecord, type RoomDatabase, type RoomRecord } from './room-store.js';
import { TOTAL_KEYS, emptyTotals, parseMatchRecord, type Credit, type HistoryDatabase, type MatchRecord, type UserProfile } from './history.js';
import { isAvatarId } from '../shared/avatars.js';
import { validRiderName } from '../shared/rider-name.js';

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

/**
 * Match history and account totals. Only this service reaches these collections: firestore.rules denies every browser.
 * A match that still has an `expiresAt` carries `cleanupAt` for the TTL policy; a match an account owns has neither.
 */
export class FirestoreHistoryDatabase implements HistoryDatabase {
  constructor(private firestore:Firestore,private prefix:string){}
  private matches(){return this.firestore.collection(`${this.prefix}-matches`);}
  private users(){return this.firestore.collection(`${this.prefix}-users`);}
  private parse(value:unknown):MatchRecord|undefined{if(value===undefined)return;const match=parseMatchRecord(value);if(!match)throw new Error('Stored match schema is incompatible');return match;}
  async transactMatch<T>(id:string,operation:(current:MatchRecord|undefined)=>{match?:MatchRecord;credits?:Credit[];result:T}):Promise<T>{
    const ref=this.matches().doc(id);
    return this.firestore.runTransaction(async transaction=>{
      const next=operation(this.parse((await transaction.get(ref)).data()));
      // A whole-document set, so a confirmed account match drops the cleanupAt its pending self carried.
      if(next.match)transaction.set(ref,{...next.match,...(next.match.expiresAt===undefined?{}:{cleanupAt:Timestamp.fromMillis(next.match.expiresAt)})});
      // Increments need no read, so crediting five riders costs five writes and cannot conflict with another match.
      for(const credit of next.credits??[])transaction.set(this.users().doc(credit.uid),{name:credit.name,...(credit.avatarId===undefined?{}:{avatarId:credit.avatarId}),updatedAt:credit.at,
        totals:Object.fromEntries(TOTAL_KEYS.map(key=>[key,FieldValue.increment(credit.totals[key])]))},{merge:true});
      return next.result;
    },{maxAttempts:5});
  }
  async matchesFor(uid:string,before:number|undefined,limit:number):Promise<MatchRecord[]>{
    let query=this.matches().where('participantUids','array-contains',uid);
    // Strictly older, exactly as MemoryHistoryDatabase pages.
    if(before!==undefined)query=query.where('endedAt','<',before);
    query=query.orderBy('endedAt','desc');
    // One unreadable record must not hide the rest of an account's history.
    return (await query.limit(limit).get()).docs.flatMap(doc=>{const match=parseMatchRecord(doc.data());return match?[match]:[];});
  }
  async profile(uid:string):Promise<UserProfile|undefined>{
    const data=(await this.users().doc(uid).get()).data();if(!data)return;
    const totals=emptyTotals(),stored=data.totals&&typeof data.totals==='object'?data.totals as Record<string,unknown>:{};
    for(const key of TOTAL_KEYS)if(Number.isSafeInteger(stored[key]))totals[key]=stored[key] as number;
    return{...(validRiderName(data.username)?{username:data.username}:{}),...(validRiderName(data.name)?{name:data.name}:{}),...(isAvatarId(data.avatarId)?{avatarId:data.avatarId}:{}),updatedAt:typeof data.updatedAt==='number'?data.updatedAt:0,totals};
  }
  async setUsername(uid:string,username:string,at:number):Promise<void>{await this.users().doc(uid).set({username,updatedAt:at},{merge:true});}
}
