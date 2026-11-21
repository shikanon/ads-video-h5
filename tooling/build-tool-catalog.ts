import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolPrompt} from '../server/toolPrompts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mini=path.join(root,'apps/miniprogram/miniprogram');
const ids=['qingmao-stickers','video-style-interface','video-style-diagram','video-style-spatial','daily-ai-frontier'];
const catalog=[],sources=[];
await mkdir(path.join(mini,'assets/templates'),{recursive:true});
for(const id of ids){
  const manifest=JSON.parse(await readFile(path.join(root,'skills',id,'template.json'),'utf8'));
  const sticker=id==='qingmao-stickers',source='skills/'+id+'/assets/'+(sticker?'pack/01/thumb.png':'poster.png'),target='assets/templates/'+id+'.png';
  await copyFile(path.join(root,source),path.join(mini,target));
  const {workflow,contextFiles,testCases,sample,...template}=manifest;
  catalog.push({id:template.id,name:template.name,description:template.description,defaults:template.defaults,...(sticker?{output:'sticker-pack'}:{}),localThumbnail:'/'+target,tool:{category:sticker?'stickers':'video',group:id.includes('interface')?'interface':id.includes('spatial')?'product':'diagram',prompt:toolPrompt({...template,...(sticker?{output:'sticker-pack'}:{})})}});
  sources.push({id,source,target,sha256:createHash('sha256').update(await readFile(path.join(root,source))).digest('hex')});
}
await writeFile(path.join(mini,'utils/tool-catalog.js'),'// Generated from original template manifests by tooling/build-tool-catalog.ts.\nmodule.exports = '+JSON.stringify(catalog,null,2)+';\n');
await writeFile(path.join(mini,'assets/templates/sources.json'),JSON.stringify(sources,null,2)+'\n');
