import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const dir='D:/ads-video-h5-diagnostics/sticker-phase2';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{const checks=[],errors=[];const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
for(const mode of ['static','dynamic']){await page.goto('http://127.0.0.1:8799/preview?page=sticker-studio&mode='+mode);await page.waitForFunction(()=>window.__miniPreview?.instance.data.available);await page.addStyleTag({content:'html,body{width:100%;max-width:100%}nav{display:none}'});
for(const width of [390,320]){await page.setViewportSize({width,height:844});checks.push(await page.evaluate(()=>({width:innerWidth,mode:window.__miniPreview.instance.data.mode,overflow:document.documentElement.scrollWidth>innerWidth})));}await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'/'+mode+'.png',fullPage:true});}
await writeFile(dir+'/ui-checks.json',JSON.stringify({checks,errors},null,2));if(errors.length||checks.some(c=>c.overflow))throw Error(JSON.stringify({checks,errors}));console.log(JSON.stringify({checks,errors}));}finally{await browser.close();}
