import {stops,routes,inStopZone,random,distance,nearestLane,lanes,nodes,light,laneAxis,sample,type Point,type Route} from './network';
export type PassengerEvent='none'|'elderly'|'no-ticket'|'bag';
export type PassengerPhase='waiting'|'boarding'|'seated'|'standing'|'alighting'|'gone';
export interface Passenger {id:string;name:string;origin:number;destination:number;phase:PassengerPhase;progress:number;event:PassengerEvent;resolved:boolean;greeted:boolean;paid:boolean;fare:number;cash:number;seat:number }
export interface BusState extends Point {yaw:number;speed:number;doors:boolean;parking:boolean;ramp:boolean;impacts:number;acceleration:number;steer:number }
export type Violation='red-light'|'speeding'|'collision'|'hard-braking'|'missed-stop'|'unsafe-departure';
export interface ScoreEvent {kind:Violation;time:number;points:number;detail:string}
export const penalties:Record<Violation,number>={'red-light':120,speeding:25,collision:150,'hard-braking':20,'missed-stop':100,'unsafe-departure':60};
export interface RouteResult {id:string;score:number;fares:number;expenses:number;served:number;missed:number;comfort:number;penalties:number;punctuality:number}
export class Score {
  events:ScoreEvent[]=[];comfort=100;fares=0;expenses=0;served=0;missed=0;punctuality:number[]=[];private cooldown=new Map<string,number>();
  penalize(kind:Violation,time:number,detail:string,key:string=kind,cooldown=5){if(time-(this.cooldown.get(key)??-Infinity)<cooldown)return false;this.cooldown.set(key,time);const fine=kind==='red-light'?5000:kind==='speeding'?1500:0;this.expenses+=fine;this.events.push({kind,time,points:penalties[kind],detail:fine?`${detail} · fine €${(fine/100).toFixed(2)}`:detail});if(this.events.length>500)this.events.shift();if(kind==='missed-stop')this.missed++;this.comfort=Math.max(0,this.comfort-(kind==='collision'?18:kind==='hard-braking'?4:kind==='unsafe-departure'?10:2));return true;}
  service(lateness:number){this.served++;this.punctuality.push(Math.max(0,100-Math.max(0,Math.abs(lateness)-20)*.7));}
  result(id:string):RouteResult{const penalty=this.events.reduce((s,e)=>s+e.points,0),punctuality=this.punctuality.length?this.punctuality.reduce((a,b)=>a+b,0)/this.punctuality.length:0;return {id,score:Math.max(0,Math.round(this.served*150+this.comfort*2+punctuality*2+this.fares/10-penalty)),fares:this.fares,expenses:this.expenses,served:this.served,missed:this.missed,comfort:Math.round(this.comfort),penalties:penalty,punctuality:Math.round(punctuality)};}
}
export class RouteService {
  trafficTime:number|null=null;
  route:Route;index=0;time=0;passengers:Passenger[]=[];score=new Score();phase:'approach'|'servicing'|'ready'|'complete'='approach';arrival=0;dwell=0;completed=false;stopRequested=false;message='';private generated=new Set<number>();private rand:()=>number;private lastDoors=false;private lastImpact=0;private previous:Point|null=null;private previousLane='';private previousS=0;private beenNear=false;
  constructor(routeId:string,seed=123,public capacity=36){const route=routes.find(r=>r.id===routeId);if(!route)throw new Error('Unknown route');this.route=route;this.rand=random(seed);this.generate();}
  get stop(){return stops[this.route.stops[Math.min(this.index,this.route.stops.length-1)]];}
  get onboard(){return this.passengers.filter(p=>['seated','standing','alighting'].includes(p.phase));}
  get queue(){return this.passengers.filter(p=>p.origin===this.index&&['waiting','boarding'].includes(p.phase));}
  get ticket(){return this.queue.find(p=>!p.paid&&p.phase==='boarding'&&p.progress>=.35);}
  get event(){return this.passengers.find(p=>!p.resolved&&p.event!=='none'&&((p.phase==='boarding'&&p.progress>=.35&&p.event!=='bag')||(p.phase==='alighting'&&p.event==='bag')));}
  generate(){if(this.generated.has(this.index)||this.index>=this.route.stops.length-1)return;this.generated.add(this.index);const count=2+Math.floor(this.rand()*3),names=['Maya','Oliver','Amina','Luca','Grace','Elias','Nora','Theo'];
    for(let i=0;i<count;i++){const roll=this.rand(),event:PassengerEvent=roll<.18?'elderly':roll<.31?'no-ticket':roll<.44?'bag':'none';this.passengers.push({id:`${this.route.id}-${this.index}-${i}`,name:names[Math.floor(this.rand()*names.length)],origin:this.index,destination:this.index+1+Math.floor(this.rand()*(this.route.stops.length-this.index-1)),phase:'waiting',progress:0,event,resolved:event==='none',greeted:false,paid:false,fare:event==='elderly'?150:250,cash:500,seat:this.passengers.length});}
  }
  greet(){const p=this.ticket;if(!p)return 'No passenger is at the ticket machine.';p.greeted=true;return `Good morning, ${p.name}. Welcome aboard.`;}
  sell(change:number){const p=this.ticket;if(!p)return 'No ticket transaction is pending.';if(!p.greeted)return 'Greet the passenger first.';if(p.event==='no-ticket'&&!p.resolved)return 'Resolve the missing-ticket request first.';if(p.cash<p.fare)return 'Insufficient payment.';if(!Number.isSafeInteger(change)||change!==p.cash-p.fare)return 'Incorrect change. Cash received minus fare is the change.';p.paid=true;this.score.fares+=p.fare;return 'Ticket issued. Thank you!';}
  resolve(choice:string,bus:Pick<BusState,'ramp'>){const p=this.event;if(!p)return 'There is no passenger event.';
    if(p.event==='elderly'){if(!bus.ramp)return 'Deploy the accessibility ramp (U) before assisting.';p.resolved=true;return 'Ramp assistance provided. Please take your time.';}
    if(p.event==='no-ticket'){if(choice==='sell'){p.resolved=true;return 'A single ticket is available. Continue with the sale.';}if(choice==='waive'){p.resolved=true;p.paid=true;this.score.penalize('unsafe-departure',this.time,'Fare waived without authorization',`fare-${p.id}`);return 'Passenger admitted without payment; fare-policy penalty recorded.';}}
    if(p.event==='bag'&&choice==='return'){p.resolved=true;this.score.comfort=Math.min(100,this.score.comfort+2);return 'Forgotten bag returned to its owner.';}
    return 'Choose an appropriate response.';
  }
  canClose(){if(this.phase==='servicing'&&(this.queue.length>0||this.passengers.some(p=>p.phase==='alighting')))return 'Passengers are still boarding or leaving. Finish tickets and accessibility assistance first.';return '';}
  recover(){if(this.completed)return;this.phase='approach';this.dwell=0;this.lastDoors=false;this.beenNear=false;this.previous=null;for(const p of this.passengers){if(p.phase==='boarding'){p.phase='waiting';p.progress=0;}if(p.phase==='alighting'){p.phase='seated';p.progress=0;}}this.score.penalize('unsafe-departure',this.time,'Roadside recovery requested','recovery',0);}
  skip(){if(this.completed)return;for(const p of this.passengers){if(p.origin===this.index&&['waiting','boarding'].includes(p.phase))p.phase='gone';if(p.destination===this.index&&p.phase!=='gone')p.destination=Math.min(this.index+1,this.route.stops.length-1);}this.score.penalize('missed-stop',this.time,`Skipped ${this.stop.name}`,`stop-${this.index}`,Infinity);this.next();}
  private next(){this.index++;this.phase='approach';this.dwell=0;this.beenNear=false;this.stopRequested=false;if(this.index>=this.route.stops.length){this.completed=true;this.phase='complete';return;}this.generate();}
  tick(dt:number,bus:BusState){if(this.completed)return;this.time+=dt;const stop=this.stop,d=distance(stop,bus),inside=inStopZone(stop,bus,bus.yaw),stopped=Math.abs(bus.speed)<.2;
    if(d<45)this.beenNear=true;
    if(this.phase==='approach'&&this.beenNear&&d>65){this.message=`Missed ${stop.name}. Continue to the next stop.`;this.skip();return;}
    this.stopRequested=this.onboard.some(p=>p.destination===this.index)&&d<100;
    if(inside&&stopped&&bus.doors&&this.phase==='approach'){this.phase='servicing';this.arrival=this.time;this.lastImpact=bus.impacts;for(const p of this.onboard)if(p.destination===this.index){p.phase='alighting';p.progress=0;}}
    if((this.phase==='servicing'||this.phase==='ready')&&(!inside||!stopped)){this.score.penalize('unsafe-departure',this.time,'Moved during passenger service');return;}
    if(this.phase==='servicing'&&bus.doors&&stopped&&inside){this.dwell+=dt;
      for(const p of this.passengers.filter(p=>p.phase==='alighting')){if(p.event==='bag'&&!p.resolved){this.message=`${p.name} has left a bag. Return it before they leave.`;continue;}p.progress+=dt/2.4;if(p.progress>=1)p.phase='gone';}
      if(!this.passengers.some(p=>p.phase==='alighting')){
        if(this.onboard.length>=this.capacity&&this.queue.length){for(const waiting of this.queue)waiting.phase='gone';this.message='Bus at capacity. Remaining passengers will wait for the next service; no fare charged.';}
        const p=this.queue[0];if(p&&this.onboard.length<this.capacity){if(p.phase==='waiting'){p.phase='boarding';const occupied=new Set(this.onboard.map(v=>v.seat));p.seat=0;while(occupied.has(p.seat))p.seat++;}if(p.event==='elderly'&&!bus.ramp){this.message='An elderly passenger needs the ramp. Apply parking brake, press U, then assist.';}else if(p.progress<.35)p.progress=Math.min(.35,p.progress+dt/2.4);else if(p.paid&&(p.resolved||p.event==='bag')){p.progress+=dt/2.4;if(p.progress>=1){p.phase=p.seat<24?'seated':'standing';this.message=`${p.name}: Thank you, driver.`;}}}
      }
      if(this.queue.length===0&&!this.passengers.some(p=>p.phase==='alighting')&&this.dwell>=2)this.phase='ready';
    }
    if(this.phase==='ready'&&this.lastDoors&&!bus.doors&&!bus.ramp){this.score.service(this.arrival-this.route.due[this.index]);this.message=`${stop.name} served.`;this.next();}
    this.lastDoors=bus.doors;
    this.rules(dt,bus);
    if(this.time-this.route.due[this.index]>45&&this.onboard.length&&this.message==='')this.message='Passenger: Are we running late?';
  }
  private rules(dt:number,bus:BusState){
    const near=nearestLane(bus,bus.yaw),lane=near.lane;
    if(Math.abs(bus.speed)*3.6>lane.limit+3&&near.distance<7)this.score.penalize('speeding',this.time,`${Math.round(Math.abs(bus.speed)*3.6)} in a ${lane.limit} zone`,'speeding',8);
    if(bus.acceleration< -3.7&&Math.abs(bus.speed)>1){if(this.score.penalize('hard-braking',this.time,'Harsh service braking','hard-braking',6))this.message='Passenger: Easy on the brakes, please!';}
    if(Math.abs(bus.speed*bus.steer)>.95&&this.onboard.length)this.score.comfort=Math.max(0,this.score.comfort-dt*.5);
    if(bus.impacts>this.lastImpact){this.score.penalize('collision',this.time,'Vehicle impact','collision',2);this.lastImpact=bus.impacts;}
    // Signed stop-line crossing using the bus FRONT bumper, not a radius trigger.
    if(this.previous){for(const l of Object.values(lanes)){if(!nodes[l.to].signal)continue;const end=sample(l.points,l.length),prev=(this.previous.x-end.x)*end.dx+(this.previous.z-end.z)*end.dz+6,current=(bus.x-end.x)*end.dx+(bus.z-end.z)*end.dz+6,lateral=Math.abs((bus.x-end.x)*-end.dz+(bus.z-end.z)*end.dx);if(prev<0&&current>=0&&lateral<2.8&&-Math.sin(bus.yaw)*end.dx-Math.cos(bus.yaw)*end.dz>.7&&light(nodes[l.to],laneAxis(l),this.trafficTime??this.time)==='red')this.score.penalize('red-light',this.time,`Red light at ${l.to}`,`signal-${l.id}`,12);}}
    this.previous={x:bus.x,z:bus.z};this.previousLane=lane.id;this.previousS=near.s;void this.previousLane;void this.previousS;
  }
}
