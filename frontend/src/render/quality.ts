import type {Quality} from './scene';
/** Hysteresis avoids changing render targets every frame. Hidden-tab stalls and
 * loading frames are excluded by the caller. Manual quality remains a ceiling. */
export class AdaptiveQuality {
  seconds=0;frames=0;cooldown=0;
  sample(dt:number,current:Quality,ceiling:Quality):Quality {
    if(!Number.isFinite(dt)||dt<=0||dt>.2)return current;
    this.cooldown=Math.max(0,this.cooldown-dt);this.seconds+=dt;this.frames++;
    if(this.seconds<4)return current;
    const fps=this.frames/this.seconds;this.seconds=0;this.frames=0;
    if(this.cooldown>0)return current;
    const levels:Quality[]=['low','balanced','high'],index=levels.indexOf(current),max=levels.indexOf(ceiling);
    const next=fps<28?Math.max(0,index-1):fps>56?Math.min(max,index+1):index;
    if(next!==index)this.cooldown=15;
    return levels[next];
  }
}
