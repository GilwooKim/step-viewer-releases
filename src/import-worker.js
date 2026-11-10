import {restoreStepAssembly} from './step-assembly.js';
importScripts('vendor/occt-import-js.js');
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ type: 'progress', text: 'CAD 엔진을 준비하고 있습니다…' });
    const occt = await occtimportjs({ locateFile: (file) => `vendor/${file}` });
    self.postMessage({ type: 'progress', text: 'STEP 형상을 읽고 있습니다…' });
    const result = occt.ReadStepFile(new Uint8Array(data.bytes), {
      linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: data.quality === 'fine' ? 0.0005 : 0.002, angularDeflection: data.quality === 'fine' ? 0.15 : 0.35
    });
    if (!result.success || !result.meshes?.length) throw new Error('표시할 수 있는 입체 형상이 없습니다. 파일이 손상되었거나 지원하지 않는 STEP 데이터일 수 있습니다.');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    for (const mesh of result.meshes) {
      const positions = mesh.attributes.position.array;
      for (let i = 0; i < positions.length; i++) {
        if (!Number.isFinite(positions[i])) throw new Error('형상 좌표에 유효하지 않은 값이 있습니다.');
        const axis = i % 3;
        min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]);
      }
      triangles += mesh.index.array.length / 3;
    }
    if (!min.every(Number.isFinite) || triangles === 0) {
      self.postMessage({ type: 'recover', metadata: { root: result.root, meshes: result.meshes.map(mesh => ({ name: mesh.name, color: mesh.color, faceCount: mesh.brep_faces?.length })) } });
      return;
    }
    if (triangles > 5000000) throw new Error('형상이 너무 복잡합니다. 다른 CAD 프로그램에서 단순화한 STEP 파일로 다시 시도해 주세요.');
    const center = min.map((value, axis) => value / 2 + max[axis] / 2);
    const transfers = [];
    const meshes = result.meshes.map((mesh, id) => {
      const source = mesh.attributes.position.array;
      const positions = new Float32Array(source.length);
      for (let i = 0; i < source.length; i++) positions[i] = source[i] - center[i % 3];
      const indices = new Uint32Array(mesh.index.array);
      const normals = mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null;
      transfers.push(positions.buffer, indices.buffer);
      if (normals) transfers.push(normals.buffer);
      return { id, name: mesh.name || `부품 ${id + 1}`, positions, indices, normals, color: mesh.color, faces: mesh.brep_faces || [] };
    });
    self.postMessage({ type: 'success', ...restoreStepAssembly({meshes,root:result.root,min,max,center,triangles},data.bytes) }, transfers);
  } catch (error) { self.postMessage({ type: 'error', message: typeof error?.message === 'string' ? error.message : 'CAD 변환에 실패했습니다. 파일을 확인해 주세요.' }); }
};
