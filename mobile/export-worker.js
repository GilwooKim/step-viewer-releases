import {facetedStepChunks} from '../src/step-stream.js';
import {CHUNK_SIZE} from './files.js';
let iterator,pending,offset=0;
self.onmessage=({data})=>{
  try {
    if(data.type==='start')iterator=facetedStepChunks(data.meshes,{progress:progress=>self.postMessage({type:'progress',progress})});
    if(!pending||offset>=pending.length){
      const item=iterator.next();
      if(item.done){self.postMessage({type:'done'});return;}
      pending=new TextEncoder().encode(item.value);offset=0;
    }
    const bytes=pending.slice(offset,offset+CHUNK_SIZE);offset+=bytes.length;
    self.postMessage({type:'chunk',bytes:bytes.buffer},[bytes.buffer]);
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
