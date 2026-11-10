import {retainAssembly,assemblyTree} from './assembly.js';

// Read only product/occurrence metadata. Geometry and placements remain the
// CAD reader's responsibility. Some XDE imports flatten transformed groups.
function metadata(bytes){
  const source=new TextDecoder().decode(bytes),products=new Map(),formations=new Map(),definitions=new Map(),edges=[];
  const pattern=/#(\d+)\s*=\s*(PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE|PRODUCT_DEFINITION_FORMATION|PRODUCT_DEFINITION|PRODUCT|NEXT_ASSEMBLY_USAGE_OCCURRENCE)\s*\(/g;
  let match,count=0;
  const decode=s=>s.replace(/\\X2\\([0-9a-f]+)\\X0\\/gi,(_,hex)=>hex.length%4?'':hex.match(/.{4}/g).map(h=>String.fromCharCode(parseInt(h,16))).join('')).replace(/\\X4\\([0-9a-f]+)\\X0\\/gi,(_,hex)=>hex.length%8?'':hex.match(/.{8}/g).map(h=>{const c=parseInt(h,16);return c<=0x10ffff?String.fromCodePoint(c):'�';}).join('')).replace(/\\\\/g,'\\');
  while((match=pattern.exec(source))&&++count<=100000){
    let i=pattern.lastIndex,start=i,depth=0,quoted=false,args=[];
    for(;i<source.length&&i-start<16384;i++){
      const c=source[i];
      if(c==="'"){if(quoted&&source[i+1]==="'"){i++;continue;}quoted=!quoted;continue;}
      if(quoted)continue;
      if(c==='(')depth++;
      if(c===')'){if(!depth){args.push(source.slice(start,i).trim());break;}depth--;}
      if(c===','&&!depth){args.push(source.slice(start,i).trim());start=i+1;}
    }
    if(quoted||source[i]!==')')continue;pattern.lastIndex=i+1;
    const id='#'+match[1],ref=v=>/^#\d+$/.test(v||'')?v:null;
    const str=v=>v?.startsWith("'")&&v.endsWith("'")?decode(v.slice(1,-1).replace(/''/g,"'")):'';
    if(match[2]==='PRODUCT')products.set(id,str(args[1])||str(args[0]));
    else if(match[2].startsWith('PRODUCT_DEFINITION_FORMATION'))formations.set(id,ref(args[2]));
    else if(match[2]==='PRODUCT_DEFINITION')definitions.set(id,ref(args[2]));
    else if(ref(args[3])&&ref(args[4]))edges.push({id,parent:args[3],child:args[4]});
  }
  if(count>100000)return null;
  const names=new Map([...definitions].map(([id,f])=>[id,products.get(formations.get(f))]));
  const children=new Map(),incoming=new Set(),leaves=new Map(),groups=new Map();
  for(const edge of edges){if(!names.has(edge.parent)||!names.has(edge.child))continue;if(!children.has(edge.parent))children.set(edge.parent,[]);children.get(edge.parent).push(edge);incoming.add(edge.child);}
  let visited=0;
  function visit(id,path,key,ancestors){
    if(path.length>=40||++visited>50000||ancestors.has(id))throw new Error('Assembly metadata limit');
    const name=names.get(id);if(!name||name.length>1024)return;
    if(!children.has(id)){if(!leaves.has(name))leaves.set(name,[]);leaves.get(name).push(path);return;}
    const next=[...path,{key,name}],signature=JSON.stringify(next.map(n=>n.name));
    if(!groups.has(signature))groups.set(signature,[]);groups.get(signature).push(next);
    const seen=new Set(ancestors);seen.add(id);for(const child of children.get(id))visit(child.child,next,child.id,seen);
  }
  for(const id of names.keys())if(!incoming.has(id))visit(id,[],id,new Set());
  return {leaves,groups};
}
export function restoreStepAssembly(data,bytes){
  retainAssembly(data);let info;
  try{info=metadata(bytes);}catch{return data;}
  if(!info)return data;
  for(const mesh of data.meshes){
    const candidates=info.leaves.get(mesh.name)||[],byPath=new Map(candidates.map(p=>[JSON.stringify(p),p]));
    if(byPath.size===1){mesh.assemblyPath=[...byPath.values()][0];continue;}
    // Repeated names are resolved only when their existing imported ancestry
    // identifies one occurrence. Never guess using enumeration order.
    const signature=JSON.stringify(mesh.assemblyPath.map(n=>n.name));
    const matching=candidates.filter(p=>JSON.stringify(p.map(n=>n.name))===signature);
    const known=info.groups.get(signature)||[];
    if(matching.length===1)mesh.assemblyPath=matching[0];
    else if(known.length===1)mesh.assemblyPath=known[0];
  }
  data.root=assemblyTree(data.meshes);return data;
}
