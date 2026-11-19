import {apiBaseFromEnv} from './endpoints';
export class ApiError extends Error {
  constructor(public status:number,public code:string,message:string,public details:Record<string,any>={}){super(message);}
  get offline(){return this.status===0||this.status===502||this.status===503||this.status===504;}
}
export interface TokenReply {access_token:string;user_id:string;expires_in:number;profile?:Profile}
export interface Profile {id:string;email:string;display_name:string;avatar:string;xp:number;level:number;money:number;currency:string;settings:Record<string,unknown>;achievements:string[];unlocks:string[]}
export interface BusModel {id:string;name:string;category:string;price:number;required_level:number;drive_ready:boolean;stats:{power_kw:number;capacity:number;fuel_tank_l:number;comfort:number;energy:string;battery_kwh:number|null;physics_status:string;physics_profile:Record<string,unknown>|null}}
export interface OwnedBus {id:string;model_id:string;upgrades:Record<string,number>;paint:string;damage:number;mileage_m:number;fuel_l:number}
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class ApiClient {
  access='';expectedUser='';private refreshing:Promise<void>|null=null;
  constructor(public base=apiBaseFromEnv(import.meta.env),private transport:typeof fetch=(input,init)=>globalThis.fetch(input,init),private sleep=wait){
    try{this.access=sessionStorage.getItem('citybus.access.v1')??'';}catch{/* Offline gameplay does not depend on token storage. */}
  }
  setToken(reply:TokenReply){this.access=reply.access_token;this.expectedUser=reply.user_id;try{sessionStorage.setItem('citybus.access.v1',this.access);}catch{/* In-memory access token remains usable. */}}
  clear(){this.access='';this.expectedUser='';try{sessionStorage.removeItem('citybus.access.v1');}catch{}}
  async raw<T>(path:string,method='GET',body?:unknown,authenticated=true):Promise<T>{
    let response:Response;
    try{response=await this.transport(`${this.base.replace(/\/$/,'')}${path}`,{method,credentials:'include',cache:'no-store',signal:AbortSignal.timeout(7000),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(authenticated&&this.access?{Authorization:`Bearer ${this.access}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new ApiError(0,'offline','Server unreachable. Your game and local saves still work.');}
    if(response.status===204)return undefined as T;
    let data:any;try{data=await response.json();}catch{throw new ApiError(response.status>=500?response.status:502,'invalid_response','The server is unavailable or returned an invalid response.');}
    if(!response.ok)throw new ApiError(response.status,data.error?.code??'request_failed',data.error?.message??'Request failed.',data.error?.details??{});
    return data as T;
  }
  async refresh(){
    if(this.refreshing)return this.refreshing;
    const rotate=async()=>{const reply=await this.raw<TokenReply>('/auth/refresh','POST',undefined,false);if(this.expectedUser&&reply.user_id!==this.expectedUser){this.clear();throw new ApiError(401,'account_changed','Another account signed in. Sign in again before syncing this account.');}this.setToken(reply);};
    this.refreshing=(async()=>{if(typeof navigator!=='undefined'&&navigator.locks)await navigator.locks.request('citybus-refresh',rotate);else await rotate();})().finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async request<T>(path:string,options:{method?:string;body?:unknown;auth?:boolean;retry?:boolean}={}):Promise<T>{
    const method=options.method??'GET',auth=options.auth!==false;
    const canRetry=options.retry??['GET','PUT','PATCH','DELETE'].includes(method);
    let refreshed=false;
    for(let attempt=0;;attempt++){
      let sent=false;
      try{if(auth&&!this.access)await this.refresh();sent=true;return await this.raw<T>(path,method,options.body,auth);}
      catch(error){if(!(error instanceof ApiError))throw error;
        if(error.status===401&&auth&&!refreshed&&sent){refreshed=true;this.access='';await this.refresh();attempt--;continue;}
        if(canRetry&&attempt<2&&(error.offline||error.status===429)){await this.sleep(error.status===429?Math.min(5000,Number(error.details.retry_after??1)*1000):250*2**attempt+Math.random()*100);continue;}
        throw error;
      }
    }
  }
}
