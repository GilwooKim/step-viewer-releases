import * as R from 'replicad';
import {assemblyTree} from './assembly.js';

// Explicit XDE component labels are essential: independent free shapes alone
// can be treated as one imported body by other CAD applications.
export function exportCadAssembly(oc,items,progress=()=>{}){
  const objects=[],own=value=>{objects.push(value);return value;};
  const text=value=>own(new oc.TCollection_ExtendedString(value,true));
  const doc=own(new oc.TDocStd_Document(text('XmlOcaf')));
  const tool=own(oc.XCAFDoc_DocumentTool.ShapeTool(own(doc.Main()))),colors=own(oc.XCAFDoc_DocumentTool.ColorTool(own(doc.Main())));
  const identity=own(new oc.TopLoc_Location()),shapes=[];
  const tree=assemblyTree(items.map((item,id)=>({...item,id}))),byId=new Map(items.map((item,id)=>[id,item]));
  const named=(label,name)=>{own(oc.TDataStd_Name.Set(label,text(name||'Assembly')));return label;};
  try{
    oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
    let completed=0;
    function group(node){
      const label=named(own(tool.NewShape()),node.name);
      for(const id of node.meshes){
        progress(`정밀 STEP 준비: 부품 ${++completed} / ${items.length}`);
        const item=byId.get(id),shape=R.deserializeShape(item.brep);shapes.push(shape);
        const leaf=named(own(tool.NewShape()),item.name);tool.SetShape(leaf,shape.wrapped);
        const rgb=item.color||[.48,.7,.75],color=own(new oc.Quantity_ColorRGBA(...rgb,1));colors.SetColor(leaf,color,oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
        named(own(tool.AddComponent(label,leaf,identity)),item.name);
      }
      for(const child of node.children)named(own(tool.AddComponent(label,group(child),identity)),child.name);
      return label;
    }
    group(tree);tool.UpdateAssemblies();
    const writer=own(new oc.STEPCAFControl_Writer());
    oc.Interface_Static.SetCVal('xstep.cascade.unit','MM');oc.Interface_Static.SetCVal('write.step.unit','MM');
    oc.Interface_Static.SetIVal('write.step.assembly',2);oc.Interface_Static.SetIVal('write.step.schema',5);
    writer.SetColorMode(true);writer.SetNameMode(true);
    progress('조립 구조와 정밀 형상을 STEP 파일로 기록하고 있습니다…');
    if(!writer.Perform(doc,'/assembly-export.step',own(new oc.Message_ProgressRange())))throw new Error('조립 STEP 파일을 저장하지 못했습니다.');
    // FS.readFile already returns an independent Uint8Array. Avoid a second
    // complete copy of a potentially hundreds-of-megabytes STEP file.
    return oc.FS.readFile('/assembly-export.step');
  }finally{
    try{oc.FS.unlink('/assembly-export.step');}catch{}
    objects.reverse().forEach(value=>{try{value.delete();}catch{}});shapes.forEach(shape=>shape.delete());
  }
}
