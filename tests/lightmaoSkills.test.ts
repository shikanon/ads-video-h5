import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadVideoTemplateCatalog,loadVideoTemplate,publicTemplate } from '../server/videoTemplates';
import { dailyAiRequest,dailyAiSceneHtml } from '../server/dailyAiTemplate';
import { lessonSettings } from '../server/lessonSpec';
import { lessonPresentation } from '../server/lessonPresentation';
import { wantsCurrentResearch } from '../server/intents';
import { newsSearchPolicy } from '../server/hotResearch';
import { newsWindowHours } from '../server/hotSources';
import { newsDatePolicy } from '../server/newsDatePolicy';
import { aiTopicSourcePlan } from '../server/aiTopicSources';
import { publicSkillGuide,skillGuideTool,isCapabilityInquiry } from '../server/assistantSkills';
import { startCreditServer } from './fixtures/creditServer';
import { waitFor } from './fixtures/nativeClient';

test('daily template defaults and explicit user choices survive internal production instructions',()=>{
  const rules='前两秒钩子；最新热点；不要紧张；内部例子60秒竖屏';
  const current=dailyAiRequest('制作一个AI图解视频',rules,['已完成问题']);
  assert.deepEqual(lessonSettings(current),{requestedSeconds:35,explicitDuration:true,format:'16:9'});
  assert.equal(wantsCurrentResearch(current),true);
  assert.equal(newsDatePolicy(current),'strict');
  assert.equal(newsWindowHours(newsSearchPolicy(current).subject),48);
  const weekly=dailyAiRequest('制作本周的AI新闻视频','优先近48小时原文');
  assert.equal(newsWindowHours(newsSearchPolicy(weekly).subject),168);
  const evergreen=dailyAiRequest('只讲原理，制作常青图解视频，60秒竖屏，不要配乐',rules);
  assert.equal(wantsCurrentResearch(evergreen),false);
  assert.equal(lessonSettings(evergreen).requestedSeconds,60);
  assert.equal(lessonSettings(evergreen).format,'9:16');
  assert.equal(lessonPresentation(evergreen).bgm,false);
  assert.equal(lessonPresentation(current).profile,'daily-ai');
  assert.equal(lessonPresentation(current).bgm,true);
  assert.equal(lessonPresentation('制作一个知识视频').profile,undefined);
  assert.ok(current.indexOf('已完成问题')<current.indexOf(rules));
});

test('daily template is registered with actual context, provenance and preview files',async()=>{
  const entry=(await loadVideoTemplateCatalog()).find(t=>t.id==='daily-ai-frontier')!;
  assert.ok(entry);assert.equal(entry.workflow,'daily-ai');
  assert.deepEqual([entry.defaults.width,entry.defaults.height,entry.defaults.seconds],[1920,1080,35]);
  assert.match(entry.sample!.videoUrl,/daily-ai-frontier\/sample\/video$/);
  const loaded=await loadVideoTemplate(entry);
  assert.match(loaded.context,/48小时/);assert.match(loaded.context,/轻喵小程序制作/);
  assert.match(loaded.skillHash,/^[a-f0-9]{64}$/);
  assert.equal('directory' in publicTemplate(entry),false);
});

test('AI discovery stays scoped and distinguishes article evidence, dates and tests',()=>{
  const scoped=aiTopicSourcePlan('机器人仿真');
  assert.match(scoped,/research.nvidia.com/);assert.doesNotMatch(scoped,/openai.com/);
  const broad=aiTopicSourcePlan('AI前沿各领域');
  for(const text of ['生命科学','Hugging Face','具体正文','事件日','真实执行','用户允许常青'])assert.ok(broad.includes(text));
  assert.equal(aiTopicSourcePlan('本地素材剪辑'),'');
});

test('public capabilities use runtime catalog and configuration without claiming execution',async()=>{
  const catalog=(await loadVideoTemplateCatalog()).map(publicTemplate);
  const guide=publicSkillGuide(catalog,{text:true,image:false,audio:false,game:false});
  for(const item of catalog)assert.ok(guide.some(s=>s.id===item.id));
  for(const id of ['sticker-studio','daily-ai-frontier','defold-game']){
    const item=guide.find(s=>s.id===id);if(item)assert.equal(item.status,'needs-configuration');
  }
  const tool=skillGuideTool(guide),result=await tool.execute('readonly',{keyword:'新角色'});
  const response=JSON.parse((result.content[0] as any).text);
  assert.equal(response.notAnExecutionReceipt,true);assert.ok(response.skills.some((s:any)=>s.id==='sticker-studio'));
  assert.doesNotMatch(JSON.stringify(response),/apiKey|D:\\|QQ号|联系人/);
  assert.equal(isCapabilityInquiry('轻喵有哪些技能和模板？'),true);
  assert.equal(isCapabilityInquiry('查证今天AI机器人最新进展'),false);
});

test('real chat transport receives the conversation skill and readonly catalog without creating artifacts',async t=>{
  const requests:any[]=[];
  const f=await startCreditServer({onProviderRequest:async body=>{requests.push(body);}});t.after(f.close);
  const cookie=await f.login();
  const draft:any=await(await f.request(cookie,'/api/sessions',{mode:'chat'})).json();
  const before:any=await(await f.request(cookie,'/api/state')).json();
  const poster=await f.request(cookie,'/api/templates/daily-ai-frontier/sample/poster');
  assert.equal(poster.status,200);assert.match(poster.headers.get('content-type')||'',/image\/png/);
  const video=await f.request(cookie,'/api/templates/daily-ai-frontier/sample/video');
  assert.equal(video.status,200);assert.match(video.headers.get('content-type')||'',/video\/mp4/);
  await poster.arrayBuffer();await video.arrayBuffer();
  const sent:any=await(await f.request(cookie,'/api/chat',{sessionId:draft.activeSessionId,message:'轻喵有哪些技能和模板？',interaction:'chat'})).json();
  const id=sent.jobs.at(-1).id;
  await waitFor(async()=>{const s:any=await(await f.request(cookie,'/api/state')).json();const j=s.jobs.find((j:any)=>j.id===id);if(j?.status==='failed')throw new Error(j.error);return j?.status==='succeeded';});
  const after:any=await(await f.request(cookie,'/api/state')).json();
  assert.equal(after.artifacts.length,before.artifacts.length);
  assert.equal(after.jobs.filter((j:any)=>j.id===id).length,1);
  const call=requests.find(r=>r.tools?.some((tool:any)=>tool.function?.name==='list_skills'));
  assert.ok(call,'real reply agent exposes readonly directory');
  const system=call.messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('\n');
  for(const phrase of ['先接住用户刚说的具体内容','不继续机械互夸','不声称能读取QQ','daily-ai-frontier','sticker-studio'])assert.ok(system.includes(phrase),phrase);
  assert.equal(requests.length,1,'own capabilities require no external research or generation');
  const style=await readFile(new URL('../skills/lightmao-conversation/SKILL.md',import.meta.url),'utf8');
  assert.match(style,/被问身份时坦诚是AI/);
});

test('daily scene framework reserves watermark and caption panel while leaving checked geometry intact',()=>{
  const html=dailyAiSceneHtml('<style>#main{background:#fffdfa}</style><section id="main"><div id="title">标题</div></section>','16:9');
  assert.match(html,/#FDF7FB/);assert.match(html,/轻喵小程序制作/);assert.match(html,/left:506.667px/);assert.match(html,/daily-caption-panel/);
  assert.equal((html.match(/class="daily-watermark"/g)||[]).length,1);
});
