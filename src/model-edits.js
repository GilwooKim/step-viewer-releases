import {assemblyTree} from './assembly.js';

// Removing parts changes membership only. Preserve remaining BReps and mesh
// buffers instead of retessellating the entire assembly in OpenCascade.
export function removeParts(data,doc,ids){
  const selected=new Set(ids),removed=data.meshes.filter(mesh=>selected.has(mesh.id));
  if(!removed.length)throw new Error('먼저 부품을 선택해 주세요.');
  let nextDoc=doc;
  if(doc){
    const keys=new Set(removed.map(mesh=>mesh.key));
    if(keys.has(undefined)||removed.some(mesh=>!doc.some(item=>item.key===mesh.key)))throw new Error('선택한 부품의 CAD 형상을 찾을 수 없습니다.');
    nextDoc=doc.filter(item=>!keys.has(item.key));
  }
  const meshes=data.meshes.filter(mesh=>!selected.has(mesh.id)),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
  for(const mesh of meshes){
    for(let i=0;i<mesh.positions.length;i++){const a=i%3,value=mesh.positions[i]+data.center[a];min[a]=Math.min(min[a],value);max[a]=Math.max(max[a],value);}
    if(mesh.primitive!=='lines')triangles+=mesh.indices.length/3;
  }
  return {count:removed.length,doc:nextDoc,data:{...data,meshes,triangles,root:assemblyTree(meshes),
    min:meshes.length?min:[0,0,0],max:meshes.length?max:[0,0,0],center:meshes.length?data.center:[0,0,0]}};
}
