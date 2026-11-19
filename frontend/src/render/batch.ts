import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Batch immutable sibling meshes only. Moving parts, interactive controls, maps and
 * transparent glazing retain their own draw order and transforms. */
export function batchStatic(root:T.Object3D,excluded:ReadonlySet<T.Object3D>=new Set()){
  const batches=new Map<string,T.Mesh[]>();
  for(const child of [...root.children]){
    if(!(child instanceof T.Mesh)||child instanceof T.InstancedMesh||excluded.has(child)||!(child.material instanceof T.MeshStandardMaterial))continue;
    const m=child.material;if(m.map||m.transparent||!child.visible||m.emissive.getHex()!==0)continue;
    const key=[m.color.getHex(),m.roughness,m.metalness,m.emissive.getHex(),m.emissiveIntensity,m.side,child.castShadow,child.receiveShadow].join(':');
    const list=batches.get(key)??[];list.push(child);batches.set(key,list);
  }
  for(const meshes of batches.values()){
    if(meshes.length<2)continue;
    const geos=meshes.map(m=>{m.updateMatrix();const geometry=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();return geometry.applyMatrix4(m.matrix);});
    const merged=mergeGeometries(geos);geos.forEach(g=>g.dispose());if(!merged)continue;
    const mesh=new T.Mesh(merged,meshes[0].material);mesh.castShadow=meshes[0].castShadow;mesh.receiveShadow=meshes[0].receiveShadow;
    meshes.forEach(m=>{root.remove(m);m.geometry.dispose();});root.add(mesh);
  }
}
