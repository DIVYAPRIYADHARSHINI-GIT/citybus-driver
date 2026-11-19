import type { Drivetrain, Surface } from './sim/drivetrain';
export class AudioEngine {
  ambient?:GainNode;cityActive=false;
  ctx:AudioContext|null=null;master?:GainNode;engine?:OscillatorNode;harmonic?:OscillatorNode;engineGain?:GainNode;roadGain?:GainNode;rainGain?:GainNode;
  volume=.45;private tick=-1;private radioTick=-1;
  async unlock(){if(!this.ctx){
    const c=new AudioContext();this.ctx=c;this.master=c.createGain();this.master.gain.value=this.volume;this.master.connect(c.destination);
    this.engineGain=c.createGain();this.engineGain.gain.value=0;const low=c.createBiquadFilter();low.type='lowpass';low.frequency.value=380;this.engineGain.connect(low).connect(this.master);
    this.engine=c.createOscillator();this.engine.type='sawtooth';this.engine.frequency.value=32;this.engine.connect(this.engineGain);this.engine.start();
    this.harmonic=c.createOscillator();this.harmonic.type='triangle';this.harmonic.connect(this.engineGain);this.harmonic.start();
    this.roadGain=this.noiseLoop(400);this.rainGain=this.noiseLoop(3000);this.ambient=this.noiseLoop(800);
  }if(this.ctx.state==='suspended')await this.ctx.resume();}
  private noiseLoop(frequency:number){const c=this.ctx!,b=c.createBuffer(1,c.sampleRate*2,c.sampleRate),data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;const s=c.createBufferSource();s.buffer=b;s.loop=true;const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=frequency;const gain=c.createGain();gain.gain.value=0;s.connect(filter).connect(gain).connect(this.master!);s.start();return gain;}
  tone(hz:number,duration=.08,volume=.06){if(!this.ctx||this.ctx.state!=='running')return;const c=this.ctx,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);o.connect(g).connect(this.master!);o.start();o.stop(c.currentTime+duration);o.onended=()=>{o.disconnect();g.disconnect();};}
  hiss(){if(!this.ctx)return;const c=this.ctx,b=c.createBuffer(1,c.sampleRate*.35,c.sampleRate),data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length)*.12;const s=c.createBufferSource();s.buffer=b;s.connect(this.master!);s.start();s.onended=()=>s.disconnect();}
  horn(){this.tone(220,.6,.13);this.tone(277,.6,.1);}
  setVolume(v:number){this.volume=v;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(v,this.ctx.currentTime,.05);}
  update(d:Drivetrain,speed:number,surface:Surface,rain:boolean,t:number,active:boolean){
    if(!this.ctx)return;const now=this.ctx.currentTime;this.engine!.frequency.setTargetAtTime(Math.max(12,d.rpm/20),now,.08);this.harmonic!.frequency.setTargetAtTime(Math.max(20,d.rpm/10),now,.08);this.engineGain!.gain.setTargetAtTime(active&&d.running?.025+d.rpm/2400*.025:0,now,.1);
    this.roadGain!.gain.setTargetAtTime(active?Math.min(.06,Math.abs(speed)*.0018)*(surface==='gravel'?1.8:1):0,now,.1);this.rainGain!.gain.setTargetAtTime(active&&rain?.04:0,now,.2);
    const tick=Math.floor(t*2.4);if(tick!==this.tick){if(active&&(d.hazards||d.left||d.right))this.tone(tick%2?650:900,.045,.04);this.tick=tick;}
    this.ambient!.gain.setTargetAtTime(active&&this.cityActive?.006:0,now,.3);
    const rt=Math.floor(t*(d.radio===3?2:3));if(active&&d.radio&&rt!==this.radioTick){const notes=d.radio===1?[196,247,294,330,294,247,220,247]:d.radio===2?[262,330,392,440,392,330,294,330]:[174,220,261,349,261,220,196,220];this.tone(notes[rt%8],.22,.018);this.radioTick=rt;}
  }
  suspend(){if(this.ctx?.state==='running')void this.ctx.suspend();}
}
