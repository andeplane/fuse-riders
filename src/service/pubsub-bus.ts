import { PubSub, type Message, type Subscription, type Topic } from '@google-cloud/pubsub';
import { randomUUID } from 'node:crypto';
import { BUS_FRAME_MAX_BYTES, parseRoutedMessage, type RoomBus, type RoutedMessage } from './room-bus.js';

export class PubSubRoomBus implements RoomBus {
  private subscription?:Subscription;
  private topic:Topic;
  private edges=new Map<string,Promise<void>>();
  private receiving=new Map<string,Promise<void>>();
  private pendingBytes=0;
  private generation=0;
  private stopping=false;
  constructor(private client:PubSub,topic:string,private gatewayId:string,private prefix:string){
    this.topic=client.topic(topic,{messageOrdering:true,gaxOpts:{timeout:3000,retry:null},batching:{maxMilliseconds:2,maxMessages:20,maxBytes:128_000}});
  }
  async start(receive:(message:RoutedMessage)=>Promise<void>,failed:(error:Error)=>void):Promise<void>{
    if(this.subscription)return;
    this.stopping=false;const generation=++this.generation;
    const name=`${this.prefix}-${randomUUID()}`;
    const [subscription]=await this.topic.createSubscription(name,{
      gaxOpts:{timeout:5000,retry:null},
      filter:`attributes.destination = "${this.gatewayId}"`,enableMessageOrdering:true,
      expirationPolicy:{ttl:{seconds:86400}},messageRetentionDuration:{seconds:600},
      flowControl:{maxMessages:128,maxBytes:2_000_000,allowExcessMessages:false},
    });
    this.subscription=subscription;
    subscription.on('error',error=>{if(generation===this.generation&&!this.stopping)failed(error);});
    subscription.on('message',(message:Message)=>{
      if(generation!==this.generation||this.stopping){message.ack();return;}
      const key=message.orderingKey||message.id;
      const previous=this.receiving.get(key)??Promise.resolve();
      const work=previous.then(async()=>{
        if(message.data.byteLength>BUS_FRAME_MAX_BYTES){message.ack();return;}
        let decoded:unknown;try{decoded=JSON.parse(message.data.toString('utf8'));}catch{message.ack();return;}
        const routed=parseRoutedMessage(decoded);
        if(routed)await receive(routed);
        message.ack();
      }).catch(error=>{message.ack();if(!this.stopping)failed(error instanceof Error?error:new Error('Bus delivery failed'));});
      this.receiving.set(key,work);void work.finally(()=>{if(this.receiving.get(key)===work)this.receiving.delete(key);});
    });
    // Creation is committed and the pull handler is installed before admission can advertise this gateway.
  }
  async publish(message:RoutedMessage):Promise<void>{
    if(!this.subscription||this.stopping)throw new Error('Room bus is not ready');
    const generation=this.generation;
    const data=Buffer.from(JSON.stringify(message)),key=`${message.incarnation}:${message.from.connectionId}:${message.to.connectionId}`;
    if(data.byteLength>BUS_FRAME_MAX_BYTES||this.pendingBytes+data.byteLength>2_000_000)throw new Error('Room bus backpressure limit');
    this.pendingBytes+=data.byteLength;
    const previous=this.edges.get(key)??Promise.resolve();
    const work=previous.then(async()=>{if(this.stopping||generation!==this.generation)throw new Error('Signal generation closed');await this.topic.publishMessage({data,attributes:{destination:message.destination},orderingKey:key});});
    this.edges.set(key,work);
    try{await work;}finally{if(generation===this.generation)this.pendingBytes-=data.byteLength;if(this.edges.get(key)===work)this.edges.delete(key);}
  }
  private async settleWithin(work:Promise<unknown>,milliseconds:number):Promise<void>{
    await new Promise<void>(resolve=>{const timer=setTimeout(resolve,milliseconds);void work.finally(()=>{clearTimeout(timer);resolve();});});
  }
  async stop():Promise<void>{
    this.stopping=true;this.generation++;
    const subscription=this.subscription;this.subscription=undefined;
    if(!subscription)return;
    // Never let provider retries or a stalled metadata read prevent bounded reconnect/idle teardown.
    await this.settleWithin(Promise.allSettled([...this.edges.values(),...this.receiving.values(),subscription.close()]),5000);
    await subscription.delete({timeout:5000,retry:null}).catch(error=>{if((error as {code?:number}).code!==5)throw error;});
    this.edges.clear();this.receiving.clear();this.pendingBytes=0;
  }
}
