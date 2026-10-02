import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AudioAnalysis, Format, LessonChapter, LessonCurveFunction, LessonPacing } from '../src/types';
import { lessonDimensions } from './lessonSpec';
import { hashBytes, renderHtmlProject } from './narrativeScenes';
import { probeVideo, runFFmpeg } from './core';
import { motionLibrary } from './motionComponents';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const colors=['#e56a48','#397ba4','#7b65a5'];
export function lessonCurve(fn:LessonCurveFunction,x:number,parameter=1):number{
  switch(fn){case'mse':return x*x;case'mae':return Math.abs(x);case'huber':return Math.abs(x)<=parameter ? .5*x*x : parameter*(Math.abs(x)-.5*parameter);case'cross-entropy':return -Math.log(x);case'hinge':return Math.max(0,1-x);case'focal':return -((1-x)**parameter)*Math.log(x);}
}
function curveSvg(chapter:LessonChapter):string{
  const p=chapter.visual.plot!;const x=(v:number)=>74+(v-p.xMin)/(p.xMax-p.xMin)*552,y=(v:number)=>318-(v-p.yMin)/(p.yMax-p.yMin)*256;
  const ticks=Array.from({length:5},(_,i)=>{
    const xv=p.xMin+(p.xMax-p.xMin)*i/4,yv=p.yMin+(p.yMax-p.yMin)*i/4;
    return `<line x1="74" y1="${y(yv)}" x2="626" y2="${y(yv)}" stroke="#e8e2da"/><text x="62" y="${y(yv)+7}" text-anchor="end">${+yv.toFixed(2)}</text><text x="${x(xv)}" y="347" text-anchor="middle">${+xv.toFixed(2)}</text>`;
  }).join('');
  const paths=p.curves.map((c,i)=>{
    const points=Array.from({length:121},(_,j)=>{const xv=p.xMin+(p.xMax-p.xMin)*j/120;const yv=lessonCurve(c.fn,xv,c.parameter??(c.fn==='focal'?2:1));return `${j?'L':'M'}${x(xv).toFixed(2)} ${y(yv).toFixed(2)}`;}).join(' ');
    const legendWidth=552/p.curves.length,left=74+i*legendWidth;
    return `<path id="curve-${i}" d="${points}" stroke="${colors[i]}" stroke-width="4" fill="none" clip-path="url(#plot-clip)"/><g id="legend-${i}"><line x1="${left}" y1="25" x2="${left+22}" y2="25" stroke="${colors[i]}" stroke-width="4"/><text data-math-width="${legendWidth-40}" data-math-min-font="22" x="${left+30}" y="32" fill="${colors[i]}" font-size="24" font-weight="600">${escape(c.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 700 405" aria-label="${escape(p.yLabel)}随${escape(p.xLabel)}的函数曲线"><defs><clipPath id="plot-clip"><rect x="74" y="62" width="552" height="256"/></clipPath></defs><g id="axes" font-size="20" fill="#575a61">${ticks}<path d="M74 62V318H626" fill="none" stroke="#8f9298" stroke-width="2"/><text x="350" y="391" text-anchor="middle" font-size="23">${escape(p.xLabel)}</text><text x="12" y="52" font-size="22">${escape(p.yLabel)}</text></g>${paths}</svg>`;
}
// Split only outside nested mathematical groups: the slash in sim(q,x)/τ
// must stay inside the exponent, rather than becoming the outer fraction.
function outerOperator(value:string,operator:string):number{
  let depth=0;
  for(let i=0;i<value.length;i++){
    if('([{'.includes(value[i]))depth++;
    else if(')]}'.includes(value[i]))depth--;
    else if(depth===0&&value[i]===operator)return i;
  }
  return -1;
}
function unwrap(value:string):string{
  const trimmed=value.trim();
  if(trimmed[0]!=='('||trimmed.at(-1)!==')')return trimmed;
  let depth=0;for(let i=0;i<trimmed.length;i++){if(trimmed[i]==='(')depth++;else if(trimmed[i]===')')depth--;if(depth===0&&i<trimmed.length-1)return trimmed;}
  return trimmed.slice(1,-1).trim();
}
export function lessonFormulaParts(formula:string):Array<{prefix?:string;numerator?:string;denominator?:string[];text?:string}>{
  return formula.split(/[;；\n]/).map(v=>v.trim()).filter(Boolean).map(text=>{
    const open=text.indexOf('['),close=text.lastIndexOf(']');
    if(open>=0&&close===text.length-1){
      const inside=text.slice(open+1,close),slash=outerOperator(inside,'/');
      if(slash>=0){const denominator=unwrap(inside.slice(slash+1)),plus=outerOperator(denominator,'+');return {prefix:text.slice(0,open).trim(),numerator:inside.slice(0,slash).trim(),denominator:plus<0?[denominator]:[denominator.slice(0,plus).trim(),'+ '+denominator.slice(plus+1).trim()]};}
    }
    const log=text.match(/^(.*?)log\s*\((.*)\)$/);
    if(log){const slash=outerOperator(log[2],'/');if(slash>=0)return {prefix:log[1]+'log',numerator:log[2].slice(0,slash).trim(),denominator:[log[2].slice(slash+1).trim()]};}
    return {text};
  });
}
function formulaSvg(formula:string):string{
  const parts=lessonFormulaParts(formula),step=252/parts.length;
  const rows=parts.map((part,i)=>{
    const center=48+step*(i+.5);
    if(part.text)return `<g id="formula-${i}"><text data-math-width="620" data-math-min-font="28" x="350" y="${center+14}" text-anchor="middle" font-size="44">${escape(part.text)}</text></g>`;
    const denominator=part.denominator!,bar=center-(denominator.length===2?8:0),x=430,left=192,right=666;
    return `<g id="formula-${i}"><text data-math-width="154" data-math-min-font="28" x="98" y="${center+10}" text-anchor="middle" font-size="32">${escape(part.prefix!)}</text><text data-math-width="${right-left-12}" data-math-min-font="28" x="${x}" y="${bar-15}" text-anchor="middle" font-size="34">${escape(part.numerator!)}</text><path d="M${left} ${bar}H${right}" stroke="#282c38" stroke-width="2"/>${denominator.map((line,j)=>`<text data-math-width="${right-left-12}" data-math-min-font="28" x="${x}" y="${bar+34+j*35}" text-anchor="middle" font-size="32">${escape(line)}</text>`).join('')}<path d="M184 ${bar-56}H177V${bar+denominator.length*36+12}H184 M674 ${bar-56}H681V${bar+denominator.length*36+12}H674" stroke="#282c38" stroke-width="2" fill="none"/></g>`;
  }).join('');
  return `<svg class="formula" viewBox="0 0 700 350" aria-label="${escape(formula)}"><rect x="12" y="48" width="676" height="252" rx="26" fill="#fff0e9"/><g font-family="Arial,'PingFang SC',sans-serif" fill="#282c38">${rows}</g></svg>`;
}

export function lessonSceneHtml(chapter:LessonChapter,index:number,total:number,duration:number,format:Format):string{
  const [w,h]=lessonDimensions(format),portrait=h>w;
  const count=chapter.visual.items.length;
  const smallSide=!portrait&&(chapter.visual.kind==='curve'||chapter.visual.kind==='formula');
  const labelSize=smallSide&&count>=3?(count===4?18:22):portrait?29:26;
  const detailSize=smallSide&&count>=3?(count===4?14:18):portrait?24:21;
  const padding=smallSide&&count>=3?(count===4?8:10):portrait?20:16;
  const titleSize=Math.min(portrait?48:50,Math.max(portrait?34:38,Math.floor((w-(portrait?72:96))/[...chapter.title].length)));

  const side=chapter.visual.kind==='curve'||chapter.visual.kind==='formula';
  const cards=chapter.visual.items.map((item,i)=>`<article id="item-${i}" class="teaching-item"><span class="item-number">${String(i+1).padStart(2,'0')}</span><div><h2>${escape(item.label)}</h2><p>${escape(item.detail)}</p></div></article>`).join('');
  const graphic=chapter.visual.kind==='curve'?curveSvg(chapter):chapter.visual.kind==='formula'?formulaSvg(chapter.visual.formula!):'';
  const cues=chapter.cues||chapter.visual.items.map((v,i)=>({text:v.cue,start:.4+i*Math.max(1,(duration-3)/chapter.visual.items.length),end:1+i}));
  const enters=chapter.visual.items.map((_,i)=>{
    const at=Math.max(.35,Math.min(duration-2,cues[i]?.start??.4+i));
    return `tl.from('#item-${i}',{y:10,duration:.45,ease:'power3.out'},${(.12+i*.12).toFixed(3)});QJMotion.focusPulse(tl,'#item-${i}',${(at+.1).toFixed(3)},.6);`;
  }).join('');
  const curves=chapter.visual.plot?.curves.map((_,i)=>`QJMotion.connectorFlow(tl,'#curve-${i}',${(.65+i*.18).toFixed(3)},1.1);tl.from('#legend-${i}',{opacity:0,x:-8,duration:.4,ease:'sine.out'},.4);`).join('')||'';
  const formula=chapter.visual.formula?chapter.visual.formula.split(/[;；\n]/).filter(Boolean).map((_,i)=>`tl.from('#formula-${i}',{opacity:0,duration:.5,ease:'sine.out'},${(.6+i*.2).toFixed(3)});`).join(''):'';
  const takeawayAt=Math.max(1,Math.min(duration-3.2,(cues.at(-1)?.end??duration-4)+.3));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@font-face{font-family:'PingFang SC';src:local('PingFang SC')}@font-face{font-family:'Noto Sans CJK SC';src:local('Noto Sans CJK SC')}
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#fffdfa;color:#282c38;font-family:'PingFang SC','Noto Sans CJK SC',Arial,sans-serif}#main{width:${w}px;height:${h}px;position:relative;padding:${portrait?36:28}px ${portrait?36:48}px}h1{margin:0;font-size:${titleSize}px;line-height:1.18;letter-spacing:-1px;max-width:100%;overflow-wrap:anywhere}.lesson-content{position:absolute;left:${portrait?36:48}px;right:${portrait?36:48}px;top:${portrait?155:125}px;height:${portrait?850:395}px;display:${side?'grid':'flex'};${side?`grid-template-${portrait?'rows':'columns'}:${portrait?'1.12fr 1fr':'1.3fr 1fr'};`:''}gap:${portrait?24:28}px;align-items:center}.graphic{width:100%;height:100%;display:flex;align-items:center}.chart,.formula{width:100%;max-height:100%;overflow:visible}.teaching-items{display:flex;flex-direction:${!side&&!portrait?'row':'column'};gap:14px;width:100%;height:100%;justify-content:center}.teaching-item{position:relative;border:2px solid #e7dfd8;border-radius:18px;background:#fffdfa;display:flex;gap:16px;padding:${padding}px;flex:1;min-width:0;align-items:center}.teaching-item h2{font-size:${labelSize}px;line-height:1.2;margin:0 0 6px;overflow-wrap:anywhere}.teaching-item p{font-size:${detailSize}px;line-height:1.35;margin:0;color:#5a5e68;overflow-wrap:anywhere}.item-number{flex:none;color:#a64a31;font-size:${portrait?26:22}px;line-height:1;font-variant-numeric:tabular-nums}.wide-items .teaching-item{flex-direction:column;align-items:flex-start;justify-content:center;background:#fff3ec}.wide-items h2{font-size:${portrait?32:32}px}.wide-items p{font-size:${portrait?26:24}px;text-wrap:balance}.timeline-items{position:relative}.timeline-items:before{content:'';position:absolute;${portrait?'left:20px;top:0;bottom:0;width:3px':'top:18px;left:0;right:0;height:3px'};background:#4c95b7}.timeline-items .teaching-item{border-top:5px solid #4c95b7}.timeline-items .item-number{background:#397ba4;color:white;border-radius:50%;padding:8px;font-size:18px;z-index:1}.comparison-items .teaching-item:nth-child(2){background:#eaf3f7;border-color:#4c95b7}.takeaway{position:absolute;left:${portrait?36:48}px;right:${portrait?36:48}px;top:${portrait?1030:537}px;margin:0;border-left:4px solid #e56a48;padding:8px 18px;font-size:${portrait?30:27}px;line-height:1.3;max-height:${portrait?100:76}px;overflow-wrap:anywhere}.accent{position:absolute;top:0;left:0;width:100%;height:6px;background:#e56a48}
</style><script src="./gsap.min.js"></script></head><body><section id="main" data-composition-id="main" data-width="${w}" data-height="${h}" data-start="0" data-duration="${duration}"><div id="accent" class="accent"></div><header><h1 id="title">${escape(chapter.title)}</h1></header><main class="lesson-content">${side?`<div id="graphic" class="graphic">${graphic}</div>`:''}<div class="teaching-items ${side?'':'wide-items'} ${chapter.visual.kind==='timeline'?'timeline-items':''} ${chapter.visual.kind==='comparison'?'comparison-items':''}">${cards}</div></main><p id="takeaway" class="takeaway">${escape(chapter.visual.takeaway)}</p></section><script>
// Measure SVG glyphs in the actual rendering browser before any motion. The
// general layout inspector sees the SVG box, but cannot see overflowing text.
for(const node of document.querySelectorAll('[data-math-width]')){
  const limit=Number(node.dataset.mathWidth),minimum=Number(node.dataset.mathMinFont);let size=Number(node.getAttribute('font-size'));
  while(node.getComputedTextLength()>limit&&size>minimum){size--;node.setAttribute('font-size',String(size));}
  if(node.getComputedTextLength()>limit+.5)throw new Error('教学公式/图例超出可读布局：'+node.textContent+'。缩短图例或拆分公式，不能继续缩小字号。');
}
${motionLibrary}window.__timelines={};const tl=gsap.timeline({paused:true});tl.from('#accent',{scaleX:0,transformOrigin:'left',duration:.6,ease:'power2.out'},.1);tl.from('#title',{y:20,duration:.6,ease:'power3.out'},.05);${side?"tl.from('#graphic',{opacity:0,y:12,duration:.6,ease:'power2.out'},.45);":''}${enters}${curves}${formula}tl.from('#takeaway',{opacity:0,x:-12,duration:.5,ease:'power2.out'},${takeawayAt.toFixed(3)});window.__timelines.main=tl;</script></body></html>`;
}

export async function produceLessonScene(chapter:LessonChapter,index:number,total:number,format:Format,speechFile:string,analysis:AudioAnalysis,project:string,pacing?:LessonPacing){
  const lead=pacing?.leadSeconds??.35,tail=pacing?.tailSeconds??.55,duration=+(analysis.duration+lead+tail).toFixed(3);
  const shifted={...chapter,cues:chapter.cues?.map(c=>({...c,start:c.start+lead,end:c.end+lead}))};
  const html=lessonSceneHtml(shifted,index,total,duration,format),htmlHash=hashBytes(html);await mkdir(project,{recursive:true});
  const visual=path.join(project,'visual.mp4'),output=path.join(project,'scene.mp4');
  let cached=false;try{const meta=JSON.parse(await readFile(path.join(project,'visual-cache.json'),'utf8'));cached=meta.htmlHash===htmlHash&&Math.abs((await probeVideo(visual)).duration-duration)<.1;}catch{}
  if(!cached){await writeFile(path.join(project,'index.html'),html);await copyFile(path.join(process.cwd(),'node_modules/gsap/dist/gsap.min.js'),path.join(project,'gsap.min.js'));await renderHtmlProject(project,visual,{fullCheck:true});await writeFile(path.join(project,'visual-cache.json'),JSON.stringify({htmlHash}),{mode:0o600});}
  await runFFmpeg(['-v','error','-y','-i',visual,'-i',speechFile,'-map','0:v','-map','1:a','-c:v','copy','-af',`adelay=${lead*1000}|${lead*1000},apad`,'-t',String(duration),'-c:a','aac','-ar','44100','-ac','2','-movflags','+faststart',output]);
  return {file:output,duration,htmlHash,audioHash:hashBytes(await readFile(speechFile)),analysis:{...analysis,duration,sourceHash:hashBytes(await readFile(output)),sentences:analysis.sentences.map(s=>({...s,start:s.start+lead,end:s.end+lead,words:s.words.map(w=>({...w,start:w.start+lead,end:w.end+lead}))})),pauses:[{start:0,end:lead},...analysis.pauses.map(p=>({start:p.start+lead,end:p.end+lead})),{start:duration-tail,end:duration}]}};
}
