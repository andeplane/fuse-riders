import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { WebSocketServer } from 'ws';
import { RoomStore, RoomError, digest, peerId, validCode, validToken } from './room-store.js';
import { FirestoreRoomDatabase } from './firestore-store.js';
import { PubSubRoomBus } from './pubsub-bus.js';
import { RoomGateway } from './gateway.js';
import { DEFAULT_ICE_SERVERS } from '../online/ice-config.js';

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
const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin)){res.writeHead(403);res.end('Origin denied');return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.writeHead(204);res.end();return;}
  const json=(value:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
    const url=new URL(req.url??'/','http://gateway');
    if(url.pathname==='/api/health'||url.pathname==='/healthz'){json({ok:true});return;}
    if(url.pathname==='/api/ready'||url.pathname==='/readyz'){json({ok:gateway.state!=='failed',state:gateway.state,connections:gateway.connections},gateway.state==='failed'?503:200);return;}
    if(url.pathname==='/api/rooms'&&req.method==='POST'){
      // Cloud Run supplies the external forwarding chain; use the final address, not arbitrary leading entries.
      const forwarded=req.headers['x-forwarded-for'];const ip=(typeof forwarded==='string'?forwarded.split(',').at(-1)?.trim():undefined)??req.socket.remoteAddress??'unknown';
      if(!await database.allowance(digest(ip),Date.now(),30)){json({error:'Room creation limit; try later'},429);return;}
      const token=randomBytes(32).toString('hex'),code=await store.createAvailable(token);json({code,token},201);return;
    }
    const end=url.pathname.match(/^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/end$/);
    if(end&&req.method==='POST'){await store.end(end[1]!,req.headers.authorization?.replace(/^Bearer /,'')??'');json({ok:true});return;}
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/ice$/);
    if(match){const token=url.searchParams.get('token')??'';if(!validToken(token)){json({error:'Invalid identity'},401);return;}const room=await store.get(match[1]);if(!room.members[peerId(token)]||room.members[peerId(token)].expiresAt<=Date.now()){json({error:'Join the room first'},403);return;}json({iceServers:DEFAULT_ICE_SERVERS,relayConfigured:false});return;}
    json({error:'Not found'},404);
  }catch(error){console.error(JSON.stringify({kind:'http-operation',errorType:error instanceof Error?error.name:'unknown',code:(error as {code?:unknown})?.code}));json({error:error instanceof RoomError?error.message:'Room service unavailable'},error instanceof RoomError?error.status:503);}
});
const sockets=new WebSocketServer({noServer:true,maxPayload:32_000,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
  const origin=req.headers.origin,url=new URL(req.url??'/','http://gateway'),match=url.pathname.match(/^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/ws$/),token=url.searchParams.get('token')??'';
  if(!origin||!origins.has(origin)||!match||!validCode(match[1])||!validToken(token)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>{
    let connectionId:string|undefined,closed=false;let pending:string[]=[];
    ws.on('message',(raw,binary)=>{if(binary){ws.close(1003,'Text frames required');return;}const data=raw.toString();if(connectionId)void gateway.receive(connectionId,data);else if(pending.length<4)pending.push(data);else ws.close(1008,'Wait for welcome');});
    ws.on('close',()=>{closed=true;pending=[];if(connectionId)void gateway.disconnect(connectionId);});
    ws.on('error',()=>{ws.close();});
    void gateway.connect(match[1],token,ws).then(id=>{connectionId=id;if(closed){void gateway.disconnect(id);return;}for(const data of pending)void gateway.receive(id,data);pending=[];}).catch(error=>{console.error(JSON.stringify({kind:'admission',errorType:error instanceof Error?error.name:'unknown',code:(error as {code?:unknown})?.code}));ws.close(error instanceof RoomError&&error.status===404?4004:4000,error instanceof RoomError?error.message:'Room service unavailable');});
  });
});
const port=Number(process.env.PORT??8080);server.listen(port,'0.0.0.0',()=>{const address=server.address();console.log(JSON.stringify({service:'fuse-riders-gateway',port:address&&typeof address==='object'?address.port:port,region,projectId,database:process.env.FIRESTORE_DATABASE_ID??'(default)'}));});
let shuttingDown=false;
const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;server.close();void gateway.stop().finally(async()=>{await Promise.allSettled([firestore.terminate(),pubsub.close()]);});};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startService();
