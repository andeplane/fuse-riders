import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { RoomStore } from './room-store.js';
import { FirestoreRoomDatabase } from './firestore-store.js';
import { PubSubRoomBus } from './pubsub-bus.js';
import { RoomGateway } from './gateway.js';
import { createRoomServer } from './http.js';

import type { AuthClient } from 'google-auth-library';
import { pathToFileURL } from 'node:url';

export function startService(authClient?:AuthClient):void {
const required=(key:string):string=>{const value=process.env[key];if(!value)throw new Error(`${key} is required`);return value;};
const projectId=required('GOOGLE_CLOUD_PROJECT'),region=required('GCP_REGION'),topic=required('PUBSUB_TOPIC');
const prefix=process.env.ROOM_COLLECTION_PREFIX??'fuse-preview';
if(!/^[a-z][a-z0-9-]{1,50}$/.test(prefix)||!/^[a-z0-9-]+$/.test(region))throw new Error('Invalid resource configuration');
const origins=new Set(required('ALLOWED_ORIGINS').split(',').map(value=>new URL(value.trim()).origin));
const gatewayId=randomUUID();
const firestore=new Firestore({projectId,databaseId:process.env.FIRESTORE_DATABASE_ID??'(default)',ignoreUndefinedProperties:true,...(authClient?{authClient}:{})});
const pubsub=new PubSub({projectId,apiEndpoint:`${region}-pubsub.googleapis.com:443`,...(authClient?{authClient}:{})});
const database=new FirestoreRoomDatabase(firestore,prefix);
const store=new RoomStore(database,{now:()=>Date.now(),id:randomUUID});
const bus=new PubSubRoomBus(pubsub,topic,gatewayId,prefix);
// Never log requests, query strings, room tokens or raw transport frames.
const gateway=new RoomGateway(gatewayId,store,bus,{now:()=>Date.now(),id:randomUUID,error:(kind,error)=>console.error(JSON.stringify({kind,errorType:error instanceof Error?error.name:'unknown'}))});
const server=createRoomServer({store,gateway,allowOrigin:origin=>origins.has(origin),
  // Cloud Run supplies the external forwarding chain; use the final address, not arbitrary leading entries.
  clientAddress:req=>{const forwarded=req.headers['x-forwarded-for'];return (typeof forwarded==='string'?forwarded.split(',').at(-1)?.trim():undefined)??req.socket.remoteAddress??'unknown';}});
const port=Number(process.env.PORT??8080);server.listen(port,'0.0.0.0',()=>{const address=server.address();console.log(JSON.stringify({service:'fuse-riders-gateway',port:address&&typeof address==='object'?address.port:port,region,projectId,database:process.env.FIRESTORE_DATABASE_ID??'(default)'}));});
let shuttingDown=false;
const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;server.close();void gateway.stop().finally(async()=>{await Promise.allSettled([firestore.terminate(),pubsub.close()]);});};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startService();
