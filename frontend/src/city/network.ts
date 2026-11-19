// Northbank's single source of truth. All distances are metres, speed limits km/h.
import worldData from './worlds.json';
export const maps=worldData.maps;
export let activeMap=maps[0];
export interface Point { x:number; z:number }
export interface Node extends Point { id:string; signal:boolean; ring?:boolean }
export interface Road { id:string; from:string; to:string; points:Point[]; highway:boolean; ring:boolean; length:number }
export interface Lane { id:string; road:string; from:string; to:string; points:Point[]; length:number; limit:number; ordinal:number; parallel?:string; connections:string[] }
export interface Stop extends Point { id:string; name:string; lane:string; s:number; yaw:number; zoneLength:number }
export interface Route { id:string; name:string; description:string; stops:string[]; due:number[]; color:string }
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
export const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
export const lengthOf=(ps:Point[])=>ps.slice(1).reduce((n,p,i)=>n+distance(ps[i],p),0);
export function sample(points:Point[],s:number):Point & {dx:number;dz:number;yaw:number}{
  let left=Math.max(0,s);
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=distance(a,b);if(left<=len||i===points.length-1){const t=Math.min(1,left/(len||1)),dx=(b.x-a.x)/(len||1),dz=(b.z-a.z)/(len||1);return {...mix(a,b,t),dx,dz,yaw:Math.atan2(-dx,-dz)};}left-=len;}
  return {...points[0],dx:0,dz:-1,yaw:0};
}
export function project(points:Point[],p:Point){let best={s:0,distance:Infinity,point:points[0],dx:0,dz:-1},s=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=distance(a,b),t=Math.max(0,Math.min(1,((p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z))/(len*len||1))),q=mix(a,b,t),d=distance(q,p);if(d<best.distance)best={s:s+t*len,distance:d,point:q,dx:(b.x-a.x)/(len||1),dz:(b.z-a.z)/(len||1)};s+=len;}return best;}
export const nodes:Record<string,Node>={};
for(const [id,x,z,signal] of [['SW',-240,240,false],['S',0,240,true],['SE',240,240,false],['W',-240,0,true],['E',240,0,true],['NW',-240,-240,true],['N',0,-240,true],['NE',240,-240,true],['HN',-240,-400,false],['HE',240,-400,false],['RN',0,-24,false],['RE',24,0,false],['RS',0,24,false],['RW',-24,0,false]] as [string,number,number,boolean][]){nodes[id]={id,x,z,signal,ring:id.startsWith('R')};}
export const roads:Road[]=[];export const lanes:Record<string,Lane>={};
function road(a:string,b:string,highway=false,curve?:Point[]){const points=curve??[nodes[a],nodes[b]],r:Road={id:`${a}-${b}`,from:a,to:b,points,highway,ring:!!curve,length:lengthOf(points)};roads.push(r);
  for(const reverse of r.ring?[false]:[false,true])for(let ordinal=0;ordinal<(highway?2:1);ordinal++){
    const from=reverse?b:a,to=reverse?a:b,base=reverse?[...points].reverse():points,offset=r.ring?0:highway?(ordinal===0?5.25:1.75):3.5;
    const shifted=base.map((p,i)=>{const a=base[Math.max(0,i-1)],b=base[Math.min(base.length-1,i+1)],len=distance(a,b)||1;return {x:p.x-(b.z-a.z)/len*offset,z:p.z+(b.x-a.x)/len*offset};});
    if(!r.ring){const startTrim=nodes[from].ring?0:14,endTrim=nodes[to].ring?0:14;const len=lengthOf(shifted);const start=sample(shifted,startTrim),end=sample(shifted,len-endTrim);shifted[0]={x:start.x,z:start.z};shifted[shifted.length-1]={x:end.x,z:end.z};}
    const id=`${from}>${to}:${ordinal}`;lanes[id]={id,road:r.id,from,to,points:shifted,length:lengthOf(shifted),limit:r.ring?25:highway?70:40,ordinal,connections:[],parallel:highway?`${from}>${to}:${1-ordinal}`:undefined};
  }
}
for(const [a,b] of [['SW','W'],['W','NW'],['SW','S'],['S','SE'],['SE','E'],['E','NE'],['NW','N'],['N','NE'],['W','RW'],['RE','E'],['S','RS'],['RN','N']])road(a,b);
road('NW','HN',true);road('HN','HE',true);road('HE','NE',true);
// Counter-clockwise circulation: at each entry yield to vehicles already on the ring.
for(const [a,b,start] of [['RN','RW',-Math.PI/2],['RW','RS',-Math.PI],['RS','RE',-Math.PI*1.5],['RE','RN',-Math.PI*2]] as [string,string,number][]){const ps=Array.from({length:17},(_,i)=>({x:Math.cos(start-i/16*Math.PI/2)*24,z:Math.sin(start-i/16*Math.PI/2)*24}));road(a,b,false,ps);}
for(const l of Object.values(lanes))l.connections=Object.values(lanes).filter(n=>n.from===l.to&&n.to!==l.from&&n.ordinal===0).map(n=>n.id);
export function connection(a:Lane,b:Lane):Point[]{const from=sample(a.points,a.length),to=sample(b.points,0);return Array.from({length:13},(_,i)=>{const t=i/12,u=1-t,reach=Math.min(18,distance(from,to)*.7);return {x:u*u*u*from.x+3*u*u*t*(from.x+from.dx*reach)+3*u*t*t*(to.x-to.dx*reach)+t*t*t*to.x,z:u*u*u*from.z+3*u*u*t*(from.z+from.dz*reach)+3*u*t*t*(to.z-to.dz*reach)+t*t*t*to.z};});}
export function nearestLane(p:Point,yaw?:number){let best:{lane:Lane;s:number;distance:number;point:Point}|undefined,score=Infinity;for(const lane of Object.values(lanes)){const q=project(lane.points,p),heading=yaw===undefined?0:Math.max(0,1-(-Math.sin(yaw)*q.dx-Math.cos(yaw)*q.dz))*9,rank=q.distance+heading;if(rank<score){best={lane,...q};score=rank;}}return best!;}
export function isRoad(p:Point){return roads.some(r=>project(r.points,p).distance<(r.highway?9:8));}
export function light(node:Node,axis:'NS'|'EW',time:number):'green'|'amber'|'red'{if(!node.signal)return 'green';const t=((time%60)+60)%60;const start=axis==='NS'?0:24;if(t>=start&&t<start+18)return 'green';if(t>=start+18&&t<start+21)return 'amber';return 'red';}
export function laneAxis(lane:Lane):'NS'|'EW'{const p=sample(lane.points,lane.length);return Math.abs(p.dx)>Math.abs(p.dz)?'EW':'NS';}
export const pedestrianPhase=(time:number)=>((time%60)+60)%60>=45;
export function shortestPath(from:string,to:string,blocked:ReadonlySet<string>=new Set()):string[]|null {
  if(!lanes[from]||!lanes[to]||blocked.has(to))return null;
  const costs=new Map([[from,0]]),previous=new Map<string,string>(),open=new Set([from]);
  while(open.size){let current=[...open].reduce((a,b)=>costs.get(a)!<costs.get(b)!?a:b);open.delete(current);if(current===to){const path=[to];while(previous.has(current)){current=previous.get(current)!;path.unshift(current);}return path;}
    for(const next of lanes[current].connections){if(blocked.has(next))continue;const cost=costs.get(current)!+lanes[next].length/(lanes[next].limit/3.6)+2;if(cost<(costs.get(next)??Infinity)){costs.set(next,cost);previous.set(next,current);open.add(next);}}
  }return null;
}
export function navigate(from:Point,to:Stop|Point,blocked:ReadonlySet<string>=new Set(),yaw?:number){const start=nearestLane(from,yaw),end='lane' in to?{lane:lanes[to.lane],s:to.s}:nearestLane(to);let path=shortestPath(start.lane.id,end.lane.id,blocked);
  if(path?.length===1&&end.s<start.s-10){let best:string[]|null=null,bestLength=Infinity;for(const next of start.lane.connections){const tail=shortestPath(next,end.lane.id,blocked);if(tail){const candidate=[start.lane.id,...tail],len=candidate.reduce((s,id)=>s+lanes[id].length,0);if(len<bestLength){best=candidate;bestLength=len;}}}path=best;}
  const points:Point[]=[];if(path)path.forEach((id,i)=>{const l=lanes[id],begin=i===0?start.s:0,finish=i===path!.length-1?end.s:l.length;for(let s=begin;s<finish;s+=8)points.push(sample(l.points,s));points.push(sample(l.points,finish));if(i<path!.length-1)points.push(...connection(l,lanes[path![i+1]]));});
  return {path,points,meters:lengthOf(points),start,end};
}
export const stops:Record<string,Stop>={};
function stop(id:string,name:string,lane:string,s:number){const p=sample(lanes[lane].points,s);stops[id]={id,name,lane,s,x:p.x,z:p.z,yaw:p.yaw,zoneLength:20};}
stop('terminal','Southbank Terminal','SW>W:0',26);stop('market','Market Street','SW>W:0',126);stop('library','Central Library','W>NW:0',106);
stop('park','Botanical Gardens','NW>N:0',86);stop('civic','Civic Square','N>RN:0',106);stop('oldtown','Old Town','W>RW:0',96);
stop('hospital','St Anne’s Hospital','SE>E:0',126);stop('university','Northbank University','E>NE:0',146);stop('harbor','Harbour Exchange','SE>S:0',146);stop('river','Riverside Parkway','HN>HE:0',226);
export const routes:Route[]=[
 {id:'21',name:'Library Local',description:'A gentle first shift. Terminal → Market → Library. 320 m, three stops, one signal.',stops:['terminal','market','library'],due:[0,55,115],color:'#b9e877'},
 {id:'36',name:'Civic Circle',description:'The heart of Northbank. Six stops, town-centre signals and the roundabout.',stops:['terminal','market','library','park','civic','oldtown'],due:[0,55,115,180,250,335],color:'#f0c17c'},
 {id:'80',name:'River Express',description:'Hospital → University → Riverside → Terminal. Highway, tunnel, toll and bridge.',stops:['hospital','university','river','terminal'],due:[0,90,215,365],color:'#90cbdc'}
];
export let roadKilometers=roads.reduce((s,r)=>s+r.length,0)/1000;
export const facilities:{id:string;name:string;x:number;z:number}[]=[{id:'fuel',name:'Southbank Fuel',x:-224,z:216},{id:'garage',name:'Depot Repair & Wash',x:-222,z:174},{id:'toll',name:'Parkway Toll',x:-70,z:-395},{id:'police',name:'Roadside Document Check',x:254,z:-65}];
const originalFacilities=structuredClone(facilities);
export function inStopZone(stop:Stop,p:Point,yaw:number){const dx=p.x-stop.x,dz=p.z-stop.z,along=dx*-Math.sin(stop.yaw)+dz*-Math.cos(stop.yaw),across=dx*Math.cos(stop.yaw)-dz*Math.sin(stop.yaw);return Math.abs(along)<=stop.zoneLength/2&&Math.abs(across)<2.6&&Math.cos(yaw-stop.yaw)>.85;}
export function random(seed:number){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}

const original={nodes:structuredClone(nodes),roads:structuredClone(roads),lanes:structuredClone(lanes),stops:structuredClone(stops),routes:structuredClone(routes)};
export function mapForRoute(id:string){return maps.find(m=>m.routes.some(r=>r.id===id))?.id??'northbank';}
export const allRouteIds=[...routes.map(r=>r.id),...maps.flatMap(m=>m.routes.map(r=>r.id))];
/** Switch only between sessions: stable exported containers keep legacy consumers
 * working, and each switch starts from an untouched Northbank graph. */
export function activateMap(id:string){
  const definition=maps.find(m=>m.id===id);if(!definition)throw new Error('Unknown map');
  for(const record of [nodes,lanes,stops])for(const key of Object.keys(record))delete (record as Record<string,unknown>)[key];
  Object.assign(nodes,structuredClone(original.nodes));Object.assign(lanes,structuredClone(original.lanes));Object.assign(stops,structuredClone(original.stops));
  roads.splice(0,roads.length,...structuredClone(original.roads));routes.splice(0,routes.length,...structuredClone(original.routes));
  for(const n of definition.nodes)nodes[n.id]={...n};
  for(const edge of definition.roads)road(String(edge[0]),String(edge[1]),Boolean(edge[2]));
  for(const lane of Object.values(lanes))lane.connections=Object.values(lanes).filter(n=>n.from===lane.to&&n.to!==lane.from&&n.ordinal===0).map(n=>n.id);
  for(const s of definition.stops)stop(String(s[0]),String(s[1]),String(s[2]),Number(s[3]));
  if(definition.routes.length)routes.splice(0,routes.length,...definition.routes.map(r=>({...r})));
  activeMap=definition;roadKilometers=roads.reduce((sum,r)=>sum+r.length,0)/1000;
  facilities.splice(0,facilities.length,...structuredClone(originalFacilities),...definition.landmarks.filter(l=>['fuel','toll'].includes(l.kind)).map(l=>({id:l.kind,name:l.name,x:l.x,z:l.z})));
}
