import {ApiError} from '../online/api';
import type {OnlineSync} from '../online/sync';
import {advance,capToWindow,emptyState,wearNew,RULES,type Snapshot,type State,type Fleet,type Wear} from './engine';
import {previewCommand,type CompanyCommand} from './commands';
export class TycoonClient {
 fleetConflicts:{id:string;bus_id:string;revision:number;local:Record<string,unknown>;server:Record<string,unknown>}[]=[];
 snapshot:Snapshot|null=null;queue:CompanyCommand[]=[];status='Local company';busy=false;conflict='';onChange:()=>void=()=>{};
 private owner='';private inFlight:Promise<void>|null=null;private cacheProtected=false;
 equipped:{id:string;revision:number;wear:Wear;energy:number}|null=null;
 constructor(public online:OnlineSync){setInterval(()=>{if(!document.hidden&&(this.online.profile||this.snapshot))void this.sync();},15000);window.addEventListener('online',()=>void this.sync());}
 private key(){return `citybus.tycoon.v1.${this.owner}`;}
 private opKey(id:string){return `${this.key()}.op.${id}`;}
 private acknowledged(){try{return JSON.parse(localStorage.getItem(`${this.key()}.acked`)??'[]') as string[];}catch{return [];}}
 private acknowledge(id:string){const ids=[...new Set([...this.acknowledged(),id])].slice(-10000);localStorage.setItem(`${this.key()}.acked`,JSON.stringify(ids));localStorage.removeItem(this.opKey(id));}
 private checkOwner(id:string){if(this.online.profile?.id!==id||this.owner!==id)throw new Error('Company account changed. Reload before continuing.');}
 load(){const owner=this.online.profile?.id??'guest';if(this.owner===owner)return;this.owner=owner;this.snapshot=null;this.queue=[];this.equipped=null;this.cacheProtected=false;this.fleetConflicts=[];
  try{const raw=JSON.parse(localStorage.getItem(this.key())??'null');if(raw){if(!raw.snapshot?.state||raw.snapshot.state.schema!==1||!Array.isArray(raw.snapshot.state.assignments)||!Array.isArray(raw.snapshot.state.fleet)||!Number.isFinite(raw.snapshot.state.money))throw new Error('Invalid company cache');this.snapshot=raw.snapshot;this.queue=raw.queue??[];}this.readQueue();}
  catch{this.snapshot=null;this.queue=[];this.cacheProtected=true;this.conflict='Company cache could not be read. It was not overwritten; driving saves are separate.';}
  if(!this.snapshot&&owner==='guest'&&!this.cacheProtected){const slot=Math.floor(Date.now()/60000),s=emptyState(slot);s.fleet=[{id:'local-cb120',model_id:'cb-120',upgrades:{},paint:'#217a6d',damage:0,mileage_m:0,wear:wearNew(),energy_units:210000,revision:0,service_due_m:0,reserved:false}];s.terminals=[{id:'local-terminal',template_id:'southbank',name:'Southbank Terminal',capacity:5}];this.snapshot={revision:0,server_slot:slot,state:s,rules:RULES};}
 }
 private readQueue(){const ack=new Set(this.acknowledged()),byId=new Map(this.queue.filter(c=>!ack.has(c.operation_id)).map(c=>[c.operation_id,c]));for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)!;if(key.startsWith(`${this.key()}.op.`)){const c=JSON.parse(localStorage.getItem(key)!);if(!ack.has(c.operation_id))byId.set(c.operation_id,c);}}this.queue=[...byId.values()].sort((a,b)=>(a.created_at??a.at_slot*60000)-(b.created_at??b.at_slot*60000));}
 private save(){if(this.cacheProtected)throw new Error(this.conflict);try{for(const c of this.queue)localStorage.setItem(this.opKey(c.operation_id),JSON.stringify(c));localStorage.setItem(this.key(),JSON.stringify({snapshot:this.snapshot,queue:this.queue}));}catch{this.conflict='Storage is full. Export local data before adding more company commands.';throw new Error(this.conflict);}}
 get forecast():State|null{this.load();if(!this.snapshot)return null;const now=Math.floor(Date.now()/60000);let s=capToWindow(this.snapshot.state,now);for(const c of this.queue){if(c.error)break;try{s=previewCommand(s,{...c,at_slot:now-c.at_slot>RULES.catchup_slots?now:c.at_slot});}catch{break;}}return advance(s,Math.max(s.cursor,now));}
 async command(kind:string,args:Record<string,unknown>){this.load();if(!this.snapshot)throw new Error('Connect once to load your company.');const c:CompanyCommand={operation_id:crypto.randomUUID(),base_revision:this.snapshot.revision,at_slot:Math.floor(Date.now()/60000),created_at:Date.now(),kind,args};
  if(kind!=='reconcile')previewCommand(this.forecast!,c);
  if(!this.online.profile){const state=previewCommand(this.forecast!,c);this.snapshot={...this.snapshot,state,revision:this.snapshot.revision+1};this.save();this.status='Local demo company · separate from accounts';this.onChange();return;}
  this.queue.push(c);this.save();this.onChange();await this.sync();const rejected=this.queue.find(v=>v.operation_id===c.operation_id)?.error;if(rejected)throw new Error(rejected);
 }
 async sync(){this.load();if(this.cacheProtected||this.inFlight)return this.inFlight;
  if(!this.online.profile){if(this.snapshot){this.snapshot.state=advance(this.snapshot.state,Math.floor(Date.now()/60000));this.status='Local demo company · settled on this device';this.save();this.onChange();}return;}
  const owner=this.online.profile.id;this.inFlight=(async()=>{if(navigator.locks)await navigator.locks.request(`citybus-tycoon-${owner}`,()=>this.work(owner));else await this.work(owner);})().finally(()=>this.inFlight=null);return this.inFlight;
 }
 private async work(owner:string){this.busy=true;this.onChange();try{
  this.checkOwner(owner);this.readQueue();const cache=JSON.parse(localStorage.getItem(this.key())??'null');if(cache?.snapshot&&cache.snapshot.revision>(this.snapshot?.revision??-1))this.snapshot=cache.snapshot;
  if(!this.snapshot){const reply=await this.online.api.request<Snapshot>('/tycoon');this.checkOwner(owner);this.snapshot=reply;this.save();}
  while(this.queue.length){const c=this.queue[0];if(c.error)break;if(!c.sent)c.base_revision=this.snapshot!.revision;c.sent=true;this.save();
   try{const next=await this.online.api.request<Snapshot>('/tycoon/commands',{method:'POST',body:{operation_id:c.operation_id,base_revision:c.base_revision,at_slot:c.at_slot,kind:c.kind,args:c.args},retry:true});this.checkOwner(owner);this.snapshot=next;this.acknowledge(c.operation_id);this.queue.shift();this.save();}
   catch(e){if(e instanceof ApiError&&[409,422].includes(e.status)){c.error=e.message;this.conflict=e.message;if(e.details.snapshot)this.snapshot=e.details.snapshot;this.save();break;}throw e;}
  }
  if(!this.queue.length){const reply=await this.online.api.request<Snapshot>('/tycoon/settle',{method:'POST',body:{},retry:true});this.checkOwner(owner);this.snapshot=reply;}
  const conflicts=await this.online.api.request<{items:TycoonClient['fleetConflicts']}>('/tycoon/fleet-conflicts');this.checkOwner(owner);this.fleetConflicts=conflicts.items;
  if(this.snapshot&&this.online.profile){this.online.profile.money=this.snapshot.state.money;this.online.profile.xp=this.snapshot.state.xp;this.online.profile.level=1+Math.floor(this.snapshot.state.xp/500);}
  this.status=this.queue.some(c=>c.error)?'Command conflict · review required':this.queue.length?'Pending company commands':'Server settled · forecast current';this.save();
 }catch(e){this.status='Offline forecast · awaiting server';this.conflict=e instanceof ApiError&&e.offline?'':(e as Error).message;}finally{this.busy=false;this.onChange();}}
 async retry(){if(!this.online.profile)return;this.snapshot=await this.online.api.request<Snapshot>('/tycoon');if(this.queue[0]){const c=this.queue[0];this.acknowledge(c.operation_id);c.operation_id=crypto.randomUUID();c.base_revision=this.snapshot.revision;c.at_slot=Math.floor(Date.now()/60000);delete c.error;delete c.sent;if(c.args.bus_id){const b=this.snapshot.state.fleet.find(b=>b.id===c.args.bus_id);if(b)c.args.fleet_revision=b.revision;}}this.conflict='';this.save();await this.sync();}
 cancel(){const c=this.queue.shift();if(c)this.acknowledge(c.operation_id);this.conflict='';this.save();this.onChange();}
 async equip(bus:Fleet){if(this.forecast?.assignments.some(a=>a.active&&a.bus_id===bus.id))throw new Error('Unassign the bus before manually driving it.');await this.command('reserve',{bus_id:bus.id,fleet_revision:bus.revision,reserved:true});const current=this.forecast!.fleet.find(b=>b.id===bus.id)!;this.equipped={id:current.id,revision:current.revision,wear:{...current.wear},energy:current.energy_units};return current;}
}
