// Paths identify assembly occurrences, not names: two identically named
// subassemblies must never be folded into one branch.
export function assemblyPath(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>40)throw new Error('조립 트리의 깊이가 잘못되었습니다.');
  return value.map(node=>{
    if(!node||typeof node.key!=='string'||!node.key||node.key.length>512||typeof node.name!=='string'||node.name.length>1024)throw new Error('조립 트리 정보가 잘못되었습니다.');
    return {key:node.key,name:node.name};
  });
}
export function assemblyTree(meshes, name='Assembly') {
  const root={name,meshes:[],children:[]},branches=new Map();
  for(const mesh of meshes){
    let node=root;const keys=[];
    for(const item of assemblyPath(mesh.assemblyPath)){
      keys.push(item.key);const key=JSON.stringify(keys);
      if(!branches.has(key)){const child={key:item.key,name:item.name,meshes:[],children:[]};branches.set(key,child);node.children.push(child);}
      node=branches.get(key);
    }
    node.meshes.push(mesh.id);
  }
  return !root.meshes.length&&root.children.length===1?root.children[0]:root;
}
export function retainAssembly(data) {
  if(data.meshes.some(mesh=>mesh.assemblyPath!==undefined)){
    data.meshes.forEach(mesh=>{mesh.assemblyPath=assemblyPath(mesh.assemblyPath);});
  }else{
    const byId=new Map(data.meshes.map(mesh=>[mesh.id,mesh])),assigned=new Set();let visited=0;
    function visit(node,path,index,depth){
      if(!node||depth>40||++visited>20000)throw new Error('조립 트리가 너무 큽니다.');
      // An importer's leaf label already names the part, not another assembly.
      const ids=node.meshes||[],children=node.children||[],leaf=ids.length===1&&!children.length&&node.name===byId.get(ids[0])?.name;
      const next=node.name&&!leaf?[...path,{key:index,name:node.name}]:path;
      for(const id of ids){const mesh=byId.get(id);if(mesh&&!assigned.has(id)){mesh.assemblyPath=assemblyPath(next);assigned.add(id);}}
      children.forEach((child,i)=>visit(child,next,`${index}.${i}`,depth+1));
    }
    visit(data.root||{meshes:data.meshes.map(mesh=>mesh.id)},[],'root',0);
    for(const mesh of data.meshes)if(!assigned.has(mesh.id))mesh.assemblyPath=[];
  }
  data.root=assemblyTree(data.meshes);return data;
}
export function assemblyDepth(meshes) {
  const paths=meshes.map(mesh=>assemblyPath(mesh.assemblyPath));
  const sharedRoot=paths.length&&paths.every(path=>path[0]?.key===paths[0][0]?.key)&&paths[0].length?1:0;
  return {skip:sharedRoot,depth:Math.max(0,...paths.map(path=>path.length-sharedRoot))};
}
export function assemblyUnit(mesh,level,skip=0){
  const path=assemblyPath(mesh.assemblyPath),length=Math.min(path.length,level+skip);
  return level>0&&length>skip?'assembly:'+JSON.stringify(path.slice(0,length).map(node=>node.key)):'part:'+mesh.id;
}
