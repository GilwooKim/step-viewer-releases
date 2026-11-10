import * as R from 'replicad';
import {assemblyPath,assemblyTree} from './assembly.js';
import {exportCadAssembly} from './cad-assembly-export.js';
export function createCadEngine(oc) {
  R.setOC(oc);
  let keyCounter = 0;
  const shapeKey = () => `cad-${Date.now()}-${++keyCounter}`;
  const dispose = (shape) => { try { shape?.delete(); } catch {} };
  function valid(shape) {
    if (!shape || shape.isNull) throw new Error('연산 결과가 비어 있습니다. 치수와 부품 위치를 확인해 주세요.');
    const checker = new oc.BRepCheck_Analyzer(shape.wrapped, true);
    try { if (!checker.IsValid()) throw new Error('유효하지 않은 형상입니다. 이전 상태를 유지합니다. 치수나 연산 대상을 바꿔 주세요.'); }
    finally { checker.delete(); }
  }
  function serialize(shape, metadata = {}) {
    return { key: metadata.key || shapeKey(), name: metadata.name || 'CAD 부품', color: metadata.color || [0.48,0.7,0.72], assemblyPath:assemblyPath(metadata.assemblyPath), brep: shape.serialize(), kind: shape instanceof R.Solid ? 'solid' : shape instanceof R.Face || shape instanceof R.Shell ? 'surface' : 'compound' };
  }
  function preview(doc) {
    const meshes = []; const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]; let triangles = 0;
    for (const item of doc) {
      const shape = R.deserializeShape(item.brep);
      try {
        const mesh = shape.mesh({ tolerance: 0.08, angularTolerance: 0.18 });
        const faces = shape.faces; const faceMap = new Map(faces.map((face,i) => [face.hashCode, i]));
        const surfaceTypes = faces.map(face => face.geomType);
        const groups = mesh.faceGroups.map((group) => ({ first: group.start / 3, last: (group.start + group.count) / 3 - 1, faceIndex: faceMap.get(group.faceId), color: null }));
        faces.forEach(dispose);
        triangles += mesh.triangles.length / 3;
        if (triangles > 5000000) throw new Error('형상이 너무 복잡합니다. 500만 삼각형 이하의 모델을 사용해 주세요.');
        const positions = new Float64Array(mesh.vertices);
        for (let i=0; i<positions.length; i++) { const axis=i%3; if(!Number.isFinite(positions[i])) throw new Error('유효하지 않은 좌표입니다.'); min[axis]=Math.min(min[axis],positions[i]); max[axis]=Math.max(max[axis],positions[i]); }
        meshes.push({ id: meshes.length, key: item.key, kind: item.kind, name: item.name, color: item.color, assemblyPath:assemblyPath(item.assemblyPath), positions, normals:new Float32Array(mesh.normals), indices:new Uint32Array(mesh.triangles), faces:groups, surfaceTypes });
      } finally { dispose(shape); }
    }
    if (!meshes.length) return { meshes:[], min:[0,0,0],max:[0,0,0],center:[0,0,0],triangles:0,root:{name:'CAD',meshes:[],children:[]} };
    if (!triangles) throw new Error('표시할 수 있는 솔리드 또는 서페이스가 없습니다.');
    const center=min.map((n,i)=>(n+max[i])/2);
    for (const mesh of meshes) mesh.positions=Float32Array.from(mesh.positions,(n,i)=>n-center[i%3]);
    return { meshes,min,max,center,triangles,root:assemblyTree(meshes) };
  }
  async function importStep(bytes) {
    oc.FS.writeFile('/input.step', new Uint8Array(bytes));
    const reader = new oc.STEPControl_Reader(); let whole;
    try {
      const status = reader.ReadFile('/input.step');
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP 파일을 읽을 수 없습니다.');
      reader.SetSystemLengthUnit(1);reader.TransferRoots(); whole=R.cast(reader.OneShape());
      if (whole.isNull) throw new Error('STEP 파일에 형상이 없습니다.');
      const pieces=[];
      function collect(type,avoid) {
        const explorer=new oc.TopExp_Explorer(whole.wrapped,type,avoid);
        try { while(explorer.More()) { const raw=explorer.Current(); const shape=R.cast(raw); pieces.push(shape); explorer.Next(); } } finally { explorer.delete(); }
      }
      collect(oc.TopAbs_ShapeEnum.TopAbs_SOLID,oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      collect(oc.TopAbs_ShapeEnum.TopAbs_SHELL,oc.TopAbs_ShapeEnum.TopAbs_SOLID);
      collect(oc.TopAbs_ShapeEnum.TopAbs_FACE,oc.TopAbs_ShapeEnum.TopAbs_SHELL);
      if (!pieces.length) throw new Error('CAD 편집에는 솔리드나 서페이스가 필요합니다.');
      try { return pieces.map((shape,i) => serialize(shape,{name:`${shape instanceof R.Solid ? '솔리드' : '서페이스'} ${i+1}`})); }
      finally { pieces.forEach(dispose); }
    } finally { dispose(whole); reader.delete(); oc.FS.unlink('/input.step'); }
  }
  function operate(doc, action, args) {
    const result = doc.map(item=>({...item}));
    const index = result.findIndex(item=>item.key===args.key); const entry=result[index];
    let shape, tool, out, face, vector; const others=[];
    const v = (name, fallback=0) => { const n=Number(args[name] ?? fallback); if(!Number.isFinite(n)||Math.abs(n)>1e8) throw new Error('유효한 수치를 입력해 주세요.'); return n; };
    const positive=(name,fallback)=>{const n=v(name,fallback);if(n<=0)throw new Error('치수는 0보다 커야 합니다.');return n;};
    try {
      if (action.startsWith('add')) {
        const x=v('x'),y=v('y'),z=v('z');
        if(action==='addBox') out=R.makeBox([x,y,z],[x+positive('width',20),y+positive('depth',20),z+positive('height',20)]);
        if(action==='addCylinder') out=R.makeCylinder(positive('radius',10),positive('height',20),[x,y,z]);
        if(action==='addSphere') out=R.makeSphere(positive('radius',10)).translate(x,y,z);
        if(action==='addPlane') {const w=positive('width',20),d=positive('depth',20);out=R.makePolygon([[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z]]);}
        valid(out);result.push(serialize(out,{name:args.name||({addBox:'박스',addCylinder:'원기둥',addSphere:'구',addPlane:'평면 서페이스'})[action]}));return result;
      }
      if(!entry)throw new Error('편집할 부품을 선택해 주세요.');
      if(action==='delete'){result.splice(index,1);return result;}
      shape=R.deserializeShape(entry.brep);
      if(action==='transform'||action==='duplicate') {
        out=shape.clone();const center=args.pivot||[0,0,0];const scale=positive('scale',1);
        out=out.scale(scale,center);
        for(const [name,axis]of[['rx',[1,0,0]],['ry',[0,1,0]],['rz',[0,0,1]]]){const angle=v(name);if(angle)out=out.rotate(angle,center,axis);}
        out=out.translate(v('x'),v('y'),v('z'));
      } else if(action==='fillet') out=shape.asShape3D().fillet(positive('radius',1));
      else if(action==='chamfer') out=shape.asShape3D().chamfer(positive('radius',1));
      else if(['fuse','cut','intersect'].includes(action)) {
        const toolEntry=result.find(item=>item.key===args.toolKey);if(!toolEntry||toolEntry.key===entry.key)throw new Error('다른 도구 부품을 선택해 주세요.');
        if(entry.kind!=='solid'||toolEntry.kind!=='solid')throw new Error('불리언 연산은 유효한 솔리드끼리 지원합니다.');
        tool=R.deserializeShape(toolEntry.brep);out=shape.asShape3D()[action](tool.asShape3D());
      } else if(['extractFace','extrudeFace','thickenFace'].includes(action)) {
        const faces=shape.faces;others.push(...faces);face=faces[args.faceIndex];
        if(!face)throw new Error('먼저 화면에서 편집할 면을 선택해 주세요.');
        if(action==='extractFace') out=face.clone();
        else if(action==='thickenFace') {
          const maker=new oc.BRepOffsetAPI_MakeThickSolid();
          try { maker.MakeThickSolidBySimple(face.wrapped,positive('distance',2));out=R.cast(maker.Shape()); }
          finally {maker.delete();}
          if(!(out instanceof R.Solid))throw new Error('이 면에서 솔리드 두께를 만들 수 없습니다.');
        }
        else {
          if(face.geomType!=='PLANE')throw new Error('면 돌출은 평면에만 지원합니다. 곡면은 면 추출 또는 두께 주기를 사용해 주세요.');
          const distance=v('distance',5);if(!distance)throw new Error('돌출 거리는 0이 될 수 없습니다.');
          vector=face.normalAt().multiply(distance);tool=R.basicFaceExtrusion(face,vector);
          out=entry.kind==='solid' ? (distance>0?shape.asShape3D().fuse(tool):shape.asShape3D().cut(tool)) : tool.clone();
        }
      } else throw new Error('지원하지 않는 편집입니다.');
      valid(out);
      if(action==='duplicate'||action==='extractFace'||action==='thickenFace') result.push(serialize(out,{...entry,key:shapeKey(),name:`${entry.name} ${action==='duplicate'?'복제':action==='extractFace'?'면':'두께'}`}));
      else result[index]=serialize(out,entry);
      if(['fuse','cut','intersect'].includes(action)&&args.removeTool) return result.filter(item=>item.key!==args.toolKey);
      return result;
    } catch(error) { if(typeof error==='number')throw new Error('CAD 연산을 완료하지 못했습니다. 형상과 치수를 바꿔 주세요.');throw error; }
    finally {others.forEach(dispose);dispose(vector);dispose(out);dispose(tool);dispose(shape);}
  }
  async function exportStep(doc,progress) {
    if(!doc.length)throw new Error('저장할 형상이 없습니다.');
    return exportCadAssembly(oc,doc,progress);
  }
  function boundsPreview(doc){
    const meshes=doc.map((item,id)=>{const shape=R.deserializeShape(item.brep);let box;try{box=shape.boundingBox;const [min,max]=box.bounds;return {id,key:item.key,positions:Float64Array.from([...min,...max]),indices:new Uint32Array(),normals:new Float32Array()};}finally{dispose(box);dispose(shape);}});
    return {meshes,center:[0,0,0]};
  }
  return {importStep,operate,preview,boundsPreview,exportStep};
}
