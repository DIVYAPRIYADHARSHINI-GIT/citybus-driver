import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createBus } from './bus';
import {createFleetBus,createTrailer,disposeBus,disposeTrailer} from './fleet';
import {specFor,wearNew,type Wear} from '../tycoon/engine';
import { makeWorld } from './world';
import {AdaptiveQuality} from './quality';
import type { Vehicle, Frame } from '../sim/vehicle';
export type CameraMode='cockpit'|'chase'|'orbit';
export type Weather='clear'|'rain'|'fog'|'snow'|'jam';
export type Quality='low'|'balanced'|'high';
export class GameScene {
  autoQuality=true;private adaptive=new AdaptiveQuality();qualityCeiling:Quality='balanced';
  renderer:T.WebGLRenderer; scene=new T.Scene(); camera=new T.PerspectiveCamera(48,1,.08,1800);
  bus=createBus();sun=new T.DirectionalLight('#fff0cb',3);ambient=new T.HemisphereLight('#d8e7df','#607059',2);
  sky=new Sky();composer:EffectComposer;bloom:UnrealBloomPass;world:ReturnType<typeof makeWorld>;
  mode:CameraMode='orbit';weather:Weather='clear';quality:Quality='balanced';hour=15;dayCycle=false;
  yaw=0;pitch=0;orbit=0;mirrorYaw=0;menu=true;gyro=0;frameCount=0;
  trailerVisual:T.Group|null=null;trailerWheels:T.Group[]=[];
  private rain:T.Points;private weatherClock=0;private ray=new T.Raycaster();private smooth=new T.Vector3();private initialized=false;
  constructor(public canvas:HTMLCanvasElement,public vehicle:Vehicle) {
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    const pmrem=new T.PMREMGenerator(this.renderer),environment=new RoomEnvironment();
    this.scene.environment=pmrem.fromScene(environment,.04).texture;this.scene.environmentIntensity=.22;environment.dispose();pmrem.dispose();
    this.scene.add(this.ambient,this.sun,this.sun.target,this.bus.group,...this.bus.wheels);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:180});this.sun.shadow.normalBias=.04;this.sun.shadow.bias=-.0001;
    this.sky.scale.setScalar(1200);this.scene.add(this.sky);
    Object.assign(this.sky.material.uniforms.turbidity,{value:4});this.sky.material.uniforms.rayleigh.value=1.4;
    this.world=makeWorld(this.scene,vehicle);
    const positions=new Float32Array(1800*3);for(let i=0;i<positions.length;i+=3){positions[i]=(Math.random()-.5)*70;positions[i+1]=Math.random()*35;positions[i+2]=(Math.random()-.5)*70;}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(positions,3));this.rain=new T.Points(geo,new T.PointsMaterial({color:'#e1e7e7',size:.07,transparent:true,opacity:.5,depthWrite:false}));this.scene.add(this.rain);
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.bloom=new UnrealBloomPass(new T.Vector2(1,1),.18,.4,1.25);this.composer.addPass(this.bloom);
    this.setWeather('clear');this.setHour(15);this.resize();
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('renderlost'));});
  }
  resize() {const w=this.canvas.clientWidth,h=this.canvas.clientHeight;this.renderer.setSize(w,h,false);this.composer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  setQuality(q:Quality){this.quality=q;this.renderer.setPixelRatio(Math.min(devicePixelRatio,q==='low'?1:q==='high'?2:1.5));this.renderer.shadowMap.enabled=q!=='low';this.bloom.enabled=q==='high';this.resize();}
  setHour(h:number) {
    this.hour=h;const angle=(h-6)/12*Math.PI,day=T.MathUtils.smoothstep(Math.sin(angle),-.12,.25),sunPos=new T.Vector3(Math.cos(angle)*70,Math.max(5,Math.sin(angle)*95),-35);
    this.sky.material.uniforms.sunPosition.value.copy(sunPos);this.sky.visible=day>.15;
    this.scene.background=new T.Color('#081923');const weatherFactor=this.weather==='clear'?1:.55;
    this.sun.intensity=(.06+day*3)*weatherFactor;this.ambient.intensity=.38+day*1.8*weatherFactor;this.scene.environmentIntensity=.012+day*.208;
    this.sun.position.copy(this.bus.group.position).add(sunPos);this.sun.target.position.copy(this.bus.group.position);
    const fogColor=new T.Color('#a5b8b3').lerp(new T.Color('#0b2028'),1-day);
    this.scene.fog=new T.FogExp2(fogColor,this.weather==='fog'?.017:this.weather==='rain'?.0045:this.weather==='snow'?.008:.0018);
    this.renderer.toneMappingExposure=.85+day*.2;
  }
  setWeather(w:Weather){this.weather=w;this.vehicle.surface=['rain','snow','fog'].includes(w)?'wet':'dry';this.rain.visible=w==='rain'||w==='snow';(this.rain.material as T.PointsMaterial).size=w==='snow'?.16:.055;this.world.road.roughness=w==='rain'?.22:.92;this.setHour(this.hour);}
  setMode(m:CameraMode){this.mode=m;this.yaw=0;this.pitch=0;this.initialized=false;this.camera.fov=m==='cockpit'?70:48;this.camera.updateProjectionMatrix();}
  updateFleetLabels(){const s=this.vehicle.drive.spec;const selector=document.querySelector<HTMLSelectElement>('#garage-transmission');if(selector){selector.value=this.vehicle.drive.automatic?'auto':'manual';selector.disabled=s.energy==='electric';}const lead=document.querySelector('#garage-copy .lead');if(lead)lead.textContent=`${s.name} · ${s.category} · ${s.energy}`;const title=document.querySelector('.bus-info h2');if(title)title.textContent=s.name;const values=document.querySelectorAll('.bus-info .spec strong');if(values[0])values[0].textContent=`${s.length_m.toFixed(1)} m`;if(values[1])values[1].textContent=`${s.mass_kg.toLocaleString()} kg`;if(values[2]){values[2].textContent=`${s.power_kw} kW`;const label=values[2].parentElement?.querySelector('span');if(label)label.textContent='POWER';}}
  equip(modelId:string,wear:Wear=wearNew(),upgrades:Record<string,number>={},paint='#217a6d',energy?:number){const spec=specFor(modelId);if(!spec)throw new Error('Unknown driving profile.');this.scene.remove(this.bus.group,...this.bus.wheels);if(this.trailerVisual){this.scene.remove(this.trailerVisual);disposeTrailer(this.trailerVisual,this.bus.paint);}disposeBus(this.bus);this.scene.remove(...this.trailerWheels);this.trailerVisual=null;this.trailerWheels=[];this.vehicle.configure(modelId,wear,upgrades);this.bus=createFleetBus(spec,upgrades);this.bus.paint.color.set(paint);this.scene.add(this.bus.group,...this.bus.wheels);if(spec.rear_length_m>0){this.trailerVisual=createTrailer(spec,this.bus.paint);this.scene.add(this.trailerVisual);this.trailerWheels=this.bus.wheels.slice(0,2).map(w=>w.clone());this.scene.add(...this.trailerWheels);}if(energy!==undefined)this.vehicle.drive.fuel=energy/1000;this.initialized=false;for(let i=0;i<120;i++)this.vehicle.step(1/120,{throttle:0,brake:0,steer:0,clutch:0});this.vehicle.replay=[];this.updateFleetLabels();}
  setCity(on:boolean){this.world.root.visible=!on;for(const body of this.world.bodies){if(on)this.vehicle.world.removeBody(body);else if(!this.vehicle.world.bodies.includes(body))this.vehicle.world.addBody(body);}}
  pick(clientX:number,clientY:number){const r=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1),this.camera);return this.ray.intersectObjects(this.bus.controls,false)[0]?.object;}
  frame(dt:number,t:number,replay?:Frame) {
    const p=this.vehicle.chassis.position,q=this.vehicle.chassis.quaternion,b=this.bus.group;
    this.sky.position.set(replay?.p[0]??p.x,0,replay?.p[2]??p.z);
    if(this.autoQuality&&!document.hidden&&!this.menu){const quality=this.adaptive.sample(dt,this.quality,this.qualityCeiling);if(quality!==this.quality)this.setQuality(quality);}
    if(replay){b.position.fromArray(replay.p);b.quaternion.fromArray(replay.q);}else{b.position.set(p.x,p.y,p.z);b.quaternion.set(q.x,q.y,q.z,q.w);}
    this.bus.wheels.forEach((w,i)=>{
      this.vehicle.ray.updateWheelTransform(i);const v=this.vehicle.ray.wheelInfos[i].worldTransform;
      if(replay){const axle=this.vehicle.ray.wheelInfos[i].chassisConnectionPointLocal;w.position.set(axle.x,-.62,axle.z).applyQuaternion(b.quaternion).add(b.position);w.quaternion.copy(b.quaternion);}else{w.position.set(v.position.x,v.position.y,v.position.z);w.quaternion.set(v.quaternion.x,v.quaternion.y,v.quaternion.z,v.quaternion.w);}
    });
    if(this.trailerVisual&&this.vehicle.trailer){const t=this.vehicle.trailer,visual=this.trailerVisual;
      if(replay){if(replay.rear){visual.position.fromArray(replay.rear.p);visual.quaternion.fromArray(replay.rear.q);}else{const spec=this.vehicle.drive.spec;visual.quaternion.copy(b.quaternion);visual.position.set(0,0,(spec.front_length_m+spec.rear_length_m)/2+.4).applyQuaternion(b.quaternion).add(b.position);}}
      else{visual.position.set(t.position.x,t.position.y,t.position.z);visual.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);}
      this.trailerWheels.forEach((w,i)=>{this.vehicle.trailerRay!.updateWheelTransform(i);const wheel=this.vehicle.trailerRay!.wheelInfos[i],v=wheel.worldTransform;if(replay){w.position.set(wheel.chassisConnectionPointLocal.x,-.62,wheel.chassisConnectionPointLocal.z).applyQuaternion(visual.quaternion).add(visual.position);w.quaternion.copy(visual.quaternion);}else{w.position.set(v.position.x,v.position.y,v.position.z);w.quaternion.set(v.quaternion.x,v.quaternion.y,v.quaternion.z,v.quaternion.w);}});
    }
    this.bus.update(this.vehicle.drive,replay?.speed??this.vehicle.speed,replay?.steer??this.vehicle.steer,t,dt);
    const target=b.position.clone();
    if(this.mode==='cockpit'&&!this.menu){
      const eye=new T.Vector3(-.62,.88,-4).multiply(b.scale).applyQuaternion(b.quaternion).add(target);this.camera.position.copy(eye);
      const rotation=new T.Quaternion().setFromEuler(new T.Euler(this.pitch-.12,this.yaw+this.gyro,0,'YXZ'));
      this.camera.quaternion.copy(b.quaternion).multiply(rotation);
    }else{
      let offset:T.Vector3;
      if(this.menu||this.mode==='orbit'){const a=this.orbit+(this.menu?-.7:2.3);offset=new T.Vector3(Math.sin(a)*24,7,Math.cos(a)*-24);if(this.menu){if(this.camera.aspect<.8){target.y-=7.2;offset.multiplyScalar(1.25);}else{target.x+=5;target.z+=3;}}}
      else {const extra=Math.max(0,this.vehicle.drive.spec.length_m-12);offset=new T.Vector3(0,5.2+extra*.2,16+extra).applyQuaternion(b.quaternion);}
      const position=b.position.clone().add(offset);
      if(!this.initialized){this.smooth.copy(position);this.initialized=true;}else this.smooth.lerp(position,1-Math.exp(-dt*6));
      this.camera.position.copy(this.smooth);target.y+=.8;this.camera.lookAt(target);
    }
    this.weatherClock+=dt;if(this.weatherClock>.25){this.setHour(this.dayCycle?((this.hour+this.weatherClock*.02)%24):this.hour);this.weatherClock=0;}
    if(this.rain.visible){this.rain.position.set(p.x,0,p.z);const a=this.rain.geometry.attributes.position as T.BufferAttribute;const arr=a.array as Float32Array;for(let i=0;i<arr.length;i+=3){arr[i+1]-=dt*(this.weather==='snow'?1.3:19);arr[i]+=dt*.4;if(arr[i+1]<0)arr[i+1]=35;}a.needsUpdate=true;}
    if(this.mode==='cockpit'&&!this.menu&&this.quality!=='low'&&this.frameCount%4===0){
      const oldVisible=this.bus.group.visible;this.bus.group.visible=false;
      this.bus.mirrorCameras.forEach((cam,i)=>{const side=i===0?-1:1;cam.position.set(side*1.65,1.05,-5.3).applyQuaternion(b.quaternion).add(b.position);cam.lookAt(new T.Vector3(side*(2+this.mirrorYaw*5),.7,24).applyQuaternion(b.quaternion).add(b.position));this.renderer.setRenderTarget(this.bus.mirrorTargets[i]);this.renderer.render(this.scene,cam);});
      this.renderer.setRenderTarget(null);this.bus.group.visible=oldVisible;
    }
    if(this.quality==='high')this.composer.render();else this.renderer.render(this.scene,this.camera);this.frameCount++;
  }
}
