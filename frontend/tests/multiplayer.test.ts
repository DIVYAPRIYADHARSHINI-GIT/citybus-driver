import {describe,it,expect} from 'vitest';
import {PoseBuffer} from '../src/multiplayer/interpolation';
import {SharedWorld,roomEvents} from '../src/multiplayer/shared-world';
import {validRemote,rankRacers,type RemotePose} from '../src/multiplayer/protocol';
import {RouteService} from '../src/city/service';
const pose=(seq:number,z:number,speed=10):RemotePose=>({id:'peer',name:'Driver',model_id:'cb-120',paint:'#217a6d',p:[0,1,z],q:[0,0,0,1],speed,seq,keys:{},articulation:0,connected:true,checkpoint:0,finished_ms:null,client_time:0});
describe('bounded remote interpolation',()=>{
 it('interpolates position and speed without mutating snapshots',()=>{const b=new PoseBuffer(),a=pose(1,0),c=pose(2,-2,12);b.push(0,a);b.push(.2,c);const result=b.sample(.1)!;expect(result.p[2]).toBeCloseTo(-1);expect(result.speed).toBeCloseTo(11);result.p[0]=20;expect(a.p[0]).toBe(0);expect(b.samples[0].pose.p[0]).toBe(0);});
 it('clamps extrapolation to 150 ms even during a long outage',()=>{const b=new PoseBuffer();b.push(0,pose(1,0));expect(b.sample(10)!.p[2]).toBeCloseTo(-1.5);expect(b.sample(1)!.p[2]).toBe(b.sample(10)!.p[2]);});
 it('does not extrapolate a disconnected player',()=>{const b=new PoseBuffer();b.push(0,{...pose(1,0),connected:false});expect(b.sample(1)!.p[2]).toBe(0);});
 it('slerps normalized orientation on the short arc',()=>{const b=new PoseBuffer();b.push(0,pose(1,0));b.push(1,{...pose(2,0),q:[0,1,0,0]});const q=b.sample(.5)!.q;expect(q[1]).toBeCloseTo(Math.SQRT1_2);expect(q[3]).toBeCloseTo(Math.SQRT1_2);});
 it('caps history and ignores out-of-order server snapshots',()=>{const b=new PoseBuffer();for(let i=0;i<40;i++)b.push(i,pose(i,-i));expect(b.samples).toHaveLength(24);b.push(20,pose(100,99));expect(b.samples.at(-1)!.time).toBe(39);});
 it('handles missing and prehistory samples safely',()=>{const b=new PoseBuffer();expect(b.sample(0)).toBeNull();b.push(5,pose(1,3));expect(b.sample(0)!.p[2]).toBe(3);});
});
describe('shared city determinism',()=>{
 it('route red-light scoring uses the shared signal clock instead of local menu-paused time',()=>{const service=new RouteService('21');service.trafficTime=30;const bus={x:-236.5,z:21,yaw:0,speed:2,doors:false,parking:false,ramp:false,impacts:0,acceleration:0,steer:0};service.tick(.01,bus);service.tick(.01,{...bus,z:19});expect(service.score.events.some(e=>e.kind==='red-light')).toBe(true);expect(service.time).toBeLessThan(1);});
 it('same room seed and clock produce exactly the same traffic',()=>{const a=new SharedWorld(5021),b=new SharedWorld(5021);a.at(85,10000);for(let t=0;t<=85;t++)b.at(t,10000);expect(a.tick).toBe(b.tick);expect(a.traffic.agents).toEqual(b.traffic.agents);});
 it('different rooms do not share identical traffic layouts',()=>{const a=new SharedWorld(1),b=new SharedWorld(2);a.at(10);b.at(10);expect(a.traffic.agents[0].x).not.toBe(b.traffic.agents[0].x);});
 it('late-join replay is budgeted and converges to the canonical state',()=>{const a=new SharedWorld(88),b=new SharedWorld(88);a.at(200,50);expect(a.ready).toBe(false);for(let i=0;i<100&&!a.ready;i++)a.at(200,50);b.at(200,10000);expect(a.ready).toBe(true);expect(a.traffic.agents).toEqual(b.traffic.agents);});
 it('ten-minute cycles bound replay work and reset deterministically',()=>{const a=new SharedWorld(44),b=new SharedWorld(44);a.at(605,10000);b.at(600,10000);b.at(605,10000);expect(a.cycle).toBe(1);expect(a.tick).toBe(100);expect(a.traffic.agents).toEqual(b.traffic.agents);});
 it('room events are stable and change only at shared epoch boundaries',()=>{expect(roomEvents(14,120)).toEqual(roomEvents(14,239.99));expect(roomEvents(14,119).epoch).not.toBe(roomEvents(14,120).epoch);});
 it('shared traffic uses the same bounded population on every device',()=>{const a=new SharedWorld(12);a.at(10);expect(a.traffic.agents).toHaveLength(16);});
});
describe('snapshot safety and race ordering',()=>{
 it('rejects nonfinite and malformed remote poses',()=>{expect(validRemote(pose(1,0))).toBe(true);expect(validRemote({...pose(1,0),p:[NaN,0,0]})).toBe(false);expect(validRemote({...pose(1,0),q:[0,1]})).toBe(false);expect(validRemote({...pose(1,0),paint:'url(evil)'})).toBe(false);expect(validRemote(null)).toBe(false);});
 it('ranks finishers by server time then unfinished checkpoint progress',()=>{const a={...pose(1,0),id:'a',checkpoint:2},b={...pose(1,0),id:'b',checkpoint:1},c={...pose(1,0),id:'c',checkpoint:4,finished_ms:30000};expect(rankRacers([a,b,c],[[0,150],[0,70],[0,-20],[0,-120]]).map(p=>p.id)).toEqual(['c','a','b']);});
 it('orders equal checkpoint progress by distance to the next gate',()=>{const a={...pose(1,100),id:'a',checkpoint:1},b={...pose(1,80),id:'b',checkpoint:1};expect(rankRacers([a,b],[[0,150],[0,70],[0,-20],[0,-120]])[0].id).toBe('b');});
});
