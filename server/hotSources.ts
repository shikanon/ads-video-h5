import type { HotTopicSignal, ResearchReference } from '../src/types';
import { publicResearchUrl, readPublicPage, type PublicReader } from './publicResearch';
import { mapLimited } from './taskPool';

export const baiduBoard='https://top.baidu.com/board?tab=realtime';
export const hnBoard='https://news.ycombinator.com/';
const plain=(s:string)=>s.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=parseInt(v.replace(/^x/i,''),/^x/i.test(v)?16:10);return n>0&&n<0x110000?String.fromCodePoint(n):' ';}).replace(/&(?:nbsp|amp|quot|lt|gt|apos);/gi,m=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&apos;':"'"}[m.toLowerCase()]||m)).replace(/\s+/g,' ').trim();
export const normalizeEvidence=(s:string)=>plain(s).replace(/\s/g,'');

export function parseBaiduBoard(html:string,observedAt:string):HotTopicSignal[]{
  const chunk=/<!--s-data:([\s\S]*?)-->/.exec(html)?.[1];
  if(!chunk)throw new Error('百度热榜页面格式已变化，未读取到榜单。');
  const data=JSON.parse(chunk),rows=data.data?.cards?.find((c:any)=>c.component==='hotList')?.content;
  if(!Array.isArray(rows))throw new Error('百度热榜没有实际榜单数据。');
  let rank=0;
  return rows.slice(0,35).flatMap((r:any)=>{
    const url=publicResearchUrl(r.url||r.rawUrl||''),title=plain(String(r.word||r.query||''));
    if(!url||!title)return [];
    const pinned=r.isTop===true;if(!pinned)rank++;
    const score=Number(r.hotScore);
    return [{id:`baidu-${pinned?'pinned':rank}`,title:title.slice(0,180),url,boardUrl:baiduBoard,source:'baidu' as const,rank:pinned?0:rank,pinned,observedAt,description:plain(String(r.desc||'')).slice(0,600),...(Number.isFinite(score)&&score>=0?{metric:{label:'百度热搜指数',value:score}}:{})}];
  });
}
export function parseHnItem(item:any,rank:number,observedAt:string):HotTopicSignal|undefined{
  if(item?.type!=='story'||item.dead||item.deleted||!Number.isSafeInteger(item.id)||typeof item.title!=='string')return;
  const url=publicResearchUrl(item.url||'')||`https://news.ycombinator.com/item?id=${item.id}`;
  const submittedAt=Number.isFinite(item.time)?new Date(item.time*1000).toISOString():undefined;
  return {id:`hn-${item.id}`,title:plain(item.title).slice(0,180),url,boardUrl:hnBoard,source:'hackernews',rank,observedAt,submittedAt,description:'HN社区当前榜单；提交时间不是原文章发布时间。',...(Number.isFinite(item.score)&&item.score>=0?{metric:{label:'HN积分',value:item.score}}:{})};
}
export async function discoverHotTopics(read:PublicReader=readPublicPage,now=Date.now()){
  const observedAt=new Date(now).toISOString(),failures:string[]=[];
  const feeds=await Promise.allSettled([
    read(baiduBoard).then(page=>parseBaiduBoard(page.text,observedAt)),
    (async()=>{const ids=JSON.parse((await read('https://hacker-news.firebaseio.com/v0/topstories.json')).text);if(!Array.isArray(ids))throw new Error('HN榜单无效');
      const results=await mapLimited(ids.filter(Number.isSafeInteger).slice(0,20),4,async(id,index)=>{try{return parseHnItem(JSON.parse((await read(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).text),index+1,observedAt);}catch{failures.push(`HN条目${id}读取失败`);return;}});
      return results.filter((v):v is HotTopicSignal=>Boolean(v));})(),
  ]);
  const signals:HotTopicSignal[]=[];
  feeds.forEach((r,i)=>{if(r.status==='fulfilled')signals.push(...r.value);else failures.push(`${i?'Hacker News':'百度'}热榜不可用：${r.reason instanceof Error?r.reason.message:'读取失败'}`);});
  if(!signals.length)failures.push('没有可验证热度信号；仍可查证有日期的新闻，不得声称已上热榜。');
  return {signals,failures,observedAt};
}
export function newsWindowHours(prompt:string):number{
  if(/今日|今天|当日|today/i.test(prompt))return 24;
  if(/(?:近|过去|最近)\s*(\d+)\s*(天|小时)/.test(prompt)){const m=/(?:近|过去|最近)\s*(\d+)\s*(天|小时)/.exec(prompt)!;return Math.min(168,Math.max(1,Number(m[1])*(m[2]==='天'?24:1)));}
  return /本周|近一周|一周|this week/i.test(prompt)?168:72;
}
function sourceDate(value:string):string|undefined{
  const v=plain(value);
  if(!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(v))return;
  let normalized=v.replace(/\//g,'-');
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized))return normalized.split('-').map((v,i)=>i?v.padStart(2,'0'):v).join('-');
  else if(!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized))normalized=normalized.replace(' ','T')+'+08:00';
  const time=Date.parse(normalized);return Number.isFinite(time)?new Date(time).toISOString():undefined;
}
export function articlePublication(html:string):{publishedAt?:string;dateEvidence?:string}{
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const root=JSON.parse(m[1]),queue=Array.isArray(root)?[...root]:[root];
      for(let count=0;queue.length&&count<50;count++){const node=queue.shift();if(!node||typeof node!=='object')continue;
        const kinds=Array.isArray(node['@type'])?node['@type']:[node['@type']];
        if(kinds.some((v:string)=>/^(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle|TechArticle)$/.test(v))){const date=sourceDate(String(node.datePublished||''));if(date)return {publishedAt:date,dateEvidence:`JSON-LD datePublished: ${node.datePublished}`};}
        if(Array.isArray(node['@graph']))queue.push(...node['@graph']);}
    }catch{}
  }
  for(const m of html.matchAll(/<meta\b[^>]*>/gi)){
    const tag=m[0],name=/(?:property|name|itemprop)=["']([^"']+)["']/i.exec(tag)?.[1];
    if(!/^(?:article:published_time|datePublished|pubdate|publishdate|publish_time|OriginalPublicationDate|DC.date.issued)$/i.test(name||''))continue;
    const value=/content=["']([^"']+)["']/i.exec(tag)?.[1]||'',date=sourceDate(value);if(date)return {publishedAt:date,dateEvidence:`meta ${name}: ${plain(value)}`};
  }
  for(const m of html.matchAll(/<(?:span|div|p|time)\b[^>]*(?:class|itemprop)=["'][^"']*(?:publish[-_]?time|publication[-_]?date|datePublished)[^"']*["'][^>]*>([^<]{5,80})</gi)){
    const date=sourceDate(m[1]);if(date)return {publishedAt:date,dateEvidence:`原页发布字段：${plain(m[1])}`};
  }
  const article=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]||html;
  const match=/(?:发布时间|发布日期|发布于|Published(?: on)?)[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)/i.exec(plain(article));
  const date=match&&sourceDate(match[1]);return date?{publishedAt:date,dateEvidence:match![0]}:{};
}
export function freshness(publishedAt:string|undefined,now:number,hours:number):NonNullable<ResearchReference['freshness']>{
  const at=Date.parse(publishedAt&&/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)?publishedAt+'T00:00:00+08:00':publishedAt||'');if(!Number.isFinite(at))return 'undated';if(at>now+60000)return 'future';return now-at<=hours*3600000?'fresh':'stale';
}
export function parseNewsPage(html:string):{title:string;excerpt:string;publishedAt?:string;dateEvidence?:string}{
  const title=plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||'');
  if(!title||/just a moment|access denied|captcha|security check|attention required|checking your browser|验证|访问受限/i.test(title))throw new Error('新闻页面不可读或要求验证。');
  const body=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]||/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]||html;
  const excerpt=plain(body.replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi,' ')).slice(0,9000);
  if(excerpt.length<180)throw new Error('新闻页面正文不足，不能当作已核验来源。');
  return {title:title.slice(0,180),excerpt,...articlePublication(html)};
}
export async function verifyNewsPages(references:ResearchReference[],hours:number,read:PublicReader=readPublicPage,now=Date.now()){
  const failures:string[]=[];const rows=await mapLimited(references.slice(0,12),3,async ref=>{
    try{const page=await read(ref.url),parsed=parseNewsPage(page.text);return {...ref,...parsed,url:page.url,retrievedAt:new Date(now).toISOString(),verification:'news-page' as const,freshness:freshness(parsed.publishedAt,now,hours)};}
    catch(error){failures.push(`${ref.title}：${error instanceof Error?error.message:'读取失败'}`);return;}
  });
  const unique=new Map<string,NonNullable<typeof rows[number]>>();for(const row of rows)if(row&&!unique.has(row.url))unique.set(row.url,row);
  return {references:[...unique.values()],failures};
}
