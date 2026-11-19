import {Traffic} from '../city/traffic';
import {stableHash} from '../tycoon/engine';
// Room traffic is a fixed 16-agent deterministic stream, independent of device,
// player presence and local menus. A ten-minute cycle bounds late-join replay.
export function roomEvents(seed:number,elapsed:number){const epoch=Math.floor(Math.max(0,elapsed)/120),n=stableHash(`${seed}:${epoch}`);return {jam:n%3===0,weather:(['clear','clear','rain','fog'] as const)[n%4],epoch};}
export class SharedWorld {
 traffic:Traffic;cycle=-1;tick=0;target=0;
 constructor(public seed:number){this.traffic=new Traffic('low',false,seed);}
 at(elapsed:number,budget=1600){const cycle=Math.floor(Math.max(0,elapsed)/600),target=Math.floor((Math.max(0,elapsed)%600)*20);if(cycle!==this.cycle||target<this.tick){this.cycle=cycle;this.tick=0;this.traffic=new Traffic('low',false,this.seed+cycle);}
  this.target=target;let steps=0;while(this.tick<target&&steps++<budget){const time=this.cycle*600+this.tick/20,event=roomEvents(this.seed,time);this.traffic.blocked=event.jam?new Set(['RE>E:0']):new Set();this.traffic.weatherSpeed=event.weather==='fog'?.45:event.weather==='rain'?.75:event.jam?.35:1;this.traffic.step(.05,{x:10000,z:10000,yaw:0,speed:0,left:false,doors:false});this.tick++;}return this.traffic;
 }
 get ready(){return this.tick===this.target;}
}
