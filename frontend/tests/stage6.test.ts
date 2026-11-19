import {afterEach,describe,it,expect} from 'vitest';
import {activateMap,maps,activeMap,lanes,nodes,stops,routes,navigate,roadKilometers,isRoad,shortestPath} from '../src/city/network';
import {SPECS} from '../src/tycoon/engine';
import {RouteService,type BusState} from '../src/city/service';
import {Incidents} from '../src/city/incidents';
import {AdaptiveQuality} from '../src/render/quality';
import {validate,defaults} from '../src/storage';
import {Vehicle} from '../src/sim/vehicle';
import {Traffic} from '../src/city/traffic';
afterEach(()=>activateMap('northbank'));
const coast={throttle:0,brake:0,steer:0,clutch:0};
function serve(s:RouteService){const bus:BusState={...s.stop,speed:0,doors:true,parking:true,ramp:true,impacts:0,acceleration:0,steer:0};for(let i=0;i<2400&&s.phase!=='ready';i++){s.tick(.05,bus);if(s.event)s.resolve(s.event.event==='bag'?'return':s.event.event==='no-ticket'?'sell':'assist',bus);if(s.ticket){s.greet();s.sell(s.ticket.cash-s.ticket.fare);}}expect(s.phase).toBe('ready');s.tick(.05,{...bus,doors:false,ramp:false});}
describe('Stage 6 maps and every model passenger lifecycle (not physical route drives)',()=>{
 for(const map of maps){
  it(`${map.id}: connected, correctly oriented stops and routes`,()=>{activateMap(map.id);expect(activeMap.id).toBe(map.id);expect(roadKilometers).toBeGreaterThan(map.id==='northbank'?3:8);for(const l of Object.values(lanes)){expect(nodes[l.from]).toBeDefined();expect(nodes[l.to]).toBeDefined();expect(l.connections.length).toBeGreaterThan(0);expect(shortestPath(l.id,'SW>W:0')).not.toBeNull();}for(const s of Object.values(stops))expect(isRoad(s)).toBe(true);for(const r of routes)for(let i=1;i<r.stops.length;i++){const a=stops[r.stops[i-1]],b=stops[r.stops[i]],nav=navigate(a,b,new Set(),a.yaw);expect(nav.path).not.toBeNull();expect(nav.meters).toBeGreaterThan(20);}});
  for(const spec of SPECS)it(`${map.id} / ${spec.id}: every stop pays once and all riders leave`,()=>{activateMap(map.id);for(const r of routes){const s=new RouteService(r.id,123,spec.capacity);while(!s.completed)serve(s);expect(s.score.served).toBe(r.stops.length);expect(s.score.missed).toBe(0);expect(s.onboard).toHaveLength(0);const saved={...defaults,sessions:[{date:new Date().toISOString(),seconds:s.time,meters:1000,liters:1,impacts:0,route:s.score.result(r.id)}]};expect(validate(saved).sessions[0].route?.id).toBe(r.id);const before=s.score.fares;s.sell(0);expect(s.score.fares).toBe(before);}});
  for(const weather of ['clear','rain','fog','jam'] as const)it(`${map.id} / ${weather}: bounded traffic`,()=>{activateMap(map.id);const traffic=new Traffic(weather==='jam'?'high':'medium',true);traffic.weatherSpeed=weather==='fog'?.45:weather==='rain'?.75:weather==='jam'?.35:1;for(let n=0;n<600;n++)traffic.step(.05,{x:0,z:0,yaw:0,speed:0,left:false,doors:false});expect(traffic.agents.length).toBeLessThanOrEqual(22);expect(traffic.agents.every(a=>Number.isFinite(a.x+a.z+a.speed)&&a.speed>=0)).toBe(true);expect(validate({...defaults,weather}).weather).toBe(weather);});
 }
 it('switching maps repeatedly restores exactly the original graph',()=>{const before=JSON.stringify({nodes,lanes,stops,routes});for(let i=0;i<10;i++)for(const map of maps)activateMap(map.id);activateMap('northbank');expect(JSON.stringify({nodes,lanes,stops,routes})).toBe(before);});
});
describe('all-model surface braking and old limitation regressions',()=>{
 for(const spec of SPECS)it(`${spec.id}: wet stopping exceeds dry and the body remains stable`,()=>{const distances=[];for(const surface of ['dry','wet'] as const){const v=new Vehicle();v.configure(spec.id);v.trackWear=false;v.roadClassifier=()=>true;v.surface=surface;for(let i=0;i<240;i++)v.step(1/120,coast);v.drive.running=true;v.drive.parking=false;v.drive.gear=1;v.chassis.velocity.set(0,0,-50/3.6);v.trailer?.velocity.set(0,0,-50/3.6);const z=v.chassis.position.z;for(let i=0;i<1800&&Math.abs(v.speed)>.1;i++)v.step(1/120,{...coast,brake:1});expect(Math.abs(v.speed)).toBeLessThan(.11);distances.push(z-v.chassis.position.z);}expect(distances[1]).toBeGreaterThan(distances[0]);});
 it.each([85,260,540])('fuel pump bills only actual available volume for a %s L tank',capacity=>{const s=new RouteService('21'),i=new Incidents(519,capacity),b={x:-224,z:216,speed:0,parking:true,running:false,hazards:false,fuel:capacity-.5};i.action('pump',b,s);for(let t=0;t<120;t++)i.tick(.1,{...b,fuel:b.fuel+i.fuelAdded},0,s);expect(i.fuelAdded).toBeCloseTo(.5);expect(s.score.expenses).toBe(90);});
 it('auto quality uses hysteresis and does not exceed the selected ceiling',()=>{const q=new AdaptiveQuality();let current:'low'|'balanced'|'high'='high';for(let i=0;i<100;i++)current=q.sample(.05,current,'high');expect(current).toBe('balanced');for(let i=0;i<60;i++)current=q.sample(1/60,current,'high');expect(current).toBe('balanced');for(let i=0;i<1500;i++)current=q.sample(1/60,current,'balanced');expect(current).toBe('balanced');});
});
