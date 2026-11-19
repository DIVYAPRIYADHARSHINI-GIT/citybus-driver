import type { Action, Pedals } from './sim/drivetrain';
const bindings:Record<string,Action>={KeyI:'ignition',KeyP:'parking',KeyE:'gearUp',KeyQ:'gearDown',KeyM:'automatic',KeyO:'doors',KeyZ:'left',KeyX:'right',KeyH:'hazards',KeyL:'lights',KeyV:'wipers',KeyR:'retarder',KeyB:'horn',KeyN:'radio',KeyU:'ramp'};
export class Input {
  sensitivity=1;deadzone=.12;
  keys=new Set<string>();touch:Pedals={throttle:0,brake:0,clutch:0,steer:0};pedals:Pedals={throttle:0,brake:0,clutch:0,steer:0};
  enabled=false;gamepad=false;private previousButtons:boolean[]=[];
  constructor(public action:(a:Action)=>void,public camera:()=>void,public pause:()=>void){
    window.addEventListener('keydown',e=>{
      if(e.code==='Escape'){e.preventDefault();if(!e.repeat)this.pause();return;}
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLButtonElement&&['Enter','Space'].includes(e.code))return;
      if(!this.enabled)return;
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
      this.keys.add(e.code);if(e.repeat)return;
      if(bindings[e.code])this.action(bindings[e.code]);if(e.code==='KeyC')this.camera();
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>this.clear());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
    window.addEventListener('gamepaddisconnected',()=>{this.previousButtons=[];this.clear();});
  }
  clear(){this.keys.clear();this.touch={throttle:0,brake:0,clutch:0,steer:0};this.pedals={...this.touch};}
  update(){
    if(!this.enabled){this.pedals={throttle:0,brake:0,clutch:0,steer:0};return;}
    const key=(...codes:string[])=>codes.some(c=>this.keys.has(c));
    const p:Pedals={throttle:Math.max(this.touch.throttle,key('KeyW','ArrowUp')?1:0),brake:Math.max(this.touch.brake,key('KeyS','ArrowDown','Space')?1:0),clutch:Math.max(this.touch.clutch,key('ShiftLeft','ShiftRight')?1:0),steer:this.touch.steer+(key('KeyA','ArrowLeft')?1:0)-(key('KeyD','ArrowRight')?1:0)};
    const pad=navigator.getGamepads?.().find(v=>v?.connected);this.gamepad=!!pad;
    if(pad){p.throttle=Math.max(p.throttle,pad.buttons[7]?.value??0);p.brake=Math.max(p.brake,pad.buttons[6]?.value??0);p.clutch=Math.max(p.clutch,pad.buttons[4]?.value??0);const axis=pad.axes[0]??0;p.steer+=Math.abs(axis)>.12?-Math.sign(axis)*(Math.abs(axis)-.12)/.88:0;
      const maps:Record<number,Action>={0:'doors',1:'parking',2:'ignition',3:'gearUp',5:'gearDown',10:'horn',11:'hazards',12:'lights',13:'retarder',14:'left',15:'right',16:'ramp'};
      pad.buttons.forEach((v,i)=>{if(v.pressed&&!this.previousButtons[i]){if(maps[i])this.action(maps[i]);if(i===9)this.pause();if(i===8)this.camera();}});this.previousButtons=pad.buttons.map(b=>b.pressed);
    }else this.previousButtons=[];
    p.steer=Math.max(-1,Math.min(1,p.steer*this.sensitivity));this.pedals=p;
  }
  bindHold(el:HTMLElement,field:keyof Pedals,value:number){
    const active=new Set<number>();
    el.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();el.setPointerCapture(e.pointerId);active.add(e.pointerId);this.touch[field]=value;el.classList.add('held');});
    const up=(e:PointerEvent)=>{active.delete(e.pointerId);if(!active.size){this.touch[field]=0;el.classList.remove('held');}};
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);
  }
}
