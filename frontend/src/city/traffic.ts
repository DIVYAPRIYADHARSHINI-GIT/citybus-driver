import { lanes,nodes,random,sample,connection,lengthOf,light,laneAxis,nearestLane,pedestrianPhase,distance,type Point,type Lane } from './network';
export type Density='low'|'medium'|'high';
export type TrafficKind='car'|'truck'|'motorcycle'|'police'|'ambulance';
export interface Agent extends Point {id:number;kind:TrafficKind;lane:string;s:number;speed:number;length:number;yaw:number;targetSpeed:number;signalBlocked:boolean;yielding:boolean;changing:number;previousLane?:string;turn?:{points:Point[];s:number;next:string;node:string};wait:number;emergency:boolean }
export interface BusPresence extends Point {yaw:number;speed:number;left:boolean;doors:boolean}
export function densityCap(density:Density,mobile:boolean){return (mobile?{low:10,medium:16,high:22}:{low:16,medium:32,high:52})[density];}
export function safeSpeed(limit:number,speed:number,gap:number,leaderSpeed:number){if(gap<=2)return 0;return Math.min(limit,Math.max(0,(gap-3)/1.5),Math.sqrt(Math.max(0,leaderSpeed*leaderSpeed+2*2.7*(gap-3))));}
export function mayOvertake(agent:Agent,others:readonly Agent[],target:Lane){return target.parallel===agent.lane&&target.limit>=70&&!others.some(a=>a.id!==agent.id&&a.lane===target.id&&a.s>agent.s-25&&a.s<agent.s+45)&&agent.s>35&&agent.s<target.length-65;}
export class Traffic {
  weatherSpeed=1;
  agents:Agent[]=[];time=0;density:Density;blocked=new Set<string>();private rand:()=>number;private serial=0;private reservations=new Map<string,number>();
  constructor(density:Density='medium',public mobile=false,seed=430){this.density=density;this.rand=random(seed);this.populate();}
  setDensity(d:Density){this.density=d;this.populate();for(const [node,id] of this.reservations)if(!this.agents.some(a=>a.id===id))this.reservations.delete(node);}
  populate(){const cap=densityCap(this.density,this.mobile);this.agents=this.agents.slice(0,cap);const options=Object.values(lanes).filter(l=>l.length>100&&l.ordinal===0);let attempts=0;
    while(this.agents.length<cap&&attempts++<cap*30){const lane=options[Math.floor(this.rand()*options.length)],s=20+this.rand()*(lane.length-50);if(this.agents.some(a=>a.lane===lane.id&&Math.abs(a.s-s)<30))continue;const id=this.serial++,kind:TrafficKind=['car','car','truck','car','motorcycle','car','police','ambulance'][id%8] as TrafficKind,p=sample(lane.points,s);
      this.agents.push({id,kind,lane:lane.id,s,speed:lane.limit/3.6*.55,length:kind==='truck'?8:kind==='motorcycle'?2.4:4.8,x:p.x,z:p.z,yaw:p.yaw,targetSpeed:0,signalBlocked:false,yielding:false,changing:1,wait:0,emergency:kind==='ambulance'&&id%2===1});
    }
  }
  step(dt:number,bus:BusPresence){this.time+=dt;const busLane=nearestLane(bus,bus.yaw),occupied=new Map<string,Agent[]>();for(const a of this.agents){const list=occupied.get(a.lane)??[];list.push(a);occupied.set(a.lane,list);}for(const list of occupied.values())list.sort((a,b)=>a.s-b.s);
    const snapshots=this.agents.map(a=>({...a}));
    for(const a of this.agents){
      if(a.turn){a.speed=Math.min(a.speed,5.5);a.turn.s+=Math.max(a.speed,.8)*dt;const p=sample(a.turn.points,a.turn.s);a.x=p.x;a.z=p.z;a.yaw=p.yaw;
        if(a.turn.s>=lengthOf(a.turn.points)){this.reservations.delete(a.turn.node);a.lane=a.turn.next;a.s=0;a.turn=undefined;}continue;}
      const lane=lanes[a.lane],node=nodes[lane.to];let limit=Math.min(lane.limit/3.6,a.kind==='truck'?14:22)*(a.kind==='motorcycle'?1:.9)*this.weatherSpeed,gap=Infinity,leaderSpeed=limit;a.yielding=false;
      const leader=(occupied.get(a.lane)??[]).find(b=>b.id!==a.id&&b.s>a.s);
      if(leader){gap=leader.s-a.s-(a.length+leader.length)/2;leaderSpeed=leader.speed;}
      if(busLane.lane.id===a.lane&&busLane.s>a.s&&busLane.distance<4){const g=busLane.s-a.s-6-a.length/2;if(g<gap){gap=g;leaderSpeed=Math.abs(bus.speed);}if(bus.left&&bus.speed<3){a.yielding=true;limit=Math.min(limit,2);}}
      // Yield to a signalling bus merging from the curb, even when its nearest lane differs.
      if(bus.left&&distance(a,bus)<28&&Math.cos(bus.yaw-a.yaw)>.8&&bus.speed<4){a.yielding=true;limit=0;}
      const emergency=snapshots.find(e=>e.emergency&&e.id!==a.id&&e.lane===a.lane&&e.s<a.s&&a.s-e.s<45);
      if(emergency&&!a.emergency){a.yielding=true;limit=Math.min(limit,3);}
      a.signalBlocked=light(node,laneAxis(lane),this.time)!=='green';
      const reservation=this.reservations.get(node.id),ringTraffic=node.ring&&!nodes[lane.from].ring&&snapshots.some(b=>b.id!==a.id&&nodes[lanes[b.lane].from].ring&&distance(b,node)<19);
      const stopForNode=a.signalBlocked||(reservation!==undefined&&reservation!==a.id)||ringTraffic||distance(bus,node)<13;
      if(stopForNode){const g=lane.length-a.s-a.length/2-1;if(g<gap){gap=g;leaderSpeed=0;}}
      if(this.blocked.has(lane.id)){const g=lane.length*.55-a.s-a.length/2;if(g>=-4&&g<gap){gap=g;leaderSpeed=0;}}
      if(a.changing>=1&&lane.ordinal===0&&lane.parallel&&leader&&leader.speed<limit*.7&&gap<35&&mayOvertake(a,snapshots,lanes[lane.parallel])){a.previousLane=a.lane;a.lane=lane.parallel;a.changing=0;continue;}
      if(a.changing>=1&&lane.ordinal===1&&lane.parallel&&(!leader||gap>50)&&mayOvertake(a,snapshots,lanes[lane.parallel])){a.previousLane=a.lane;a.lane=lane.parallel;a.changing=0;continue;}
      a.targetSpeed=safeSpeed(limit,a.speed,gap,leaderSpeed);a.speed=Math.max(0,a.speed+Math.max(-4.5*dt,Math.min(1.7*dt,a.targetSpeed-a.speed)));
      const movement=Math.min(a.speed*dt,Math.max(0,gap-.25));a.s+=movement;a.wait=a.speed<.2?a.wait+dt:0;
      const p=sample(lane.points,a.s);a.x=p.x;a.z=p.z;a.yaw=p.yaw;
      if(a.previousLane&&a.changing<1){a.changing=Math.min(1,a.changing+dt/2.5);const previous=sample(lanes[a.previousLane].points,a.s),f=a.changing*a.changing*(3-2*a.changing);a.x=previous.x+(p.x-previous.x)*f;a.z=previous.z+(p.z-previous.z)*f;}
      if(a.s>=lane.length-a.length/2-1&&!stopForNode){
        const choices=lane.connections.filter(id=>!this.blocked.has(id)),next=choices[Math.floor(this.rand()*choices.length)];
        if(next){const outgoing=(occupied.get(next)??[])[0];if(outgoing&&outgoing.s<18){a.speed=0;continue;}this.reservations.set(node.id,a.id);a.turn={points:[{x:a.x,z:a.z},...connection(lane,lanes[next])],s:0,next,node:node.id};a.speed=Math.max(.8,Math.min(a.speed,5.5));}
        else a.speed=0;
      }
    }
  }
  pedestrians(){const phase=this.time%60;return Object.values(nodes).filter(n=>n.signal).flatMap((n,i)=>{const t=(phase-45)/13;return [0,1].map(j=>({id:i*2+j,x:n.x-8+Math.max(0,Math.min(1,t))*16,z:n.z+17+j*.7,active:pedestrianPhase(this.time)&&t<1,yaw:-Math.PI/2}));});}
}
