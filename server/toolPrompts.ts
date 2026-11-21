import {readFileSync} from 'node:fs';
import type {VideoTemplate} from '../shared/videoTemplates';
const spec=JSON.parse(readFileSync(new URL('../shared/toolPrompts.json',import.meta.url),'utf8'));
export function toolPrompt(template:VideoTemplate){
  const entry=Object.values(spec.templates).find((s:any)=>s.templateId===template.id) as any;
  if(!entry)return '@'+template.name+' '+(template.output==='sticker-pack'?'参考轻喵24张表情，为我的角色制作两种画风，选定后生成3张样张。':template.output==='game'?'玩法/主题：【填写】':'主题/要求：【填写】');
  const d=template.defaults,gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,g=gcd(d.width,d.height);
  const context={...d,ratio:d.width/g+':'+d.height/g,narration:spec.narration[d.narration?'yes':'no'],bgm:spec.bgm[d.bgm?'yes':'no']};
  return ['@'+template.name,...entry.fields,entry.instructions,spec.defaultsLine.replace(/\{(\w+)\}/g,(_:string,k:keyof typeof context)=>String(context[k]))].join('\n');
}
