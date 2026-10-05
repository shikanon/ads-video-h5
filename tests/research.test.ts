import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Value } from 'typebox/value';
import { articlePublication, discoverHotTopics, freshness, newsWindowHours, parseBaiduBoard, parseHnItem, verifyNewsPages } from '../server/hotSources';
import { decodeOpenWebSearch, openWebBase, openWebEngines, searchOpenWeb, usableSearchArticle } from '../server/openWebSearch';
import { publicAddress, publicResearchUrl, readPublicPage } from '../server/publicResearch';
import { currentResearchExpired, refreshHotTopics, validateHotBrief, newsPublisher, newsPassages, hydrateHotEvidence, hotBriefParameters } from '../server/hotResearch';
import { mergeResearch } from '../server/narrativeResearch';
import { classify, lessonRequest, selectedHotVideoRequest, wantsCurrentResearchOnly } from '../server/intents';
import { lessonSettings } from '../server/lessonSpec';
import type { HotResearchBrief, ResearchReference } from '../src/types';

const now=Date.parse('2026-10-02T04:00:00Z'),at=new Date(now).toISOString();
const board='<!--s-data:'+JSON.stringify({data:{cards:[{component:'hotList',content:[{word:'置顶宣传',url:'https://www.baidu.com/s?wd=1',isTop:true,hotScore:'900'},{word:'真实热搜',url:'https://www.baidu.com/s?wd=2',hotScore:'800',index:0}]}]}})+'-->';

test('additional research preserves source IDs and rebases summaries and news evidence to the actual URLs',()=>{
  const ref=(id:string,url:string,excerpt:string)=>({id,url,title:url,verification:'news-page' as const,excerpt});
  const previous={summary:'原稿引用ref-1',queries:[],references:[ref('ref-1','https://official.example/news','旧正文')]};
  const next={summary:'新稿引用ref-1，官方更新ref-2',queries:[],references:[ref('ref-1','https://report.example/news','独立报道正文'),ref('ref-2','https://official.example/news','已重读官方正文')],current:{asOf:'2026-10-05T00:00:00Z',expiresAt:'2026-10-05T00:30:00Z',windowHours:24,signals:[],failures:[],topics:[{title:'主题',hook:'钩子',angle:'角度',visualPlan:'示意',signalIds:[],uncertainties:[],facts:[{text:'事实',evidence:[{referenceId:'ref-1',quote:'独立报道正文'},{referenceId:'ref-2',quote:'已重读官方正文'}]}]}]}};
  const result=mergeResearch(previous,next);
  assert.equal(result.references.find(r=>r.id==='ref-1')!.url,'https://official.example/news');
  assert.equal(result.references.find(r=>r.id==='ref-1')!.excerpt,'已重读官方正文');
  assert.match(result.summary,/新稿引用ref-2，官方更新ref-1/);
  assert.deepEqual(result.current!.topics[0].facts[0].evidence.map(e=>e.referenceId),['ref-2','ref-1']);
  assert.equal(previous.references[0].excerpt,'旧正文');
  const search=mergeResearch(previous,{summary:'搜索摘要ref-1',queries:[],references:[{...previous.references[0],verification:'search-cited',excerpt:'只搜索未读'}]});
  assert.equal(search.references[0].verification,'news-page');assert.equal(search.references[0].excerpt,'旧正文');
});

test('expired news refresh re-reads the selected sources and keeps the event and evidence IDs',async()=>{
  const quote='本次报道讨论模型的语音入口，演示能力与正式发布状态需要分别核对。';
  const references=['https://official.example/news','https://report.example/news'].map((url,i)=>({id:'r'+i,url,title:'已选新闻',verification:'news-page' as const,excerpt:quote.repeat(10),freshness:'fresh' as const}));
  const previous={summary:'初次研究',queries:[],references,current:{asOf:new Date(Date.now()-3600000).toISOString(),expiresAt:new Date(Date.now()-1800000).toISOString(),windowHours:24,signals:[],failures:[],topics:[{title:'已选新闻',hook:'事件影响',angle:'核对来源',visualPlan:'示意',signalIds:[],uncertainties:[],facts:[{text:'语音入口报道',evidence:references.map(r=>({referenceId:r.id,quote}))}]}]}};
  const read:string[]=[];
  const page=(body:string)=>`<title>已选新闻</title><meta property="article:published_time" content="${new Date(Date.now()-600000).toISOString()}"><article>${body.repeat(10)}</article>`;
  const result=await refreshHotTopics(previous,'制作今日大模型新闻视频',{read:async url=>{read.push(url);return {url,text:page(quote),contentType:'text/html'};}});
  assert.deepEqual(read,references.map(r=>r.url));assert.equal(currentResearchExpired(result),false);assert.equal(result.current!.topics[0].title,'已选新闻');assert.deepEqual(result.references.map(r=>r.id),['r0','r1']);assert.ok(result.references.every(r=>Date.parse(r.retrievedAt!)>Date.parse(previous.current.asOf)));
  await assert.rejects(()=>refreshHotTopics(previous,'今日新闻',{read:async url=>({url,text:page('本次页面已改为介绍其他事情，原来引用的那条报道不再出现。'),contentType:'text/html'})}),/逐字证据和交叉来源/);
  await assert.rejects(()=>refreshHotTopics(previous,'今日新闻',{read:async url=>{if(url.includes('report.example'))throw new Error('HTTP 403');return {url,text:page(quote),contentType:'text/html'};}}),/交叉来源/);
});
const article='<html><title>最新发布</title><meta property="article:published_time" content="2026-10-02T09:00:00+08:00"><article>'+('今日正式发布了新功能，用户可以通过设置打开它。'.repeat(20))+'</article></html>';
test('current research is distinct from generated news video and academic history',()=>{
  const prompt='生成一个讲解今日AI热点的视频';
  assert.equal(classify('搜集今日AI热点，给出选题'),'plan');
  assert.equal(classify('搜集AI热点，给2个适合制作短视频的选题，先不要生成视频'),'plan');
  assert.equal(wantsCurrentResearchOnly('给这段热点口播精剪并加字幕'),false);
  assert.equal(wantsCurrentResearchOnly('搜集AI热点，给2个选题'),true);
  assert.equal(classify(prompt),'export');assert.equal(lessonRequest(prompt,[]),prompt);
  assert.equal(classify(prompt+'，先给脚本'),'plan');
  assert.deepEqual(lessonSettings(prompt),{requestedSeconds:45,explicitDuration:false,format:'9:16'});
  assert.equal(lessonSettings('生成损失函数变迁史的教学视频').requestedSeconds,240);
  assert.equal(lessonRequest('用这些真人口播做热点视频',[]),undefined);
});
test('public source reader rejects private, metadata, mapped and alternate numeric addresses',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.2.3','100.64.1.1','169.254.169.254','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','2001:10::1','2002:0a00:1::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  for(const url of ['http://example.com','https://user:pass@example.com','https://localhost/a','https://2130706433','https://0x7f000001','https://[::1]','https://example.com:8443'])assert.equal(publicResearchUrl(url),undefined,url);
  await assert.rejects(readPublicPage('https://169.254.169.254/latest/meta-data/'),/公开/);
});
test('upstream adapter preserves partial engine failures without making ranking a trend',()=>{
  const body={status:'ok',data:{engines:['bing','baidu'],results:[{title:'Article',url:'https://example.com/news',description:'Snippet'},{title:'Duplicate',url:'https://example.com/news'},{title:'Private',url:'https://127.0.0.1/secret'}],partialFailures:[{engine:'baidu',code:'engine_error'}]}};
  const result=decodeOpenWebSearch(body,'test',at);assert.equal(result.references.length,1);assert.equal(result.references[0].verification,'search-cited');assert.equal(result.references[0].publishedAt,undefined);
  assert.deepEqual((result.queries[0] as any).partialFailures,[{engine:'baidu',code:'engine_error'}]);
  assert.throws(()=>decodeOpenWebSearch({status:'error',error:{code:'engine_error'}},'test'),/失败/);
  assert.throws(()=>decodeOpenWebSearch({status:'ok',data:{results:[]}},'test'),/没有/);
  assert.equal(usableSearchArticle('https://image.baidu.com/search?word=AI'),false);
  assert.throws(()=>decodeOpenWebSearch({status:'ok',data:{results:[{title:'AI图片',url:'https://image.baidu.com/search?word=AI'}]}},'AI'),/没有/);
  assert.equal(openWebBase('http://127.0.0.1:3210'),'http://127.0.0.1:3210');
  assert.throws(()=>openWebBase('https://external.example/'),/回环/);assert.throws(()=>openWebBase('http://127.0.0.1:3210/secret'),/回环/);
  assert.deepEqual(openWebEngines('bing,baidu,bing'),['bing','baidu']);assert.throws(()=>openWebEngines('untrusted'),/受支持/);
});
test('HTTP adapter calls the documented request API and never requests browser cookies',async()=>{
  let received:any;
  const server=createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{received={path:req.url,...JSON.parse(body)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',data:{results:[{title:'A',url:'https://example.com/article',description:'A result'}],engines:['bing']}}));});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{const address=server.address() as {port:number};const r=await searchOpenWeb('AI news',`http://127.0.0.1:${address.port}`,['bing']);assert.equal(r.references.length,1);assert.equal(received.path,'/search');assert.equal(received.searchMode,'request');assert.deepEqual(received.engines,['bing']);}
  finally{server.close();await once(server,'close');}
});
test('Baidu pinned rows and HN submission times remain distinct from news dates',()=>{
  const rows=parseBaiduBoard(board,at);assert.equal(rows[0].rank,0);assert.equal(rows[0].pinned,true);assert.equal(rows[1].rank,1);assert.equal(rows[1].metric?.value,800);
  assert.equal(parseHnItem({id:123,title:'A',type:'story',time:now/1000,score:12},3,at)?.submittedAt,at);
  assert.equal(parseHnItem({id:123,title:'A',type:'story',dead:true},3,at),undefined);
  assert.throws(()=>parseBaiduBoard('<title>captcha</title>',at),/格式/);
});
test('unavailable trend feeds are explicit; they cannot fabricate a working board',async()=>{
  const r=await discoverHotTopics(async()=>{throw new Error('unavailable');},now);assert.equal(r.signals.length,0);assert.ok(r.failures.some(f=>f.includes('没有可验证')));
});
test('article dates use publication, not modification, header clock or unrelated JSON-LD',()=>{
  assert.equal(articlePublication(article).publishedAt,'2026-10-02T01:00:00.000Z');
  assert.equal(articlePublication('<meta property="article:modified_time" content="2026-10-02">').publishedAt,undefined);
  assert.equal(articlePublication('<script type="application/ld+json">{"@type":"WebSite","datePublished":"2026-10-02"}</script>').publishedAt,undefined);
  assert.equal(articlePublication('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-01","dateModified":"2026-10-02"}]}</script>').publishedAt,'2026-10-01');
  assert.equal(articlePublication('<article>发布时间：2026-10-02 09:00:00</article>').publishedAt,'2026-10-02T01:00:00.000Z');
  assert.equal(articlePublication('<span class="publish-time">2026-10-02 06:00</span>').publishedAt,'2026-10-01T22:00:00.000Z');
});
test('fresh, stale, future and undated evidence stays separate',()=>{
  assert.equal(newsWindowHours('今日AI热点'),24);assert.equal(newsWindowHours('近期新闻'),72);assert.equal(newsWindowHours('过去7天'),168);
  assert.equal(freshness('2026-10-02',now,24),'fresh');assert.equal(freshness('2026-09-30',now,24),'stale');assert.equal(freshness('2026-10-03',now,24),'future');assert.equal(freshness(undefined,now,24),'undated');
});
test('verification reads actual bodies, saves date evidence, and rejects access checks',async()=>{
  const refs:ResearchReference[]=[{id:'r1',title:'A',url:'https://example.com/a',excerpt:'snippet',retrievedAt:at,verification:'search-cited'},{id:'r2',title:'B',url:'https://example.org/b',excerpt:'snippet',retrievedAt:at,verification:'search-cited'}];
  const r=await verifyNewsPages(refs,24,async(url)=>({url,text:url.includes('.com')?article:'<title>Just a moment</title>',contentType:'text/html'}),now);
  assert.equal(r.references.length,1);assert.equal(r.references[0].verification,'news-page');assert.equal(r.references[0].freshness,'fresh');assert.ok(r.references[0].dateEvidence);assert.equal(r.failures.length,1);
});
test('hot briefs need verbatim evidence, fresh sources and independent publishers',()=>{
  const ref=(id:string,url:string):ResearchReference=>({id,url,title:'A',excerpt:'今日正式发布了新功能，用户可以通过设置打开它。',verification:'news-page',retrievedAt:at,freshness:'fresh',publishedAt:'2026-10-02'});
  const refs=[ref('r1','https://example.com/a'),ref('r2','https://example.org/b')];
  const topics:HotResearchBrief['topics']=[{title:'新功能',hook:'新功能能改变什么？',angle:'解释用户影响',signalIds:[],facts:[{text:'新功能已发布',evidence:[{referenceId:'r1',quote:refs[0].excerpt},{referenceId:'r2',quote:refs[1].excerpt}]}],visualPlan:'前后对比卡',uncertainties:[]}];
  assert.equal(validateHotBrief(topics,refs,[]).length,1);
  assert.throws(()=>validateHotBrief(topics,refs.map(r=>({...r,freshness:'stale'})),[]),/时效/);
  assert.throws(()=>validateHotBrief(topics,[refs[0],{...refs[1],url:'https://news.example.com/b'}],[]),/独立/);
  assert.throws(()=>validateHotBrief([{...topics[0],signalIds:['invented']}],refs,[]),/热度/);
  const bad=structuredClone(topics);bad[0].facts[0].evidence[0].quote='并不存在的新闻事实绝对不能凭空添加';assert.throws(()=>validateHotBrief(bad,refs,[]),/正文/);
  assert.equal(newsPublisher('https://news.example.co.uk/a'),'example.co.uk');
});
test('news checkpoints expire after 30 minutes instead of using the academic 24 hour cache',()=>{
  const c:HotResearchBrief={asOf:at,expiresAt:new Date(now+30*60000).toISOString(),windowHours:24,topics:[],signals:[],failures:[]};
  const result={summary:'',references:[],queries:[],current:c};assert.equal(currentResearchExpired(result,now),false);assert.equal(currentResearchExpired(result,now+30*60000),true);
  assert.equal(currentResearchExpired({...result,current:{...c,expiresAt:new Date(now+24*3600000).toISOString()}},now),true);
});
test('selected passage IDs preserve fetched words and cannot cite another source or invent a paragraph',()=>{
  const r:ResearchReference={id:'ref-1',url:'https://example.com',title:'A',excerpt:'今日正式发布了新功能，用户可以通过设置打开它。第二段介绍实际使用要求，仍应注意范围限制。',verification:'news-page',retrievedAt:at};
  const p=newsPassages(r);assert.equal(p.length,2);
  const raw=[{facts:[{text:'新功能已发布',evidence:[{referenceId:r.id,passageId:p[0].id}]}]}];
  assert.equal(hydrateHotEvidence(raw,[r])[0].facts[0].evidence[0].quote,p[0].text);
  assert.equal(hydrateHotEvidence([{facts:[{text:'新功能已发布',evidence:[{passageId:p[0].id}]}]}],[r])[0].facts[0].evidence[0].referenceId,r.id);
  assert.throws(()=>hydrateHotEvidence([{facts:[{evidence:[{referenceId:'ref-2',passageId:p[0].id}]}]}],[r]),/对应实际来源/);
  assert.throws(()=>hydrateHotEvidence([{facts:[{evidence:[{referenceId:r.id,passageId:'ref-1-p999'}]}]}],[r]),/对应实际来源/);
});
test('news tool accepts only fetched passage choices and rejects board IDs and excess facts before execution',()=>{
  const r:ResearchReference={id:'ref-1',url:'https://example.com',title:'A',excerpt:'今日正式发布了新功能，用户可以通过设置打开它。',verification:'news-page',retrievedAt:at};
  const schema=hotBriefParameters([r]);
  const topic={title:'新功能',hook:'发生了什么变化？',angle:'解释影响',signalIds:['baidu-2'],facts:[{text:'新功能已发布',evidence:[{passageId:'ref-1-p1'}]}],visualPlan:'变化对比卡',uncertainties:[]};
  assert.equal(Value.Check(schema,{topics:[topic]}),true);
  const bad=structuredClone(topic);bad.facts[0].evidence[0].passageId='baidu-2';assert.equal(Value.Check(schema,{topics:[bad]}),false);
  bad.facts[0].evidence[0].passageId='ref-1-p999';assert.equal(Value.Check(schema,{topics:[bad]}),false);
  assert.equal(Value.Check(schema,{topics:[{...topic,facts:Array(5).fill(topic.facts[0])}]}),false);
});
test('a short follow-up selects the real researched topic and never invents unavailable choices',()=>{
  const message={id:'a',role:'assistant' as const,text:'已查证',createdAt:at,research:{references:[],brief:{asOf:at,expiresAt:at,windowHours:24,signals:[],failures:[],topics:[{title:'选定事件',hook:'变化是什么',angle:'解释影响',signalIds:[],facts:[],visualPlan:'对比图',uncertainties:[]}]}}};
  const prompt='把第1个选题做成45秒视频';assert.equal(classify(prompt),'export');assert.ok(selectedHotVideoRequest(prompt,[message])?.includes('选定事件'));
  assert.equal(classify(prompt+'，先给脚本'),'plan');
  assert.throws(()=>selectedHotVideoRequest('生成第2个选题的视频',[message]),/尚未通过/);
  assert.equal(selectedHotVideoRequest('重新生成第2章的视频',[message]),undefined);
  assert.equal(selectedHotVideoRequest('不要制作第1个的视频',[message]),undefined);
  assert.equal(selectedHotVideoRequest('只剪已有视频，不用HTML',[message]),undefined);
});
