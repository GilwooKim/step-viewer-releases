import {Capacitor,registerPlugin} from '@capacitor/core';
import {validateFile,safeName,writePayload,EXPORT_EXTENSIONS} from './files.js';
import {selfTest} from './self-test.js';
const Native=registerPlugin('CADFiles');
const $=id=>document.getElementById(id);
let onFile=()=>{},onProgress=()=>{};
const batches=new Map();
const language=()=>localStorage.getItem('language')||(navigator.language.startsWith('ko')?'ko':'en');
async function readFile(reference){
  validateFile(reference);
  const response=await fetch(Capacitor.convertFileSrc(reference.path));
  if(!response.ok)throw new Error('파일을 읽지 못했습니다.');
  return {...reference,bytes:new Uint8Array(await response.arrayBuffer())};
}
const noConversion=async()=>({error:'이 변환은 Windows 버전에서 사용할 수 있습니다.'});
window.desktop={
  platform:'ipad',
  preferences:async()=>({language:language()}),
  setLanguage:async value=>{localStorage.setItem('language',value);return {language:value};},
  setWorking:async value=>Native.setWorking({value}),setDirty:async()=>{},setTitle:async()=>{},
  confirmCloseTab:async name=>(await Native.confirmClose({name})).choice,
  chooseFile:async()=>{const result=await Native.pick();return result.files||[];},
  openPath:async path=>readFile(await Native.describe({path})),
  droppedReference:file=>({name:file.name,size:file.size,bytes:null,browserFile:file}),
  recentFiles:async()=>[],openRecent:async()=>null,
  startupFile:async()=>{const r=await Native.startup();return r.files||[];},
  onFile:callback=>{onFile=callback;},onAction:()=>{},
  convertNative:noConversion,rhino:noConversion,
  saveModel:async(payload,ext,name)=>{
    const filename=safeName(name,ext),{token}=await Native.begin({names:[filename]});
    try{await writePayload(Native,token,0,payload,onProgress);return {...await Native.finish({token}),name:filename};}
    catch(error){await Native.abort({token});throw error;}
  },
  savePNG:async(data,name)=>window.desktop.saveModel(new Uint8Array(await (await fetch(data)).arrayBuffer()),'png',name),
  beginBatchExport:async(ext,names)=>{const files=names.map((n,i)=>safeName(n,ext,i+1));const {token}=await Native.begin({names:files});batches.set(token,files);return {token,folderName:'파일 앱 / Files'};},
  writeBatchExport:async(token,index,payload)=>{await writePayload(Native,token,index,payload,onProgress);return {name:batches.get(token)[index],saved:true};},
  endBatchExport:async token=>{try{const r=await Native.finish({token});return r.saved?r:{error:'파일 앱으로 내보내기를 취소했습니다.'};}finally{batches.delete(token);}},
  onMeshStepProgress:callback=>{onProgress=callback;},
  updateState:async()=>({currentVersion:'1.0.0 · iPad',status:'store',configured:false}),
  onUpdateState:()=>{},checkUpdates:async()=>{},downloadUpdate:async()=>{},installUpdate:async()=>{},setAutomaticUpdates:async()=>{}
};
window.stepViewerMobile={multiSelect:false};
const select=document.createElement('button');select.id='touch-select';select.textContent='다중 선택';select.setAttribute('aria-pressed','false');
select.onclick=()=>{const active=!window.stepViewerMobile.multiSelect;window.stepViewerMobile.multiSelect=active;select.setAttribute('aria-pressed',String(active));select.classList.toggle('active',active);};
const parts=document.createElement('button');parts.id='parts-toggle';parts.textContent='부품';parts.setAttribute('aria-expanded','false');
parts.onclick=()=>{const active=document.body.classList.toggle('parts-open');parts.setAttribute('aria-expanded',String(active));};
document.querySelector('.toolbar').prepend(parts,select);
document.querySelector('.selection-hint').textContent='다중 선택을 켜고 부품을 탭해 추가 / 해제';
document.querySelector('.interaction-hint').textContent='한 손가락 회전 · 두 손가락 이동 / 확대';
document.querySelector('.welcome-note').textContent='파일은 이 iPad에서만 처리됩니다.';
document.querySelector('.welcome-formats').textContent='STEP · STL · OBJ · GLB · 3MF · DXF · USDZ';
document.querySelector('.welcome p').textContent='파일 앱에서 CAD 파일을 선택하세요.';
$('recent').hidden=true;
$('canvas').setAttribute('aria-label','3D 모델. 한 손가락 회전, 두 손가락 이동과 확대, 탭으로 선택');
await Native.addListener('openFiles',event=>onFile(event.files));
await Native.addListener('memoryWarning',()=>{
  $('toast').hidden=false;$('toast').classList.add('error');$('toast').textContent='메모리가 부족합니다. 작업을 저장하고 사용하지 않는 파일 탭을 닫아 주세요.';
});
await import('../src/app.js');
for(const option of [...$('export-format').options])if(!EXPORT_EXTENSIONS.includes(option.value))option.remove();
document.querySelector('.update-toggle').hidden=true;
document.querySelector('.update-actions').hidden=true;
$('update-settings').querySelector('.subnote').textContent='iPad 앱 업데이트는 TestFlight 또는 App Store에서 설치합니다.';
$('update-status').textContent='TestFlight / App Store에서 업데이트를 확인하세요.';
document.querySelector('#help-dialog .help-note')?.insertAdjacentText('beforeend',' iPad: 한 손가락으로 회전, 두 손가락으로 이동·확대합니다. 여러 부품은 다중 선택을 켜고 탭하세요.');
window.stepViewerMobile.ready=true;
window.stepViewerMobile.selfTest=()=>selfTest(Native);
