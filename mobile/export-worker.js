import {facetedStepChunks} from '../src/step-stream.js';
let iterator;
self.onmessage=({data})=>{
  try {
    if(data.type==='start')iterator=facetedStepChunks(data.meshes,{progress:progress=>self.postMessage({type:'progress',progress})});
    const item=iterator.next();
    if(item.done){self.postMessage({type:'done'});return;}
    const bytes=new TextEncoder().encode(item.value);self.postMessage({type:'chunk',bytes:bytes.buffer},[bytes.buffer]);
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
