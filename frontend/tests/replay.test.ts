import {describe,it,expect} from 'vitest';
import {sampleReplay} from '../src/sim/replay';
import type {Frame} from '../src/sim/vehicle';
const frames:Frame[]=[{t:10,p:[0,1,0],q:[0,0,0,1],speed:0,steer:0},{t:10.1,p:[1,2,3],q:[0,1,0,0],speed:10,steer:.2}];
describe('trajectory replay interpolation',()=>{
 it('handles empty recordings',()=>expect(sampleReplay([],3)).toBeUndefined());
 it('clamps before the first sample',()=>expect(sampleReplay(frames,0)).toEqual(frames[0]));
 it('clamps after the last sample',()=>expect(sampleReplay(frames,20)).toEqual(frames[1]));
 it('interpolates position, speed and steering between 10 Hz samples',()=>{const s=sampleReplay(frames,10.05)!;expect(s.p[0]).toBeCloseTo(.5);expect(s.p[1]).toBeCloseTo(1.5);expect(s.p[2]).toBeCloseTo(1.5);expect(s.speed).toBeCloseTo(5);expect(s.steer).toBeCloseTo(.1);});
 it('slerps a normalized shortest-arc orientation',()=>{const s=sampleReplay(frames,10.05)!;expect(s.q[1]).toBeCloseTo(Math.SQRT1_2);expect(s.q[3]).toBeCloseTo(Math.SQRT1_2);expect(Math.hypot(...s.q)).toBeCloseTo(1);});
 it('never exposes mutable recording arrays',()=>{const s=sampleReplay(frames,0)!;s.p[0]=999;s.q[3]=0;expect(frames[0].p[0]).toBe(0);expect(frames[0].q[3]).toBe(1);});
});
