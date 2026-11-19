import {ApiClient,ApiError,type Profile,type OwnedBus,type BusModel,type TokenReply} from './api';
import {LocalStore,validate,defaults,type Save,type Session} from '../storage';
import bundledCatalog from './catalog.json';
export interface Conflict {id:string;server_version:number;resolved:boolean;local:{revision_id:string;document:Save;created_at:number};server:{revision_id:string;document:Save;created_at:number}}
export interface Cloud {version:number;revision_id:string|null;document:Save|null}
interface QueuedResult {id:string;payload:Record<string,unknown>;error?:string}
interface PendingSave {operation_id:string;base_version:number;client_id:string;document:Save;fingerprint:string}
interface Meta {baseVersion:number;baseline:string;outbox:QueuedResult[];acknowledged:string[];conflict:Conflict|null;pendingSave:PendingSave|null;selectedBus:string|null}
const emptyMeta=():Meta=>({baseVersion:0,baseline:'',outbox:[],acknowledged:[],conflict:null,pendingSave:null,selectedBus:null});
export const AUTH_KEY='citybus.account.v1';
export const ownerKey='citybus.save-owner.v1';
export const metaKey=(id:string)=>`citybus.sync.v1.${id}`;
export const slotKey=(id:string|null)=>`citybus.slot.v1.${id??'guest'}`;
export function canonical(value:unknown):string {if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
export async function fingerprint(save:Save){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(save)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function submission(session:Session,ownedBus:string|null){return {run_id:session.runId,finished_at:session.date,seconds:session.seconds,meters:session.meters,liters:session.liters,impacts:session.impacts,route:session.route,...(ownedBus?{owned_bus_id:ownedBus}:{})};}

export class OnlineSync {
  api=new ApiClient();profile:Profile|null=null;meta:Meta=emptyMeta();catalog:BusModel[]=bundledCatalog as BusModel[];fleet:OwnedBus[]=[];status='Local only';message='';busy=false;connected=false;private syncTimer=0;private currentOwner:string|null=null;private clientId='';private pendingLogout=false;private stopped=false;private syncing:Promise<void>|null=null;
  onChange:()=>void=()=>{};onApply:()=>void=()=>{};canApply:()=>boolean=()=>true;
  resultExtra:()=>Record<string,unknown>=()=>({});resultEligible:()=>boolean=()=>true;
  constructor(public store:LocalStore){
    try{this.clientId=localStorage.getItem('citybus.client-id')??crypto.randomUUID();localStorage.setItem('citybus.client-id',this.clientId);this.currentOwner=localStorage.getItem(ownerKey);this.pendingLogout=localStorage.getItem('citybus.pending-logout')==='true';const raw=localStorage.getItem(AUTH_KEY);if(raw){const saved=JSON.parse(raw);if(saved.profile?.id&&saved.profile.id===this.currentOwner){this.profile=saved.profile;this.api.expectedUser=saved.profile.id;this.loadMeta(saved.profile.id);this.loadCache();this.status='Checking connection';}}}catch{this.message='Online metadata could not be read. The local game is still available.';}
    this.store.subscribe(()=>{if(this.profile)this.schedule(1200);});
    window.addEventListener('online',()=>{if(this.profile)this.schedule(100);});
    window.addEventListener('storage',e=>{if(e.key===AUTH_KEY||e.key===ownerKey){const owner=localStorage.getItem(ownerKey);let account:string|null=null;try{account=JSON.parse(localStorage.getItem(AUTH_KEY)??'null')?.profile?.id??null;}catch{}if(owner===this.currentOwner&&account===(this.profile?.id??null))return;this.stopped=true;this.api.clear();this.store.protected=true;this.store.error='Account changed in another tab. Reload before saving in this tab; its current state will be retained in its own account slot.';this.status='Account changed in another tab';this.message='Reload before continuing account sync. This tab will not upload to another account.';this.changed();}});
    setInterval(()=>{if(this.profile&&!document.hidden)this.schedule(0);},20000);
    if(this.profile)this.schedule(600);
  }
  private changed(){this.onChange();}
  private put(key:string,value:unknown){try{localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));}catch{throw new Error('Browser storage is full or unavailable. Export your local save before continuing cloud operations.');}}
  private loadMeta(id:string){const raw=localStorage.getItem(metaKey(id));this.meta=raw?{...emptyMeta(),...JSON.parse(raw)}:emptyMeta();if(!Array.isArray(this.meta.outbox)||!Array.isArray(this.meta.acknowledged))throw new Error('Invalid sync metadata');}
  private persist(){if(this.profile){if(this.currentOwner&&localStorage.getItem(ownerKey)!==this.currentOwner)throw new ApiError(401,'account_changed','Account changed in another tab. Reload before saving.');this.put(metaKey(this.profile.id),this.meta);this.put(AUTH_KEY,{profile:this.profile});}}
  private loadCache(){try{const cache=JSON.parse(localStorage.getItem(`citybus.cache.${this.profile!.id}`)??'null');if(cache){if(Array.isArray(cache.catalog)&&cache.catalog.length>=20)this.catalog=cache.catalog;if(Array.isArray(cache.fleet))this.fleet=cache.fleet;}}catch{/* Catalog fallback is bundled, not fetched from a CDN. */}}
  private cache(){if(this.profile)this.put(`citybus.cache.${this.profile.id}`,{catalog:this.catalog,fleet:this.fleet});}
  private reconcile(){if(!this.profile)return;const seen=new Set([...this.meta.acknowledged,...this.meta.outbox.map(r=>r.id)]);for(const s of this.store.data.sessions){if(s.runId&&s.route&&!seen.has(s.runId)){this.meta.outbox.push({id:s.runId,payload:submission(s,null)});seen.add(s.runId);}}}
  schedule(ms=300){if(this.stopped||!this.profile)return;clearTimeout(this.syncTimer);this.syncTimer=window.setTimeout(()=>void this.sync(),ms);}
  async authenticate(kind:'login'|'register',email:string,password:string,name?:string){
    if(!this.canApply())throw new Error('Finish the current drive before changing accounts.');
    if(!globalThis.crypto?.subtle||!globalThis.crypto?.randomUUID)throw new Error('Cloud accounts require HTTPS or localhost. Local driving is still available.');
    if(this.store.protected)throw new Error('The local save is protected because it could not be read. Export/reset it before linking an account.');
    if(this.pendingLogout){await this.api.raw('/auth/logout','POST',undefined,false);this.pendingLogout=false;localStorage.removeItem('citybus.pending-logout');}
    const reply=await this.api.request<TokenReply>(`/auth/${kind}`,{method:'POST',body:{email,password,...(kind==='register'?{display_name:name}:{})},auth:false,retry:false});
    const previous=this.currentOwner;
    this.put(slotKey(previous),this.store.data);
    if(previous!==reply.user_id){let next:Save;const raw=localStorage.getItem(slotKey(reply.user_id));if(raw)next=validate(JSON.parse(raw));else next=previous===null&&kind==='register'?structuredClone(this.store.data):structuredClone(defaults);this.store.data=next;this.store.save();}
    this.profile=reply.profile!;this.currentOwner=reply.user_id;this.put(ownerKey,reply.user_id);this.api.setToken(reply);this.loadMeta(reply.user_id);this.loadCache();this.stopped=false;this.persist();this.onApply();this.status='Connected';this.connected=true;this.changed();await this.sync();
  }
  async logout(){if(!this.canApply())throw new Error('Finish the current drive before signing out.');if(this.currentOwner&&localStorage.getItem(ownerKey)!==this.currentOwner)throw new Error('Account changed in another tab. Reload before signing out.');this.stopped=true;clearTimeout(this.syncTimer);if(this.syncing)await this.syncing;this.put(slotKey(this.currentOwner),this.store.data);try{await this.api.raw('/auth/logout','POST',undefined,false);this.pendingLogout=false;localStorage.removeItem('citybus.pending-logout');}catch{this.pendingLogout=true;this.put('citybus.pending-logout','true');}
    this.api.clear();this.profile=null;this.meta=emptyMeta();this.currentOwner=null;this.fleet=[];this.connected=false;this.stopped=false;localStorage.removeItem(AUTH_KEY);localStorage.removeItem(ownerKey);clearTimeout(this.syncTimer);
    const guest=localStorage.getItem(slotKey(null));this.store.data=guest?validate(JSON.parse(guest)):structuredClone(defaults);this.store.save();this.onApply();this.status='Local only';this.message=this.pendingLogout?'Signed out on this device. Server revocation will be retried before the next sign-in.':'';this.changed();
  }
  finish(session:Session){
    if(this.stopped){this.store.finish(session);try{this.put(slotKey(this.currentOwner),this.store.data);}catch(error){this.message=(error as Error).message;}this.changed();return;}
    if(this.profile&&session.route&&!this.stopped&&this.resultEligible()){session={...session,runId:session.runId??crypto.randomUUID()};this.meta.outbox.push({id:session.runId!,payload:{...submission(session,this.meta.selectedBus),...this.resultExtra()}});}
    this.store.finish(session);
    try{this.persist();}catch(error){this.message=(error as Error).message;}
    if(this.profile){this.status='Saved locally · queued';this.schedule(100);}this.changed();
  }
  async sync(){if(this.syncing)return this.syncing;if(!this.profile||this.stopped)return;
    this.syncing=this.performSync().finally(()=>{this.syncing=null;});return this.syncing;
  }
  private async performSync(){const id=this.profile!.id;this.busy=true;this.changed();
    const work=async()=>{
      if(this.store.protected)throw new Error('Local save is protected. Export it before syncing.');
      if(localStorage.getItem(ownerKey)!==id)throw new ApiError(401,'account_changed','The active account changed in another tab. Reload to continue.');
      // All tabs share refresh cookies and save data. A browser lock serializes
      // each account's outbox and cloud writes, not merely its network refresh.
      this.loadMeta(id);this.reconcile();this.persist();
      const profile=await this.api.request<Profile>('/profile');if(profile.id!==id||localStorage.getItem(ownerKey)!==id)throw new ApiError(401,'account_changed','Account mismatch; sync was stopped.');this.profile=profile;this.connected=true;this.persist();
      for(const queued of [...this.meta.outbox]){
        if(queued.error)continue;
        try{const reply=await this.api.request<{profile:Profile}>('/results',{method:'POST',body:queued.payload,retry:true});if(localStorage.getItem(ownerKey)!==id)throw new ApiError(401,'account_changed','Account changed during result upload. Reload to continue.');this.profile=reply.profile;this.meta.acknowledged=[...this.meta.acknowledged,queued.id].slice(-10000);this.meta.outbox=this.meta.outbox.filter(r=>r.id!==queued.id);this.persist();}
        catch(error){if(error instanceof ApiError&&[400,404,409,422].includes(error.status)){queued.error=error.message;this.persist();continue;}throw error;}
      }
      if(!this.meta.conflict){
        const current=validate(structuredClone(this.store.data)),hash=await fingerprint(current);
        if(this.meta.pendingSave||hash!==this.meta.baseline){
          if(!this.meta.pendingSave){this.meta.pendingSave={operation_id:crypto.randomUUID(),client_id:this.clientId,base_version:this.meta.baseVersion,document:current,fingerprint:hash};this.persist();}
          const pending=this.meta.pendingSave,{fingerprint:sentHash,...body}=pending;
          try{const reply=await this.api.request<Cloud>('/saves',{method:'PUT',body,retry:true});this.meta.baseVersion=reply.version;this.meta.baseline=sentHash;this.meta.pendingSave=null;this.persist();}
          catch(error){if(error instanceof ApiError&&error.code==='sync_conflict'){this.meta.conflict=error.details.conflict;this.meta.pendingSave=null;this.persist();}else throw error;}
        }else{
          const remote=await this.api.request<Cloud>('/saves');if(remote.version!==this.meta.baseVersion){
            // Even a clean local copy is not silently replaced by another device.
            // Persist both via the same optimistic write/conflict protocol.
            this.meta.pendingSave={operation_id:crypto.randomUUID(),client_id:this.clientId,base_version:this.meta.baseVersion,document:current,fingerprint:hash};this.persist();this.schedule(100);
          }
        }
      }
      const [catalog,fleet]=await Promise.all([this.api.request<{items:BusModel[]}>('/catalog',{auth:false}),this.api.request<{items:OwnedBus[]}>('/fleet')]);this.catalog=catalog.items;this.fleet=fleet.items;this.cache();
      this.status=this.meta.conflict?'Conflict · choose a version':this.meta.outbox.some(r=>r.error)?'Upload needs review':this.meta.pendingSave?'Sync queued':`Cloud v${this.meta.baseVersion} · saved`;this.message='';this.persist();
    };
    try{if(navigator.locks)await navigator.locks.request(`citybus-sync-${id}`,work);else await work();}
    catch(error){this.connected=false;if(error instanceof ApiError&&error.status===401){this.status='Sign in to reconnect';this.api.access='';}else this.status='Offline · saved on device';this.message=(error as Error).message;}
    finally{this.busy=false;this.changed();}
  }
  async resolve(choice:'local'|'server'){
    if(!this.meta.conflict||!this.profile)return;if(!this.canApply())throw new Error('Finish the current drive before choosing a cloud version.');const conflict=this.meta.conflict;
    // Preserve the latest device copy as well as the immutable server conflict
    // snapshots. Failure to store this backup blocks replacement, rather than
    // discarding a newer local edit made while the conflict dialog was open.
    const raw=localStorage.getItem(`citybus.backups.${this.profile.id}`);const backups=raw?JSON.parse(raw):[];this.put(`citybus.backups.${this.profile.id}`,[{date:new Date().toISOString(),document:validate(this.store.data)},...backups].slice(0,8));
    try{const reply=await this.api.request<Cloud>(`/saves/conflicts/${conflict.id}/resolve`,{method:'POST',body:{operation_id:crypto.randomUUID(),choice,expected_version:conflict.server_version},retry:true});this.meta.baseVersion=reply.version;this.meta.conflict=null;this.meta.pendingSave=null;this.meta.baseline=await fingerprint(validate(reply.document));if(choice==='server'){this.store.data=validate(reply.document);this.store.save();this.onApply();}this.persist();this.status=`Cloud v${reply.version} · resolved`;this.changed();this.schedule(100);}
    catch(error){if(error instanceof ApiError&&error.code==='sync_conflict'){this.meta.conflict=error.details.conflict;this.persist();this.changed();}throw error;}
  }
  selectBus(bus:OwnedBus){if(!this.profile)return;this.meta.selectedBus=bus.id;this.persist();}
  dismissRejected(){this.meta.acknowledged.push(...this.meta.outbox.filter(r=>r.error).map(r=>r.id));this.meta.outbox=this.meta.outbox.filter(r=>!r.error);this.persist();this.schedule();this.changed();}
}
