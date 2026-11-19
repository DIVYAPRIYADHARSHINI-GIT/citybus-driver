import * as T from 'three';
import {createBus,box,material,textTexture,type BusModel} from './bus';
import type {Spec} from '../tycoon/engine';
import {batchStatic} from './batch';
export function createFleetBus(spec:Spec,upgrades:Record<string,number>={}):BusModel {
 const model=createBus(Math.min(6,Math.ceil(spec.capacity/4))),g=model.group;g.name=spec.name;g.scale.set(spec.width_m/2.5,spec.category==='double-decker'?.9:spec.height_m/3.3,spec.front_length_m/12);
 if(spec.category==='double-decker'){
  const upper=new T.Group();upper.position.y=1.95;g.add(upper);const shell=material('#d7e1cc'),glass=material('#416a70',.15,.25);box(upper,2.48,.12,11.8,0,1.45,0,shell);for(const side of [-1,1]){box(upper,.07,.18,11.8,side*1.23,.1,0,model.paint);for(let j=0;j<8;j++){box(upper,.045,1.1,1.32,side*1.24,.77,-5.2+j*1.48,glass);box(upper,.08,1.35,.08,side*1.24,.7,-5.9+j*1.48,shell);}}box(upper,2.3,1.2,.06,0,.75,-5.9,glass);box(upper,2.3,1.2,.06,0,.75,5.9,glass);for(let row=0;row<6;row++)for(const x of [-.7,.7])box(upper,.7,.55,.15,x,.55,-3.3+row*1.35,material('#667b54'));batchStatic(upper);
 }
 if(spec.category==='coach'){for(const side of [-1,1])for(let j=0;j<4;j++){const hatch=box(g,.025,.55,1.55,side*1.29,-.25,-1.8+j*1.7,material('#879c8e',.3,.6));box(g,.025,.04,.25,side*1.31,-.05,hatch.position.z,material('#172c27'));}}
 if(spec.energy==='electric'){box(g,2.15,.28,4.6,0,2.25,.9,material('#83c8bd',.3,.35));const badge=new T.Mesh(new T.PlaneGeometry(1,.35),new T.MeshBasicMaterial({map:textTexture('ELECTRIC','#c3f29b','#163e37')}));badge.position.set(0,.55,-6.07);badge.rotation.y=Math.PI;g.add(badge);}
 if((upgrades.engine??0)>0)for(const side of [-1,1])box(g,.025,.12,4.8,side*1.29,.1,0,material('#d6bd72',.3,.6));
 if((upgrades.tires??0)>0)model.wheels.forEach(w=>{const ring=new T.Mesh(new T.TorusGeometry(.32,.022,8,28),material('#b6d98b',.25,.6));ring.rotation.y=Math.PI/2;ring.position.x=.16;w.add(ring);});
 if((upgrades.interior??0)>0)for(const x of [-.6,.6]){const mat=material('#d7e9c3');mat.emissive.set('#cdebb6');mat.emissiveIntensity=.6;box(g,.04,.03,9,x,1.79,0,mat);}
 if((upgrades.seats??0)>0)g.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshStandardMaterial&&o.material.color.getHex()===0x426d67)o.material.color.set('#7187a1');});
 if((upgrades.brakes??0)>0)model.wheels.forEach(w=>{const rotor=new T.Mesh(new T.TorusGeometry(.22,.025,8,24),material('#d4a66a',.2,.7));rotor.rotation.y=Math.PI/2;rotor.position.x=-.16;w.add(rotor);});
 if((upgrades.suspension??0)>0)for(const side of [-1,1])box(g,.04,.1,4.8,side*1.29,-.55,0,material('#8dbad1',.3,.5));
 model.paint.roughness=Math.max(.15,.35-(upgrades.paint??0)*.05);
 model.wheels.forEach(w=>w.scale.setScalar(spec.wheel_radius_m/.5));
 // Shared working controls retain their ray-pick targets. Cabin trim, proportions,
 // seat count and an individually named instrument plaque identify each profile.
 if(spec.id!=='cb-120'){
  g.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshStandardMaterial&&o.material.color.getHex()===0x426d67)o.material.color.set(spec.cockpit_trim);});
  const plaque=new T.Mesh(new T.PlaneGeometry(.7,.13),new T.MeshBasicMaterial({map:textTexture(`${spec.name} / ${spec.energy==='electric'?'EV':'DIESEL'}`,'#f5ead1',spec.cockpit_trim,512,100)}));plaque.position.set(.38,.12,-4.85);g.add(plaque);
 }
 return model;
}
export function createTrailer(spec:Spec,paint:T.Material){const root=new T.Group(),body=material('#dce4d2'),glass=material('#517a77',.2,.2),dark=material('#24382f');box(root,2.48,.8,spec.rear_length_m,0,-.25,0,paint);box(root,2.48,.15,spec.rear_length_m,0,1.92,0,body);for(const side of [-1,1])for(let j=0;j<4;j++){box(root,.04,1.25,1.5,side*1.25,1.05,-2.55+j*1.7,glass);box(root,.1,1.6,.08,side*1.25,1.05,-3.3+j*1.7,body);}box(root,2.4,1.7,.08,0,1, spec.rear_length_m/2,glass);for(let row=0;row<4;row++)for(const x of [-.7,.7]){box(root,.75,.17,.6,x,-.03,-2.5+row*1.4,dark);box(root,.75,.6,.12,x,.3,-2.2+row*1.4,dark);}for(let i=0;i<8;i++)box(root,2.4,.0+2.4,.07,0,.62,-spec.rear_length_m/2-.05-i*.055,i%2?dark:material('#647569'));batchStatic(root);return root;}
export function disposeBus(model:BusModel){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();for(const root of [model.group,...model.wheels])root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials){const texture=(m as T.MeshStandardMaterial).map;if(texture)textures.add(texture);m.dispose();}for(const g of geometries)g.dispose();for(const t of textures)t.dispose();model.mirrorTargets.forEach(t=>t.dispose());}
// Trailer wheels share their resources with the front wheels. Dispose only the
// trailer's unique resources here; disposeBus owns the shared paint and wheels.
export function disposeTrailer(root:T.Group,sharedPaint:T.Material){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m!==sharedPaint)materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>{(m as T.MeshStandardMaterial).map?.dispose();m.dispose();});}
