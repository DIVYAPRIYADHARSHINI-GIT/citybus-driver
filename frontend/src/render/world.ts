import * as T from 'three';
import { box, material, textTexture } from './bus';
import type { Vehicle } from '../sim/vehicle';
import { batchStatic } from './batch';
export const trackPoint=(t:number,r=50)=>{
  // Continuous stadium: west straight, northern arc, east straight, southern arc.
  const straight=120, arc=Math.PI*r, length=straight*2+arc*2;let s=((t%1)+1)%1*length;
  if(s<straight)return new T.Vector3(-r,0,60-s);s-=straight;
  if(s<arc){const a=Math.PI+s/r;return new T.Vector3(Math.cos(a)*r,0,-60+Math.sin(a)*r);}s-=arc;
  if(s<straight)return new T.Vector3(r,0,-60+s);s-=straight;
  const a=s/r;return new T.Vector3(Math.cos(a)*r,0,60+Math.sin(a)*r);
};
export function makeWorld(parent:T.Scene,physics:Vehicle) {
  const previousBodies=new Set(physics.world.bodies);
  const scene=new T.Group();parent.add(scene);
  const earth=material('#809575',.98),road=material('#50595a',.94),line=material('#e6e1ca'),curb=material('#d4d8ca'),wood=material('#6a6556'),leaves=material('#446e55'),glass=material('#6e8a8a',.24,.25),concrete=material('#c8c7b5');
  const ground=box(scene,1600,1,1600,0,-.52,0,earth);ground.receiveShadow=true;ground.castShadow=false;
  const n=360,positions:number[]=[],uv:number[]=[],indices:number[]=[];
  for(let i=0;i<=n;i++){
    const t=i/n,center=trackPoint(t),next=trackPoint(t+.00001),tan=next.sub(center).normalize(),normal=new T.Vector3(-tan.z,0,tan.x);
    for(const side of [-1,1]){const p=center.clone().addScaledVector(normal,side*10);positions.push(p.x,.016,p.z);uv.push(i/12,side>0?1:0);}
    if(i<n){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  const asphalt=new T.Mesh(geo,road);asphalt.receiveShadow=true;asphalt.material.side=T.DoubleSide;scene.add(asphalt);
  for(let i=0;i<180;i++){
    const p=trackPoint(i/180),next=trackPoint(i/180+.0001),angle=Math.atan2(next.x-p.x,next.z-p.z);
    const stripe=box(scene,.13,.012,1.5,p.x,.032,p.z,line);stripe.rotation.y=angle;stripe.castShadow=false;
    for(const side of [-1,1]){const q=p.clone().add(new T.Vector3(Math.cos(angle)*side*9.8,0,-Math.sin(angle)*side*9.8));const c=box(scene,.38,.12,3.15,q.x,.06,q.z,i%3===0?material('#6f8177'):curb);c.rotation.y=angle;c.castShadow=false;}
  }
  // Test markings and a physical low-speed suspension strip.
  for(let i=0;i<5;i++) {
    const z=-20-i*1.2;box(scene,7,.08,.45,-50,.04,z,material(i%2?'#e2c679':'#c9bb82'));physics.addBox(-50,.04,z,7,.08,.45);
  }
  for(let i=0;i<8;i++)box(scene,1,.015,1,-53.5+i,.035,53,i%2?line:road);
  for(let i=0;i<8;i++)box(scene,1,.015,1,-53.5+i,.035,54,i%2?road:line);
  // Depot, service canopy and guard rails. Every substantial building has collision.
  box(scene,27,7,18,7,3.5,4,concrete);physics.addBox(7,3.5,4,27,7,18);
  box(scene,28,.35,19,7,7.1,4,material('#344e47'));
  for(let i=0;i<4;i++){box(scene,5.3,4.8,.09,-2.7+i*6.3,2.4,13.05,glass);for(let y=0;y<6;y++)box(scene,5.3,.04,.1,-2.7+i*6.3,.5+y*.7,13.12,concrete);}
  const depotSign=new T.Mesh(new T.PlaneGeometry(18,1),new T.MeshBasicMaterial({map:textTexture('CITYBUS  /  PROVING GROUND','#e7eddb','#344e47',1024,80)}));depotSign.position.set(7,6.1,13.1);scene.add(depotSign);
  box(scene,20,.2,14,-4,3.9,32,material('#d7dacb'));for(const x of [-13,5])for(const z of [26,38])box(scene,.2,4,.2,x,2,z,steel());
  // Original low-poly landscaping; deterministic placement and instanced foliage.
  const trunks=new T.InstancedMesh(new T.CylinderGeometry(.16,.26,3,7),wood,130),canopies=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),leaves,130);
  const dummy=new T.Object3D();let seed=7631;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<130;i++) {
    const angle=rand()*Math.PI*2,r=95+rand()*140,x=Math.cos(angle)*r,z=Math.sin(angle)*r*1.4,h=3+rand()*5;
    dummy.position.set(x,1.5,z);dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.y=h;dummy.scale.set(h*.48,h*.65,h*.48);dummy.rotation.y=rand()*5;dummy.updateMatrix();canopies.setMatrixAt(i,dummy.matrix);
  }
  trunks.castShadow=true;canopies.castShadow=true;scene.add(trunks,canopies);
  for(let i=0;i<25;i++) {
    const x=(rand()-.5)*650,z=-240-rand()*100,h=12+rand()*44;
    box(scene,12+rand()*25,h,12+rand()*20,x,h/2,z,material(['#a7b4a9','#99aca7','#c1c3ad','#8e9f9a'][i%4]));
  }
  // Safety barriers around the outer oval, collidable rather than decorative.
  for(let i=0;i<48;i++){
    const p=trackPoint(i/48),p2=trackPoint(i/48+.0001),angle=Math.atan2(p2.x-p.x,p2.z-p.z);
    p.add(new T.Vector3(Math.cos(angle)*13,0,-Math.sin(angle)*13));
    const wall=box(scene,.3,.65,9,p.x,.65,p.z,curb);wall.rotation.y=angle;physics.addBox(p.x,.65,p.z,.3,.65,9,angle);
    for(const dz of [-3,3]){const post=box(scene,.12,1,.12,p.x+Math.sin(angle)*dz,.5,p.z+Math.cos(angle)*dz,steel());post.castShadow=false;}
  }
  for(const [x,z,label] of [[-62,31,'30'],[62,-20,'50'],[-62,-13,'20']] as [number,number,string][]){
    box(scene,.08,2.6,.08,x,1.3,z,steel());const s=new T.Mesh(new T.CircleGeometry(.5,32),new T.MeshBasicMaterial({map:textTexture(label,'#1e322d','#f3eedc',128,128),side:T.DoubleSide}));s.position.set(x,2.7,z);scene.add(s);
  }
  for(let i=0;i<14;i++){
    const p=trackPoint(i/14),p2=trackPoint(i/14+.0001),a=Math.atan2(p2.x-p.x,p2.z-p.z);p.add(new T.Vector3(Math.cos(a)*-12,0,-Math.sin(a)*-12));
    box(scene,.12,7,.12,p.x,3.5,p.z,steel());box(scene,1.5,.12,.4,p.x,7,p.z,concrete);
  }
  // Cones make the braking bay easy to identify without blocking the driving lane.
  for(let i=0;i<12;i++)for(const x of [-56,-44]){const cone=new T.Mesh(new T.ConeGeometry(.19,.65,12),material('#c77546'));cone.position.set(x,.325,43-i*4);cone.castShadow=true;scene.add(cone);box(scene,.43,.05,.43,x,.025,43-i*4,wood);}
  batchStatic(scene);
  return {road,earth,root:scene,bodies:physics.world.bodies.filter(b=>!previousBodies.has(b))};
}
function steel(){return material('#717e78',.5,.6);}
