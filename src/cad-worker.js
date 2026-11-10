import initOC from './vendor/replicad_single.js';
import { createCadEngine } from './cad-engine.js';
import {restoreSourceCad} from './step-source.js';
import {facetedStep} from './step-stream.js';
let engine;
self.onmessage=async({data})=>{
  try {
    if(!engine){self.postMessage({id:data.id,type:'progress',text:'정밀 CAD 엔진을 준비하고 있습니다…'});engine=createCadEngine(await initOC({locateFile:name=>new URL(`./vendor/${name}`,import.meta.url).href}));}
    if(data.action==='source-doc'){
      self.postMessage({id:data.id,type:'progress',text:'STEP 원본의 정밀 형상을 읽고 있습니다…'});
      const original=await engine.importStep(data.args.bytes),source=data.args.descriptor.source;
      // Recovery import and this reader enumerate the same complete set of
      // solids/shells/faces. Use that verified order; no tessellation or costly
      // spline-extrema calculation is needed to export a subset of those parts.
      const recoveredOrder=source.length===original.length&&source.every((p,i)=>p.cadIndex===i);
      self.postMessage({id:data.id,type:'progress',text:'부품 편집을 STEP 원본에 적용하고 있습니다…'});
      const {doc}=restoreSourceCad({doc:original,recoveredOrder,...(recoveredOrder?{}:{preview:engine.boundsPreview(original)})},data.args.descriptor,engine,false);
      self.postMessage({id:data.id,type:'source-doc',doc});return;
    }
    if(data.action==='export'){const bytes=await engine.exportStep(data.doc,text=>self.postMessage({id:data.id,type:'progress',text}));self.postMessage({id:data.id,type:'export',bytes},[bytes.buffer]);return;}
    const doc=data.action==='preview'?data.doc:data.action==='import'?await engine.importStep(data.bytes):data.action==='mesh-import'?await engine.importStep(new TextEncoder().encode(facetedStep(data.args.meshes))):engine.operate(data.doc||[],data.action,data.args||{});
    const preview=engine.preview(doc);
    const transfers=[...new Set(preview.meshes.flatMap(m=>[m.positions.buffer,m.normals.buffer,m.indices.buffer]))];
    self.postMessage({id:data.id,type:'success',doc,preview},transfers);
  }catch(error){self.postMessage({id:data.id,type:'error',message:typeof error?.message==='string'?error.message:'CAD 연산이 실패했습니다. 이전 모델은 유지됩니다.'});}
};
