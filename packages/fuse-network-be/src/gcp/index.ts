import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import type { AuthClient } from 'google-auth-library';
import { RoomStore } from '../room-store.js';
import { RoomGateway } from '../gateway.js';
import { createRoomServer } from '../http.js';
import { FirestoreRoomDatabase } from './firestore-store.js';
import { PubSubRoomBus } from './pubsub-bus.js';
export { FirestoreRoomDatabase } from './firestore-store.js';
export { PubSubRoomBus } from './pubsub-bus.js';

export interface GcpRoomServiceOptions {
  /** Logged on start, e.g. `my-game-gateway`. */
  serviceName:string;
  /** Firestore collection and Pub/Sub subscription prefix when ROOM_COLLECTION_PREFIX is unset. */
  defaultPrefix:string;
  /** Explicit credentials for a local smoke; Cloud Run uses its service account. */
  authClient?:AuthClient;
  maxGuests?:number;
  fullMessage?:string;
}
/**
 * The Cloud Run room service: Firestore holds room metadata, Pub/Sub routes signalling between instances.
 * Reads GOOGLE_CLOUD_PROJECT, GCP_REGION, PUBSUB_TOPIC, ALLOWED_ORIGINS, and optionally ROOM_COLLECTION_PREFIX,
 * FIRESTORE_DATABASE_ID and PORT.
 */
export function startGcpRoomService(options:GcpRoomServiceOptions):Server {
  const {authClient}=options;
  const required=(key:string):string=>{const value=process.env[key];if(!value)throw new Error(`${key} is required`);return value;};
  const projectId=required('GOOGLE_CLOUD_PROJECT'),region=required('GCP_REGION'),topic=required('PUBSUB_TOPIC');
  const prefix=process.env.ROOM_COLLECTION_PREFIX??options.defaultPrefix;
  if(!/^[a-z][a-z0-9-]{1,50}$/.test(prefix)||!/^[a-z0-9-]+$/.test(region))throw new Error('Invalid resource configuration');
  const origins=new Set(required('ALLOWED_ORIGINS').split(',').map(value=>new URL(value.trim()).origin));
  const gatewayId=randomUUID();
  const firestore=new Firestore({projectId,databaseId:process.env.FIRESTORE_DATABASE_ID??'(default)',ignoreUndefinedProperties:true,...(authClient?{authClient}:{})});
  const pubsub=new PubSub({projectId,apiEndpoint:`${region}-pubsub.googleapis.com:443`,...(authClient?{authClient}:{})});
  const database=new FirestoreRoomDatabase(firestore,prefix,options.maxGuests);
  const store=new RoomStore(database,{now:()=>Date.now(),id:randomUUID,maxGuests:options.maxGuests,fullMessage:options.fullMessage});
  const bus=new PubSubRoomBus(pubsub,topic,gatewayId,prefix);
  // Never log requests, query strings, room tokens or raw transport frames.
  const gateway=new RoomGateway(gatewayId,store,bus,{now:()=>Date.now(),id:randomUUID,error:(kind,error)=>console.error(JSON.stringify({kind,errorType:error instanceof Error?error.name:'unknown'}))});
  const server=createRoomServer({store,gateway,allowOrigin:origin=>origins.has(origin),
    // Cloud Run supplies the external forwarding chain; use the final address, not arbitrary leading entries.
    clientAddress:req=>{const forwarded=req.headers['x-forwarded-for'];return (typeof forwarded==='string'?forwarded.split(',').at(-1)?.trim():undefined)??req.socket.remoteAddress??'unknown';}});
  const port=Number(process.env.PORT??8080);server.listen(port,'0.0.0.0',()=>{const address=server.address();console.log(JSON.stringify({service:options.serviceName,port:address&&typeof address==='object'?address.port:port,region,projectId,database:process.env.FIRESTORE_DATABASE_ID??'(default)'}));});
  let shuttingDown=false;
  const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;server.close();void gateway.stop().finally(async()=>{await Promise.allSettled([firestore.terminate(),pubsub.close()]);});};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
  return server;
}
