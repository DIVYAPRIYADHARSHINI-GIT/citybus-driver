import { Quaternion } from 'three';
import type { Frame } from './vehicle';
/** Pure trajectory sampling. Does not mutate the recording or the live body. */
export function sampleReplay(frames:readonly Frame[],time:number):Frame|undefined{
  if(!frames.length)return undefined;
  if(time<=frames[0].t)return structuredClone(frames[0]);
  if(time>=frames[frames.length-1].t)return structuredClone(frames[frames.length-1]);
  let lo=0,hi=frames.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(frames[mid].t<=time)lo=mid;else hi=mid;}
  const a=frames[lo],b=frames[hi],f=(time-a.t)/(b.t-a.t),q=new Quaternion().fromArray(a.q).slerp(new Quaternion().fromArray(b.q),f).normalize();
  let rear:Frame['rear'];if(a.rear&&b.rear){const rq=new Quaternion().fromArray(a.rear.q).slerp(new Quaternion().fromArray(b.rear.q),f).normalize();rear={p:a.rear.p.map((n,i)=>n+(b.rear!.p[i]-n)*f) as Frame['p'],q:[rq.x,rq.y,rq.z,rq.w]};}
  return {t:time,p:[a.p[0]+(b.p[0]-a.p[0])*f,a.p[1]+(b.p[1]-a.p[1])*f,a.p[2]+(b.p[2]-a.p[2])*f],q:[q.x,q.y,q.z,q.w],speed:a.speed+(b.speed-a.speed)*f,steer:a.steer+(b.steer-a.steer)*f,...(rear?{rear}:{})};
}
