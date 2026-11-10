import {base64,writePayload} from './files.js';
export async function selfTest(Native){
  const checks=[];
  const wait=async(test,seconds=120)=>{const until=Date.now()+seconds*1000;while(!test()){if(Date.now()>until)throw new Error('Timed out: '+document.getElementById('toast').textContent);await new Promise(r=>setTimeout(r,200));}};
  let token;
  try {
    const sample=new Uint8Array(600000);for(let i=0;i<sample.length;i++)sample[i]=i%251;
    ({token}=await Native.begin({names:['chunk-test.stl']}));
    const result=await writePayload(Native,token,0,sample);
    if(result.size!==sample.length)throw new Error('Native chunk size mismatch');
    await Native.abort({token});token=null;checks.push('native chunk write / seal / cleanup');
    document.getElementById('demo').click();
    await wait(()=>Number(document.getElementById('part-count').textContent)>0);
    await wait(()=>document.getElementById('loading').hidden);
    checks.push('STEP Web Worker + WebAssembly + WebGL');
    document.getElementById('edit-toggle').click();document.getElementById('enable-cad').click();
    await wait(()=>document.getElementById('enable-cad').hidden);
    checks.push('precision CAD worker');
    const count=Number(document.getElementById('part-count').textContent);
    if(count<2)throw new Error('Expected multipart example');
    document.getElementById('touch-select').click();
    const rows=document.querySelectorAll('.part-row button');rows[0].click();rows[1].click();
    if(document.querySelectorAll('.part-row.selected').length!==2)throw new Error('Touch multi-select failed');
    document.getElementById('delete-selected').click();
    if(Number(document.getElementById('part-count').textContent)!==count-2)throw new Error('Multi-delete failed');
    document.getElementById('undo').click();
    if(Number(document.getElementById('part-count').textContent)!==count)throw new Error('Undo failed');
    checks.push('touch selection / CAD multi-delete / undo');
    const meshes=[{id:0,name:'Part',positions:new Float32Array([0,0,0,10,0,0,0,10,0]),indices:new Uint32Array([0,1,2])}];
    ({token}=await Native.begin({names:['mesh-test.step']}));
    const written=await writePayload(Native,token,0,{kind:'mesh-step',meshes});
    if(written.size<1000)throw new Error('Mesh STEP output too small');
    await Native.abort({token});token=null;checks.push('streaming mesh STEP worker to native disk');
    return {ok:true,checks,parts:count,userAgent:navigator.userAgent};
  }catch(error){if(token)await Native.abort({token});return {ok:false,checks,error:error.stack||error.message};}
}
