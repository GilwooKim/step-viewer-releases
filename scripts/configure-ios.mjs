import {readFile,writeFile} from 'node:fs/promises';
const path='ios/App/App.xcodeproj/project.pbxproj';
let text=await readFile(path,'utf8');
for(const [name,type,kind,id] of [['CADFiles.swift','sourcecode.swift','Sources','CA0000000000000000000001'],['PrivacyInfo.xcprivacy','text.xml','Resources','CA0000000000000000000002']]){
  const buildId=id.slice(0,-1)+(Number(id.at(-1))+2);
  if(!text.includes(`/* ${name} */`)){
    text=text.replace('/* Begin PBXFileReference section */',`/* Begin PBXFileReference section */\n\t\t${id} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${type}; path = ${name}; sourceTree = "<group>"; };`);
    text=text.replace('/* Begin PBXBuildFile section */',`/* Begin PBXBuildFile section */\n\t\t${buildId} /* ${name} in ${kind} */ = {isa = PBXBuildFile; fileRef = ${id} /* ${name} */; };`);
    text=text.replace('504EC3071FED79650016851F /* AppDelegate.swift */,',`504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${id} /* ${name} */,`);
    const phase=new RegExp(`(isa = PBX${kind}BuildPhase;[\\s\\S]*?files = \\()`);
    text=text.replace(phase,`$1\n\t\t\t\t${buildId} /* ${name} in ${kind} */,`);
  }
}
text=text.replaceAll('TARGETED_DEVICE_FAMILY = "1,2"','TARGETED_DEVICE_FAMILY = 2').replaceAll('IPHONEOS_DEPLOYMENT_TARGET = 15.0','IPHONEOS_DEPLOYMENT_TARGET = 17.0').replaceAll('MARKETING_VERSION = 1.0;','MARKETING_VERSION = 1.0.0;');
await writeFile(path,text);
const plistPath='ios/App/App/Info.plist';let plist=await readFile(plistPath,'utf8');
if(!plist.includes('CFBundleDocumentTypes'))plist=plist.replace('<dict>',`<dict>
  <key>CFBundleLocalizations</key><array><string>en</string><string>ko</string></array>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>LSSupportsOpeningDocumentsInPlace</key><true/>
  <key>UIFileSharingEnabled</key><true/>
  <key>CFBundleDocumentTypes</key><array><dict>
    <key>CFBundleTypeName</key><string>CAD and 3D documents</string>
    <key>CFBundleTypeRole</key><string>Editor</string>
    <key>LSHandlerRank</key><string>Alternate</string>
    <key>LSItemContentTypes</key><array><string>public.data</string></array>
  </dict></array>`);
await writeFile(plistPath,plist);
