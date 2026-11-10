import initOC from './vendor/replicad_single.js';
import { recoverStep } from './step-recovery.js';
import {restoreStepAssembly} from './step-assembly.js';
self.onmessage = async ({ data }) => {
  try {
    const progress = text => self.postMessage({ type: 'progress', text });
    progress('부품별 호환 처리를 준비하고 있습니다…');
    const oc = await initOC({ locateFile: name => new URL(`./vendor/${name}`, import.meta.url).href });
    const result = restoreStepAssembly(await recoverStep(oc, data.bytes, data.metadata, progress),data.bytes);
    const transfers = result.meshes.flatMap(mesh => [mesh.positions.buffer, mesh.indices.buffer, mesh.normals.buffer]);
    self.postMessage({ type: 'success', ...result }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || '부품별 호환 처리에 실패했습니다. 파일 형상이나 사용 가능한 메모리를 확인해 주세요.' });
  }
};
