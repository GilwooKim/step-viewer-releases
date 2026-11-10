import * as R from 'replicad';

// A failed assembly-wide tessellation must not discard every valid component.
// This path uses the separately bundled CAD kernel and meshes each solid/shell.
export async function recoverStep(oc, bytes, metadata, progress = () => {}) {
  R.setOC(oc);
  const dispose = value => { try { value?.delete(); } catch {} };
  const reader = new oc.STEPControl_Reader();
  const shapes = [], meshes = [], warnings = [];
  let whole, triangles = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  oc.FS.writeFile('/recovery.step', new Uint8Array(bytes));
  try {
    progress('호환 처리: STEP 형상을 다시 읽고 있습니다…');
    if (reader.ReadFile('/recovery.step') !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP 파일을 읽을 수 없습니다.');
    reader.SetSystemLengthUnit(1); // millimetres, including files authored in inches
    reader.TransferRoots();
    whole = R.cast(reader.OneShape());
    if (whole.isNull) throw new Error('STEP 파일에서 형상을 찾을 수 없습니다.');
    for (const [type, avoid] of [['SOLID', 'SHAPE'], ['SHELL', 'SOLID'], ['FACE', 'SHELL']]) {
      const explorer = new oc.TopExp_Explorer(whole.wrapped, oc.TopAbs_ShapeEnum[`TopAbs_${type}`], oc.TopAbs_ShapeEnum[`TopAbs_${avoid}`]);
      try {
        while (explorer.More()) {
          shapes.push(R.cast(explorer.Current()));
          if (shapes.length > 10000) throw new Error('부품 수가 10,000개를 초과합니다.');
          explorer.Next();
        }
      } finally { explorer.delete(); }
    }
    const meshNodes = [];
    const collectNodes = node => { if (node?.meshes?.length) meshNodes.push(node); for (const child of node?.children || []) collectNodes(child); };
    collectNodes(metadata?.root);
    // XCAF and STEPControl enumerate the same solid/shell order for one compound.
    // Do not guess labels across multiple independently enumerated mesh nodes.
    const matchingOrder = meshNodes.length === 1 && meshNodes[0].meshes.length === shapes.length &&
      meshNodes[0].meshes.every((id, i) => id === i) && metadata?.meshes?.length === shapes.length && shapes.every((shape, i) => {
      const faces = shape.faces;
      try { return faces.length === metadata.meshes[i].faceCount; }
      finally { faces.forEach(dispose); }
    });
    if (!matchingOrder) warnings.push('호환 처리에서 어셈블리 구조를 개별 형상으로 펼쳤습니다. 부품 이름과 색상은 기본값으로 표시합니다.');
    const omitted = [];
    for (let i = 0; i < shapes.length; i++) {
      progress(`호환 처리: 부품 ${i + 1} / ${shapes.length} 표면 생성 중…`);
      const shape = shapes[i];
      try {
        let mesh;
        try { mesh = shape.mesh({ tolerance: 0.2, angularTolerance: 0.35 }); }
        catch { omitted.push(i); continue; }
        if (!mesh.triangles.length || !mesh.vertices.length) { omitted.push(i); continue; }
        triangles += mesh.triangles.length / 3;
        if (triangles > 5000000) throw new Error('형상이 500만 삼각형을 초과합니다. 원본 CAD에서 형상을 단순화해 주세요.');
        const positions = Float64Array.from(mesh.vertices);
        for (let n = 0; n < positions.length; n++) {
          if (!Number.isFinite(positions[n])) throw new Error('형상 좌표에 유효하지 않은 값이 있습니다.');
          min[n % 3] = Math.min(min[n % 3], positions[n]); max[n % 3] = Math.max(max[n % 3], positions[n]);
        }
        const source = matchingOrder ? metadata.meshes[i] : null;
        meshes.push({ id: i, name: source?.name || `부품 ${i + 1}`, color: source?.color,
          positions, indices: Uint32Array.from(mesh.triangles), normals: Float32Array.from(mesh.normals),
          faces: mesh.faceGroups.map(group => ({ first: group.start / 3, last: (group.start + group.count) / 3 - 1, color: null })) });
      } finally { dispose(shape); shapes[i] = null; }
    }
    if (!meshes.length) throw new Error('부품별 호환 처리에서도 표시 가능한 표면을 찾지 못했습니다.');
    if (omitted.length) warnings.push(`호환 처리 중 ${shapes.length}개 중 ${omitted.length}개 부품의 표면을 생성하지 못했습니다. 누락 번호: ${omitted.map(n => n + 1).join(', ')}`);
    warnings.unshift('부품별 호환 처리로 파일을 열었습니다. 원본 STEP은 보존되며, 화면의 곡면은 0.2 mm / 0.35 rad 설정으로 삼각형화합니다. 면별 색상은 부품 색상으로 표시합니다.');
    const center = min.map((n, i) => n / 2 + max[i] / 2);
    for (const mesh of meshes) mesh.positions = Float32Array.from(mesh.positions, (n, i) => n - center[i % 3]);
    const root = matchingOrder && metadata.root ? metadata.root : { name: 'STEP', meshes: meshes.map(m => m.id), children: [] };
    return { meshes, root, min, max, center, triangles, warnings, recovered: true, omitted: omitted.length };
  } finally {
    shapes.forEach(dispose); dispose(whole); reader.delete(); oc.FS.unlink('/recovery.step');
  }
}
