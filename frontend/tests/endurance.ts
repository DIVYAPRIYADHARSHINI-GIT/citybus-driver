import {Vehicle} from '../src/sim/vehicle';
import {Traffic} from '../src/city/traffic';
import {activateMap} from '../src/city/network';
export function soak(hours:number,memoryUsage:()=>{heapUsed:number;rss:number}){const v=new Vehicle();v.roadClassifier=()=>true;v.trackWear=true;v.drive.running=true;v.drive.parking=false;v.drive.gear=1;let traffic=new Traffic('high',true),last=performance.now();const samples=[];
 for(let tick=0;tick<Math.round(hours*3600*120);tick++){
  if(tick%(3600*120)===0){activateMap(['northbank','meridian','coastway'][Math.floor(tick/(3600*120))%3]);traffic=new Traffic('high',true);}
  v.surface=Math.floor(tick/(120*600))%2?'wet':'dry';const speed=v.speed;v.step(1/120,{throttle:speed<4?.5:0,brake:speed>5?.15:0,steer:.3,clutch:0});
  if(tick%6===0)traffic.step(.05,{x:0,z:0,yaw:0,speed:0,left:false,doors:false});
  if(!Number.isFinite(v.chassis.position.length())||traffic.agents.length>22||v.replay.length>300)throw Error('Unbounded/invalid simulation state');
  if(tick%(600*120)===0){(globalThis as any).gc?.();const now=performance.now(),memory=memoryUsage();samples.push({gameSeconds:tick/120,wallWindowSeconds:(now-last)/1000,heapMiB:memory.heapUsed/1048576,rssMiB:memory.rss/1048576,bodies:v.world.bodies.length,replay:v.replay.length,agents:traffic.agents.length});last=now;console.log(JSON.stringify(samples.at(-1)));}
 }
 return {gameHours:hours,method:'Accelerated 120-Hz Cannon + 20-Hz mobile-capped traffic; one hour per map; no WebGL. Explicit GC before heap samples.',samples};
}
