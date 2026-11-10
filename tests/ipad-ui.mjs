import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{try{const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!filename.startsWith(root+path.sep))throw Error();const bytes=await readFile(filename);const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'};res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1376,height:1032},isMobile:true,hasTouch:true,deviceScaleFactor:1});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const jobs=new Map();let next=0;
  window.__exports=[];window.__pick=[];
  const methods=['pick','describe','startup','begin','append','seal','finish','abort','setWorking','confirmClose','addListener','removeListener'];
  window.Capacitor={PluginHeaders:[{name:'CADFiles',methods:methods.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))}],convertFileSrc:path=>path,
    nativeCallback:()=> 'listener',
    nativePromise:async(_plugin,method,args={})=>{
      if(method==='begin'){const token=String(++next);jobs.set(token,{names:args.names,files:{}});return {token};}
      if(method==='append'){const job=jobs.get(args.token);(job.files[args.index]??=[]).push(Uint8Array.from(atob(args.data),c=>c.charCodeAt(0)));return {};}
      if(method==='seal')return {size:jobs.get(args.token).files[args.index].reduce((n,b)=>n+b.length,0)};
      if(method==='finish'){const job=jobs.get(args.token);window.__exports.push({names:job.names,sizes:Object.values(job.files).map(chunks=>chunks.reduce((n,b)=>n+b.length,0))});jobs.delete(args.token);return {saved:true};}
      if(method==='abort'){jobs.delete(args.token);return {};}
      if(method==='pick'){const files=window.__pick;window.__pick=[];return {files};}
      if(method==='describe')return {name:'Second.step',size:100000,path:args.path};
      if(method==='startup')return {files:[]};
      if(method==='confirmClose')return {choice:'discard'};
      return {};
    }};
});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.stepViewerMobile?.ready);
  const native=await page.evaluate(()=>window.stepViewerMobile.selfTest());assert.equal(native.ok,true,JSON.stringify(native));
  await page.locator('#close-editor').click();
  await page.locator('#export-selected').click();await page.locator('#export-layout').selectOption('separate');await page.locator('#export-run').click();
  await page.waitForFunction(()=>window.__exports.length===1);assert.equal((await page.evaluate(()=>window.__exports[0].names)).length,2);
  await page.locator('#close-convert').click();
  await page.evaluate(()=>window.__pick=[{path:location.origin+'/demo.step',name:'Second.step',size:100000}]);
  await page.locator('#open').click();await page.waitForFunction(()=>document.querySelectorAll('.tab-select').length===2&&document.getElementById('loading').hidden);
  assert.equal(await page.locator('.tab-select').count(),2);
  await page.locator('#touch-select').click(); // turn off before individual selection
  await page.locator('.part-row button').first().click();
  await page.locator('#canvas').evaluate(canvas=>{
    for(const [type,id,x] of [['pointerdown',1,600],['pointerdown',2,650],['pointerup',2,650],['pointerup',1,600]])canvas.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:400,button:0,bubbles:true}));
  });
  assert.equal(await page.locator('.part-row.selected').count(),1);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/ipad-landscape.png'});
  await page.setViewportSize({width:1032,height:1376});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#parts-toggle').click();await page.locator('#tree').waitFor({state:'visible'});
  await page.screenshot({path:'test-results/ipad-portrait.png'});
  await page.locator('#settings').click();await page.locator('#settings-language').selectOption('en');
  await page.waitForFunction(()=>document.documentElement.lang==='en');assert.match(await page.locator('#update-status').innerText(),/TestFlight/);
  assert.equal(await page.locator('#export-format option[value="dwg"]').count(),0);
  assert.deepEqual(errors,[]);
  const report={ok:true,native,checks:['per-part native bridge export','multiple document tabs','pinch does not alter selection','portrait/landscape layout','English settings','unsupported formats hidden'],errors};
  await writeFile('test-results/ipad-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
