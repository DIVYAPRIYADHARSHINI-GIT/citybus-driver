import * as T from 'three';
import {box,material,textTexture} from '../render/bus';
import {batchStatic} from '../render/batch';
import {specFor} from '../tycoon/engine';
import {PoseBuffer} from './interpolation';
import type {RemotePose} from './protocol';
interface Ghost {root:T.Group;detail:T.Group;simple:T.Mesh;label:T.Sprite;tail:T.MeshStandardMaterial;rear:T.Group|null;buffer:PoseBuffer;last:number}
export class RemoteBuses {
 root=new T.Group();ghosts=new Map<string,Ghost>();gates=new T.Group();selfId='';drawnDetail=0;
 constructor(public scene:T.Scene,public mobile:boolean){this.root.name='Multiplayer ghost buses · no physics bodies';scene.add(this.root,this.gates);}
 private create(p:RemotePose):Ghost {const spec=specFor(p.model_id)??specFor('cb-120')!,root=new T.Group(),detail=new T.Group(),paint=material(p.paint,.4,.2),white=material('#dde4d3',.4,.15),glass=material('#386566',.2,.3),dark=material('#1b2b27');root.add(detail);
  const len=spec.front_length_m,w=spec.width_m,h=spec.height_m;
  box(detail,w,.9,len,0,-.15,0,paint);box(detail,w,.13,len,0,h-1.2,0,white);
  for(const side of [-1,1]){box(detail,.05,h-1.7,len-.3,side*w/2,(h-1.7)/2+.35,0,glass);for(let z=-len/2+.3;z<len/2;z+=1.45)box(detail,.08,h-1.55,.07,side*w/2,(h-1.55)/2+.3,z,white);}
  for(const z of [-len/2,len/2]){box(detail,w-.12,h-1.7,.05,0,(h-1.7)/2+.35,z,glass);box(detail,w,.12,.13,0,-.55,z,dark);}
  if(spec.category==='double-decker')box(detail,w+.02,.18,len,0,1.35,0,paint);
  if(spec.energy==='electric')box(detail,w*.8,.2,3,0,h-1.02,1,material('#8ac6c0'));
  for(const side of [-1,1])for(const z of [-len*.325,len*.175]){const tire=new T.Mesh(new T.CylinderGeometry(spec.wheel_radius_m,spec.wheel_radius_m,.24,12),dark);tire.rotation.z=Math.PI/2;tire.position.set(side*(w/2-.08),-.61,z);detail.add(tire);}
  const tail=material('#902e2b');tail.emissive.set('#ff3b28');for(const side of [-1,1])box(detail,.16,.2,.05,side*(w/2-.2),-.1,len/2+.05,tail);
  batchStatic(detail);
  let rear:T.Group|null=null;if(spec.rear_length_m>0){rear=new T.Group();rear.position.z=len/2+.2;detail.add(rear);box(rear,w,.9,spec.rear_length_m,0,-.15,spec.rear_length_m/2+.2,paint);box(rear,w,.13,spec.rear_length_m,0,1.9,spec.rear_length_m/2+.2,white);for(const side of [-1,1])box(rear,.05,1.3,spec.rear_length_m,side*w/2,1.1,spec.rear_length_m/2+.2,glass);for(let i=0;i<7;i++)box(rear,w,2.3,.04,0,.6,i*.05,dark);batchStatic(rear);}
  const simple=new T.Mesh(new T.BoxGeometry(w,h-1,len),paint);simple.position.y=(h-1)/2-.6;simple.visible=false;root.add(simple);
  root.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshStandardMaterial){o.material.transparent=true;o.material.opacity=.65;o.material.depthWrite=false;}});
  const label=new T.Sprite(new T.SpriteMaterial({map:textTexture(p.name,'#eff4de','#214b3d',512,80),depthTest:false,transparent:true,sizeAttenuation:false}));label.position.set(0,h+.25,0);label.scale.set(.16,.025,1);root.add(label);root.userData.playerId=p.id;this.root.add(root);return {root,detail,simple,label,tail,rear,buffer:new PoseBuffer(),last:0};
 }
 push(elapsed:number,poses:RemotePose[],selfId:string){this.selfId=selfId;const present=new Set<string>();for(const p of poses){if(p.id===selfId)continue;present.add(p.id);let ghost=this.ghosts.get(p.id);if(!ghost){if(this.ghosts.size>=7)continue;ghost=this.create(p);this.ghosts.set(p.id,ghost);}ghost.buffer.push(elapsed,p);ghost.last=elapsed;}
  for(const [id,ghost] of this.ghosts)if(!present.has(id)){this.disposeRoot(ghost.root);this.ghosts.delete(id);}
 }
 frame(roomTime:number,camera:T.Camera){const sorted=[...this.ghosts.values()].sort((a,b)=>a.root.position.distanceToSquared(camera.position)-b.root.position.distanceToSquared(camera.position));this.drawnDetail=0;
  sorted.forEach((ghost,i)=>{const p=ghost.buffer.sample(roomTime-.1);if(!p)return;ghost.root.position.fromArray(p.p);ghost.root.quaternion.fromArray(p.q);const distance=ghost.root.position.distanceTo(camera.position),detailed=i<(this.mobile?1:3)&&distance<160;ghost.detail.visible=detailed;ghost.simple.visible=!detailed;ghost.root.visible=distance<450;ghost.label.visible=distance<150;(ghost.label.material as T.SpriteMaterial).opacity=p.connected?1:.45;ghost.tail.emissiveIntensity=p.keys.brake>0?3:.1;if(ghost.rear)ghost.rear.rotation.y=p.articulation??0;if(detailed&&ghost.root.visible)this.drawnDetail++;});
 }
 setGates(checkpoints:number[][]){this.clearGates();checkpoints.forEach(([x,z],i)=>{const g=new T.Group();g.position.set(x,3,z);const ring=new T.Mesh(new T.TorusGeometry(4,.12,6,36),new T.MeshBasicMaterial({color:i===0?'#d4ef91':'#8dc8dc',transparent:true,opacity:.75}));g.add(ring);const sign=new T.Sprite(new T.SpriteMaterial({map:textTexture(String(i+1),'#193b2a','#d9f0ac',128,128)}));sign.scale.set(1,1,1);sign.position.y=4.8;g.add(sign);this.gates.add(g);});}
 highlightGate(index:number){this.gates.children.forEach((g,i)=>g.visible=i>=index);}
 private disposeRoot(root:T.Object3D){root.removeFromParent();const geos=new Set<T.BufferGeometry>(),mats=new Set<T.Material>(),textures=new Set<T.Texture>();root.traverse(o=>{if(o instanceof T.Mesh){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}if(o instanceof T.Sprite)mats.add(o.material);});for(const m of mats){const map=(m as T.SpriteMaterial).map;if(map)textures.add(map);m.dispose();}geos.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());}
 clearGates(){for(const g of [...this.gates.children])this.disposeRoot(g);}
 clear(){for(const ghost of this.ghosts.values())this.disposeRoot(ghost.root);this.ghosts.clear();this.clearGates();}
}
