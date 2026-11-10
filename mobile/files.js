export const MAX_IMPORT = 512 * 1024 * 1024;
export const CHUNK_SIZE = 256 * 1024;
export const IMPORT_EXTENSIONS = ['step','stp','stl','obj','glb','gltf','3mf','dxf','fbx','dae','3ds','usdz','svcad'];
export const EXPORT_EXTENSIONS = ['step','stl','obj','glb','3mf','dxf','usdz'];
export function validateFile(file) {
  if(!IMPORT_EXTENSIONS.includes(file.name.split('.').pop().toLowerCase()))throw new Error('이 형식은 iPad에서 지원하지 않습니다. STEP, STL, OBJ 또는 GLB로 변환해 주세요.');
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_IMPORT)throw new Error('iPad에서는 512MB 이하의 파일을 열 수 있습니다.');
}
export function safeName(name,ext,index=0) {
  const stem=String(name).replace(/\.[^.]+$/,'').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').trim().slice(0,100)||'Model';
  return `${index?String(index).padStart(4,'0')+'_':''}${stem}.${ext}`;
}
export function base64(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
export async function writePayload(native,token,index,payload,progress=()=>{}) {
  if(payload?.kind==='mesh-step') {
    await new Promise((resolve,reject)=>{
      const worker=new Worker('export-worker.js',{type:'module'});
      const finish=error=>{worker.terminate();error?reject(error):resolve();};
      worker.onerror=()=>finish(new Error('STEP 내보내기 엔진 실행에 실패했습니다.'));
      worker.onmessage=async({data})=>{
        try {
          if(data.type==='chunk') {await native.append({token,index,data:base64(new Uint8Array(data.bytes))});worker.postMessage({type:'next'});}
          else if(data.type==='progress')progress(data.progress);
          else if(data.type==='done')finish();
          else if(data.type==='error')finish(new Error(data.message));
        }catch(error){finish(error);}
      };
      worker.postMessage({type:'start',meshes:payload.meshes});
    });
  }else{
    const bytes=payload instanceof Uint8Array?payload:new Uint8Array(payload);
    for(let offset=0;offset<bytes.length;offset+=CHUNK_SIZE)await native.append({token,index,data:base64(bytes.subarray(offset,offset+CHUNK_SIZE))});
  }
  return native.seal({token,index});
}
