import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateFile,safeName,MAX_IMPORT,CHUNK_SIZE,writePayload,readFileBytes} from '../mobile/files.js';
test('native reads use bounded binary ranges, rejecting truncated files',async()=>{
  const source=new Uint8Array(9*1024*1024+7);source[0]=13;source[source.length-1]=249;let requests=0;
  const result=await readFileBytes('test',source.length,async(_url,{headers})=>{requests++;const [,a,b]=headers.Range.match(/bytes=(\d+)-(\d+)/);assert.ok(Number(b)-Number(a)<4*1024*1024);return new Response(source.subarray(Number(a),Number(b)+1),{status:206});});
  assert.equal(requests,3);assert.deepEqual(result,source);
  await assert.rejects(readFileBytes('test',20,async()=>new Response(new Uint8Array(10),{status:206})),/파일 크기/);
});
import {facetedStepChunks} from '../src/step-stream.js';
test('device file budget and unsupported converters',()=>{
  validateFile({name:'assembly.STEP',size:400*1024*1024});
  assert.throws(()=>validateFile({name:'assembly.step',size:MAX_IMPORT+1}));
  assert.throws(()=>validateFile({name:'drawing.dwg',size:20}));
  assert.equal(safeName('../part:one.step','stl',2),'0002_.._part_one.stl');
});
test('binary output preserves bytes with bounded bridge messages and backpressure',async()=>{
  const input=new Uint8Array(CHUNK_SIZE*3+19);for(let i=0;i<input.length;i++)input[i]=i%251;
  const output=[];let pending=0,maxPending=0,sealed=false;
  const native={append:async({data})=>{pending++;maxPending=Math.max(maxPending,pending);await new Promise(r=>setTimeout(r,1));const bytes=Buffer.from(data,'base64');assert.ok(bytes.length<=CHUNK_SIZE);output.push(bytes);pending--;},seal:async()=>{assert.equal(pending,0);sealed=true;}};
  await writePayload(native,'token',0,input);
  assert.equal(maxPending,1);assert.ok(sealed);
  assert.equal(createHash('sha256').update(Buffer.concat(output)).digest('hex'),createHash('sha256').update(input).digest('hex'));
});
test('disk errors stop export before sealing',async()=>{
  let calls=0;
  await assert.rejects(writePayload({append:async()=>{throw new Error('Disk full');},seal:async()=>calls++},'x',0,new Uint8Array(300000)),/Disk full/);
  assert.equal(calls,0);
});
test('mesh STEP stream exceeds former 50k limit and retains two parts',()=>{
  const make=(id)=>({id,name:'Part '+id,positions:new Float32Array([0,0,0,10,0,0,0,10,0]),indices:new Uint32Array(Array.from({length:78000},(_,i)=>i%3))});
  let size=0,largest=0,parts=0,last='';for(const chunk of facetedStepChunks([make(0),make(1)])){size+=chunk.length;largest=Math.max(largest,chunk.length);parts+=(chunk.match(/STEP_VIEWER_PART /g)||[]).length;last=chunk;}
  assert.ok(size>1000000);assert.ok(largest<1024*1024);assert.equal(parts,2);assert.match(last,/END-ISO-10303-21/);
});
