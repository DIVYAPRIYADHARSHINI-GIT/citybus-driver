import * as T from 'three';
import type { Action, Drivetrain } from '../sim/drivetrain';
import { batchStatic } from './batch';
export const palette = ['#217a6d','#c29a50','#ba553f','#25445d','#e4e9df'];
export function material(color: T.ColorRepresentation, roughness=.6, metalness=.05) { return new T.MeshStandardMaterial({color,roughness,metalness}); }
export function box(parent: T.Object3D, w:number,h:number,d:number, x:number,y:number,z:number, mat:T.Material) {
  const mesh = new T.Mesh(new T.BoxGeometry(w,h,d),mat); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
export function textTexture(text: string, fg='#b9e877', bg='#10221e', w=512,h=96) {
  const c=document.createElement('canvas'); c.width=w;c.height=h; const ctx=c.getContext('2d')!;
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${h*.54}px monospace`;ctx.fillText(text,w/2,h/2,w*.94);
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
export interface BusModel { group:T.Group; wheels:T.Group[]; wheel:T.Group; doors:T.Group[]; wipers:T.Group[]; controls:T.Object3D[]; paint:T.MeshStandardMaterial; gauges:T.CanvasTexture; headlights:T.SpotLight[]; indicators:T.MeshStandardMaterial[]; ramp:T.Mesh; mirrorTargets:T.WebGLRenderTarget[]; mirrorCameras:T.PerspectiveCamera[]; update:(d:Drivetrain, speed:number,steer:number,t:number,dt:number)=>void }
export function createBus(seatRows=6): BusModel {
  const group=new T.Group();group.name='CB 120 · diesel city bus';
  const white=material('#e2e6dc',.38,.22), paint=material(palette[0],.35,.24), black=material('#101b1c',.7), dark=material('#293638',.74), steel=material('#9da9a5',.3,.8), seat=material('#426d67',.85), yellow=material('#dec478',.35,.3);
  const glass=new T.MeshPhysicalMaterial({color:'#688a83',roughness:.12,metalness:.2,transparent:true,opacity:.2,depthWrite:false,side:T.DoubleSide});
  const floor=box(group,2.42,.15,11.8,0,-.57,0,dark);
  box(group,2.5,.17,12,0,1.92,0,white);box(group,2.3,.24,2.6,0,2.12,1.8,dark);
  // Side skirt profiles include actual wheel-arch cutouts, not wheels hidden in boxes.
  for(const side of [-1,1]) {
    const shape=new T.Shape(); shape.moveTo(-6,-.72);shape.lineTo(-4.58,-.72);shape.lineTo(-4.58,-.55);
    shape.absarc(-3.9,-.55,.68,Math.PI,0,true);shape.lineTo(1.42,-.55);shape.absarc(2.1,-.55,.68,Math.PI,0,true);shape.lineTo(2.78,-.72);shape.lineTo(6,-.72);shape.lineTo(6,.37);shape.lineTo(-6,.37);shape.closePath();
    const m=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.075,bevelEnabled:false}),paint);m.rotation.y=-Math.PI/2;m.position.x=side*1.24;m.castShadow=true;group.add(m);
    box(group,.07,.15,12,side*1.23,.38,0,white);
    for(let j=0;j<8;j++) {
      const z=-5.25+j*1.5;
      if(side===1 && (j===0||j===4)) continue;
      box(group,.032,1.25,1.4,side*1.251,1.08,z,glass);box(group,.075,1.5,.07,side*1.24,1.12,z+.74,black);
    }
    box(group,.07,.1,12,side*1.25,1.78,0,black);
    for(const z of [-5.95,5.95]) box(group,.12,2.4,.15,side*1.2,.62,z,white);
  }
  box(group,2.48,.7,.12,0,-.32,-5.96,white);
  box(group,2.32,1.66,.025,0,1,-5.99,glass);box(group,.06,1.7,.035,.15,1,-6.01,black);
  box(group,2.42,.32,.04,0,1.64,-6.03,black);
  const sign=new T.Mesh(new T.PlaneGeometry(2.13,.23),new T.MeshBasicMaterial({map:textTexture('01  PROVING GROUND')}));sign.position.set(0,1.65,-6.06);sign.rotation.y=Math.PI;group.add(sign);
  box(group,2.47,1.04,.12,0,-.2,5.95,paint);box(group,2.3,1.25,.035,0,1.1,6,glass);
  for(let j=0;j<7;j++) box(group,1.4,.025,.03,0,-.05+j*.065,6.03,black);
  for(const z of [-6.04,6.04]) { box(group,2.3,.13,.13,0,-.59,z,black); const plate=new T.Mesh(new T.PlaneGeometry(.5,.12),new T.MeshBasicMaterial({map:textTexture('CB · 0120','#162b25','#f4f4dc',256,64)}));plate.position.set(0,-.39,z+(z<0?-.03:.03));if(z<0)plate.rotation.y=Math.PI;group.add(plate); }
  const headlights:T.SpotLight[]=[],indicators:T.MeshStandardMaterial[]=[];
  for(const side of [-1,1]) {
    const lamp=material('#f9edcd',.15,.3);lamp.emissive.set('#fff1ce');lamp.emissiveIntensity=.35;
    box(group,.43,.19,.04,side*.87,-.13,-6.045,lamp);
    const spot=new T.SpotLight('#fff1cf',0,95,.48,.5,1.5);spot.position.set(side*.87,-.1,-6.12);spot.target.position.set(side*2,-1.1,-40);group.add(spot,spot.target);headlights.push(spot);
    const amber=material('#ee8a20');amber.emissive.set('#ff8c1c');indicators.push(amber);
    box(group,.15,.1,.04,side*1.04,.1,-6.04,amber);box(group,.07,.09,.2,side*1.28,.45,-4.4,amber);
    box(group,.16,.3,.04,side*1.07,-.12,6.05,material('#a72d29',.3));
    box(group,.3,.05,.05,side*1.27,1.5,-5.65,dark);
  }
  // Cabin, driver's station, ticket terminal, grab poles and 24 individual seats.
  for(let row=0;row<seatRows;row++) for(const side of [-1,1]) {
    const z=-2.75+row*1.35;
    box(group,.8,.17,.62,side*.72,-.04,z,seat);box(group,.8,.7,.13,side*.72,.32,z+.31,seat);box(group,.09,.5,.08,side*.72,-.32,z,steel);
  }
  for(const z of [-3.2,-.4,2.4,4.8]) for(const x of [-.35,.35]) { const p=new T.Mesh(new T.CylinderGeometry(.021,.021,2.3,8),yellow);p.position.set(x,.63,z);group.add(p); }
  box(group,1.9,.28,.6,0,-.03,-5.45,dark);box(group,.95,.3,.47,-.58,.12,-5.2,black);
  box(group,.65,.2,.7,-.62,-.03,-4.25,seat);box(group,.65,.8,.13,-.62,.33,-3.92,seat);
  const wheel=new T.Group();wheel.position.set(-.62,.35,-4.95);wheel.rotation.x=-.45;group.add(wheel);
  const rim=new T.Mesh(new T.TorusGeometry(.29,.023,10,36),black);wheel.add(rim);
  for(let i=0;i<3;i++) { const spoke=box(wheel,.025,.27,.03,0,.12,0,dark);spoke.rotation.z=i*Math.PI*2/3;spoke.position.set(Math.sin(-i*Math.PI*2/3)*.12,Math.cos(i*Math.PI*2/3)*.12,0); }
  const hub=new T.Mesh(new T.CylinderGeometry(.08,.08,.06,20),black.clone());hub.rotation.x=Math.PI/2;wheel.add(hub);rim.userData.action='steering';rim.userData.tooltip='Steering wheel · drag left / right';
  hub.userData.action='horn';hub.userData.tooltip='Horn · press the centre of the wheel';
  const controls:T.Object3D[]=[rim,hub];
  const pedals=(['clutch','brake','throttle'] as const).map((action,i)=>{const pedal=box(group,.12,.04,.25,-.92+i*.23,-.5,-4.82,black.clone());pedal.userData.action=`pedal:${action}`;pedal.userData.tooltip=`${action} pedal · hold`;controls.push(pedal);return pedal;});
  const levers:T.Group[]=[];
  for(const [action,x,z,label] of [['gearUp',-.06,-4.45,'Gear lever · drag up / down'],['parking',-1.02,-4.45,'Parking brake · click to apply / release'],['doors',.76,-4.55,'Door lever · click to open / close']] as [Action,number,number,string][]){
    const lever=new T.Group();lever.position.set(x,-.1,z);group.add(lever);levers.push(lever);
    const shaft=box(lever,.025,.28,.025,0,.14,0,steel.clone());
    const knob=new T.Mesh(new T.SphereGeometry(.065,16,12),material(action==='doors'?'#c8ad62':'#263b32'));
    knob.position.y=.3;knob.userData.action=action;knob.userData.tooltip=label;shaft.userData.action=action;shaft.userData.tooltip=label;
    lever.add(knob);controls.push(knob,shaft);
    box(group,.16,.1,.23,x,-.12,z,black);
  }
  const radioKnob=new T.Mesh(new T.CylinderGeometry(.052,.052,.07,20),material('#536e5b',.3,.6));radioKnob.rotation.x=Math.PI/2;radioKnob.position.set(.51,.37,-5.09);radioKnob.userData.action='radio';radioKnob.userData.tooltip='Radio · click station / drag volume';group.add(radioKnob);controls.push(radioKnob);
  const gaugeCanvas=document.createElement('canvas');gaugeCanvas.width=768;gaugeCanvas.height=256;const gc=gaugeCanvas.getContext('2d')!;const gauges=new T.CanvasTexture(gaugeCanvas);gauges.colorSpace=T.SRGBColorSpace;
  const panel=new T.Mesh(new T.PlaneGeometry(.9,.3),new T.MeshBasicMaterial({map:gauges}));panel.position.set(-.62,.29,-5.16);panel.rotation.x=-.12;group.add(panel);
  const actions: [Action,string][]=[['ignition','START'],['parking','P BRAKE'],['doors','DOORS'],['lights','LIGHTS'],['wipers','WIPERS'],['hazards','HAZARD'],['left','LEFT'],['right','RIGHT'],['retarder','RETARD'],['automatic','AUTO'],['gearUp','GEAR +'],['gearDown','GEAR −'],['radio','RADIO'],['horn','HORN'],['ramp','RAMP']];
  actions.forEach(([action,label],i)=>{
    const x=.03+(i%3)*.22,z=-5.4+Math.floor(i/3)*.17;
    const m=box(group,.18,.065,.12,x,.16,z,material(action==='hazards'?'#933f32':'#364f4a'));
    m.userData.action=action;m.userData.tooltip=label;controls.push(m);
    const txt=new T.Mesh(new T.PlaneGeometry(.16,.065),new T.MeshBasicMaterial({map:textTexture(label,'#dfe9cf','#30473f',256,96)}));txt.rotation.x=-Math.PI/2;txt.position.set(x,.195,z);group.add(txt);
  });
  const ticket=box(group,.33,.42,.12,.73,.48,-5.05,black);ticket.rotation.x=-.2;ticket.userData.action='ticket';ticket.userData.tooltip='Ticket machine · training mode';controls.push(ticket);
  const ticketScreen=new T.Mesh(new T.PlaneGeometry(.27,.28),new T.MeshBasicMaterial({map:textTexture('TICKETS','#b9e877','#132b26',256,256)}));ticketScreen.position.set(.73,.5,-4.98);group.add(ticketScreen);
  const doors:T.Group[]=[];
  for(const z of [-5.25,.75]) for(const half of [-1,1]) {
    const door=new T.Group();door.position.set(1.25,.1,z+half*.7);group.add(door);
    box(door,.045,1.9,.66,0,.53,-half*.34,glass);box(door,.07,2.3,.055,0,.45,0,black);box(door,.07,.35,.68,0,-.47,-half*.34,paint);
    door.userData.direction=half;doors.push(door);
  }
  const ramp=box(group,1,.05,1.3,1.6,-.64,-5.2,dark);ramp.visible=false;ramp.rotation.z=-.2;
  const wipers:T.Group[]=[];
  for(const x of [-.68,.58]) {const w=new T.Group();w.position.set(x,.23,-6.07);box(w,.025,.93,.025,0,.43,0,black);box(w,.045,.62,.035,.015,.65,0,black);group.add(w);wipers.push(w);}
  const wheels:T.Group[]=[];
  for(let i=0;i<4;i++) {
    const w=new T.Group();const tire=new T.Mesh(new T.CylinderGeometry(.5,.5,.26,32),material('#1e2422',.94));tire.rotation.z=Math.PI/2;w.add(tire);
    const hubcap=new T.Mesh(new T.CylinderGeometry(.29,.29,.28,24),steel);hubcap.rotation.z=Math.PI/2;w.add(hubcap);
    for(const side of [-1,1]) for(let k=0;k<8;k++) {const bolt=new T.Mesh(new T.SphereGeometry(.024,5,4),black);bolt.position.set(side*.15,Math.sin(k*Math.PI/4)*.19,Math.cos(k*Math.PI/4)*.19);w.add(bolt);}
    w.traverse(o=>{o.castShadow=true;});batchStatic(w);wheels.push(w);
  }
  const mirrorTargets:T.WebGLRenderTarget[]=[],mirrorCameras:T.PerspectiveCamera[]=[];
  for(const side of [-1,1]) {
    box(group,.12,.5,.25,side*1.6,1.1,-5.45,black);
    const target=new T.WebGLRenderTarget(128,256);target.texture.colorSpace=T.SRGBColorSpace;mirrorTargets.push(target);
    const mirror=new T.Mesh(new T.PlaneGeometry(.2,.42),new T.MeshBasicMaterial({map:target.texture}));mirror.position.set(side*1.6,1.1,-5.3);mirror.userData.action='mirror';mirror.userData.tooltip='Mirror · adjust rearward view';controls.push(mirror);group.add(mirror);
    const camera=new T.PerspectiveCamera(65,.5,.2,200);mirrorCameras.push(camera);
  }
  let gaugeClock=0, doorAngle=0;
  const update=(d:Drivetrain,speed:number,steer:number,t:number,dt:number)=>{
    wheel.rotation.z=-steer*7;
    pedals.forEach((p,i)=>p.rotation.x=-.35-d.visualPedals[(['clutch','brake','throttle'] as const)[i]]*.5);
    levers[0].rotation.x=T.MathUtils.damp(levers[0].rotation.x,-d.gear*.045,8,dt);
    levers[1].rotation.x=T.MathUtils.damp(levers[1].rotation.x,d.parking?-.6:.15,8,dt);
    levers[2].rotation.z=T.MathUtils.damp(levers[2].rotation.z,d.doors?-.65:0,8,dt);
    radioKnob.rotation.y=d.radio*.7;
    doorAngle=T.MathUtils.damp(doorAngle,d.doors?Math.PI*.42:0,5,dt);
    doors.forEach(v=>v.rotation.y=v.userData.direction*doorAngle);ramp.visible=d.ramp;
    wipers.forEach((w,i)=>w.rotation.z=d.wipers?Math.sin(t*4+i*.2)*.65:1.38);
    headlights.forEach(h=>h.intensity=d.lights?180:0);
    indicators.forEach((m,i)=>m.emissiveIntensity=(d.hazards||(i===0?d.left:d.right))&&Math.floor(t*2.4)%2===0?4:0);
    controls.forEach(o=>{const a=o.userData.action;if(o instanceof T.Mesh && o.material instanceof T.MeshStandardMaterial && a!=='steering') {o.material.emissive.set('#b9e877');o.material.emissiveIntensity=(a==='ignition'?d.running:a==='parking'?d.parking:a==='doors'?d.doors:a==='retarder'?d.retarder>0:(d as unknown as Record<string,unknown>)[a])?.17:0;}});
    gaugeClock+=dt;if(gaugeClock<.1)return;gaugeClock=0;
    gc.fillStyle='#10241f';gc.fillRect(0,0,768,256);
    function dial(cx:number,label:string,value:number,max:number){gc.lineWidth=10;gc.strokeStyle='#28483b';gc.beginPath();gc.arc(cx,132,85,Math.PI*.75,Math.PI*2.25);gc.stroke();gc.strokeStyle='#c4f18e';gc.beginPath();gc.arc(cx,132,85,Math.PI*.75,Math.PI*.75+Math.PI*1.5*Math.min(1,value/max));gc.stroke();gc.fillStyle='#e5f2d5';gc.textAlign='center';gc.font='bold 43px monospace';gc.fillText(String(Math.round(value)),cx,146);gc.font='20px monospace';gc.fillText(label,cx,195);}
    dial(113,'km/h',Math.abs(speed)*3.6,100);dial(345,'RPM',d.rpm,d.spec.redline_rpm);
    gc.textAlign='left';gc.fillStyle='#d3e5bd';gc.font='22px monospace';gc.fillText(`AIR ${d.air.toFixed(1)} bar`,490,70);gc.fillText(`${d.spec.energy==='electric'?'BATT':'FUEL'} ${Math.round(d.fuel)} ${d.spec.energy==='electric'?'kWh':'L'}`,490,111);gc.fillText(`TEMP ${Math.round(d.temperature)}°`,490,152);gc.fillText(`${d.gearLabel}   ${d.parking?'(P)':''} ${d.abs?'ABS':''}`,490,204);gauges.needsUpdate=true;
  };
  batchStatic(group,new Set([...controls,ramp]));
  void floor;
  return {group,wheels,wheel,doors,wipers,controls,paint,gauges,headlights,indicators,ramp,mirrorTargets,mirrorCameras,update};
}
