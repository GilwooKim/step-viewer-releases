import {assemblyTree,assemblyPath} from './assembly.js';
export function meshBounds(mesh,center){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<mesh.positions.length;i++){const a=i%3,v=mesh.positions[i]+center[a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}return {min,max};}
export function retainStepSource(data){
 if(data.stepSource)return data;
 const parts=data.meshes.map(m=>({id:m.id,...meshBounds(m,data.center),cadIndex:data.recovered?m.id:null}));
 return {...data,stepSource:{pristine:true,parts},meshes:data.meshes.map(m=>({...m,stepOrigin:{id:m.id,transforms:[]}}))};
}
export function sourceDescriptor(data,ids=null){
 const selected=data.meshes.filter(m=>!ids||ids.includes(m.id));
 if(!data.stepSource||selected.some(m=>!m.stepOrigin||m.primitive==='lines'))return null;
 return {source:data.stepSource.parts,parts:selected.map(m=>({id:m.id,name:m.name,color:m.color,assemblyPath:assemblyPath(m.assemblyPath),origin:m.stepOrigin}))};
}
// Match against the original, unedited occurrence bounds. Never match against
// moved geometry or resurrect parts that the user removed in mesh mode.
export function restoreSourceCad(result,descriptor,engine,withPreview=true){
 const {source,parts}=descriptor;if(!Array.isArray(source)||!Array.isArray(parts)||!parts.length||source.length>10000||parts.length>10000)throw new Error('STEP 원본 연결 정보가 잘못되었습니다.');
 const knownOrder=result.recoveredOrder&&source.length===result.doc.length&&source.every((p,i)=>p.cadIndex===i);
 const candidates=knownOrder?source.map((part,i)=>({...part,i,mesh:{},used:false})):result.preview.meshes.map((mesh,i)=>({mesh,i,...meshBounds(mesh,result.preview.center),used:false})),matches=new Map();
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 for(const original of source){
  if(!Number.isInteger(original.id)||![original.min,original.max].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw new Error('STEP 원본 연결 정보가 잘못되었습니다.');
  const size=Math.max(distance(original.min,original.max),.01),score=c=>(distance(c.min,original.min)+distance(c.max,original.max))/size;
  const indexed=Number.isInteger(original.cadIndex)?candidates[original.cadIndex]:null;
  let best=indexed&&!indexed.used&&score(indexed)<.05?indexed:null;
  if(!best){const sorted=candidates.filter(c=>!c.used).map(c=>({c,score:score(c)})).sort((a,b)=>a.score-b.score);if(sorted[0]?.score<.05&&(!sorted[1]||sorted[1].score-sorted[0].score>1e-6))best=sorted[0].c;}
  if(best){best.used=true;matches.set(original.id,best);}
 }
 const doc=[],meshes=[];let transformed=false;
 for(const [i,part]of parts.entries()){
  const match=matches.get(part.origin?.id);if(!match)throw new Error('일부 부품을 STEP 원본과 정확히 대응할 수 없습니다. 메시 STEP으로 저장하거나 원본을 다시 열어 정밀 CAD 모드에서 편집해 주세요.');
  let entry={...result.doc[match.i],key:`${result.doc[match.i].key}-${i}`,name:part.name,color:part.color||[.48,.7,.75],assemblyPath:assemblyPath(part.assemblyPath)};
  if(!Array.isArray(part.origin.transforms)||part.origin.transforms.length>10000)throw new Error('STEP 원본 변환 정보가 잘못되었습니다.');
  for(const transform of part.origin.transforms){
   if(!transform||!Array.isArray(transform.pivot)||transform.pivot.length!==3||!transform.pivot.every(Number.isFinite)||!['x','y','z','rx','ry','rz','scale'].every(k=>Number.isFinite(transform[k]))||transform.scale<=0)throw new Error('STEP 원본 변환 정보가 잘못되었습니다.');
   entry=engine.operate([entry],'transform',{...transform,key:entry.key})[0];transformed=true;
  }
  doc.push(entry);meshes.push({...match.mesh,id:i,key:entry.key,name:entry.name,color:entry.color,assemblyPath:entry.assemblyPath});
 }
 if(!withPreview)return {doc};
 if(transformed)return {doc,preview:engine.preview(doc)};
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
 for(const m of meshes){const b=meshBounds(m,result.preview.center);for(let a=0;a<3;a++){min[a]=Math.min(min[a],b.min[a]);max[a]=Math.max(max[a],b.max[a]);}triangles+=m.indices.length/3;}
 return {doc,preview:{...result.preview,meshes,min,max,triangles,root:assemblyTree(meshes)}};
}
