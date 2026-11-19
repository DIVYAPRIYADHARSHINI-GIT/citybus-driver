import type {Frame} from './vehicle';
export interface TripRecording {version:1;map:string;route:string|null;model:string;frames:Frame[];truncated:boolean}
const KEY='citybus-last-trip.v1';
function validPose(value:unknown):value is NonNullable<Frame['rear']>{
  if(!value||typeof value!=='object')return false;
  const v=value as NonNullable<Frame['rear']>;
  return Array.isArray(v.p)&&v.p.length===3&&Array.isArray(v.q)&&v.q.length===4&&[...v.p,...v.q].every(Number.isFinite)&&v.p.every(n=>Math.abs(n)<=10000)&&Math.abs(Math.hypot(...v.q)-1)<=.05;
}
/** One-Hz rounded trajectory archive, at most four hours / 4 MB. The original
 * 10-Hz 30-second diagnostic ring is unchanged. NPC/audio history is not recorded. */
export class TripRecorder {
  recording:TripRecording={version:1,map:'track',route:null,model:'cb-120',frames:[],truncated:false};
  begin(map:string,route:string|null,model:string){this.recording={version:1,map,route,model,frames:[],truncated:false};}
  sample(frame:Frame){
    const frames=this.recording.frames;if(frames.length&&frame.t-frames.at(-1)!.t<1)return;
    const round=(n:number)=>Math.round(n*10000)/10000;
    const pose=(v:NonNullable<Frame['rear']>)=>({p:v.p.map(round) as Frame['p'],q:v.q.map(round) as Frame['q']});
    frames.push({t:round(frame.t),...pose(frame),speed:round(frame.speed),steer:round(frame.steer),...(frame.rear?{rear:pose(frame.rear)}:{})});
    if(frames.length>14400){frames.shift();this.recording.truncated=true;}
  }
  save():boolean {
    if(this.recording.frames.length<2)return false;
    try{const raw=JSON.stringify(this.recording);if(raw.length>4000000)return false;localStorage.setItem(KEY,raw);return true;}catch{return false;}
  }
  static read():TripRecording|null {
    try{
      const raw=localStorage.getItem(KEY);if(!raw||raw.length>4000000)return null;
      const r=JSON.parse(raw) as TripRecording;
      if(r.version!==1||typeof r.map!=='string'||typeof r.model!=='string'||!Array.isArray(r.frames)||r.frames.length<2||r.frames.length>14400)return null;
      let last=-Infinity;
      for(const f of r.frames){if(!validPose(f)||![f.t,f.speed,f.steer].every(Number.isFinite)||f.t<=last||(f.rear!==undefined&&!validPose(f.rear)))return null;last=f.t;}
      return r;
    }catch{return null;}
  }
}
