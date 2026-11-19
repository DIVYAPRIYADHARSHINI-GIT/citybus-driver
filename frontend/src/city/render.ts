import * as T from 'three';
import * as C from 'cannon-es';
import {box,material,textTexture} from '../render/bus';
import {batchStatic} from '../render/batch';
import type {Vehicle} from '../sim/vehicle';
import {roads,lanes,nodes,stops,facilities,random,sample,project,distance,light,laneAxis,type Point} from './network';
import type {Traffic,Agent,TrafficKind} from './traffic';
import type {RouteService,Passenger} from './service';
import type {Incidents} from './incidents';
import {activeMap} from './network';
interface Chunk {root:T.Group;bodies:C.Body[];x:number;z:number}
const materials={road:material('#536369',.94),walk:material('#b9c3b6'),white:material('#f4edd3'),grass:material('#809978'),black:material('#223536'),green:material('#33846b'),yellow:material('#dec785'),glass:material('#73979c',.2,.4),red:material('#b75a49')};
function ribbon(root:T.Object3D,ps:Point[],width:number,y:number,mat:T.Material){const pos:number[]=[],idx:number[]=[];ps.forEach((p,i)=>{const a=ps[Math.max(0,i-1)],b=ps[Math.min(ps.length-1,i+1)],d=distance(a,b)||1,nx=-(b.z-a.z)/d,nz=(b.x-a.x)/d;for(const side of [-1,1])pos.push(p.x+nx*width/2*side,y,p.z+nz*width/2*side);if(i<ps.length-1){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}});const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();const m=new T.Mesh(g,mat);m.receiveShadow=true;root.add(m);return m;}
function label(root:T.Object3D,text:string,x:number,y:number,z:number,width:number,yaw=0,bg='#204d42'){const m=new T.Mesh(new T.PlaneGeometry(width,width*.2),new T.MeshBasicMaterial({map:textTexture(text,'#f1efd7',bg,512,100)}));m.position.set(x,y,z);m.rotation.y=yaw;const reverse=m.clone();reverse.rotation.y+=Math.PI;root.add(m,reverse);return m;}
function dispose(root:T.Object3D){root.traverse(o=>{if(o instanceof T.Mesh&&!o.userData.shared){if(o instanceof T.InstancedMesh)o.dispose();o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(!Object.values(materials).includes(m)){if('map' in m)(m.map as T.Texture|null)?.dispose();m.dispose();}});}});}
export {dispose as disposeCityResources};
export class CityWorld {
  private extraGates:{mesh:T.Mesh;body:C.Body}[]=[];
  hideActors(){for(const batch of this.trafficBatches.values())for(const m of [batch.body,batch.cab,batch.wheels,batch.beacons])if(m)m.count=0;for(const m of [this.bodyPeople,this.heads,this.legs,this.arms])m.count=0;}
  dispose(){this.activate(false);dispose(this.root);this.gps.geometry.dispose();(this.gps.material as T.Material).dispose();this.root.clear();}
  ghostTraffic=false;
  root=new T.Group();base=new T.Group();chunks=new Map<string,Chunk>();bodies:C.Body[]=[];active=false;private signals:{lane:string;bulbs:T.MeshStandardMaterial[]}[]=[];private lamps:T.MeshStandardMaterial[]=[];private trafficBatches=new Map<TrafficKind,{body:T.InstancedMesh;cab:T.InstancedMesh;wheels:T.InstancedMesh;beacons?:T.InstancedMesh}>();private trafficBodies=new Map<number,C.Body>();private pedestrianBodies=new Map<number,C.Body>();
  private bodyPeople:T.InstancedMesh;private heads:T.InstancedMesh;private legs:T.InstancedMesh;private arms:T.InstancedMesh;private dummy=new T.Object3D();private chunkTimer=0;private gate:T.Mesh;private gateBody:C.Body;private hose:T.Mesh;private triangle:T.Mesh;private jam:T.Group;private gps:T.Line;private gpsKey='';
  constructor(public vehicle:Vehicle,public mobile:boolean){
    this.root.name=activeMap.name;this.root.add(this.base);
    box(this.base,6000,.2,6000,0,-.14,-100,materials.grass);
    for(const road of roads){const width=road.highway?19:16;ribbon(this.base,road.points,width+4,.022,materials.walk);ribbon(this.base,road.points,width,.04,materials.road);
      if(!road.ring){for(let s=18;s<road.length-18;s+=10){const p=sample(road.points,s),stripe=box(this.base,.13,.015,4,p.x,.065,p.z,materials.white);stripe.rotation.y=p.yaw;stripe.castShadow=false;}
        if(road.highway)for(const offset of [-3.5,3.5])for(let s=20;s<road.length-20;s+=12){const p=sample(road.points,s),stripe=box(this.base,.13,.015,5,p.x-p.dz*offset,.07,p.z+p.dx*offset,materials.white);stripe.rotation.y=p.yaw;stripe.castShadow=false;}
      }
      for(let s=30;s<road.length-15;s+=65){const p=sample(road.points,s),x=p.x-p.dz*(width/2+2),z=p.z+p.dx*(width/2+2);box(this.base,.14,7,.14,x,3.5,z,materials.black);const lamp=material('#eef2d7');lamp.emissive.set('#ffe6ac');this.lamps.push(lamp);box(this.base,1.1,.12,.45,x,7,z,lamp);}
    }
    // Clear square junction surfaces connect all trimmed lane endpoints.
    for(const node of Object.values(nodes)){if(node.ring)continue;box(this.base,20,.035,20,node.x,.04,node.z,materials.road);
      if(node.signal){for(const axis of [0,1])for(const side of [-1,1])for(let i=-3;i<=3;i++){const x=node.x+(axis===0?i*2:side*17),z=node.z+(axis===0?side*17:i*2);box(this.base,axis===0?1.2:4,.012,axis===0?4:1.2,x,.072,z,materials.white);}}
    }
    const island=new T.Mesh(new T.CylinderGeometry(17,17,.55,64),materials.grass);island.position.set(0,.26,0);this.base.add(island);this.bodies.push(vehicle.addBox(0,.2,0,23,.4,23));
    const statue=new T.Mesh(new T.TorusKnotGeometry(3,.7,72,10),material('#bfa96b',.24,.7));statue.position.set(0,6,0);this.base.add(statue);box(this.base,6,3,6,0,1.5,0,materials.walk);
    for(const l of Object.values(lanes)){const end=sample(l.points,l.length),start=sample(l.points,Math.min(25,l.length));if(nodes[l.to].signal&&l.ordinal===0){const x=end.x-end.dz*4.8,z=end.z+end.dx*4.8;box(this.base,.13,4.8,.13,x,2.4,z,materials.black);const caseMesh=box(this.base,.48,1.5,.4,x,4.5,z,materials.black);caseMesh.rotation.y=end.yaw+Math.PI;const bulbs:T.MeshStandardMaterial[]=[];
        for(let i=0;i<3;i++){const mat=material(['#9d3b35','#ad9138','#3a8e62'][i]);mat.emissive.set(['#ff3023','#ffb828','#54ff83'][i]);bulbs.push(mat);const sphere=new T.Mesh(new T.SphereGeometry(.14,10,8),mat);sphere.position.set(x-end.dx*.23,5-i*.43,z-end.dz*.23);this.base.add(sphere);}this.signals.push({lane:l.id,bulbs});
        const line=box(this.base,6.5,.018,.25,end.x,.083,end.z,materials.white);line.rotation.y=end.yaw;
      }
      if(l.ordinal===0&&!nodes[l.from].ring){const x=start.x-start.dz*6,z=start.z+start.dx*6;box(this.base,.08,2.7,.08,x,1.35,z,materials.black);label(this.base,String(l.limit),x,2.55,z,1.1,start.yaw,'#aabca1');}
    }
    for(const stop of Object.values(stops)){const p=sample(lanes[stop.lane].points,stop.s),right={x:-p.dz,z:p.dx},group=new T.Group();group.position.set(stop.x,0,stop.z);group.rotation.y=stop.yaw;this.base.add(group);
      for(const x of [-2.1,2.1])for(let z=-9;z<10;z+=3)box(group,.16,.016,1.8,x,.09,z,materials.yellow);for(const z of [-10,10])box(group,4.2,.02,.15,0,.09,z,materials.yellow);batchStatic(group);
      const curbX=stop.x+right.x*6,curbZ=stop.z+right.z*6;box(this.base,.1,3.2,.1,curbX,1.6,curbZ,materials.green);label(this.base,stop.name.toUpperCase(),curbX,3,curbZ,5,stop.yaw,'#245e4d');
      const shelter=new T.Group();shelter.position.set(stop.x+right.x*9,0,stop.z+right.z*9);shelter.rotation.y=stop.yaw;this.base.add(shelter);box(shelter,2.6,.16,7,0,2.9,0,materials.green);for(const z of [-3,3])box(shelter,.12,3,.12,1,1.5,z,materials.black);box(shelter,.1,2.2,6,1.1,1.6,0,materials.glass);box(shelter,1,.15,4,.3,.65,0,materials.yellow);batchStatic(shelter);
    }
    // Terminal and roadside destinations, with actual collision hulls.
    box(this.base,22,6,35,-212,3,210,materials.walk);this.bodies.push(vehicle.addBox(-212,3,210,22,6,35));label(this.base,'SOUTHBANK / BUS TERMINAL',-223.1,4.7,209,15,-Math.PI/2);
    for(const f of facilities){box(this.base,.12,3,.12,f.x,1.5,f.z,materials.green);label(this.base,f.name.toUpperCase(),f.x,3.4,f.z,7,Math.PI/2);}
    box(this.base,1.4,2.2,1,-226,1.1,222,materials.green);label(this.base,'FUEL 1.80/L',-226,1.5,222.51,1.2);
    this.hose=box(this.base,.08,.08,5,-229,.8,222,materials.black);this.hose.visible=false;
    box(this.base,11,5,9,-219,2.5,169,materials.glass);this.bodies.push(vehicle.addBox(-219,2.5,169,11,5,9));
    // Highway underpass / tunnel, straight and level: walls and roof are collidable.
    box(this.base,126,1.3,28,115,6.8,-400,materials.walk);this.bodies.push(vehicle.addBox(115,6.8,-400,126,1.3,28));
    for(const z of [-411,-389]){box(this.base,126,6,1,115,3,z,materials.walk);this.bodies.push(vehicle.addBox(115,3,z,126,6,1));}label(this.base,'NORTHBANK TUNNEL · 70',49,6,-400,14,-Math.PI/2);
    for(let x=60;x<177;x+=20){const mat=material('#eee1af');mat.emissive.set('#fff1b8');mat.emissiveIntensity=2;box(this.base,3,.12,.3,x,6,-400,mat);}
    // Bridge deck over a visually recessed river; continuous flat physics floor.
    box(this.base,140,.08,67,240,-.02,-323,material('#467e88',.17,.3));box(this.base,20,.25,75,240,.025,-323,materials.road);
    for(const x of [230,250]){box(this.base,.3,1,75,x,.65,-323,materials.walk);this.bodies.push(vehicle.addBox(x,.65,-323,.3,1,75));for(let z=-357;z<-285;z+=8)box(this.base,.2,4,.2,x,2,z,materials.green);box(this.base,.2,.2,75,x,4,-323,materials.green);}
    for(const x of [217,263])box(this.base,1,13,1,x,5,-323,materials.walk);label(this.base,'RIVER AIRE BRIDGE',240,8,-282,19,Math.PI);
    box(this.base,3,3,3,-70,1.5,-386,materials.green);this.gate=box(this.base,.2,.18,8,-70,1.3,-395,materials.red);this.gateBody=vehicle.addBox(-70,1.3,-395,.2,1.6,8);this.bodies.push(this.gateBody);
    this.triangle=new T.Mesh(new T.ConeGeometry(.7,1.2,3),materials.red);this.root.add(this.triangle);this.triangle.visible=false;
    this.jam=new T.Group();this.base.add(this.jam);const jl=lanes['RE>E:0'];for(let i=0;i<6;i++){const p=sample(jl.points,jl.length*.55);const cone=new T.Mesh(new T.ConeGeometry(.24,.8,8),materials.red);cone.position.set(p.x, .4,p.z-3+i*1.1);this.jam.add(cone);}
    for(const landmark of activeMap.landmarks){const {x,z,kind,name}=landmark;label(this.base,name,x,5.8,z+15,18);
      if(kind==='bridge'){
        box(this.base,230,.08,130,x,-.03,z,material('#3b7e8c',.18));box(this.base,240,.08,22,x,.02,z,materials.road);
        for(const side of [-1,1]){box(this.base,240,1,.3,x,.65,z+side*11,materials.walk);this.bodies.push(vehicle.addBox(x,.65,z+side*11,240,1,.3));for(let dx=-100;dx<=100;dx+=25){box(this.base,.5,8,.5,x+dx,4,z+side*12,materials.green);box(this.base,20,.3,.3,x+dx,7,z+side*12,materials.green);}}
      }else if(kind==='tunnel'){
        box(this.base,180,1.2,28,x,7,z,materials.walk);this.bodies.push(vehicle.addBox(x,7,z,180,1.2,28));for(const side of [-1,1]){box(this.base,180,6.5,1,x,3.25,z+side*12,materials.walk);this.bodies.push(vehicle.addBox(x,3.25,z+side*12,180,6.5,1));}
      }else if(kind==='toll'){
        const horizontal=activeMap.id==='meridian';box(this.base,3,3,3,x+12,1.5,z+12,materials.green);const mesh=box(this.base,horizontal?.2:8,.18,horizontal?8:.2,x,1.3,z,materials.red),body=vehicle.addBox(x,1.3,z,horizontal?.2:8,1.6,horizontal?8:.2);this.extraGates.push({mesh,body});this.bodies.push(body);
      }else if(kind==='fuel'||kind==='rest'){
        box(this.base,22,.05,32,x,.03,z,materials.road);box(this.base,12,4,8,x+12,2,z,materials.walk);this.bodies.push(vehicle.addBox(x+12,2,z,12,4,8));for(let j=-1;j<=1;j++)box(this.base,1,2,1,x,1,z+j*5,materials.green);
      }else{box(this.base,60,.1,60,x,.05,z,materials.walk);box(this.base,24,48,24,x,24,z,materials.glass);this.bodies.push(vehicle.addBox(x,24,z,24,48,24));}
    }
    batchStatic(this.base,new Set([this.gate,this.hose,...this.extraGates.map(g=>g.mesh)]));
    for(const kind of ['car','truck','motorcycle','police','ambulance'] as TrafficKind[]){const colors={car:'#cba872',truck:'#658a83',motorcycle:'#d68450',police:'#e1e7dc',ambulance:'#eaddb2'},body=new T.InstancedMesh(new T.BoxGeometry(1,1,1),material(colors[kind],.38,.25),60),cab=new T.InstancedMesh(new T.BoxGeometry(1,1,1),materials.glass,60),wheels=new T.InstancedMesh(new T.CylinderGeometry(.36,.36,.23,10).rotateZ(Math.PI/2),materials.black,240);body.castShadow=true;cab.castShadow=true;this.root.add(body,cab,wheels);const batch:{body:T.InstancedMesh;cab:T.InstancedMesh;wheels:T.InstancedMesh;beacons?:T.InstancedMesh}={body,cab,wheels};if(kind==='police'||kind==='ambulance'){const mat=material('#629dea');mat.emissive.set('#257bff');mat.emissiveIntensity=2;batch.beacons=new T.InstancedMesh(new T.BoxGeometry(.9,.16,.25),mat,60);this.root.add(batch.beacons);}this.trafficBatches.set(kind,batch);}
    this.bodyPeople=new T.InstancedMesh(new T.BoxGeometry(.4,.64,.24),material('#6887a8'),90);this.heads=new T.InstancedMesh(new T.SphereGeometry(.14,10,8),material('#ba8b69'),90);this.legs=new T.InstancedMesh(new T.BoxGeometry(.12,.52,.13),materials.black,180);this.arms=new T.InstancedMesh(new T.BoxGeometry(.11,.5,.12),material('#6887a8'),180);this.root.add(this.bodyPeople,this.heads,this.legs,this.arms);
    this.gps=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#c5f287',transparent:true,opacity:.85}));this.root.add(this.gps);
    this.root.visible=false;for(const body of this.bodies)vehicle.world.removeBody(body);
  }
  activate(on:boolean){this.active=on;this.root.visible=on;for(const b of this.bodies){if(on&&!this.vehicle.world.bodies.includes(b))this.vehicle.world.addBody(b);if(!on)this.vehicle.world.removeBody(b);}if(!on){for(const c of this.chunks.values()){c.bodies.forEach(b=>this.vehicle.world.removeBody(b));this.root.remove(c.root);dispose(c.root);}this.chunks.clear();for(const b of [...this.trafficBodies.values(),...this.pedestrianBodies.values()])this.vehicle.world.removeBody(b);this.trafficBodies.clear();this.pedestrianBodies.clear();}}
  private chunk(x:number,z:number){const root=new T.Group(),bodies:C.Body[]=[],rand=random((x+12)*65537+(z+12)*113);root.name=`city-chunk:${x},${z}`;root.position.set(x*160,0,z*160);
    for(let i=0;i<12;i++){const px=x*160+(rand()-.5)*148,pz=z*160+(rand()-.5)*148;if(roads.some(r=>project(r.points,{x:px,z:pz}).distance<31)||Math.hypot(px,pz)<48||facilities.some(f=>distance(f,{x:px,z:pz})<40)||Math.abs(pz+323)<43&&Math.abs(px-240)<80)continue;
      const w=13+rand()*17,d=13+rand()*18,h=9+rand()*38,color=['#b9b49b','#a7bdaf','#7f9d9f','#bf947d'][i%4],lod=new T.LOD(),detail=new T.Group(),simple=new T.Group();lod.position.set(px-x*160,0,pz-z*160);root.add(lod);
      box(detail,w,h,d,0,h/2,0,material(color));box(simple,w,h,d,0,h/2,0,material(color));for(let row=0;row<h/3.5-1;row++)for(let col=0;col<w/4-1;col++){box(detail,1.5,1.7,.08,-w/2+2.5+col*4,2.5+row*3.5,d/2+.05,materials.glass);}box(detail,w+.5,.5,d+.5,0,h+.2,0,materials.walk);batchStatic(detail);lod.addLevel(detail,0);lod.addLevel(simple,this.mobile?100:160);bodies.push(this.vehicle.addBox(px,h/2,pz,w,h,d));
    }
    const trunks=new T.InstancedMesh(new T.CylinderGeometry(.16,.25,3,6),material('#665f4f'),24),trees=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),material('#48795a'),24);let count=0;
    for(let i=0;i<24;i++){const px=x*160+(rand()-.5)*150,pz=z*160+(rand()-.5)*150;if(roads.some(r=>project(r.points,{x:px,z:pz}).distance<13))continue;const h=3+rand()*3;this.dummy.position.set(px-x*160,1.5,pz-z*160);this.dummy.rotation.set(0,0,0);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();trunks.setMatrixAt(count,this.dummy.matrix);this.dummy.position.y=h;this.dummy.scale.set(1.7,h*.5,1.7);this.dummy.updateMatrix();trees.setMatrixAt(count,this.dummy.matrix);count++;}trunks.count=trees.count=count;trees.castShadow=true;root.add(trunks,trees);this.root.add(root);return {root,bodies,x:x*160,z:z*160};
  }
  updateChunks(p:Point,dt:number){if(!this.active)return;this.chunkTimer-=dt;if(this.chunkTimer>0)return;this.chunkTimer=.5;const radius=this.mobile?270:390,cx=Math.round(p.x/160),cz=Math.round(p.z/160);
    for(let x=cx-3;x<=cx+3;x++)for(let z=cz-3;z<=cz+3;z++){const key=`${x}:${z}`;if(Math.hypot(x*160-p.x,z*160-p.z)<radius&&!this.chunks.has(key))this.chunks.set(key,this.chunk(x,z));}
    for(const [key,c] of this.chunks)if(distance(c,p)>radius+140){c.bodies.forEach(b=>this.vehicle.world.removeBody(b));this.root.remove(c.root);dispose(c.root);this.chunks.delete(key);}
  }
  path(points:Point[]){const key=points.map(p=>`${Math.round(p.x)},${Math.round(p.z)}`).join(';');if(key===this.gpsKey)return;this.gpsKey=key;this.gps.geometry.dispose();this.gps.geometry=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(p.x,.18,p.z)));}
  sync(traffic:Traffic,service:RouteService,incidents:Incidents,dt:number,hour:number){if(!this.active)return;const bus=this.vehicle.chassis.position;this.updateChunks(bus,dt);
    materials.road.roughness=this.vehicle.surface==='wet'?.24:.94;
    for(const gate of this.extraGates){gate.mesh.position.y=T.MathUtils.damp(gate.mesh.position.y,incidents.tollPaid?6:1.3,5,dt);gate.body.collisionResponse=!incidents.tollPaid;gate.body.collisionFilterMask=incidents.tollPaid?0:-1;}
    this.signals.forEach(s=>{const l=lanes[s.lane],state=light(nodes[l.to],laneAxis(l),traffic.time);s.bulbs.forEach((m,i)=>m.emissiveIntensity=['red','amber','green'][i]===state?3.5:0);});this.lamps.forEach(m=>m.emissiveIntensity=hour<6||hour>18?3:0);
    this.gate.rotation.x=T.MathUtils.damp(this.gate.rotation.x,incidents.tollPaid?Math.PI/2:0,5,dt);this.gateBody.collisionResponse=!incidents.tollPaid;this.gateBody.collisionFilterMask=incidents.tollPaid?0:-1;this.hose.visible=incidents.pump;this.jam.visible=incidents.jam;
    this.triangle.visible=incidents.triangle;if(incidents.triangle){this.triangle.position.set(0,.6,13).applyQuaternion(new T.Quaternion().copy(this.vehicle.chassis.quaternion as unknown as T.Quaternion)).add(new T.Vector3(bus.x,bus.y-1,bus.z));}
    for(const [kind,batch] of this.trafficBatches){const list=traffic.agents.filter(a=>a.kind===kind&&distance(a,bus)<(this.mobile?200:350));batch.body.count=batch.cab.count=list.length;batch.wheels.count=list.length*4;if(batch.beacons)batch.beacons.count=list.length;
      list.forEach((a,i)=>{const w=kind==='motorcycle'?.65:kind==='truck'?2.4:1.85,h=kind==='truck'?2.9:kind==='ambulance'?2.1:.8;this.matrix(batch.body,i,a.x,h/2+.45,a.z,a.yaw,w,h,a.length);this.matrix(batch.cab,i,a.x-Math.sin(a.yaw)*a.length*.12,h+.5,a.z-Math.cos(a.yaw)*a.length*.12,a.yaw,w*.85,.65,a.length*.45);
        for(let j=0;j<4;j++){const local=new T.Vector3((j%2?1:-1)*w*.5,.36,(j<2?-1:1)*a.length*.32).applyAxisAngle(new T.Vector3(0,1,0),a.yaw);this.matrix(batch.wheels,i*4+j,a.x+local.x,.36,a.z+local.z,a.yaw,1,1,1);}if(batch.beacons)this.matrix(batch.beacons,i,a.x,h+.95,a.z,a.yaw,1,1,1);
      });[batch.body,batch.cab,batch.wheels,batch.beacons].forEach(m=>{if(m){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}});
    }
    const activeIds=new Set<number>();for(const a of traffic.agents){if(distance(a,bus)>110)continue;activeIds.add(a.id);let body=this.trafficBodies.get(a.id);if(!body){body=new C.Body({mass:0,type:C.Body.KINEMATIC,shape:new C.Box(new C.Vec3(a.kind==='motorcycle'?.35:1,a.kind==='truck'?1.5:.7,a.length/2))});this.vehicle.world.addBody(body);this.trafficBodies.set(a.id,body);}body.position.set(a.x,a.kind==='truck'?1.8:1,a.z);body.quaternion.setFromEuler(0,a.yaw,0);body.aabbNeedsUpdate=true;}
    for(const [id,body] of this.trafficBodies)if(!activeIds.has(id)){this.vehicle.world.removeBody(body);this.trafficBodies.delete(id);}
    const people:{p:Point;y:number;yaw:number;walking:boolean;wave:boolean;seat:boolean}[]=[];
    for(const ped of traffic.pedestrians()){if(distance(ped,bus)<180)people.push({p:ped,y:0,yaw:ped.yaw,walking:ped.active,wave:false,seat:false});let b=this.pedestrianBodies.get(ped.id);if(ped.active&&distance(ped,bus)<80){if(!b){b=new C.Body({mass:0,type:C.Body.KINEMATIC,shape:new C.Sphere(.32)});this.vehicle.world.addBody(b);this.pedestrianBodies.set(ped.id,b);}b.position.set(ped.x,.75,ped.z);b.aabbNeedsUpdate=true;}else if(b){this.vehicle.world.removeBody(b);this.pedestrianBodies.delete(ped.id);}}
    for(const p of service.passengers){if(p.phase==='gone')continue;const pose=this.passengerPose(p,service);people.push(pose);}
    const count=Math.min(90,people.length);this.bodyPeople.count=this.heads.count=count;this.legs.count=this.arms.count=count*2;
    people.slice(0,count).forEach((a,i)=>{const bend=a.seat?-.32:0;this.matrix(this.bodyPeople,i,a.p.x,a.y+1.1+bend,a.p.z,a.yaw,1,1,1);this.matrix(this.heads,i,a.p.x,a.y+1.57+bend,a.p.z,a.yaw,1,1,1);
      for(let j=0;j<2;j++){const side=j?1:-1,walk=a.walking?Math.sin(traffic.time*7+i+j*Math.PI)*.35:0;const offset=new T.Vector3(side*.13,0,walk*.2).applyAxisAngle(new T.Vector3(0,1,0),a.yaw);this.matrix(this.legs,i*2+j,a.p.x+offset.x,a.y+.48+bend*.5,a.p.z+offset.z,a.yaw,1,a.seat?.65:1,1);const arm=new T.Vector3(side*.3,0,0).applyAxisAngle(new T.Vector3(0,1,0),a.yaw);this.matrix(this.arms,i*2+j,a.p.x+arm.x,a.y+1.06+bend+(a.wave&&j===0?.55:0),a.p.z+arm.z,a.yaw,1,1,1);}
    });for(const m of [this.bodyPeople,this.heads,this.legs,this.arms]){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}
    for(const body of [...this.trafficBodies.values(),...this.pedestrianBodies.values()]){body.collisionResponse=!this.ghostTraffic;body.collisionFilterMask=this.ghostTraffic?0:-1;}
  }
  private passengerPose(p:Passenger,service:RouteService){const bus=this.vehicle.chassis.position,spec=this.vehicle.drive.spec,scale=new T.Vector3(spec.width_m/2.5,spec.category==='double-decker'?.9:spec.height_m/3.3,spec.front_length_m/12),floor=Math.max(0,bus.y-.58*scale.y),q=new T.Quaternion().copy(this.vehicle.chassis.quaternion as unknown as T.Quaternion),stop=stops[service.route.stops[p.origin]],right={x:Math.cos(stop.yaw),z:-Math.sin(stop.yaw)},waiting={x:stop.x+right.x*7-Math.sin(stop.yaw)*(Number(p.id.split('-').at(-1))*1.1),z:stop.z+right.z*7-Math.cos(stop.yaw)*(Number(p.id.split('-').at(-1))*1.1)},seat=new T.Vector3(p.seat<24?[-.98,-.53,.53,.98][p.seat%4]:.08,-.05,-2.75+Math.floor((p.seat%24)/4)*1.35).multiply(scale).applyQuaternion(q).add(new T.Vector3(bus.x,bus.y,bus.z)),door=new T.Vector3(1.5,-.55,-5.25).multiply(scale).applyQuaternion(q).add(new T.Vector3(bus.x,bus.y,bus.z));
    if(p.phase==='waiting')return {p:waiting,y:0,yaw:stop.yaw,walking:false,wave:true,seat:false};
    if(p.phase==='boarding'){const t=p.progress,from=t<.35?waiting:door,to=t<.35?door:seat,f=t<.35?t/.35:(t-.35)/.65;return {p:{x:from.x+(to.x-from.x)*f,z:from.z+(to.z-from.z)*f},y:floor*Math.min(1,t/.35),yaw:stop.yaw,walking:true,wave:false,seat:false};}
    if(p.phase==='alighting'){const current=service.stop,r={x:Math.cos(current.yaw),z:-Math.sin(current.yaw)},end={x:current.x+r.x*8,z:current.z+r.z*8},t=Math.min(1,p.progress),from=t<.65?seat:door,to=t<.65?door:end,f=t<.65?t/.65:(t-.65)/.35;return {p:{x:from.x+(to.x-from.x)*f,z:from.z+(to.z-from.z)*f},y:floor*(t<.65?1:1-f),yaw:current.yaw,walking:true,wave:false,seat:false};}
    return {p:seat,y:floor,yaw:Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x)),walking:false,wave:service.stopRequested,seat:p.phase==='seated'};
  }
  private matrix(mesh:T.InstancedMesh,index:number,x:number,y:number,z:number,yaw:number,sx:number,sy:number,sz:number,pitch=0,roll=0){this.dummy.position.set(x,y,z);this.dummy.rotation.set(pitch,yaw,roll);this.dummy.scale.set(sx,sy,sz);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);}
}
