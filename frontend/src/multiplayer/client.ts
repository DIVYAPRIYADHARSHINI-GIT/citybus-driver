import type {OnlineSync} from '../online/sync';
import {ApiError} from '../online/api';
import {websocketUrl} from '../online/endpoints';
import {validRemote,type Room,type RemotePose,type ChatMessage,type RaceResult} from './protocol';
interface Resume {code:string;token:string;user:string;model_id:string;line_id:string;paint:string;expires:number}
export class MultiplayerClient {
 socket:WebSocket|null=null;room:Room|null=null;selfId='';poses:RemotePose[]=[];chat:ChatMessage[]=[];status='Not connected';rtt=0;lastSnapshot=0;active=false;reconnecting=false;sequence=0;rejections=0;message='';
 onChange:()=>void=()=>{};onWelcome:(room:Room,pose:any,resume:boolean)=>void=()=>{};onSnapshot:(elapsed:number,poses:RemotePose[])=>void=()=>{};onRaceStart:()=>void=()=>{};onLeft:(reason:string)=>void=()=>{};onResult:(result:RaceResult)=>void=()=>{};
 private elapsedValue=0;private elapsedAt=0;private resume:Resume|null=null;private retryTimer=0;private retries=0;private manual=false;private lastSend=0;private pingTimer=0;private joinedOnce=false;
 private connecting:Promise<void>|null=null;
 constructor(public online:OnlineSync){try{const raw=JSON.parse(sessionStorage.getItem('citybus.room.v1')??'null');if(raw&&raw.user===online.profile?.id&&raw.expires>Date.now())this.resume=raw;}catch{}window.addEventListener('online',()=>{if(this.reconnecting)void this.reconnect();});}
 get elapsed(){return this.elapsedValue+Math.min(.5,Math.max(0,(performance.now()-this.elapsedAt)/1000));}
 get quality(){return !this.active?this.reconnecting?'Reconnecting':'Offline':performance.now()-this.lastSnapshot>2500?'Stalled':this.rtt>300?'Poor':this.rtt>120?'Fair':'Good';}
 get canResume(){return !!this.resume&&this.resume.expires>Date.now()&&this.resume.user===this.online.profile?.id;}
 async join(code:string,model_id='cb-120',paint='#217a6d',line_id='21',isResume=false){if(this.connecting)return this.connecting;this.connecting=this.connect(code,model_id,paint,line_id,isResume).finally(()=>this.connecting=null);return this.connecting;}
 private async connect(code:string,model_id='cb-120',paint='#217a6d',line_id='21',isResume=false){
  if(!this.online.profile)throw new Error('Sign in for optional multiplayer. Single-player remains available.');if(this.active&&!isResume)throw new Error('Leave your current room first.');this.manual=false;this.status=isResume?'Reconnecting…':'Connecting…';this.message='';this.onChange();
  let ticket:{ticket:string;websocket_path:string};try{ticket=await this.online.api.request('/multiplayer/ticket',{method:'POST',body:{code,model_id,paint,line_id,...(isResume&&this.resume?{resume_token:this.resume.token}:{})},retry:false});}catch(error){this.status='Multiplayer unavailable';this.message=(error as Error).message;this.onChange();throw error;}
  let socket:WebSocket;
  try{socket=new WebSocket(websocketUrl(this.online.api.base,location.href,import.meta.env.VITE_WS_URL,ticket.websocket_path));}
  catch(error){this.status='Multiplayer unavailable';this.message=(error as Error).message;this.onChange();throw error;}
  this.socket=socket;
  await new Promise<void>((resolve,reject)=>{let welcomed=false;const timeout=setTimeout(()=>{socket.close();reject(new Error('Room connection timed out. Local driving is unaffected.'));},8000);
   socket.onopen=()=>socket.send(JSON.stringify({type:'join',ticket:ticket.ticket}));
   socket.onerror=()=>{if(this.socket===socket)this.message='Connection interrupted. Local single-player is still available.';};
   socket.onmessage=event=>{if(this.socket!==socket||typeof event.data!=='string'||event.data.length>64000)return;let data:any;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='welcome'){
     clearTimeout(timeout);welcomed=true;const wasResume=isResume;this.room=data.room;this.selfId=data.self_id;this.sequence=Math.max(this.sequence,Number(data.pose?.seq??-1)+1);this.active=true;this.reconnecting=false;this.retries=0;this.joinedOnce=true;this.status='Connected · ghost buses';this.setClock(data.room.elapsed);this.lastSnapshot=performance.now();
     this.resume={code,token:data.resume_token,user:this.selfId,model_id,line_id,paint,expires:Date.now()+60000};this.persistResume();this.chat=Array.isArray(data.chat)?data.chat.slice(-50):[];
     this.onWelcome(this.room!,data.pose,wasResume);this.onChange();clearInterval(this.pingTimer);this.pingTimer=window.setInterval(()=>{if(this.active){this.send({type:'ping',client_time:performance.now()});this.persistResume();if(performance.now()-this.lastSnapshot>5000)this.socket?.close();}},2000);resolve();
    }else if(data.type==='snapshot'&&Array.isArray(data.players)){
     this.lastSnapshot=performance.now();this.setClock(data.elapsed);this.poses=data.players.slice(0,8).filter(validRemote);if(this.room){const previous=this.room.state;this.room.state=data.phase;this.room.race_elapsed=data.race_elapsed;this.room.countdown=data.countdown;if(previous==='lobby'&&data.phase==='countdown')this.onRaceStart();}this.onSnapshot(data.elapsed,this.poses);
    }else if(data.type==='room'){
     const old=this.room?.state;this.room=data.room;if(old==='lobby'&&this.room?.state==='countdown')this.onRaceStart();this.onChange();
    }else if(data.type==='pong'){if(typeof data.echo==='number')this.rtt=Math.max(0,performance.now()-data.echo);if(Number.isFinite(data.server_elapsed))this.setClock(data.server_elapsed);}
    else if(data.type==='chat'&&data.message&&typeof data.message.text==='string'){if(!this.chat.some(m=>m.id===data.message.id))this.chat=[...this.chat,data.message].slice(-50);this.onChange();}
    else if(data.type==='checkpoint'){const me=this.room?.members.find(m=>m.id===this.selfId);if(me)me.checkpoint=data.checkpoint;this.onChange();}
    else if(data.type==='race_result'){if(this.room){const i=this.room.results.findIndex(r=>r.player_id===data.result.player_id);if(i<0)this.room.results.push(data.result);else this.room.results[i]=data.result;}this.onResult(data.result);this.onChange();this.online.schedule(100);}
    else if(data.type==='rejected'){this.rejections++;this.message=`Movement rejected: ${data.reason}${data.review?' · integrity review flagged':''}`;this.onChange();}
    else if(data.type==='left'){this.manual=true;this.active=false;this.reconnecting=false;this.status='Left room';this.message=data.reason;this.clearResume();this.onLeft(data.reason);this.onChange();}
    else if(data.type==='error'){this.message=data.message??'Multiplayer request failed.';this.onChange();if(!welcomed){clearTimeout(timeout);this.manual=true;reject(new ApiError(409,data.code,this.message));}}
   };
   socket.onclose=()=>{clearTimeout(timeout);clearInterval(this.pingTimer);if(this.socket!==socket)return;this.active=false;
    if(!welcomed){if(!this.manual)reject(new Error(this.message||'Room connection was refused.'));}
    if(this.manual){this.status='Not connected';this.onChange();return;}
    if(this.resume){if(welcomed)this.resume.expires=Date.now()+60000;this.persistResume(false);this.reconnecting=true;this.status='Disconnected · 60 seconds to reconnect';this.onChange();this.scheduleReconnect();}
   };
  });
 }
 private setClock(elapsed:number){if(Number.isFinite(elapsed)){this.elapsedValue=elapsed;this.elapsedAt=performance.now();}}
 private persistResume(extend=true){if(this.resume){if(extend)this.resume.expires=Date.now()+60000;try{sessionStorage.setItem('citybus.room.v1',JSON.stringify(this.resume));}catch{}}}
 private clearResume(){this.resume=null;try{sessionStorage.removeItem('citybus.room.v1');}catch{}}
 private scheduleReconnect(){clearTimeout(this.retryTimer);this.retryTimer=window.setTimeout(()=>void this.reconnect(),Math.min(5000,500*2**this.retries));}
 async reconnect(){if(this.active)return;if(!this.canResume){this.reconnecting=false;this.status='Reconnect window expired';this.message='Return to multiplayer to join a new room. Single-player is unaffected.';this.clearResume();this.onLeft('reconnect_expired');this.onChange();return;}this.retries++;const saved=this.resume!;try{await this.join(saved.code,saved.model_id,saved.paint,saved.line_id,true);}catch(error){this.message=(error as Error).message;if(error instanceof ApiError&&[401,403,404,409].includes(error.status)){this.manual=true;this.reconnecting=false;this.clearResume();this.status='Room session unavailable';this.onLeft(this.message);this.onChange();}else this.scheduleReconnect();}}
 send(message:Record<string,unknown>){if(this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<32768)this.socket.send(JSON.stringify(message));}
 pose(p:number[],q:number[],speed:number,keys:Record<string,number>,articulation=0){const time=performance.now();if(!this.active||time-this.lastSend<1000/15)return;this.lastSend=time;this.send({type:'pose',seq:this.sequence++,p,q,speed,keys,articulation,client_time:time});}
 leave(notify=true){this.manual=true;clearTimeout(this.retryTimer);clearInterval(this.pingTimer);if(notify)this.send({type:'leave'});this.socket?.close(1000);this.socket=null;this.active=false;this.reconnecting=false;this.room=null;this.poses=[];this.chat=[];this.clearResume();this.status='Not connected';this.onChange();}
}
