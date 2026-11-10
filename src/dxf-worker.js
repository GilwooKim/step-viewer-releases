import {parseDxf} from './mesh-io.js';
self.onmessage=({data})=>{try{const result=parseDxf(data);self.postMessage({result},result.meshes.flatMap(m=>[m.positions.buffer,m.indices.buffer]));}catch(e){self.postMessage({error:e.message||'DXF 파일을 읽지 못했습니다.'});}};
