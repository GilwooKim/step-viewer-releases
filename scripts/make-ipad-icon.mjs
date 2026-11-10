// Rasterize the existing code-drawn STEP Viewer cube as an opaque App Store icon.
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
try{
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
  await page.setContent('<style>html,body{margin:0;background:#152332;overflow:hidden}svg{display:block}</style>'+await readFile('assets/ipad-icon.svg','utf8'));
  await page.screenshot({path:'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',omitBackground:false});
}finally{await browser.close();}
