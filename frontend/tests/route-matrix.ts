import {Vehicle} from '../src/sim/vehicle';
import {activateMap,maps,routes,stops,navigate,distance,isRoad,type Point} from '../src/city/network';
import {SPECS} from '../src/tycoon/engine';
import {RouteService,type BusState} from '../src/city/service';
const dt=1/120,neutral={throttle:0,brake:0,clutch:0,steer:0};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const yaw=(v:Vehicle)=>{const q=v.chassis.quaternion;return Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x));};
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
/** Physical flat-road route QA. Actual Cannon bodies, drivetrain, steering and
 * stop service; no pose/velocity mutation after the initial spawn. This does NOT
 * include renderer-created static obstacles, traffic hulls or keyboard input. */
export function driveRoute(map:string,id:string,model:string){
 activateMap(map);const spec=SPECS.find(s=>s.id===model)!,service=new RouteService(id,123,spec.capacity),v=new Vehicle(),first=service.stop;
 v.configure(model);v.trackWear=false;v.roadClassifier=isRoad;v.resetPoint={x:first.x+Math.sin(first.yaw)*18,z:first.z+Math.cos(first.yaw)*18,yaw:first.yaw};v.reset();
 for(let i=0;i<240;i++)v.step(dt,neutral);v.drive.action('ignition',0);v.drive.action('gearUp',0);v.drive.action('parking',0);
 let path:Point[]=navigate(v.chassis.position,first,new Set(),yaw(v)).points,index=0,lastStop=0,sim=0,maxError=0,lastLoad=-1;
 const state=():BusState=>({x:v.chassis.position.x,z:v.chassis.position.z,yaw:yaw(v),speed:v.speed,doors:v.drive.doors,parking:v.drive.parking,ramp:v.drive.ramp,impacts:v.impacts,acceleration:0,steer:v.steer});
 for(let tick=0;tick<120*1800&&!service.completed;tick++){
  const load=service.onboard.length*75;if(load!==lastLoad){v.setLoad(load);lastLoad=load;}
  sim+=dt;const p=v.chassis.position,goal=service.stop,remaining=distance(p,goal),angle=yaw(v);
  if(remaining<8&&Math.abs(v.speed)<.12){
   v.drive.parking=true;v.drive.doors=true;v.drive.ramp=true;
   service.tick(dt,state());if(service.event)service.resolve(service.event.event==='bag'?'return':service.event.event==='no-ticket'?'sell':'assist',state());if(service.ticket){service.greet();service.sell(service.ticket.cash-service.ticket.fare);}
   if(service.phase==='ready'){v.drive.doors=false;v.drive.ramp=false;service.tick(dt,state());v.drive.parking=false;lastStop=service.index;if(!service.completed){path=navigate(p,service.stop,new Set(),angle).points;index=0;}}
   v.step(dt,neutral);continue;
  }
  let nearest=index;for(let k=index;k<Math.min(path.length,index+20);k++)if(distance(p,path[k])<=distance(p,path[nearest])+1e-6)nearest=k;index=nearest;
  const lookahead=clamp(Math.abs(v.speed)*1.1+7,7,16);let target=path[index]??goal,j=index;while(j<path.length-1&&distance(p,target)<lookahead)target=path[++j];
  const error=wrap(Math.atan2(-(target.x-p.x),-(target.z-p.z))-angle),aim=Math.atan(2*spec.wheelbase_m*Math.sin(error)/Math.max(3,distance(p,target))),maxAngle=spec.steer_angle_rad/(1+Math.abs(v.speed)*.045);
  const steer=clamp(aim/maxAngle,-1,1);let desired=Math.abs(error)>.35?3:7;desired=Math.min(desired,Math.sqrt(Math.max(0,2*1.2*(remaining-3))));
  const throttle=clamp((desired-v.speed)*.65,0,.85),brake=clamp((v.speed-desired)*.3,0,.65);v.step(dt,{...neutral,throttle,brake,steer});
  service.tick(dt,state());if(service.score.missed)break;
  if(tick%120===0){maxError=Math.max(maxError,Math.min(...path.slice(index,index+5).map(q=>distance(v.chassis.position,q))));if(!Number.isFinite(v.speed)||v.chassis.position.y<.3)break;}
 }
 return {map,route:id,model,completed:service.completed,served:service.score.served,expected:service.route.stops.length,seconds:Math.round(sim),meters:Math.round(v.distance),maxPathError:Math.round(maxError*10)/10,position:[v.chassis.position.x,v.chassis.position.z],stop:service.stop.id,phase:service.phase};
}
export function combinations(){return maps.flatMap(map=>{activateMap(map.id);return routes.flatMap(route=>SPECS.map(spec=>({map:map.id,route:route.id,model:spec.id})));});}
