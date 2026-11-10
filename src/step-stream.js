import {assemblyTree,assemblyPath} from './assembly.js';
const number=n=>{const s=Number(n.toFixed(6)).toString();return s.includes('.')||/e/i.test(s)?s:s+'.';};
const stepString=value=>String(value).replace(/\\/g,'\\\\').replace(/'/g,"''").replace(/[^\x20-\x7e]+/g,text=>'\\X2\\'+Array.from(text,c=>Array.from({length:c.length},(_,i)=>c.charCodeAt(i).toString(16).padStart(4,'0').toUpperCase()).join('')).join('')+'\\X0\\');
export function validateStepMeshes(meshes){
  if(!Array.isArray(meshes)||!meshes.length||meshes.length>10000)throw new Error('저장할 부품을 선택해 주세요.');
  let triangles=0,coordinates=0;
  for(const m of meshes){
    if(m.primitive==='lines')throw new Error('이 출력 형식은 선 객체를 지원하지 않습니다. 표면 부품만 선택하거나 DXF / DWG / OBJ / GLB / SKP / 3DM으로 저장해 주세요.');
    if(!m.positions?.length||m.positions.length%3||!m.indices?.length||m.indices.length%3)throw new Error('유효하지 않은 메시 데이터입니다.');
    triangles+=m.indices.length/3;coordinates+=m.positions.length;
    if(triangles>5000000||coordinates>45000000)throw new Error('500만 삼각형 이하의 모델을 사용해 주세요.');
    for(const n of m.positions)if(!Number.isFinite(n)||Math.abs(n)>1e12)throw new Error('유효하지 않은 형상 좌표입니다.');
    for(const n of m.indices)if(!Number.isInteger(n)||n<0||n>=m.positions.length/3)throw new Error('메시 인덱스가 잘못되었습니다.');
    if(m.name!==undefined&&(typeof m.name!=='string'||m.name.length>4096))throw new Error('부품 이름이 잘못되었습니다.');
    if(m.color&&(!Array.isArray(m.color)||m.color.length!==3||m.color.some(n=>!Number.isFinite(n)||n<0||n>1)))throw new Error('부품 색상이 잘못되었습니다.');
    assemblyPath(m.assemblyPath);
  }
  return triangles;
}
// Bounded text chunks, indexed vertices and numeric edge keys avoid constructing
// one huge JavaScript string or expanding all triangles into copied vertices.
export function* facetedStepChunks(meshes,{progress=()=>{}}={}){
  const total=validateStepMeshes(meshes);let serial=0,text='',completed=0;
  const entity=value=>{const id=++serial;text+=`#${id} = ${value};\n`;return '#'+id;};
  yield "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('STEP Viewer faceted mesh v2'),'2;1');\nFILE_NAME('model.step','2026-10-26T00:00:00',('STEP Viewer'),(''),'STEP Viewer','STEP Viewer','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
  const app=entity("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  entity(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const pc=entity(`PRODUCT_CONTEXT('',${app},'mechanical')`),dc=entity(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  const mm=entity('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))'),rad=entity('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))'),sr=entity('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.))');
  const uncertainty=entity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),${mm},'distance_accuracy_value','')`);
  const context=entity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('',''))`);
  const origin=entity("CARTESIAN_POINT('',(0.,0.,0.))"),z=entity("DIRECTION('',(0.,0.,1.))"),x=entity("DIRECTION('',(1.,0.,0.))"),axis=entity(`AXIS2_PLACEMENT_3D('',${origin},${z},${x})`);
  const product=(name,representation)=>{const safe=stepString(name),p=entity(`PRODUCT('${safe}','${safe}','',(${pc}))`),f=entity(`PRODUCT_DEFINITION_FORMATION('','',${p})`),definition=entity(`PRODUCT_DEFINITION('design','',${f},${dc})`),shape=entity(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);entity(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);return {definition,representation};};
  const definitions=[];
  for(const [partIndex,m]of meshes.entries()){
    const name=m.name||'Part',points=new Map(),refs=new Uint32Array(m.positions.length/3),edges=new Map(),faces=[];
    // Private, bounded JSON comments allow this application's own large faceted
    // output to reopen without allocating a CAD face for every triangle.
    text+=`/* STEP_VIEWER_PART ${JSON.stringify({name,color:m.color||[.5,.7,.75],assemblyPath:assemblyPath(m.assemblyPath)}).replace(/\*/g,'\\u002a')} */\n`;
    for(let i=0;i<refs.length;i++){
      const key=[0,1,2].map(a=>number(m.positions[i*3+a])).join(',');
      let ref=points.get(key);if(ref===undefined){entity(`CARTESIAN_POINT('',(${key}))`);ref=serial;points.set(key,ref);}refs[i]=ref;
      if(text.length>262144){yield text;text='';}
    }
    const stride=serial+1;
    for(let i=0;i<m.indices.length;i+=3){
      const ids=[m.indices[i],m.indices[i+1],m.indices[i+2]],r=ids.map(id=>refs[id]);
      if(r[0]===r[1]||r[1]===r[2]||r[2]===r[0])continue;
      const a=ids[0]*3,b=ids[1]*3,c=ids[2]*3,p=m.positions;
      const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nl=Math.hypot(nx,ny,nz),tl=Math.hypot(ux,uy,uz);if(!nl||!tl)continue;
      for(let e=0;e<3;e++){const low=Math.min(r[e],r[(e+1)%3]),high=Math.max(r[e],r[(e+1)%3]);const key=low*stride+high;edges.set(key,(edges.get(key)||0)+1);}
      const loop=entity(`POLY_LOOP('',(${r.map(id=>'#'+id).join(',')}))`),bound=entity(`FACE_OUTER_BOUND('',${loop},.T.)`);
      const normal=entity(`DIRECTION('',(${[nx/nl,ny/nl,nz/nl].map(number).join(',')}))`),tangent=entity(`DIRECTION('',(${[ux/tl,uy/tl,uz/tl].map(number).join(',')}))`);
      const placement=entity(`AXIS2_PLACEMENT_3D('',#${r[0]},${normal},${tangent})`),plane=entity(`PLANE('',${placement})`);
      faces.push(entity(`FACE_SURFACE('',(${bound}),${plane},.T.)`));
      if(text.length>262144){yield text;text='';progress({part:partIndex+1,parts:meshes.length,triangles:completed+i/3,total});}
    }
    if(!faces.length)throw new Error('저장할 유효한 삼각형이 없습니다.');
    let closed=true;for(const count of edges.values())if(count!==2){closed=false;break;}
    // A large shell's reference list is emitted in chunks too.
    const shell='#'+(++serial);text+=`${shell} = ${closed?'CLOSED_SHELL':'OPEN_SHELL'}('',(`;
    for(let i=0;i<faces.length;i++){text+=(i?',':'')+faces[i];if(text.length>262144){yield text;text='';}}text+='));\n';
    const safe=stepString(name),solid=entity(closed?`FACETED_BREP('${safe}',${shell})`:`SHELL_BASED_SURFACE_MODEL('${safe}',(${shell}))`);
    const rep=entity(`${closed?'FACETED_BREP_SHAPE_REPRESENTATION':'MANIFOLD_SURFACE_SHAPE_REPRESENTATION'}('${safe}',(${axis},${solid}),${context})`);definitions.push(product(name,rep));
    const rgb=entity(`COLOUR_RGB('',${(m.color||[.5,.7,.75]).map(number).join(',')})`),fillColor=entity(`FILL_AREA_STYLE_COLOUR('',${rgb})`),fill=entity(`FILL_AREA_STYLE('',(${fillColor}))`),surface=entity(`SURFACE_STYLE_FILL_AREA(${fill})`),side=entity(`SURFACE_SIDE_STYLE('',(${surface}))`),usage=entity(`SURFACE_STYLE_USAGE(.BOTH.,${side})`),assign=entity(`PRESENTATION_STYLE_ASSIGNMENT((${usage}))`),styled=entity(`STYLED_ITEM('',(${assign}),${solid})`);entity(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled}),${context})`);
    text+='/* STEP_VIEWER_PART_END */\n';yield text;text='';completed+=m.indices.length/3;progress({part:partIndex+1,parts:meshes.length,triangles:completed,total});
  }
  let occurrence=0;
  const component=(parent,child,name)=>{const usage=entity(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${++occurrence}','${stepString(name)}','',${parent.definition},${child.definition},$)`),placement=entity(`PRODUCT_DEFINITION_SHAPE('','',${usage})`),transform=entity(`ITEM_DEFINED_TRANSFORMATION('','',${axis},${axis})`),relation=entity(`(REPRESENTATION_RELATIONSHIP('','',${child.representation},${parent.representation}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${transform}) SHAPE_REPRESENTATION_RELATIONSHIP())`);entity(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${relation},${placement})`);};
  function group(node){const rep=entity(`SHAPE_REPRESENTATION('${stepString(node.name)}',(${axis}),${context})`),parent=product(node.name,rep);for(const id of node.meshes)component(parent,definitions[id],meshes[id].name||'Part');for(const child of node.children)component(parent,group(child),child.name);return parent;}
  group(assemblyTree(meshes.map((m,id)=>({...m,id}))));yield text+'ENDSEC;\nEND-ISO-10303-21;\n';
}
export function facetedStep(meshes){return [...facetedStepChunks(meshes)].join('');}
