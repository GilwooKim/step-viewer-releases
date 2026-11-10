import {initLocalization,sourceText} from './localization.js';
import {initSettings,openSettings} from './settings.js';
import { initUpdates } from './updates.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { icon, mountIcons } from './icons.js';
import { importMesh, exportMesh, absoluteMeshes, normalizeMeshes } from './mesh-io.js';
import { FORMATS, EXTENSIONS, extension } from './formats.js';
import { retainAssembly,assemblyTree,assemblyPath,assemblyDepth,assemblyUnit } from './assembly.js';
import {removeParts} from './model-edits.js';
import {retainStepSource,sourceDescriptor} from './step-source.js';
await initLocalization();
initSettings();
mountIcons();
const $ = (id) => document.getElementById(id);
const format = (value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const sizeText = (bytes) => bytes < 1048576 ? `${format(bytes / 1024)} KB` : `${format(bytes / 1048576)} MB`;
let toastTimer, batchJob=null, exportSourceCache=null;
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 10000 : 4000); }

const canvas = $('canvas');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); }
catch { $('welcome').innerHTML = '<h1>3D 그래픽을 시작할 수 없습니다.</h1><p>그래픽 드라이버를 업데이트한 뒤 다시 실행해 주세요.</p>'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x182535, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdbefff, 0x58677b, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.1); keyLight.position.set(2, -3, 5); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d6ff, 1.5); fillLight.position.set(-3, 1, 2); scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xb7f5e6, 1.5); rimLight.position.set(1, 4, 3); scene.add(rimLight);
const orthographic = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 1000000);
const perspective = new THREE.PerspectiveCamera(38, 1, 0.01, 1000000);
let camera = orthographic;
for (const item of [orthographic, perspective]) { item.up.set(0, 0, 1); item.position.set(170, -230, 160); }
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });
controls.addEventListener('start', () => { document.querySelectorAll('.view-buttons button').forEach((b) => b.classList.remove('active')); $('view-label').textContent = '자유 보기'; });
let grid;
let model = new THREE.Group(); scene.add(model);
let parts = [], modelData = null, activeFile = null, selected = null, worker = null, importToken = 0;
const selectedIds = new Set();
let cadDoc=null, sourceBytes=null, selectedFace=null, faceOverlay=null, busy=false, revision=0, savedRevision=0, revisionCounter=0;
let undoStack=[],redoStack=[],cadWorker=null,cadPending=null,cadRequestId=0,layout='assembly';
let displayMode = 'shaded', span = 100, gridVisible = true;
let viewportWidth = 1, viewportHeight = 1;
const documents = [];
let activeDocument=null, documentCounter=0, tabPrompt=false, processingFiles=false, importDone=null;
const openQueue=[];
const pathKey = path => path ? path.replaceAll('\\','/').toLocaleLowerCase() : null;
function setModelControls(enabled) { document.querySelectorAll('[data-model]').forEach((element) => { element.disabled = !enabled; }); $('search').disabled = !enabled; }
setModelControls(false);

function resize() {
  viewportWidth = Math.max(1, $('viewport').clientWidth); viewportHeight = Math.max(1, $('viewport').clientHeight);
  renderer.setSize(viewportWidth, viewportHeight, false);
  const aspect = viewportWidth / viewportHeight;
  orthographic.left = -span * aspect / 2; orthographic.right = span * aspect / 2; orthographic.top = span / 2; orthographic.bottom = -span / 2;
  orthographic.updateProjectionMatrix(); perspective.aspect = aspect; perspective.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(resize).observe($('viewport'));
function updateAxes() {
  const inverse = camera.quaternion.clone().invert();
  [['x', 1, 0, 0], ['y', 0, 1, 0], ['z', 0, 0, 1]].forEach(([name, x, y, z]) => {
    const direction = new THREE.Vector3(x, y, z).applyQuaternion(inverse);
    const sx = 45 + direction.x * 27, sy = 45 - direction.y * 27;
    $(`ax-${name}`).setAttribute('x2', sx); $(`ax-${name}`).setAttribute('y2', sy);
    $(`label-${name}`).style.left = `${45 + direction.x * 36}px`; $(`label-${name}`).style.top = `${45 - direction.y * 36}px`;
  });
}
function animate() { requestAnimationFrame(animate); if (controls.update() || dirty) { renderer.render(scene, camera); updateAxes(); dirty = false; } }
animate();

function bounds(visibleOnly = true) {
  const box = new THREE.Box3();
  parts.forEach((part) => { if (!visibleOnly || part.mesh.visible) box.union(partBounds(part)); });
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50)) : box;
}
function frame(box = bounds()) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const direction = camera.position.clone().sub(controls.target).normalize();
  if (!direction.lengthSq()) direction.set(1, -1, 1).normalize();
  const aspect = viewportWidth / viewportHeight;
  span = radius * 2.65 / Math.min(aspect, 1);
  const dist = radius * 1.3 / Math.sin(THREE.MathUtils.degToRad(perspective.fov / 2)) / Math.min(aspect, 1);
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(direction, dist);
  orthographic.zoom = 1;
  for (const cam of [orthographic, perspective]) { cam.near = Math.max(radius / 10000, 0.000001); cam.far = Math.max(radius * 10000, 100); cam.updateProjectionMatrix(); }
  controls.minDistance = radius * 0.015; controls.maxDistance = radius * 500; controls.minZoom = 0.005; controls.maxZoom = 500;
  controls.update(); resize(); dirty = true;
}
const views = { iso: [1, -1.5, 1.05], front: [0, -1, 0], top: [0, -0.0001, 1], right: [1, 0, 0] };
const viewNames = { iso: '등각 보기', front: '정면 보기', top: '윗면 보기', right: '오른쪽 보기' };
function view(name) {
  camera.position.copy(controls.target).add(new THREE.Vector3(...views[name]).normalize().multiplyScalar(Math.max(camera.position.distanceTo(controls.target), 10)));
  controls.update(); frame();
  document.querySelectorAll('.view-buttons button').forEach((button) => button.classList.toggle('active', button.id === name));
  $('view-label').textContent = viewNames[name];
}
function rebuildGrid(box) {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z, 0.01);
  const step = Math.pow(10, Math.floor(Math.log10(max / 8)));
  const gridSize = Math.ceil(max * 2 / step) * step;
  grid = new THREE.GridHelper(gridSize, Math.min(100, Math.round(gridSize / step)), 0x436577, 0x2d4357);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = box.min.z - max * 0.015;
  grid.material.transparent = true; grid.material.opacity = 0.45; grid.material.depthWrite = false; grid.visible = gridVisible;
  scene.add(grid);
}
function color(rgb) { return rgb ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : new THREE.Color('#9fbdc9'); }
function makeMaterial(rgb) { return new THREE.MeshStandardMaterial({ color: color(rgb), metalness: 0.25, roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); }
function disposeModel(group) { group.traverse((object) => { object.geometry?.dispose(); if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); }); }
function buildModel(data, file, fresh = null) {
  retainAssembly(data);
  const next = new THREE.Group(), nextParts = [];
  try {
    for (const source of data.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
      if (source.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3)); else if(source.primitive!=='lines')geometry.computeVertexNormals();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const materials = [source.primitive==='lines'?new THREE.LineBasicMaterial({color:color(source.color)}):makeMaterial(source.color)], palette = new Map();
      if (source.faces.some((face) => face.color)) {
        const faces = source.faces.slice().sort((a, b) => a.first - b.first);
        let cursor = 0;
        for (const face of faces) {
          const start = face.first * 3, count = (face.last - face.first + 1) * 3;
          if (start > cursor) geometry.addGroup(cursor, start - cursor, 0);
          let materialIndex = 0;
          if (face.color) { const key = face.color.join(','); if (!palette.has(key)) { palette.set(key, materials.length); materials.push(makeMaterial(face.color)); } materialIndex = palette.get(key); }
          geometry.addGroup(start, count, materialIndex); cursor = start + count;
        }
        if (cursor < source.indices.length) geometry.addGroup(cursor, source.indices.length - cursor, 0);
      } else geometry.addGroup(0, source.indices.length, 0);
      const mesh = source.primitive==='lines'?new THREE.LineSegments(geometry,materials[0]):new THREE.Mesh(geometry, materials); mesh.userData.id = source.id; next.add(mesh);
      if (data.triangles < 600000 && source.primitive!=='lines') {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: '#142e3a', transparent: true, opacity: 0.48 }));
        edges.userData.edges = true; mesh.add(edges);
      }
      nextParts.push({ id: source.id, name: source.name, source, mesh, materials, triangles: source.primitive==='lines'?0:source.indices.length / 3 });
    }
  } catch (error) { disposeModel(next); throw error; }
  clearFaceOverlay();
  if(fresh || !activeDocument){
    rememberDocument();scene.remove(model);if(!activeDocument)disposeModel(model);
    if(grid){scene.remove(grid);grid=null;}
    activeDocument={id:++documentCounter,name:file.name,path:file.path||null,changed:false,state:null};documents.push(activeDocument);
    cadDoc=fresh?.doc??null;sourceBytes=fresh?.bytes??null;undoStack=[];redoStack=[];revision=savedRevision=++revisionCounter;
  }else{scene.remove(model);disposeModel(model);activeDocument.state=null;}
  model = next; parts = nextParts; scene.add(model);
  modelData = sourceBytes&&!cadDoc?retainStepSource(data):data;
  for(const part of parts)part.source=modelData.meshes.find(m=>m.id===part.id)||part.source;
  activeFile = { name: file.name, size: file.size||0, path:file.path||null };
  selectedFace=null;clearFaceOverlay();
  selected = null; selectPart(null); displayMode = 'shaded'; setDisplay('shaded');
  $('welcome').hidden = true; $('model-summary').hidden = false;
  $('file-name').textContent = file.name; $('file-name').title = file.name;
  $('file-name').setAttribute('data-user-text','');$('title-file').setAttribute('data-user-text','');$('title-file').textContent = file.name; $('file-detail').textContent = `${sizeText(file.size)} · ${parts.length}개 부품`;
  $('part-count').textContent = parts.length; $('search').value = '';
  $('stats').textContent = `${format(parts.length)} 부품 · ${format(data.triangles)} 삼각형`;
  ['x', 'y', 'z'].forEach((axis, i) => { $(`dim-${axis}`).textContent = format(data.max[i] - data.min[i]); });
  renderTree(data.root); setModelControls(true); layout='assembly';$('explode').value=0;updateAssemblyOptions();applyLayout(); rebuildGrid(bounds(false)); view('iso');updateEditor();
  $('import-notes').textContent=(data.warnings||[]).join('\n');$('model-mode').hidden=false;updateDirty();
  window.desktop.setTitle(file.name); $('status-text').textContent = '모델을 불러왔습니다'; dirty = true;
  renderTabs(true);
}

function cameraState(cam){return {position:cam.position.toArray(),quaternion:cam.quaternion.toArray(),zoom:cam.zoom,near:cam.near,far:cam.far};}
function rememberDocument(){
  if(!activeDocument)return;
  // Settle orbit damping before detaching so the next document cannot inherit a pending drag.
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  activeDocument.changed=revision!==savedRevision;
  activeDocument.state={model,grid,parts,modelData,activeFile,cadDoc,sourceBytes,revision,savedRevision,undoStack,redoStack,selected,selectedIds:[...selectedIds],selectedFace,
    displayMode,layout,span,gridVisible,explode:$('explode').value,explodeUnit:$('explode-unit').value,search:$('search').value,treeScroll:$('tree').scrollTop,
    groups:[...$('tree').querySelectorAll('details')].map(el=>el.open),editorOpen:!$('editor').hidden,editorScroll:$('editor').querySelector('.editor-scroll').scrollTop,
    editorFields:[...$('editor').querySelectorAll('input[id],select[id]')].map(el=>[el.id,el.value,el.checked]),
    editorGroups:[...$('editor').querySelectorAll('details')].map(el=>el.open),viewLabel:sourceText($('view-label')),
    viewButtons:[...document.querySelectorAll('.view-buttons button.active')].map(el=>el.id),camera:camera===orthographic?'orthographic':'perspective',
    orthographic:cameraState(orthographic),perspective:cameraState(perspective),target:controls.target.toArray(),minDistance:controls.minDistance,maxDistance:controls.maxDistance};
}
function renderTabs(scroll=false){
  const focused=document.activeElement?.id;
  $('document-tabs').replaceChildren();$('tabs-empty').hidden=documents.length>0;
  for(const doc of documents){
    const item=document.createElement('div');item.className='document-tab';item.classList.toggle('active',doc===activeDocument);item.dataset.documentId=doc.id;
    const button=document.createElement('button');button.className='tab-select';button.id=`document-tab-${doc.id}`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(doc===activeDocument));button.setAttribute('aria-controls','document-panel');button.tabIndex=doc===activeDocument?0:-1;
    button.textContent=(doc.changed?'● ':'')+doc.name;button.title=(doc.path||doc.name)+(doc.changed?' · 저장하지 않은 변경 사항':'');button.disabled=busy||tabPrompt;button.onclick=()=>activateDocument(doc);
    button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?documents.length-1:(documents.indexOf(doc)+(e.key==='ArrowRight'?1:-1)+documents.length)%documents.length;activateDocument(documents[index]);$(`document-tab-${documents[index].id}`)?.focus();}};
    const close=document.createElement('button');close.className='tab-close';close.textContent='×';close.title='탭 닫기 (Ctrl+W)';close.setAttribute('aria-label',`${doc.name} 탭 닫기`);close.disabled=busy||tabPrompt;close.onclick=()=>closeDocument(doc);
    item.append(button,close);$('document-tabs').append(item);
  }
  $('tab-open').disabled=busy||tabPrompt;
  if(activeDocument)$('document-panel').setAttribute('aria-labelledby',`document-tab-${activeDocument.id}`);else $('document-panel').removeAttribute('aria-labelledby');
  if(focused?.startsWith('document-tab-'))$(focused)?.focus({preventScroll:true});
  if(scroll&&activeDocument)$(`document-tab-${activeDocument.id}`)?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function activateDocument(doc){
  if(!doc||doc===activeDocument||busy||tabPrompt)return;
  rememberDocument();clearFaceOverlay();scene.remove(model);if(grid)scene.remove(grid);if(!activeDocument)disposeModel(model);
  const s=doc.state;activeDocument=doc;
  ({model,grid,parts,modelData,activeFile,cadDoc,sourceBytes,revision,savedRevision,undoStack,redoStack,selected,selectedFace,displayMode,layout,span,gridVisible}=s);
  selectedIds.clear();s.selectedIds.forEach(id=>selectedIds.add(id));scene.add(model);if(grid)scene.add(grid);
  $('welcome').hidden=true;$('model-summary').hidden=false;$('model-mode').hidden=false;setModelControls(true);
  $('file-name').setAttribute('data-user-text','');$('file-name').textContent=activeFile.name;$('file-name').title=doc.path||activeFile.name;$('file-detail').textContent=`${sizeText(activeFile.size)} · ${parts.length}개 부품`;
  $('part-count').textContent=parts.length;$('stats').textContent=`${format(parts.length)} 부품 · ${format(modelData.triangles)} 삼각형`;
  ['x','y','z'].forEach((axis,i)=>{$(`dim-${axis}`).textContent=format(modelData.max[i]-modelData.min[i]);});
  $('import-notes').textContent=(modelData.warnings||[]).join('\n');renderTree(modelData.root);$('search').value=s.search;filterTree();
  [...$('tree').querySelectorAll('details')].forEach((el,i)=>{el.open=s.groups[i]??true;});$('tree').scrollTop=s.treeScroll;
  $('explode').value=s.explode;updateAssemblyOptions(s.explodeUnit);applyLayout();setDisplay(displayMode);$('grid').classList.toggle('active',gridVisible);$('grid').setAttribute('aria-pressed',gridVisible);
  $('editor').hidden=!s.editorOpen;$('edit-toggle').classList.toggle('active',s.editorOpen);
  $('cad-action').value=s.editorFields.find(([id])=>id==='cad-action')?.[1]||'addBox';renderCadFields();renderSelection();showFace();
  for(const [id,value,checked] of s.editorFields){const el=$(id);if(el){el.value=value;el.checked=checked;}}
  [...$('editor').querySelectorAll('details')].forEach((el,i)=>{el.open=s.editorGroups[i]??false;});$('editor').querySelector('.editor-scroll').scrollTop=s.editorScroll;
  camera=s.camera==='orthographic'?orthographic:perspective;controls.object=camera;controls.target.fromArray(s.target);controls.minDistance=s.minDistance;controls.maxDistance=s.maxDistance;
  for(const [cam,state] of [[orthographic,s.orthographic],[perspective,s.perspective]]){cam.position.fromArray(state.position);cam.quaternion.fromArray(state.quaternion);cam.zoom=state.zoom;cam.near=state.near;cam.far=state.far;cam.updateProjectionMatrix();}
  controls.update();resize();$('projection').textContent=camera===orthographic?'평행 투영':'원근 투영';$('view-label').textContent=s.viewLabel;
  document.querySelectorAll('.view-buttons button').forEach(el=>el.classList.toggle('active',s.viewButtons.includes(el.id)));
  $('batch-results').hidden=true;$('batch-progress').hidden=true;$('export-status').textContent='';
  updateDirty();renderTabs(true);window.desktop.setTitle(activeFile.name);$('status-text').textContent=`${activeFile.name} · 탭 전환`;dirty=true;
}
function cycleDocument(delta){if(documents.length)activateDocument(documents[(documents.indexOf(activeDocument)+delta+documents.length)%documents.length]);}
async function closeDocument(doc=activeDocument){
  if(!doc||busy||tabPrompt)return;
  if(doc!==activeDocument)activateDocument(doc);
  if(revision!==savedRevision){
    tabPrompt=true;renderTabs();window.desktop.setWorking(true);
    try{const choice=await window.desktop.confirmCloseTab(activeFile.name);if(choice==='cancel')return;if(choice==='save'&&!(await saveProject()))return;}
    catch(error){toast(error.message||'탭을 닫지 못했습니다.',true);return;}
    finally{tabPrompt=false;renderTabs();window.desktop.setWorking(busy);queueMicrotask(drainOpenQueue);}
  }
  const index=documents.indexOf(doc);clearFaceOverlay();scene.remove(model);disposeModel(model);documents.splice(index,1);activeDocument=null;
  if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();grid=null;}
  model=new THREE.Group();parts=[];modelData=null;activeFile=null;selected=null;selectedIds.clear();resetDocument();
  if(documents.length)activateDocument(documents[Math.min(index,documents.length-1)]);
  else{
    scene.add(model);if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();grid=null;}
    $('welcome').hidden=false;$('model-summary').hidden=true;$('model-mode').hidden=true;$('part-count').textContent='0';$('file-name').removeAttribute('data-user-text');$('file-name').textContent='열린 파일이 없습니다';$('file-name').title='';$('file-detail').textContent='CAD · 메시 · 드로잉';$('tree').replaceChildren();$('search').value='';$('stats').textContent='';$('status-text').textContent='파일을 열어 주세요';$('title-file').textContent='3D CAD 뷰어';
    renderSelection();setModelControls(false);$('explode').disabled=true;window.desktop.setTitle('');dirty=true;
  }
  updateDirty();renderTabs(true);
}

function selectPart(id, toggle = false) {
  const previous = selected;
  if (!toggle) selectedIds.clear();
  if (id !== null && parts.some(part => part.id === id)) {
    if (toggle && selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  }
  selected = selectedIds.has(id) ? id : [...selectedIds].at(-1) ?? null;
  if (previous !== selected || selectedIds.size !== 1) { selectedFace = null; clearFaceOverlay(); }
  renderSelection();
}
function renderSelection() {
  for (const part of parts) {
    const included = selectedIds.has(part.id);
    part.materials.forEach(material => {
      if (material.emissive) { material.emissive.set(included ? '#16463f' : '#000000'); material.emissiveIntensity = included ? 0.75 : 0; }
      else material.color.copy(color(included ? [.5, 1, .8] : part.source.color));
    });
  }
  document.querySelectorAll('.part-row').forEach(row => {
    const included = selectedIds.has(Number(row.dataset.id));
    row.classList.toggle('selected', included); row.querySelector('button').setAttribute('aria-pressed', String(included));
  });
  const chosen = parts.filter(part => selectedIds.has(part.id)), part = chosen.length === 1 ? chosen[0] : null;
  $('selected-name').toggleAttribute('data-user-text',!!part);
  $('selected-name').textContent = chosen.length > 1 ? `${format(chosen.length)}개 부품 선택` : part?.name || '선택 없음';
  $('selected-name').title = chosen.map(part => part.name).join('\n');
  if (chosen.length) {
    const box = new THREE.Box3(); chosen.forEach(part => box.union(part.mesh.geometry.boundingBox));
    const size = box.getSize(new THREE.Vector3());
    $('selected-detail').textContent = `${format(size.x)} × ${format(size.y)} × ${format(size.z)} mm\n${format(chosen.reduce((n, part) => n + part.triangles, 0))} 삼각형`;
  } else $('selected-detail').textContent = '모델 또는 부품 이름을 클릭하세요.';
  $('isolate').disabled = $('focus').disabled = $('export-selected').disabled = !chosen.length || busy;
  $('export-selected').textContent = chosen.length ? `선택 부품 내보내기 (${chosen.length}개)…` : '선택 부품 내보내기…';
  $('delete-selected').textContent=chosen.length?`선택 부품 삭제 (${chosen.length}개)`:'선택 부품 삭제';
  $('delete-selected').disabled=!chosen.length||busy||tabPrompt;
  $('part-index').textContent = part ? `${parts.indexOf(part) + 1} / ${parts.length}` : chosen.length ? `${chosen.length}개 선택 / ${parts.length}` : '부품별 보기';
  updateExportScope(); updateEditor(); dirty = true;
}
function setVisibility(id, visible) {
  const part = parts.find((item) => item.id === id); if (!part) return;
  part.mesh.visible = visible;
  document.querySelectorAll(`.part-row[data-id="${id}"]`).forEach((row) => { row.classList.toggle('hidden-part', !visible); row.querySelector('input').checked = visible; });
  if (!visible && selectedIds.has(id)) selectPart(id, true);
  $('status-text').textContent = `${parts.filter((item) => item.mesh.visible).length} / ${parts.length} 부품 표시`; dirty = true;
}
function renderTree(root) {
  $('tree').replaceChildren(); const included = new Set();
  function row(id, parent) {
    if (included.has(id)) return; const part = parts.find((item) => item.id === id); if (!part) return; included.add(id);
    const element = document.createElement('div'); element.className = 'part-row'; element.dataset.id = id; element.dataset.name = part.name.toLocaleLowerCase();
    element.classList.toggle('hidden-part',!part.mesh.visible);
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = part.mesh.visible; check.setAttribute('aria-label', `${part.name} 표시`); check.addEventListener('change', () => {if(!busy)setVisibility(id, check.checked);else check.checked=part.mesh.visible;});
    const button = document.createElement('button'); button.innerHTML = icon('cube'); const label = document.createElement('span'); label.textContent = part.name; button.append(label); button.title = `${part.name} · Shift+클릭으로 선택 추가·해제`; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', event => { if (!busy) selectPart(id, event.shiftKey || window.stepViewerMobile?.multiSelect); }); button.addEventListener('dblclick', event => { if (busy || event.shiftKey || window.stepViewerMobile?.multiSelect) return; setVisibility(id, true); frame(partBounds(part)); });
    element.append(check, button); parent.append(element);
  }
  function walk(node, parent, depth) {
    if (!node || depth > 40) return;
    let container = parent;
    if(node.name&&(node.children?.length||node.meshes?.length)){
      const ids=[];const collect=n=>{ids.push(...(n.meshes||[]));(n.children||[]).forEach(collect);};collect(node);
      const details=document.createElement('details');details.open=true;details.className='assembly-group';
      const summary=document.createElement('summary'),label=document.createElement('span');label.className='assembly-name';label.textContent=node.name;label.title=node.name;summary.append(label);
      const select=document.createElement('button');select.className='assembly-select';select.textContent=`${ids.length}개 선택`;select.title='조립품 전체 선택 · Shift+클릭으로 선택 추가·해제';select.setAttribute('aria-label',`${node.name} 조립품 선택`);
      select.onclick=event=>{event.preventDefault();event.stopPropagation();if(busy)return;const toggle=event.shiftKey||window.stepViewerMobile?.multiSelect;const remove=toggle&&ids.every(id=>selectedIds.has(id));if(!toggle)selectedIds.clear();for(const id of ids)if(remove)selectedIds.delete(id);else selectedIds.add(id);selected=[...selectedIds].at(-1)??null;selectedFace=null;clearFaceOverlay();renderSelection();};
      summary.append(select);details.append(summary);parent.append(details);container=details;
    }
    for (const id of node.meshes || []) row(id, container);
    for (const child of node.children || []) walk(child, container, depth + 1);
  }
  walk(root, $('tree'), 0); parts.forEach((part) => row(part.id, $('tree')));
}
function setDisplay(mode) {
  displayMode = mode;
  for (const part of parts) {
    for (const material of part.materials) { material.wireframe = mode === 'wire'; material.transparent = mode === 'transparent'; material.opacity = mode === 'transparent' ? 0.3 : 1; material.depthWrite = mode !== 'transparent'; material.needsUpdate = true; }
    part.mesh.children.forEach((child) => { child.visible = mode !== 'wire'; });
  }
  for (const name of ['shaded', 'wire', 'transparent']) { $(name).classList.toggle('active', name === mode); $(name).setAttribute('aria-pressed', name === mode); }
  dirty = true;
}

let importClock;
function stopImport() { importToken++; worker?.terminate(); worker = null; clearInterval(importClock); importClock = null; $('loading-detail').textContent = '파일 크기와 형상 복잡도에 따라 시간이 걸릴 수 있습니다.'; const done=importDone;importDone=null;done?.(); }
function loadFile(input){
  const files=Array.isArray(input)?input:input?.files||[input];openQueue.push(...files.filter(Boolean));return drainOpenQueue();
}
async function drainOpenQueue(){
  if(processingFiles||busy||tabPrompt)return;
  processingFiles=true;
  try{
    while(openQueue.length){
      const reference=openQueue.shift(),key=pathKey(reference.path),existing=key&&documents.find(doc=>pathKey(doc.path)===key);
      if(existing){activateDocument(existing);continue;}
      setBusy(true,`${reference.name||'파일'}을 새 탭으로 열고 있습니다…`);
      const token=importToken;
      try{
        const retained=documents.reduce((n,d)=>n+(d===activeDocument?sourceBytes?.byteLength||0:d.state?.sourceBytes?.byteLength||0),0);
        if(retained+(reference.size||0)>600*1024*1024)throw new Error('메모리 보호를 위해 사용하지 않는 파일 탭을 저장하고 닫아 주세요.');
        const file=reference.path&&!reference.bytes?await window.desktop.openPath(reference.path):reference;
        if(file.browserFile)file.bytes=new Uint8Array(await file.browserFile.arrayBuffer());
        if(token===importToken)await loadOneFile(file);
      }
      catch(error){toast(error.message||'파일을 열지 못했습니다.',true);}
      finally{stopImport();setBusy(false);}
    }
  }finally{processingFiles=false;}
}
function cancelOpenFiles(){openQueue.length=0;stopImport();$('status-text').textContent='불러오기를 취소했습니다';}
async function loadOneFile(file) {
  if (!file) return;
  if (file.error) { toast(file.error, true); return; }
  stopImport(); const token = importToken;
  const ext=extension(file.name);
  if(file.meshStep){buildModel(normalizeMeshes(file.meshStep.meshes),file,{});return;}
  if(ext==='svcad'){try{openProject(file);}catch(e){toast(e.message,true);}return;}
  if(!['step','stp'].includes(ext)){
    $('loading').hidden=false;$('loading-text').textContent='형상과 단위를 해석하고 있습니다…';$('open').disabled=true;
    try{const data=await importMesh(file);if(token!==importToken)return;buildModel(data,file,{});stopImport();if(data.warnings?.length)toast('파일을 열었습니다. 편집 패널에서 가져오기 정보를 확인할 수 있습니다.');}
    catch(e){if(token===importToken){stopImport();toast(e.message||'파일을 읽지 못했습니다.',true);}}return;
  }
  $('loading').hidden = false; $('open').disabled = true; $('loading-text').textContent = '파일을 읽고 있습니다…'; $('status-text').textContent = `${file.name} 불러오는 중`;
  const started = Date.now();
  const updateElapsed = () => { const seconds = Math.floor((Date.now() - started) / 1000); $('loading-detail').textContent = `${sizeText(file.size)} · ${Math.floor(seconds / 60)}분 ${seconds % 60}초 경과${file.size >= 32 * 1024 * 1024 ? ' · 큰 어셈블리는 몇 분이 걸릴 수 있습니다.' : ''}`; };
  updateElapsed(); importClock = setInterval(updateElapsed, 1000);
  const completion=new Promise(resolve=>{importDone=resolve;});
  const fail = (message) => { if (token !== importToken) return; stopImport(); toast(message, true); $('status-text').textContent = '파일을 불러오지 못했습니다'; };
  const startWorker = (recovery = false, metadata) => {
    worker?.terminate();
    const current = new Worker(recovery ? 'step-recovery-worker.js' : 'import-worker.js', recovery ? { type: 'module' } : undefined);
    worker = current;
    current.onerror = () => { if (worker === current) fail('CAD 엔진 실행에 실패했습니다. 파일이 너무 크거나 메모리가 부족할 수 있습니다.'); };
    current.onmessage = ({ data }) => {
    if (token !== importToken) return;
    if (worker !== current) return;
    if (data.type === 'progress') $('loading-text').textContent = data.text;
    if (data.type === 'recover' && !recovery) {
      $('loading-text').textContent = '어셈블리 표면을 생성하지 못해 부품별 호환 처리로 다시 시도합니다…';
      startWorker(true, data.metadata); return;
    }
    if (data.type === 'error') fail(data.message);
    if (data.type === 'success') {
      try { buildModel(data, file,{bytes:file.bytes instanceof Uint8Array?file.bytes:new Uint8Array(file.bytes)}); stopImport();if(data.recovered)toast(`부품별 호환 처리로 ${data.meshes.length}개 부품을 열었습니다.${data.omitted ? ` ${data.omitted}개 부품은 누락되었습니다. 편집 패널의 가져오기 정보를 확인하세요.` : ''}`,!!data.omitted); }
      catch { fail('3D 화면 생성에 실패했습니다. 더 작은 STEP 파일로 다시 시도해 주세요.'); }
    }
    };
    const bytes = new Uint8Array(file.bytes);
    current.postMessage({ bytes: bytes.buffer, quality: 'standard', metadata }, [bytes.buffer]);
  };
  startWorker();
  await completion;
}
async function openFile() { try { await loadFile(await window.desktop.chooseFile()); } catch { toast('파일 선택 창을 열 수 없습니다.', true); } }
async function savePNG() {
  if (!activeFile) return;
  try {
    renderer.setClearColor(0x1b2939, 1); renderer.render(scene, camera);
    const png = canvas.toDataURL('image/png');
    renderer.setClearColor(0x182535, 0); dirty = true;
    const result = await window.desktop.savePNG(png, activeFile.name);
    if (result?.saved) toast('PNG 이미지를 저장했습니다.'); if (result?.error) toast(result.error, true);
  } catch { renderer.setClearColor(0x182535, 0); dirty = true; toast('이미지를 저장하지 못했습니다.', true); }
}
const actions = { settings:openSettings, open: openFile, fit: () => parts.length && frame(), iso: () => parts.length && view('iso'), front: () => parts.length && view('front'), top: () => parts.length && view('top'), right: () => parts.length && view('right'), save: savePNG, project:saveProject,convert:showConvert,undo:()=>historyMove(false),redo:()=>historyMove(true), help: () => !$('help-dialog').open && $('help-dialog').showModal() };
Object.entries(actions).forEach(([name, handler]) => $(name).addEventListener('click', handler));
actions['close-tab']=()=>closeDocument();actions['next-tab']=()=>cycleDocument(1);actions['previous-tab']=()=>cycleDocument(-1);
$('tab-open').onclick=openFile;
$('welcome-open').addEventListener('click', openFile);
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) { const rect = $('help-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help-dialog').close(); } });
$('demo').addEventListener('click', async () => { try { const response = await fetch('demo.step'); if (!response.ok) throw new Error(); const bytes = new Uint8Array(await response.arrayBuffer()); await loadFile({ name: 'Precision Bracket.step', bytes, size: bytes.byteLength }); } catch { toast('예제 파일을 열 수 없습니다.', true); } });
$('cancel').addEventListener('click', () => { if(batchJob){cancelBatchExport();return;}if(processingFiles)cancelOpenFiles();else cancelCad(); });
for (const mode of ['shaded', 'wire', 'transparent']) $(mode).addEventListener('click', () => setDisplay(mode));
$('grid').addEventListener('click', () => { gridVisible = !gridVisible; if (grid) grid.visible = gridVisible; $('grid').classList.toggle('active', gridVisible); $('grid').setAttribute('aria-pressed', gridVisible); dirty = true; });
$('projection').addEventListener('click', () => {
  const previous = camera; camera = camera === orthographic ? perspective : orthographic;
  camera.position.copy(previous.position); camera.quaternion.copy(previous.quaternion); controls.object = camera;
  $('projection').textContent = camera === orthographic ? '평행 투영' : '원근 투영';
  frame();
});
$('show-all').addEventListener('click', () => { parts.forEach((part) => setVisibility(part.id, true)); frame(); });
$('isolate').addEventListener('click', () => { if (!selectedIds.size) return; parts.forEach(part => setVisibility(part.id, selectedIds.has(part.id))); frame(); });
$('focus').addEventListener('click', () => { if (!selectedIds.size) return; const box = new THREE.Box3(); parts.filter(part => selectedIds.has(part.id)).forEach(part => { setVisibility(part.id, true); box.union(partBounds(part)); }); frame(box); });
$('export-selected').addEventListener('click', () => showConvert('selected'));
function filterTree() {
  const query = $('search').value.trim().toLocaleLowerCase();
  document.querySelectorAll('.part-row').forEach((row) => { row.hidden = !row.dataset.name.includes(query); });
  [...$('tree').querySelectorAll('details')].reverse().forEach((group) => { group.hidden = !group.querySelector('.part-row:not([hidden])'); if (query) group.open = true; });
}
$('search').addEventListener('input', filterTree);
$('recent').addEventListener('click', async () => {
  const menu = $('recent-menu');
  if (!menu.hidden) { menu.hidden = true; $('recent').setAttribute('aria-expanded', false); return; }
  const entries = await window.desktop.recentFiles(); menu.replaceChildren();
  if (!entries.length) { const empty = document.createElement('p'); empty.textContent = '최근에 연 파일이 없습니다.'; menu.append(empty); }
  for (const entry of entries) {
    const button = document.createElement('button'), name = document.createElement('span'), detail = document.createElement('small'); name.textContent = entry.name; detail.textContent = entry.path;
    button.append(name, detail); button.title = entry.path; button.addEventListener('click', async () => { menu.hidden = true; $('recent').setAttribute('aria-expanded', false); await loadFile(await window.desktop.openRecent(entry.id)); }); menu.append(button);
  }
  menu.hidden = false; $('recent').setAttribute('aria-expanded', true);
});
document.addEventListener('click', (event) => { if (!event.target.closest('.menu-wrap')) { $('recent-menu').hidden = true; $('recent').setAttribute('aria-expanded', false); } });
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
let pointerStart,gesture=false;
const activePointers=new Set();
canvas.addEventListener('pointerdown', (event) => {
  activePointers.add(event.pointerId);
  if(activePointers.size>1){gesture=true;pointerStart=null;return;}
  gesture=false;pointerStart={x:event.clientX,y:event.clientY,button:event.button,id:event.pointerId};
});
canvas.addEventListener('pointermove',event=>{if(pointerStart?.id===event.pointerId&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>8)gesture=true;});
canvas.addEventListener('pointercancel',event=>{activePointers.delete(event.pointerId);pointerStart=null;gesture=true;});
function pick(event) {
  const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(parts.filter((part) => part.mesh.visible).map((part) => part.mesh), false)[0];
}
canvas.addEventListener('pointerup', event => {
  if (!busy && !gesture && activePointers.size===1 && pointerStart?.id===event.pointerId && pointerStart?.button === 0 && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 8) {
    const hit = pick(event); selectPart(hit?.object.userData.id ?? null, event.shiftKey || window.stepViewerMobile?.multiSelect);
    if (hit && cadDoc && selectedIds.size === 1 && selected === hit.object.userData.id) {
      const part = parts.find(p => p.id === selected);
      selectedFace = part.source.faces.find(f => hit.faceIndex >= f.first && hit.faceIndex <= f.last)?.faceIndex ?? null; showFace(); updateEditor();
    }
  }
  activePointers.delete(event.pointerId);pointerStart = null;
});
canvas.addEventListener('dblclick', event => { if (busy || event.shiftKey || window.stepViewerMobile?.multiSelect || event.pointerType==='touch') return; const hit = pick(event); if (hit) { selectPart(hit.object.userData.id); frame(partBounds(parts.find(p=>p.id===hit.object.userData.id))); } });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if(event.key==='Delete'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!document.querySelector('dialog[open]')&&!event.target.closest('input,textarea,select,[contenteditable]')){event.preventDefault();deleteSelectedParts();return;}
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&(event.key==='Tab'||event.key.toLowerCase()==='w')){
    event.preventDefault();if(document.querySelector('dialog[open]'))return;
    if(event.key==='Tab')cycleDocument(event.shiftKey?-1:1);else closeDocument();return;
  }
  if (event.key === 'Escape') { if (document.querySelector('dialog[open]')) return; if (processingFiles)cancelOpenFiles();else if(cadPending)cancelCad(); else if(!busy)selectPart(null); $('recent-menu').hidden = true; }
});
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
document.addEventListener('drop', async (event) => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files]; if (!files.length) return;
  const supported=files.filter(file=>[...EXTENSIONS,'svcad'].includes(extension(file.name)));
  if(supported.length!==files.length)toast('지원되지 않는 파일은 건너뜁니다.',true);
  try { await loadFile(supported.map(file=>window.desktop.droppedReference(file))); } catch { toast('파일을 읽지 못했습니다. 파일 열기 버튼으로 다시 선택해 주세요.', true); }
});
window.desktop.onFile(loadFile);
window.desktop.onAction((name) => { if(name==='busy-close'){toast('파일 처리 또는 저장 중입니다. 작업을 마치거나 취소한 뒤 종료해 주세요.',true);return;} if (document.activeElement?.tagName === 'INPUT' && ['fit', 'iso', 'front', 'top', 'right'].includes(name)) return; actions[name]?.(); });
window.desktop.startupFile().then(loadFile).catch(() => toast('시작 파일을 불러오지 못했습니다.', true));
canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); toast('그래픽 연결이 끊어졌습니다. 앱을 다시 실행해 주세요.', true); });

function partBounds(part){return part.mesh.geometry.boundingBox.clone().translate(part.mesh.position);}
function clearFaceOverlay(){if(faceOverlay){faceOverlay.parent?.remove(faceOverlay);faceOverlay.geometry.dispose();faceOverlay.material.dispose();faceOverlay=null;}}
function showFace(){clearFaceOverlay();const p=parts.find(p=>p.id===selected);if(!p||selectedIds.size!==1||selectedFace===null)return;const group=p.source.faces.find(f=>f.faceIndex===selectedFace);if(!group)return;const g=new THREE.BufferGeometry();g.setAttribute('position',p.mesh.geometry.getAttribute('position'));g.setIndex(Array.from(p.source.indices.slice(group.first*3,(group.last+1)*3)));faceOverlay=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:'#8affd8',transparent:true,opacity:.42,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));faceOverlay.raycast=()=>{};p.mesh.add(faceOverlay);dirty=true;}
function updateAssemblyOptions(value='0'){
  const {depth}=assemblyDepth(parts.map(part=>part.source));$('explode-unit').replaceChildren(new Option('개별 부품','0'));
  for(let i=1;i<=depth;i++)$('explode-unit').add(new Option(`조립품 ${i}단계 · 내부 배치 유지`,String(i)));
  $('explode-unit').value=Number(value)<=depth?String(value):'0';$('assembly-layout-note').hidden=!depth;
}
function applyLayout(){
  if(!parts.length)return;const value=Number($('explode').value)/100,base=new THREE.Box3();for(const p of parts)base.union(p.mesh.geometry.boundingBox);const max=Math.max(...base.getSize(new THREE.Vector3()).toArray(),1);
  const {skip}=assemblyDepth(parts.map(part=>part.source)),units=new Map();for(const part of parts){const key=assemblyUnit(part.source,Number($('explode-unit').value),skip);if(!units.has(key))units.set(key,{box:new THREE.Box3(),parts:[]});const unit=units.get(key);unit.box.union(part.mesh.geometry.boundingBox);unit.parts.push(part);}
  const groups=[...units.values()],columns=Math.ceil(Math.sqrt(groups.length)),rows=Math.ceil(groups.length/columns);let cell=1;for(const unit of groups)cell=Math.max(cell,...unit.box.getSize(new THREE.Vector3()).toArray());cell*=1.35+value;
  groups.forEach((unit,i)=>{const center=unit.box.getCenter(new THREE.Vector3()),offset=new THREE.Vector3();if(layout==='explode'){const direction=center.clone();if(direction.length()<max*.04)direction.set(Math.cos(i*2.39996),Math.sin(i*2.39996),.3);offset.copy(direction.normalize().multiplyScalar(max*value*.85));}if(layout==='grid')offset.set((i%columns-(columns-1)/2)*cell,0,(rows-1)/2*cell-Math.floor(i/columns)*cell).sub(center);unit.parts.forEach(part=>part.mesh.position.copy(offset));});
  for(const mode of ['assembly','explode','grid'])$(`layout-${mode}`).classList.toggle('active',layout===mode);$('explode-value').textContent=`${Math.round(value*100)}%`;$('explode').disabled=layout==='assembly';dirty=true;
}
for(const mode of ['assembly','explode','grid'])$(`layout-${mode}`).onclick=()=>{layout=mode;if(mode!=='assembly'&&!Number($('explode').value))$('explode').value=45;applyLayout();frame();};
$('explode').oninput=()=>{if(layout==='assembly')layout='explode';applyLayout();frame();};
$('explode-unit').onchange=()=>{applyLayout();frame();};
function nextPart(delta){if(!parts.length)return;const index=parts.findIndex(p=>p.id===selected),p=parts[(index+delta+parts.length)%parts.length];selectPart(p.id);for(const other of parts)setVisibility(other.id,other.id===p.id);selectPart(p.id);frame();}
$('next-part').onclick=()=>nextPart(1);$('prev-part').onclick=()=>nextPart(-1);

function updateDirty(){const changed=revision!==savedRevision;if(activeDocument)activeDocument.changed=changed;window.desktop.setDirty(documents.some(doc=>doc.changed));$('title-file').toggleAttribute('data-user-text',!!activeFile);$('title-file').textContent=(changed?'● ':'')+(activeFile?.name||'3D CAD 뷰어');$('undo').disabled=!undoStack.length||busy;$('redo').disabled=!redoStack.length||busy;$('model-mode').textContent=(cadDoc?'정밀 CAD':'메시 / 드로잉')+(changed?' · 수정됨':'');renderTabs();}
function resetDocument(){cadDoc=null;sourceBytes=null;undoStack=[];redoStack=[];revision=savedRevision=++revisionCounter;selectedFace=null;cancelCad();updateDirty();}
function snapshot(){return {data:modelData||{meshes:[],root:{meshes:[],children:[]},center:[0,0,0],min:[0,0,0],max:[0,0,0],triangles:0},doc:cadDoc,sourceBytes,revision,selected,selectedIds:[...selectedIds],selectedFace,file:activeFile||{name:'Untitled.step',size:0}};}
function memoryCost(state){return(state.data?.meshes||[]).reduce((n,m)=>n+m.positions.byteLength+m.indices.byteLength+(m.normals?.byteLength||0),0)+(state.doc||[]).reduce((n,d)=>n+d.brep.length*2,0);}
function trimHistory(){while(undoStack.length>12||undoStack.length>1&&undoStack.reduce((n,s)=>n+memoryCost(s),0)>128*1024*1024)undoStack.shift();}
function commit(data,doc,label,old=snapshot()){
  if(!activeDocument)buildModel(old.data,old.file,{doc:old.doc,bytes:old.sourceBytes});
  undoStack.push(old);redoStack=[];trimHistory();cadDoc=doc;sourceBytes=doc?null:old.sourceBytes;if(sourceBytes&&old.data.stepSource)data={...data,stepSource:{...old.data.stepSource,pristine:false}};revision=++revisionCounter;const key=old.data?.meshes.find(m=>m.id===old.selected)?.key;buildModel(data,activeFile||{name:'Untitled.step',size:0});const selection=key?parts.find(p=>p.source.key===key)?.id:parts.find(p=>p.id===old.selected)?.id;if(selection!==undefined)selectPart(selection);updateDirty();$('status-text').textContent=label;toast(label);
}
function historyMove(redo){if(busy)return;const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;if(!from.length)return;to.push(snapshot());const state=from.pop();cadDoc=state.doc;sourceBytes=state.sourceBytes;revision=state.revision;buildModel(state.data,state.file);selectedIds.clear();const restored=new Set(state.selectedIds||[state.selected]);for(const part of parts)if(restored.has(part.id))selectedIds.add(part.id);selected=selectedIds.has(state.selected)?state.selected:[...selectedIds].at(-1)??null;selectedFace=selectedIds.size===1?state.selectedFace:null;showFace();renderSelection();updateDirty();}
function setBusy(value,text='CAD 형상을 계산하고 있습니다…') {busy=value;window.desktop.setWorking(value||tabPrompt);controls.enabled=!value;$('loading').hidden=!value;$('loading-text').textContent=text;$('open').disabled=value;document.querySelectorAll('#editor button,#convert,#project').forEach(b=>b.disabled=value);updateDirty();renderSelection();if(!modelData)setModelControls(false);if(!value)queueMicrotask(drainOpenQueue);}
function cancelCad(){if(cadPending){clearTimeout(cadPending.timer);cadPending.reject(new Error('CAD 작업을 취소했습니다. 이전 모델을 유지합니다.'));cadPending=null;cadWorker?.terminate();cadWorker=null;}}
function cadCall(action,args={},doc=cadDoc){
  if(cadPending)return Promise.reject(new Error('CAD 작업이 진행 중입니다.'));
  // Requests carry their complete BRep document. Keeping the previous WASM
  // engine alive only retains its native allocations and duplicates that data.
  cadWorker?.terminate();cadWorker=null;
  const worker=new Worker('cad-worker.js',{type:'module'});cadWorker=worker;
  return new Promise((resolve,reject)=>{
    const inputSize=args.bytes?.byteLength||(action==='import'?sourceBytes?.byteLength||0:action==='mesh-import'?args.meshes.reduce((n,m)=>n+m.positions.byteLength+m.indices.byteLength,0):(doc||[]).reduce((total,item)=>total+item.brep.length,0));
    const id=++cadRequestId,timer=setTimeout(cancelCad,inputSize>32*1024*1024?300000:120000);
    cadPending={id,resolve,reject,timer};
    const finish=(error,result)=>{
      if(cadPending?.id!==id)return;
      cadPending=null;clearTimeout(timer);worker.terminate();if(cadWorker===worker)cadWorker=null;
      if(error){const message=/memory access out of bounds|out of memory|cannot enlarge memory|allocation failed/i.test(error.message||'')?'CAD 엔진의 메모리 오류로 작업을 중단했습니다. 편집 내용은 유지되며, 다시 시도하면 새 엔진을 사용합니다.':error.message;reject(new Error(message));}
      else resolve(result);
    };
    worker.onmessage=({data})=>{if(cadPending?.id!==id||data.id!==id)return;if(data.type==='progress'){$('loading-text').textContent=data.text;return;}finish(data.type==='error'?new Error(data.message):null,data);};
    worker.onerror=()=>finish(new Error('CAD 엔진을 실행하지 못했습니다. 메모리와 파일을 확인해 주세요.'));
    try{worker.postMessage({id,action,doc,args:action==='import'?{}:args,bytes:action==='import'?(args.bytes||sourceBytes):undefined});}catch(error){finish(error);}
  });
}
function matchCadAppearance(result,previous){
  const box=(m,center)=>{const b=new THREE.Box3();for(let i=0;i<m.positions.length;i+=3)b.expandByPoint(new THREE.Vector3(m.positions[i]+center[0],m.positions[i+1]+center[1],m.positions[i+2]+center[2]));return b;};
  const candidates=previous.meshes.filter(m=>m.primitive!=='lines').map(m=>({m,box:box(m,previous.center)}));
  let unmatched=0;
  result.preview.meshes.forEach((m,i)=>{const b=box(m,result.preview.center),size=Math.max(b.getSize(new THREE.Vector3()).length(),.01);const matches=candidates.filter(c=>!c.used).map(c=>({c,score:(b.min.distanceTo(c.box.min)+b.max.distanceTo(c.box.max))/size})).sort((a,b)=>a.score-b.score);const best=matches[0];if(best&&best.score<.05&&(!matches[1]||matches[1].score-best.score>1e-6)){best.c.used=true;const name=best.c.m.name,color=best.c.m.color||[.48,.7,.75],path=assemblyPath(best.c.m.assemblyPath);result.doc[i]={...result.doc[i],name,color,assemblyPath:path};m.name=name;m.color=color;m.assemblyPath=path;}else unmatched++;});
  result.preview.root=assemblyTree(result.preview.meshes);
  if(unmatched)result.preview.warnings=[`${unmatched}개 형상은 원본 부품과 일대일로 대응하지 않아 조립 트리에 임의로 배정하지 않았습니다. 해당 형상은 최상위에 표시합니다.`];
}
async function enableCad(){
  if(cadDoc)return true;if(!modelData?.meshes.length){toast('STEP / 메시 파일을 열거나 새 CAD 문서를 만들어 주세요.',true);return false;}
  if(busy)return false;const old=snapshot(),faceted=!(sourceBytes&&sourceDescriptor(modelData));setBusy(true);
  try{const descriptor=sourceBytes&&sourceDescriptor(modelData);const result=descriptor?await cadCall('preview',{},(await cadCall('source-doc',{bytes:sourceBytes,descriptor},null)).doc):await cadCall('mesh-import',{meshes:absoluteMeshes(modelData)},null);if(!descriptor)matchCadAppearance(result,old.data);commit(result.preview,result.doc,faceted?'메시를 삼각형 면 CAD로 변환했습니다. 원래 곡면은 복원되지 않습니다.':'정밀 CAD 편집을 시작했습니다. 대응 가능한 부품의 조립 트리를 유지합니다.',old);return true;}
  catch(e){toast(e.message,true);return false;}finally{setBusy(false);updateEditor();}
}
async function newCad(){if(busy||tabPrompt)return;buildModel({meshes:[],root:{meshes:[],children:[]},center:[0,0,0],min:[0,0,0],max:[0,0,0],triangles:0},{name:'Untitled.step',size:0},{doc:[]});$('editor').hidden=false;$('edit-toggle').classList.add('active');$('cad-action').value='addBox';renderCadFields();updateEditor();}
$('new-cad').onclick=newCad;$('new-document').onclick=newCad;$('enable-cad').onclick=enableCad;
$('edit-toggle').onclick=()=>{$('editor').hidden=!$('editor').hidden;$('edit-toggle').classList.toggle('active',!$('editor').hidden);};$('close-editor').onclick=()=>{$('editor').hidden=true;$('edit-toggle').classList.remove('active');};

function fields(container,items){$(container).replaceChildren();for(const [name,label,value]of items){const wrap=document.createElement('label');wrap.className='field';wrap.textContent=label;const input=document.createElement('input');input.type='number';input.step='any';input.value=value;input.name=name;input.id=`${container}-${name}`;input.setAttribute('aria-label',label);wrap.append(input);$(container).append(wrap);}}
function values(container){const data={};for(const input of $(container).querySelectorAll('input')){const n=Number(input.value);if(input.value.trim()===''||!Number.isFinite(n)||Math.abs(n)>1e8)throw new Error('유효한 수치를 입력해 주세요.');data[input.name]=n;}return data;}
fields('transform-fields',[['x','이동 X',0],['y','이동 Y',0],['z','이동 Z',0],['rx','회전 X',0],['ry','회전 Y',0],['rz','회전 Z',0],['scale','배율',1]]);
fields('drawing-fields',[['x','X',0],['y','Y',0],['z','Z',0],['width','너비 / ΔX',20],['depth','높이 / ΔY',20],['radius','반지름',10]]);
fields('vertex-fields',[['x','X (mm)',0],['y','Y (mm)',0],['z','Z (mm)',0]]);
function renderCadFields(){const op=$('cad-action').value;let items=[];if(op.startsWith('add'))items=[['x','X (mm)',0],['y','Y (mm)',0],['z','Z (mm)',0]];if(['addBox','addPlane'].includes(op))items.push(['width','너비',20],['depth','깊이',20]);if(['addBox','addCylinder'].includes(op))items.push(['height','높이',20]);if(['addCylinder','addSphere'].includes(op))items.push(['radius','반지름',10]);if(['fillet','chamfer'].includes(op))items.push(['radius','반경 / 거리',1]);if(['extrudeFace','thickenFace'].includes(op))items.push(['distance','거리 (mm)',op==='extrudeFace'?5:2]);fields('cad-fields',items);$('tool-label').hidden=$('remove-tool-label').hidden=!['fuse','cut','intersect'].includes(op);updateEditor();}
$('cad-action').onchange=renderCadFields;renderCadFields();
function updateEditor(){
  const p=selectedIds.size===1?parts.find(p=>p.id===selected):null;$('enable-cad').hidden=!!cadDoc;$('enable-cad').textContent=sourceBytes?'정밀 CAD 편집 시작':'메시를 CAD 면으로 변환';$('cad-note').textContent=sourceBytes?'STEP 원본의 솔리드·서페이스를 읽고 대응 가능한 부품의 조립 트리를 유지합니다.':'삼각형을 평면 CAD 면으로 변환합니다. 원래 곡면은 복원되지 않으며 선 객체는 지원하지 않습니다. 큰 메시는 STEP 내보내기를 권장합니다.';$('cad-note').hidden=!!cadDoc;$('edit-mode-note').textContent=cadDoc?'정밀 CAD 모드 · 솔리드/서페이스 형상을 편집하고 STEP으로 보존합니다.':'메시 / 드로잉 모드 · 부품 이동·회전·배율, 이름·색상, 선의 꼭짓점을 수정합니다.';
  $('part-name-edit').value=p?.name||'';$('part-color').value='#'+(p?.source.color||[.48,.7,.75]).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const previousTool=$('tool-part').value;$('tool-part').replaceChildren();for(const other of parts.filter(o=>o.id!==selected)){const option=document.createElement('option');option.value=other.source.key||String(other.id);option.textContent=other.name;$('tool-part').append(option);}if([...$('tool-part').options].some(o=>o.value===previousTool))$('tool-part').value=previousTool;
  $('face-select').replaceChildren(new Option('화면의 면을 클릭하세요',''));if(cadDoc&&p?.source.surfaceTypes)for(const [i,type]of p.source.surfaceTypes.entries())$('face-select').add(new Option(`면 ${i+1} · ${type}`,String(i)));$('face-select').value=selectedFace===null?'':String(selectedFace);
  $('multi-edit-note').hidden=selectedIds.size<2;
  for(const id of ['rename-part','transform','duplicate','edit-vertex','face-select'])$(id).disabled=busy||selectedIds.size!==1;
  $('delete-part').disabled=busy||tabPrompt||!selectedIds.size;
  $('apply-cad').disabled=busy||(selectedIds.size>1&&!$('cad-action').value.startsWith('add'));
}
$('face-select').onchange=()=>{selectedFace=$('face-select').value===''?null:Number($('face-select').value);showFace();};
function selectedPart(){if(selectedIds.size>1)throw new Error('개별 편집은 부품 하나만 선택해 주세요.');const p=parts.find(p=>p.id===selected);if(!p)throw new Error('먼저 부품을 선택해 주세요.');return p;}
async function transformPart(action){if(busy)return;try{const p=selectedPart(),args=values('transform-fields');if(args.scale<=0)throw new Error('배율은 0보다 커야 합니다.');const pivot=p.mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).add(new THREE.Vector3(...modelData.center));if(cadDoc){const old=snapshot();setBusy(true);try{const r=await cadCall(action,{...args,key:p.source.key,pivot:pivot.toArray()});commit(r.preview,r.doc,action==='duplicate'?'부품을 복제했습니다.':'부품 변환을 적용했습니다.',old);}finally{setBusy(false);}}else{const meshes=absoluteMeshes(modelData),source=meshes.find(m=>m.id===selected),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(source.positions,3));const matrix=new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z);matrix.premultiply(new THREE.Matrix4().makeScale(args.scale,args.scale,args.scale));for(const [axis,key]of[['X','rx'],['Y','ry'],['Z','rz']])matrix.premultiply(new THREE.Matrix4()[`makeRotation${axis}`](THREE.MathUtils.degToRad(args[key])));matrix.premultiply(new THREE.Matrix4().makeTranslation(pivot.x+args.x,pivot.y+args.y,pivot.z+args.z));g.applyMatrix4(matrix);const changed={...source,positions:g.getAttribute('position').array.slice(),normals:null,...(source.stepOrigin?{stepOrigin:{...source.stepOrigin,transforms:[...source.stepOrigin.transforms,{...args,pivot:pivot.toArray()}]}}:{})};g.dispose();if(action==='duplicate'){changed.name+=' 복제';meshes.push(changed);}else meshes[meshes.indexOf(source)]=changed;commit(normalizeMeshes(meshes),null,'부품 변환을 적용했습니다.');}}catch(e){toast(e.message,true);}}
$('transform').onclick=()=>transformPart('transform');$('duplicate').onclick=()=>transformPart('duplicate');
function deleteSelectedParts(){
  if(busy||tabPrompt||!modelData||!selectedIds.size)return;
  try{const old=snapshot(),result=removeParts(modelData,cadDoc,selectedIds);commit(result.data,result.doc,`${result.count}개 부품을 삭제했습니다. Ctrl+Z로 되돌릴 수 있습니다.`,old);selectPart(null);}
  catch(error){toast(error.message,true);}
}
$('delete-part').onclick=$('delete-selected').onclick=deleteSelectedParts;
$('rename-part').onclick=()=>{if(busy)return;try{const p=selectedPart(),name=$('part-name-edit').value.trim().slice(0,120);if(!name)throw new Error('부품 이름을 입력해 주세요.');const rgb=new THREE.Color($('part-color').value).convertLinearToSRGB().toArray();const data={...modelData,meshes:modelData.meshes.map(m=>m.id===selected?{...m,name,color:rgb,faces:m.faces.map(f=>({...f,color:null}))}:m)};const doc=cadDoc?.map(d=>d.key===p.source.key?{...d,name,color:rgb}:d)||null;commit(data,doc,'부품 이름과 색상을 적용했습니다.');}catch(e){toast(e.message,true);}};
$('apply-cad').onclick=async()=>{if(busy)return;const op=$('cad-action').value;if(!op.startsWith('add')&&selectedIds.size>1){toast('개별 편집은 부품 하나만 선택해 주세요.',true);return;}if(!cadDoc&&!(await enableCad()))return;try{const args=values('cad-fields');if(!op.startsWith('add'))args.key=selectedPart().source.key;args.toolKey=$('tool-part').value;args.removeTool=$('remove-tool').checked;args.faceIndex=selectedFace;const old=snapshot();setBusy(true);try{const r=await cadCall(op,args);commit(r.preview,r.doc,'CAD 형상 편집을 적용했습니다.',old);}finally{setBusy(false);}}catch(e){toast(e.message,true);}};
$('add-drawing').onclick=()=>{if(busy)return;try{if(cadDoc?.length)throw new Error('드로잉 추가는 메시/드로잉 모드에서 사용합니다. CAD 모드에서는 평면 서페이스 추가를 사용해 주세요.');const a=values('drawing-fields'),op=$('drawing-action').value;let points=[],indices=[];if(op==='rectangle'){if(a.width<=0||a.depth<=0)throw new Error('너비와 높이는 0보다 커야 합니다.');points=[[a.x,a.y,a.z],[a.x+a.width,a.y,a.z],[a.x+a.width,a.y+a.depth,a.z],[a.x,a.y+a.depth,a.z]];indices=[0,1,1,2,2,3,3,0];}else if(op==='circle'){if(a.radius<=0)throw new Error('반지름은 0보다 커야 합니다.');for(let i=0;i<96;i++){points.push([a.x+a.radius*Math.cos(i/96*Math.PI*2),a.y+a.radius*Math.sin(i/96*Math.PI*2),a.z]);indices.push(i,(i+1)%96);}}else{points=[[a.x,a.y,a.z],[a.x+a.width,a.y+a.depth,a.z]];indices=[0,1];}const meshes=modelData?absoluteMeshes(modelData):[];meshes.push({name:({line:'선',rectangle:'사각형',circle:'원'})[op],positions:points.flat(),indices,primitive:'lines'});commit(normalizeMeshes(meshes),null,'드로잉을 추가했습니다.');}catch(e){toast(e.message,true);}};
$('edit-vertex').onclick=()=>{if(busy)return;try{const p=selectedPart();if(cadDoc||p.source.primitive!=='lines')throw new Error('선 객체를 선택해 주세요.');const i=Number($('vertex-index').value)-1;if(!Number.isInteger(i)||i<0||i>=p.source.positions.length/3)throw new Error(`꼭짓점 번호는 1~${p.source.positions.length/3}입니다.`);const a=values('vertex-fields'),meshes=absoluteMeshes(modelData);const m=meshes.find(m=>m.id===p.id);m.positions.set([a.x,a.y,a.z],i*3);commit(normalizeMeshes(meshes),null,'선의 꼭짓점을 수정했습니다.');}catch(e){toast(e.message,true);}};

for(const f of FORMATS)$('export-format').add(new Option(f.label,f.ext));
function exportNote(){const ext=$('export-format').value;$('export-note').textContent=FORMATS.find(f=>f.ext===ext).note;$('projection-label').hidden=!['dxf','dwg'].includes(ext);$('step-geometry-label').hidden=ext!=='step';$('export-status').textContent='';}
$('export-format').onchange=exportNote;exportNote();
function exportPartIds(){const scope=$('export-scope').value;return parts.filter(p=>scope==='selected'?selectedIds.has(p.id):scope==='visible'?p.mesh.visible:true).map(p=>p.id);}
function updateExportScope(){
  const chosen=exportPartIds(),chosenSet=new Set(chosen),separate=$('export-layout').value==='separate';
  $('export-scope').querySelector('[value=selected]').textContent=`선택한 부품 (${selectedIds.size}개)`;
  $('export-selection-summary').textContent=chosen.length?`${chosen.length}개 부품을 ${separate?chosen.length+'개의 파일로 각각':'한 파일에'} 저장합니다: ${parts.filter(p=>chosenSet.has(p.id)).slice(0,4).map(p=>p.name).join(', ')}${chosen.length>4?' 외 '+(chosen.length-4)+'개':''}`:'저장할 부품이 없습니다. Shift+클릭으로 부품을 선택해 주세요.';
  $('batch-export-note').hidden=!separate;
  $('export-run').textContent=separate?'폴더 선택 후 부품별 저장…':'변환하고 저장…';
  $('export-run').disabled=busy||!chosen.length;
}
$('export-scope').onchange=$('export-layout').onchange=()=>{updateExportScope();$('export-status').textContent='';};
function showConvert(scope){if(!modelData||busy)return;$('export-scope').value=typeof scope==='string'?scope:selectedIds.size>1?'selected':'all';exportNote();updateExportScope();if(!$('convert-dialog').open)$('convert-dialog').showModal();}
$('close-convert').onclick=()=>{if(!busy)$('convert-dialog').close();};
$('convert-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
function cancelBatchExport(){if(!batchJob)return;batchJob.cancel=true;$('export-cancel').disabled=true;$('export-cancel').textContent='현재 부품 처리 후 중단…';}
$('export-cancel').onclick=cancelBatchExport;
async function encodeParts(ids,ext,scope,projection,combined){
  if(ext==='step'&&$('step-geometry').value==='mesh')return {kind:'mesh-step',meshes:absoluteMeshes(modelData,ids)};
  if(ext==='step'&&exportSourceCache)return (await cadCall('export',{},ids.map(id=>exportSourceCache.get(id)))).bytes;
  if(ext==='step'&&cadDoc){const chosen=new Set(ids),keys=new Set(modelData.meshes.filter(m=>chosen.has(m.id)).map(m=>m.key));const docs=cadDoc.filter(d=>keys.has(d.key));if(!docs.length)throw new Error('선택한 부품의 CAD 형상을 찾을 수 없습니다.');return (await cadCall('export',{},docs)).bytes;}
  if(combined&&ext==='step'&&sourceBytes&&scope==='all'&&modelData.stepSource?.pristine)return sourceBytes;
  if(ext==='step'){const descriptor=sourceBytes&&sourceDescriptor(modelData,ids);if(descriptor){const prepared=await cadCall('source-doc',{bytes:sourceBytes,descriptor},null);return (await cadCall('export',{},prepared.doc)).bytes;}return {kind:'mesh-step',meshes:absoluteMeshes(modelData,ids)};}
  return exportMesh(absoluteMeshes(modelData,ids),ext,{projection});
}
async function saveSeparate(ids,ext,scope,projection){
  const items=ids.map(id=>parts.find(p=>p.id===id)),state={cancel:false},results=[];batchJob=state;
  $('batch-progress').max=items.length;$('batch-progress').value=0;$('batch-progress').hidden=false;
  $('export-cancel').hidden=false;$('export-cancel').disabled=false;$('export-cancel').textContent='내보내기 중단';
  let job;
  try{
    job=await window.desktop.beginBatchExport(ext,items.map(p=>p.name));
    if(!job){$('batch-progress').hidden=true;$('export-status').textContent='폴더 선택을 취소했습니다.';return;}
    if(job.error){$('batch-progress').hidden=true;throw new Error(job.error);}
    for(let i=0;i<items.length;i++){
      if(state.cancel)break;
      const part=items[i];$('export-status').textContent=`${i+1} / ${items.length} 처리 중 · ${part.name}`;
      try{
        const bytes=await encodeParts([part.id],ext,scope,projection,false);
        const saved=await window.desktop.writeBatchExport(job.token,i,bytes);if(saved.error)throw new Error(saved.error);
        results.push({part:part.name,name:saved.name});
      }catch(error){results.push({part:part.name,error:error.message||'변환하지 못했습니다.'});}
      $('batch-progress').value=i+1;
    }
    const failed=results.filter(r=>r.error).length,saved=results.length-failed,remaining=items.length-results.length;
    const message=`${remaining?'내보내기 중단':'부품별 내보내기 완료'} · 저장 ${saved}개 · 실패 ${failed}개${remaining?' · 미처리 '+remaining+'개':''}`;
    $('export-status').textContent=message;$('batch-results-summary').textContent=`처리 결과 · ${job.folderName}`;
    $('batch-result-list').replaceChildren();
    for(const result of results){const li=document.createElement('li');li.textContent=result.error?`실패 · ${result.part}: ${result.error}`:`저장 · ${result.part} → ${result.name}`;if(result.error)li.className='export-failed';$('batch-result-list').append(li);}
    if(remaining){const li=document.createElement('li');li.textContent=`나머지 ${remaining}개 부품은 처리하지 않았습니다. 이미 저장된 파일은 유지됩니다.`;$('batch-result-list').append(li);}
    $('batch-results').hidden=false;$('batch-results').open=!!failed||!!remaining;toast(message,!!failed);
  }finally{
    if(job?.token){const ended=await window.desktop.endBatchExport(job.token);if(ended.error)throw new Error(ended.error);}
    batchJob=null;$('export-cancel').hidden=true;
  }
}
$('export-run').onclick=async()=>{
  if(busy)return;const ext=$('export-format').value,scope=$('export-scope').value,projection=$('drawing-projection').value,ids=exportPartIds();if(!ids.length){$('export-status').textContent='저장할 부품을 선택해 주세요.';return;}
  setBusy(true,'파일을 변환하고 있습니다…');$('export-status').textContent='변환 중…';$('batch-results').hidden=true;$('batch-progress').hidden=true;
  for(const id of ['export-format','export-scope','export-layout','drawing-projection','step-geometry'])$(id).disabled=true;
  try{
    if($('export-layout').value==='separate'){const descriptor=ext==='step'&&$('step-geometry').value!=='mesh'&&!cadDoc&&sourceBytes&&sourceDescriptor(modelData,ids);if(descriptor){const result=await cadCall('source-doc',{bytes:sourceBytes,descriptor},null);exportSourceCache=new Map(descriptor.parts.map((p,i)=>[p.id,result.doc[i]]));}await saveSeparate(ids,ext,scope,projection);}
    else{const bytes=await encodeParts(ids,ext,scope,projection,true);const r=await window.desktop.saveModel(bytes,ext,activeFile.name);if(r?.error)throw new Error(r.error);$('export-status').textContent=r?.saved?`${r.name} 저장 완료`:'저장을 취소했습니다.';if(r?.saved)toast(`${ext.toUpperCase()} 변환 파일을 저장했습니다.`);}
  }catch(error){$('export-status').textContent=error.message;toast(error.message,true);}
  finally{exportSourceCache=null;batchJob=null;$('export-cancel').hidden=true;for(const id of ['export-format','export-scope','export-layout','drawing-projection','step-geometry'])$(id).disabled=false;setBusy(false);updateExportScope();}
};
const toBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
function projectBytes(){const data={...modelData,meshes:modelData.meshes.map(m=>({...m,positions:Array.from(m.positions),indices:Array.from(m.indices),normals:m.normals?Array.from(m.normals):null}))};return new TextEncoder().encode(JSON.stringify({format:'STEPViewerProject',version:1,name:activeFile.name,data,cadDoc,sourceStep:sourceBytes?toBase64(sourceBytes):null}));}
async function saveProject(){if(!modelData||busy)return false;setBusy(true,'편집 프로젝트를 준비하고 있습니다…');try{const bytes=projectBytes();const r=await window.desktop.saveModel(bytes,'svcad',activeFile.name);if(r?.error)throw new Error(r.error);if(r?.saved){savedRevision=revision;toast('편집 프로젝트를 저장했습니다.');return true;}}catch(e){toast(e.message,true);}finally{setBusy(false);}return false;}
function openProject(file){const p=JSON.parse(new TextDecoder().decode(file.bytes));if(p.format!=='STEPViewerProject'||p.version!==1||!Array.isArray(p.data?.meshes)||!Array.isArray(p.data.center)||p.data.center.length!==3||!p.data.center.every(Number.isFinite))throw new Error('지원하는 STEP Viewer 프로젝트가 아닙니다.');retainAssembly(p.data);const meshes=p.data.meshes.map(m=>({...m,positions:m.positions.map((v,i)=>v+p.data.center[i%3])}));const data=meshes.length?normalizeMeshes(meshes):{meshes:[],center:[0,0,0],min:[0,0,0],max:[0,0,0],triangles:0,root:{meshes:[],children:[]}};if(p.cadDoc!==null&&(!Array.isArray(p.cadDoc)||p.cadDoc.some(d=>typeof d.brep!=='string'||typeof d.key!=='string'||!Array.isArray(d.color))))throw new Error('프로젝트의 CAD 형상이 잘못되었습니다.');if(p.cadDoc)for(const item of p.cadDoc){const mesh=p.data.meshes.find(m=>m.key===item.key);item.assemblyPath=assemblyPath(item.assemblyPath??mesh?.assemblyPath);}const bytes=p.sourceStep?Uint8Array.from(atob(p.sourceStep),c=>c.charCodeAt(0)):null;if(p.data.stepSource)data.stepSource=p.data.stepSource;buildModel(data,file,{doc:p.cadDoc,bytes});updateDirty();}

window.desktop.onMeshStepProgress(({part,parts,triangles,total})=>{if(busy)$('loading-text').textContent=`메시 STEP 저장: 부품 ${part} / ${parts} · ${Math.round(triangles/total*100)}%`;});
initUpdates();
