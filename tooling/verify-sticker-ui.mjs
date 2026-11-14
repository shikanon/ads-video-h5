import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output=process.env.QINGJIAN_STICKER_ARTIFACT_DIR||'D:/ads-video-h5-diagnostics/sticker-029';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.QINGJIAN_CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8798/preview?page=stickers');
 await page.waitForFunction(()=>window.__miniPreview?.instance.data.items.length===24);
 await page.addStyleTag({content:'html,body{width:100%;max-width:100%}nav{display:none}'});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>[...document.querySelectorAll('[class*=sticker-tile] img')].length===24&&[...document.querySelectorAll('[class*=sticker-tile] img')].every(i=>i.complete&&i.naturalWidth>0));
 await page.screenshot({path:output+'/sticker-template.png',fullPage:true});
 const checks=[];
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  checks.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,count:window.__miniPreview.instance.data.items.length,scenes:window.__miniPreview.instance.data.scenes.length,tiles:[...document.querySelectorAll('[class*=sticker-tile]')].map(n=>({class:n.className,x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width})).slice(0,4),wide:[...document.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(n=>({tag:n.tagName,class:n.className,width:n.getBoundingClientRect().width}))})));
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.__miniPreview.instance.preview({currentTarget:{dataset:{id:'01'}}}));
 await page.screenshot({path:output+'/sticker-preview.png',fullPage:false});
 await page.evaluate(()=>window.__miniPreview.instance.closePreview());
 await writeFile(output+'/ui-checks.json',JSON.stringify({checks,errors},null,2));
 if(errors.length||checks.some(c=>c.overflow||c.count!==24||c.scenes!==6))throw Error(JSON.stringify({checks,errors}));
 console.log(JSON.stringify({output,checks,errors}));
}finally{await browser.close()}
