import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/vendor', {recursive:true});
const common={bundle:true,minify:true,target:'safari17',legalComments:'linked'};
for(const [entry,format] of [['app','esm'],['cad-worker','esm'],['step-recovery-worker','esm'],['import-worker','iife'],['dxf-worker','esm']]) {
  await build({...common,entryPoints:[`src/${entry}.js`],outfile:`dist/${entry}.js`,format,external:['./vendor/replicad_single.js','./vendor/rhino3dm.module.js']});
}
await build({...common,entryPoints:['mobile/entry.js'],outfile:'dist/mobile.js',format:'esm'});
await build({...common,entryPoints:['mobile/export-worker.js'],outfile:'dist/export-worker.js',format:'esm'});
for(const name of ['replicad_single.js','replicad_single.wasm'])await copyFile(`node_modules/replicad-opencascadejs/dist/${name}`,`dist/vendor/${name}`);
for(const name of ['occt-import-js.js','occt-import-js.wasm'])await copyFile(`node_modules/occt-import-js/dist/${name}`,`dist/vendor/${name}`);
for(const name of ['rhino3dm.module.js','rhino3dm.wasm'])await copyFile(`node_modules/rhino3dm/${name}`,`dist/vendor/${name}`);
await copyFile('src/styles.css','dist/styles.css');
await copyFile('mobile/ipad.css','dist/ipad.css');
let html=await readFile('src/index.html','utf8');
html=html.replace('width=device-width, initial-scale=1','width=device-width, initial-scale=1, viewport-fit=cover')
  .replace('</head>','<link rel="stylesheet" href="ipad.css"></head>')
  .replace('src="app.js"','src="mobile.js"');
await writeFile('dist/index.html',html);
for(const name of ['demo.step','icon.png'])await copyFile(`assets/${name}`,`dist/${name}`);
await cp('licenses','dist/licenses',{recursive:true});
await copyFile('LICENSE','dist/LICENSE.txt');
console.log('Built offline iPad application assets.');
