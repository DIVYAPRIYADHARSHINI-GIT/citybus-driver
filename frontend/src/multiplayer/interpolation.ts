import {Quaternion,Vector3} from 'three';
import type {RemotePose} from './protocol';
export interface Sample {time:number;pose:RemotePose}
export class PoseBuffer {
 samples:Sample[]=[];
 push(time:number,pose:RemotePose){if(this.samples.length&&time<=this.samples.at(-1)!.time)return;this.samples.push({time,pose:structuredClone(pose)});if(this.samples.length>24)this.samples.shift();}
 sample(time:number):RemotePose|null{if(!this.samples.length)return null;const first=this.samples[0],last=this.samples.at(-1)!;if(time<=first.time)return structuredClone(first.pose);
  for(let i=1;i<this.samples.length;i++){const b=this.samples[i],a=this.samples[i-1];if(time<=b.time){const f=(time-a.time)/(b.time-a.time),q=new Quaternion().fromArray(a.pose.q).slerp(new Quaternion().fromArray(b.pose.q),f);return {...structuredClone(b.pose),p:a.pose.p.map((v,k)=>v+(b.pose.p[k]-v)*f),q:[q.x,q.y,q.z,q.w],speed:a.pose.speed+(b.pose.speed-a.pose.speed)*f};}}
  const result=structuredClone(last.pose),dt=Math.min(.15,Math.max(0,time-last.time));if(result.connected&&dt){const forward=new Vector3(0,0,-1).applyQuaternion(new Quaternion().fromArray(result.q));result.p=result.p.map((v,i)=>v+forward.getComponent(i)*result.speed*dt);}return result;
 }
}
