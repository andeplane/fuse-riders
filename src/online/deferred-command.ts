/** One recent host intention may wait briefly for a clock refresh, never for a new authority. */
export class DeferredCommand<T> {
  private pending?:{value:T;expires:number};
  offer(value:T,now:number):void{this.pending={value,expires:now+5000};}
  drain(now:number,permitted:boolean):{status:'waiting'|'empty'|'expired'}|{status:'ready';value:T}{
    if(!this.pending)return{status:'empty'};
    if(now>=this.pending.expires){this.pending=undefined;return{status:'expired'};}
    if(!permitted)return{status:'waiting'};
    const {value}=this.pending;this.pending=undefined;return{status:'ready',value};
  }
  clear():void{this.pending=undefined;}
}
