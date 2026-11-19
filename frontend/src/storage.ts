import type { Quality, Weather } from './render/scene';
import type { RouteResult } from './city/service';
import type { Density } from './city/traffic';
import {allRouteIds} from './city/network';
export interface Session { date:string; seconds:number; meters:number; liters:number; impacts:number; route?:RouteResult; runId?:string }
export interface Save { version:1; paint:string; quality:Quality; weather:Weather; hour:number; volume:number; sessions:Session[]; tutorial:boolean; city?:{density:Density} }
export const defaults:Save={version:1,paint:'#217a6d',quality:'balanced',weather:'clear',hour:15,volume:.45,sessions:[],tutorial:true};
export const KEY='citybus-driver.v1';
export function validate(value:unknown):Save {
  if(!value||typeof value!=='object')throw new Error('Save is not an object');const v=value as Partial<Save>;
  if(v.version!==1||!Array.isArray(v.sessions)||v.sessions.length>500)throw new Error('Unsupported save version');
  if(typeof v.paint!=='string'||!/^#[\da-f]{6}$/i.test(v.paint)||!['low','balanced','high'].includes(v.quality??'')||!['clear','rain','fog','snow','jam'].includes(v.weather??'')||!Number.isFinite(v.hour)||v.hour!<0||v.hour!>24||!Number.isFinite(v.volume)||v.volume!<0||v.volume!>1||typeof v.tutorial!=='boolean')throw new Error('Invalid settings');
  for(const s of v.sessions){if(!s||typeof s.date!=='string'||!Number.isFinite(Date.parse(s.date))||![s.seconds,s.meters,s.liters,s.impacts].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))throw new Error('Invalid session');if(s.runId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.runId))throw new Error('Invalid route run id');}
  if(v.city&&!['low','medium','high'].includes(v.city.density))throw new Error('Invalid city settings');
  return {version:1,paint:v.paint,quality:v.quality!,weather:v.weather!,hour:v.hour!,volume:v.volume!,tutorial:v.tutorial,...(v.city?{city:{density:v.city.density}}:{}),sessions:v.sessions.map(s=>({date:s.date,seconds:s.seconds,meters:s.meters,liters:s.liters,impacts:s.impacts,...(s.route?{route:validateRouteResult(s.route)}:{}),...(s.runId?{runId:s.runId}:{})}))};
}
export function validateRouteResult(v:RouteResult):RouteResult{
  if(!allRouteIds.includes(v.id))throw new Error('Invalid route result');
  const fields=['score','fares','expenses','served','missed','comfort','penalties','punctuality'] as const;
  for(const field of fields)if(!Number.isSafeInteger(v[field])||v[field]<0||v[field]>100000000)throw new Error('Invalid route score');
  if(v.comfort>100||v.punctuality>100)throw new Error('Invalid route rating');
  return Object.fromEntries([['id',v.id],...fields.map(f=>[f,v[f]])]) as unknown as RouteResult;
}
export class LocalStore {
  data:Save=structuredClone(defaults);error='';protected=false;
  private listeners=new Set<()=>void>();
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  constructor(){try{const raw=localStorage.getItem(KEY);if(raw)this.data=validate(JSON.parse(raw));}catch{this.error='Local save could not be read. It has not been overwritten. Export it from Settings before resetting.';this.protected=true;}}
  save(){if(this.protected)return;try{localStorage.setItem(KEY,JSON.stringify(this.data));for(const listener of this.listeners)listener();}catch{this.error='Browser storage is unavailable or full. This session is not saved.';}}
  reset(){this.protected=false;this.data=structuredClone(defaults);this.save();}
  finish(s:Session){this.data.sessions=[s,...this.data.sessions].slice(0,500);this.save();}
}
