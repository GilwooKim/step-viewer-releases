import * as T from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { NURBSCurve } from 'three/addons/curves/NURBSCurve.js';
import DxfParser from 'dxf-parser';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { extension } from './formats.js';
import { facetedStep } from './step-stream.js';
import {assemblyTree} from './assembly.js';
import dxfTemplate from './dxf-template.json';

const decode=b=>new TextDecoder().decode(b);
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const mmUnits={1:25.4,2:304.8,3:1609344,4:1,5:10,6:1000,7:1000000,8:0.0000254,9:0.0254,10:914.4,11:.0000001,12:.000001,13:.001,14:100,15:10000,16:100000,17:1e12,21:1200000/3937};
const toPoint=p=>new T.Vector3(p?.x||0,p?.y||0,p?.z||0);
const neutral=[0.48,0.70,0.75];

export function normalizeMeshes(meshes, warnings=[]) {
  if(meshes.length>10000)throw new Error('부품은 10,000개까지 지원합니다.');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
  meshes=meshes.filter(m=>m.positions?.length && m.indices?.length);
  for(const m of meshes){
    if(m.positions.length%3||m.indices.length%(m.primitive==='lines'?2:3))throw new Error('유효하지 않은 메시 데이터입니다.');
    for(const i of m.indices)if(!Number.isInteger(i)||i<0||i>=m.positions.length/3)throw new Error('메시 인덱스가 잘못되었습니다.');
    for(let i=0;i<m.positions.length;i++){const v=m.positions[i];if(!Number.isFinite(v)||Math.abs(v)>1e12)throw new Error('유효하지 않은 형상 좌표입니다.');min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);}
    if(m.primitive!=='lines')triangles+=m.indices.length/3;
  }
  if(!meshes.length)throw new Error('지원되는 표면 또는 선을 찾을 수 없습니다.');
  if(triangles>5000000)throw new Error('500만 삼각형 이하의 모델을 사용해 주세요.');
  const center=min.map((v,i)=>(v+max[i])/2);
  meshes=meshes.map((m,id)=>({...m,id,name:m.name||`부품 ${id+1}`,positions:Float32Array.from(m.positions,(v,i)=>v-center[i%3]),indices:new Uint32Array(m.indices),normals:m.normals?new Float32Array(m.normals):null,faces:m.faces||[],color:m.color||neutral}));
  return {meshes,min,max,center,triangles,root:assemblyTree(meshes),warnings};
}
export function absoluteMeshes(data,ids=null){return data.meshes.filter(m=>!ids||ids.includes(m.id)).map(m=>({...m,positions:Float64Array.from(m.positions,(v,i)=>v+data.center[i%3]),indices:new Uint32Array(m.indices)}));}
export function objectMeshes(root,scale=1,yUp=false){
  const meshes=[];root.updateMatrixWorld(true);const adjust=new T.Matrix4().makeScale(scale,scale,scale);if(yUp)adjust.premultiply(new T.Matrix4().makeRotationX(Math.PI/2));
  root.traverse(o=>{if(!o.isMesh&&!o.isLine)return;const g=o.geometry.clone();g.applyMatrix4(new T.Matrix4().multiplyMatrices(adjust,o.matrixWorld));const attr=g.getAttribute('position');if(!attr)return;
    let idx=g.index?Array.from(g.index.array):Array.from({length:attr.count},(_,i)=>i);
    if(o.isLine&&!o.isLineSegments){const line=[];for(let i=1;i<idx.length;i++)line.push(idx[i-1],idx[i]);if(o.isLineLoop)line.push(idx.at(-1),idx[0]);idx=line;}
    if(o.isMesh&&o.matrixWorld.determinant()<0)for(let i=0;i<idx.length;i+=3)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]];
    const mats=Array.isArray(o.material)?o.material:[o.material];const rgb=mat=>mat?.color?.clone().convertLinearToSRGB().toArray()||neutral;
    meshes.push({name:o.name||o.parent?.name,positions:Array.from(attr.array),indices:idx,color:rgb(mats[0]),normals:g.getAttribute('normal')?.array.slice(),primitive:o.isLine?'lines':undefined,faces:o.isMesh?g.groups.map(gr=>({first:gr.start/3,last:(gr.start+gr.count)/3-1,color:rgb(mats[gr.materialIndex])})):[]});g.dispose();
  });return meshes;
}

export function parseDxf(text){
  if(text.startsWith('AutoCAD Binary DXF'))throw new Error('바이너리 DXF는 ASCII DXF로 저장한 뒤 열어 주세요.');
  if(!/\bEOF\s*$/.test(text))throw new Error('DXF 파일이 불완전합니다. ASCII DXF로 다시 저장해 주세요.');
  const doc=new DxfParser().parseSync(text);const meshes=[],skipped=new Set();const factor=mmUnits[doc.header?.$INSUNITS]||1;
  const buckets=new Map();const entityName=e=>e.layer||'Drawing';
  function append(e,points,indices,lines,mat){const key=`${entityName(e)}:${lines?'lines':'mesh'}`;if(!buckets.has(key))buckets.set(key,{name:entityName(e),positions:[],indices:[],primitive:lines?'lines':undefined,color:e.color?new T.Color(e.color).convertLinearToSRGB().toArray():neutral,faces:[]});const m=buckets.get(key),offset=m.positions.length/3;for(const p of points)m.positions.push(...p.clone().applyMatrix4(mat).multiplyScalar(factor).toArray());for(const i of indices)m.indices.push(i+offset);}
  function poly(e,points,closed,mat){if(points.length<2)return;const idx=[];for(let i=1;i<points.length;i++)idx.push(i-1,i);if(closed)idx.push(points.length-1,0);append(e,points,idx,true,mat);}
  function walk(entities,mat,depth=0){if(depth>24)throw new Error('DXF 블록 중첩이 너무 깊습니다.');for(const e of entities||[]){
    const type=e.type;const coords=e.vertices?.map(p=>toPoint({...p,z:p.z??e.elevation??0}));
    if(type==='INSERT'){const b=doc.blocks?.[e.name];if(!b){skipped.add('INSERT');continue;}const local=new T.Matrix4().compose(toPoint(e.position),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),T.MathUtils.degToRad(e.rotation||0)),new T.Vector3(e.xScale??1,e.yScale??1,e.zScale??1));local.multiply(new T.Matrix4().makeTranslation(-(b.position?.x||0),-(b.position?.y||0),-(b.position?.z||0)));walk(b.entities,mat.clone().multiply(local),depth+1);}
    else if(type==='3DFACE'||type==='SOLID'){if(!coords||coords.length<3)continue;const idx=[0,1,2];if(coords[3]&&coords[3].distanceToSquared(coords[2])>1e-20)idx.push(0,2,3);append(e,coords.slice(0,4),idx,false,mat);}
    else if(type==='POLYLINE'&&e.isPolyfaceMesh){const vertices=e.vertices.filter(v=>!v.faceA);const faces=e.vertices.filter(v=>v.faceA);const idx=[];for(const f of faces){const ring=[f.faceA,f.faceB,f.faceC,f.faceD].filter(Boolean).map(n=>Math.abs(n)-1);if(ring.length>=3)idx.push(ring[0],ring[1],ring[2]);if(ring.length===4)idx.push(ring[0],ring[2],ring[3]);}append(e,vertices.map(toPoint),idx,false,mat);}
    else if(type==='LINE')poly(e,coords,false,mat);
    else if(type==='LWPOLYLINE'||type==='POLYLINE'){
      if(e.is3dPolygonMesh){skipped.add('POLYGON_MESH');continue;}const pts=[];for(let i=0;i<coords.length;i++){const a=coords[i],b=coords[(i+1)%coords.length],bulge=e.vertices[i].bulge;pts.push(a);if(bulge&&(i<coords.length-1||e.shape)){const theta=4*Math.atan(bulge),chord=a.distanceTo(b),mid=a.clone().add(b).multiplyScalar(.5),perp=new T.Vector3(-(b.y-a.y),b.x-a.x,0).normalize();const c=mid.addScaledVector(perp,chord*(1-bulge*bulge)/(4*bulge)),r=a.distanceTo(c),start=Math.atan2(a.y-c.y,a.x-c.x),steps=Math.max(4,Math.ceil(Math.abs(theta)*16));for(let j=1;j<steps;j++){const angle=start+theta*j/steps;pts.push(new T.Vector3(c.x+r*Math.cos(angle),c.y+r*Math.sin(angle),a.z+(b.z-a.z)*j/steps));}}}poly(e,pts,e.shape,mat);
    } else if(type==='CIRCLE'||type==='ARC'){const start=e.startAngle||0;let angle=type==='CIRCLE'?2*Math.PI:(e.endAngle-start+2*Math.PI)%(2*Math.PI);const steps=Math.max(16,Math.ceil(angle*32));const pts=[];for(let i=0;i<=steps;i++){const t=start+angle*i/steps;pts.push(toPoint(e.center).add(new T.Vector3(Math.cos(t)*e.radius,Math.sin(t)*e.radius,0)));}poly(e,pts,false,mat);}
    else if(type==='ELLIPSE'){const axis=toPoint(e.majorAxisEndPoint),side=new T.Vector3(-axis.y,axis.x,0).multiplyScalar(e.axisRatio);const pts=[];let start=e.startAngle||0,end=e.endAngle||Math.PI*2;if(end<=start)end+=Math.PI*2;for(let i=0;i<=128;i++){const t=start+(end-start)*i/128;pts.push(toPoint(e.center).addScaledVector(axis,Math.cos(t)).addScaledVector(side,Math.sin(t)));}poly(e,pts,false,mat);}
    else if(type==='SPLINE'&&e.controlPoints?.length&&e.knotValues?.length){try{const curve=new NURBSCurve(e.degreeOfSplineCurve,e.knotValues,e.controlPoints.map((p,i)=>new T.Vector4(p.x,p.y,p.z||0,e.weights?.[i]||1)));poly(e,curve.getPoints(Math.min(2048,Math.max(64,e.controlPoints.length*12))),e.closed,mat);}catch{skipped.add('SPLINE');}}
    else skipped.add(type);
  }}
  walk(doc.entities,new T.Matrix4());meshes.push(...buckets.values());const warnings=['DXF: 지원되는 선·표면만 표시합니다. 문자·치수·해치·ACIS 솔리드는 보존하지 않습니다.'];if(skipped.size)warnings.push(`제외된 엔티티: ${[...skipped].join(', ')}`);if(!doc.header?.$INSUNITS)warnings.push('단위 정보가 없어 mm로 해석했습니다.');return normalizeMeshes(meshes,warnings);
}
function parseSkp(data){
  const meshes=[];for(let n=0;n<data.scene.length;n++){const instance=data.scene[n],run=data.runs[instance.run];if(!run)continue;const mat=new T.Matrix4().fromArray(instance.world).transpose();const points=run.vertices_m.map(p=>new T.Vector3(...p).applyMatrix4(mat).multiplyScalar(1000));const indices=[];
    for(const face of run.faces){if(face.outer.length<3)continue;const normal=new T.Vector3(...face.normal);const dominant=['x','y','z'].sort((a,b)=>Math.abs(normal[b])-Math.abs(normal[a]))[0];const plane=p=>dominant==='x'?new T.Vector2(p.y,p.z):dominant==='y'?new T.Vector2(p.z,p.x):new T.Vector2(p.x,p.y);const raw=run.vertices_m.map(p=>new T.Vector3(...p));const ring=face.outer.map(i=>plane(raw[i])),holes=face.holes.map(h=>h.map(i=>plane(raw[i]))),lookup=[...face.outer,...face.holes.flat()];const tris=T.ShapeUtils.triangulateShape(ring,holes);for(const tri of tris){let [a,b,c]=tri.map(i=>lookup[i]);const cross=raw[b].clone().sub(raw[a]).cross(raw[c].clone().sub(raw[a]));if(cross.dot(normal)<0)[b,c]=[c,b];if(mat.determinant()<0)[b,c]=[c,b];indices.push(a,b,c);}}
    if(indices.length)meshes.push({name:data.names?.[n]||`SKP ${n+1}`,positions:points.flatMap(p=>p.toArray()),indices});
    const edges=run.edges.filter(e=>!e.hidden&&!run.faces.length).flatMap(e=>[e.v0,e.v1]);if(edges.length)meshes.push({name:data.names?.[n]||'SKP 선',positions:points.flatMap(p=>p.toArray()),indices:edges,primitive:'lines'});
  }return normalizeMeshes(meshes,[`SKP ${data.version}: 그룹·표면·선을 표시합니다. 텍스처·주석은 제외됩니다.`,...(data.diagnostics?.length?[`파일 해석 진단 ${data.diagnostics.length}건. 일부 요소가 생략될 수 있습니다.`]:[])]);
}

export async function importMesh(file){
  let ext=extension(file.name),bytes=new Uint8Array(file.bytes);const warnings=[];let object,scale=1,yUp=false;
  if(ext==='dwg'){const r=await window.desktop.convertNative('dwg-read',bytes);if(r.error)throw new Error(r.error);bytes=r.bytes;ext='dxf';}
  if(ext==='dxf')return new Promise((resolve,reject)=>{const worker=new Worker('dxf-worker.js',{type:'module'});const done=(error,result)=>{clearTimeout(timer);worker.terminate();error?reject(new Error(error)):resolve(result);};const timer=setTimeout(()=>done('DXF 해석 시간이 초과되었습니다.'),60000);worker.onerror=()=>done('DXF 해석에 실패했습니다.');worker.onmessage=({data})=>done(data.error,data.result);worker.postMessage(decode(bytes));});
  if(ext==='3dm'){const r=await window.desktop.rhino('read',bytes);if(r.error)throw new Error(r.error);return normalizeMeshes(r.meshes,r.warnings);}
  if(ext==='skp'){const r=await window.desktop.convertNative('skp-read',bytes);if(r.error)throw new Error(r.error);return parseSkp(JSON.parse(decode(r.bytes)));}
  const manager=new T.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('data:')||url.startsWith('blob:')||url.startsWith('app://viewer/vendor/'))return url;warnings.push('외부 텍스처는 불러오지 않았습니다. 형상과 기본 색상만 표시합니다.');return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';});
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  if(ext==='stl')object=new T.Mesh(new STLLoader().parse(buffer),new T.MeshStandardMaterial({color:'#83b2bf'}));
  if(ext==='obj')object=new OBJLoader(manager).parse(decode(bytes));
  if(ext==='glb'||ext==='gltf'){let meta;if(ext==='gltf')meta=JSON.parse(decode(bytes));else if(bytes.length>20){const view=new DataView(buffer);if(view.getUint32(16,true)===0x4e4f534a)meta=JSON.parse(decode(bytes.subarray(20,20+view.getUint32(12,true))));}if(meta?.buffers?.some(b=>b.uri&&!b.uri.startsWith('data:')))throw new Error('외부 .bin 버퍼를 참조하는 glTF는 지원하지 않습니다. 형상이 포함된 GLB로 저장해 주세요.');object=(await new GLTFLoader(manager).parseAsync(buffer,'')).scene;scale=1000;yUp=true;}
  if(ext==='fbx'){object=new FBXLoader(manager).parse(buffer,'');scale=(object.userData.unitScaleFactor||1)*10;yUp=true;}
  if(ext==='dae'){object=new ColladaLoader(manager).parse(decode(bytes),'').scene;scale=1000;yUp=true;}
  if(ext==='3ds')object=new TDSLoader(manager).parse(buffer,'');
  if(ext==='usdz'){object=new USDLoader(manager).parse(buffer);scale=1000;yUp=true;}
  if(ext==='3mf'){object=new ThreeMFLoader(manager).parse(buffer);const entries=unzipSync(bytes);const model=Object.entries(entries).find(([n])=>n.toLowerCase().endsWith('.model'));const unit=model?strFromU8(model[1]).match(/<model[^>]*\bunit=["']([^"']+)/)?.[1]:'millimeter';scale={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000}[unit]||1;}
  if(!object)throw new Error('지원하지 않는 파일 형식입니다.');
  const meshes=objectMeshes(object,scale,yUp);object.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();});
  if(['stl','obj','3ds'].includes(ext))warnings.push(`${ext.toUpperCase()}: 단위 정보가 없거나 불완전하므로 mm로 해석합니다. 필요하면 크기 조절을 적용해 주세요.`);
  warnings.push('정적 형상을 가져왔습니다. 애니메이션·외부 텍스처·설계 이력은 편집 대상에 포함되지 않습니다.');
  return normalizeMeshes(meshes,warnings);
}

export function exportObject(meshes,meters=false){const root=new T.Group();for(const m of meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(m.positions,3));g.setIndex(Array.from(m.indices));g.computeVertexNormals();const material=new T.MeshStandardMaterial({color:new T.Color().setRGB(...(m.color||neutral),T.SRGBColorSpace),roughness:.5,metalness:0});const o=m.primitive==='lines'?new T.LineSegments(g,new T.LineBasicMaterial({color:material.color})):new T.Mesh(g,material);o.name=m.name||'Part';root.add(o);}if(meters){root.scale.setScalar(.001);root.rotation.x=-Math.PI/2;}root.updateMatrixWorld(true);return root;}
function dxfExport(meshes,projection='3d'){
  const out=[],layers=[];let handle=0x1000000;const pair=(a,b)=>out.push(String(a),String(b));
  const header=(type,layer)=>{pair(0,type);pair(5,(handle++).toString(16).toUpperCase());pair(330,dxfTemplate.owner);pair(100,'AcDbEntity');pair(8,layer);pair(100,type==='LINE'?'AcDbLine':'AcDbFace');};
  const point=(m,i)=>{let p=Array.from(m.positions.slice(i*3,i*3+3));if(projection==='xy')p[2]=0;if(projection==='xz')p=[p[0],p[2],0];if(projection==='yz')p=[p[1],p[2],0];return p;};
  for(const [n,m]of meshes.entries()){const layer=`P${n+1}_${m.name.replace(/[^\w-]/g,'_').slice(0,70)}`;layers.push(`0\nLAYER\n5\n${(0x1000+n).toString(16)}\n330\n${dxfTemplate.layerOwner}\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n2\n${layer}\n70\n0\n62\n7\n6\nContinuous\n`);const isLines=m.primitive==='lines'||projection!=='3d';const seen=new Set();const line=(a,b)=>{const p=point(m,a),q=point(m,b);const key=[p.join(','),q.join(',')].sort().join('|');if(seen.has(key)||p.every((v,i)=>v===q[i]))return;seen.add(key);header('LINE',layer);for(let j=0;j<3;j++)pair(10+j*10,p[j]);for(let j=0;j<3;j++)pair(11+j*10,q[j]);};
    for(let i=0;i<m.indices.length;i+=m.primitive==='lines'?2:3){const [a,b,c]=m.indices.slice(i,i+3);if(isLines){line(a,b);if(m.primitive!=='lines'){line(b,c);line(c,a);}continue;}header('3DFACE',layer);for(const [j,index]of[a,b,c,c].entries()){const p=point(m,index);for(let k=0;k<3;k++)pair(10+j+k*10,p[k]);}}
  }return strToU8(dxfTemplate.text.replace('999\nSTEP_VIEWER_ENTITIES\n',out.join('\n')+'\n').replace('999\nSTEP_VIEWER_LAYERS\n',layers.join('')).replace('STEP_VIEWER_HANDSEED',(handle+1).toString(16)));
}
function threeMf(meshes){const resources=[],build=[];for(const [i,m]of meshes.entries()){const id=i+1;let verts='',tris='';for(let j=0;j<m.positions.length;j+=3)verts+=`<vertex x="${m.positions[j]}" y="${m.positions[j+1]}" z="${m.positions[j+2]}"/>`;for(let j=0;j<m.indices.length;j+=3)tris+=`<triangle v1="${m.indices[j]}" v2="${m.indices[j+1]}" v3="${m.indices[j+2]}"/>`;const hex='#'+(m.color||neutral).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');resources.push(`<basematerials id="${10001+id}"><base name="Color" displaycolor="${hex}"/></basematerials><object id="${id}" type="model" name="${xml(m.name)}" pid="${10001+id}" pindex="0"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object>`);build.push(`<item objectid="${id}"/>`);}
  return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(`<?xml version="1.0"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources.join('')}</resources><build>${build.join('')}</build></model>`)},{level:6});
}
export async function exportMesh(meshes,ext,options={}){
  if(!meshes.length)throw new Error('저장할 부품을 선택해 주세요.');
  const lines=meshes.some(m=>m.primitive==='lines');if(lines&&['stl','step','3mf','usdz','fbx','3ds','dae'].includes(ext))throw new Error('이 출력 형식은 선 객체를 지원하지 않습니다. 표면 부품만 선택하거나 DXF / DWG / OBJ / GLB / SKP / 3DM으로 저장해 주세요.');
  if(ext==='step')return strToU8(facetedStep(meshes));
  if(ext==='dxf')return dxfExport(meshes,options.projection);
  if(ext==='dwg'){const r=await window.desktop.convertNative('dwg-write',dxfExport(meshes,options.projection));if(r.error)throw new Error(r.error);return r.bytes;}
  if(ext==='skp'){const r=await window.desktop.convertNative('skp-write',strToU8(JSON.stringify({meshes:meshes.map(m=>({...m,positions:Array.from(m.positions),indices:Array.from(m.indices),normals:undefined,faces:undefined}))})));if(r.error)throw new Error(r.error);return r.bytes;}
  if(ext==='3mf')return threeMf(meshes);
  if(ext==='3dm'){const r=await window.desktop.rhino('write',meshes.map(m=>({...m,positions:Array.from(m.positions),indices:Array.from(m.indices),normals:null,faces:[]})));if(r.error)throw new Error(r.error);return r.bytes;}
  const root=exportObject(meshes,['glb','3ds','dae','usdz'].includes(ext));
  // Assimp's FBX writer uses centimetres and may omit the imported scene-root
  // transform. Bake the internal bridge geometry into centimetres / Y-up.
  if(ext==='fbx'){const matrix=new T.Matrix4().makeRotationX(-Math.PI/2).multiply(new T.Matrix4().makeScale(.1,.1,.1));root.traverse(o=>o.geometry?.applyMatrix4(matrix));root.updateMatrixWorld(true);}
  try{
    if(ext==='stl')return new Uint8Array(new STLExporter().parse(root,{binary:true}).buffer);
    if(ext==='obj')return strToU8(new OBJExporter().parse(root));
    if(ext==='usdz')return new Uint8Array(await new USDZExporter().parseAsync(root,{includeAnchoringProperties:false}));
    const glb=new Uint8Array(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false}));
    if(ext==='glb')return glb;
    if(['fbx','3ds','dae'].includes(ext)){const r=await window.desktop.convertNative(`assimp-${ext}`,glb);if(r.error)throw new Error(r.error);return r.bytes;}
    throw new Error('지원하지 않는 출력 형식입니다.');
  }finally{root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
}
