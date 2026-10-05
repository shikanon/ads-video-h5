import test from 'node:test';
import assert from 'node:assert/strict';
import type { LessonBarChart, LessonChapter } from '../src/types';
import { barChartSvg, validateBarChart, inferBarData, chapterBarChart, barChartDetail } from '../server/barChart';
import { lessonSceneHtml } from '../server/lessonScenes';

const chart:LessonBarChart={unit:'分',illustrative:true,bars:[{label:'甲',value:40},{label:'乙',value:90}],panels:[{title:'零基线',min:0,max:100}]};
const group=(svg:string,id:string)=>svg.match(new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`))![1];
const barHeight=(svg:string,id:string)=>Number(group(svg,id).match(/<rect[^>]*height="([0-9.]+)"/)![1]);
test('numeric bar heights preserve the source ratio and show actual values and units',()=>{
  const svg=barChartSvg(chart);assert.ok(Math.abs(barHeight(svg,'chart-bar-0-1')/barHeight(svg,'chart-bar-0-0')-2.25)<1e-8);
  assert.match(svg,/单位：分/);assert.match(group(svg,'chart-bar-0-0'),/>40<\/text>/);assert.match(group(svg,'chart-bar-0-1'),/>90<\/text>/);
});
test('a cropped axis shows unchanged raw values, marks out-of-range data, and cannot pose as a normal chart',()=>{
  const clipped={...chart,panels:[...chart.panels,{title:'错误截断示意',min:60,max:100}]};
  const svg=barChartSvg(clipped),below=group(svg,'chart-bar-1-0');assert.match(below,/40↓/);assert.match(below,/低于下限/);assert.doesNotMatch(below,/<rect/);
  assert.equal(barHeight(svg,'chart-bar-1-1'),169.5);assert.match(svg,/截断示意：下限 60/);
  assert.throws(()=>validateBarChart({...chart,panels:[{title:'正常图',min:60,max:100}]}),/非零基线/);
});
test('legacy chart recovery derives values from supplied labels and does not invent a stock dataset',()=>{
  const chapter={id:'c3',visual:{kind:'comparison',takeaway:'柱高比较',items:[{label:'甲 40分',detail:'示意数据',cue:'甲'},{label:'乙 70分',detail:'示意数据',cue:'乙'},{label:'丙 55分',detail:'示意数据',cue:'丙'},{label:'丁 90分',detail:'示意数据',cue:'丁'}]}} as LessonChapter;
  const common=inferBarData([chapter])!;assert.deepEqual(common.bars.map(b=>b.value),[40,70,55,90]);
  const comparison={...chapter,visual:{...chapter.visual,items:[{label:'正确：0–100',detail:'乙70、丙55从零开始',cue:'零'},{label:'错误：60–100',detail:'乙70、丙55在截断坐标中',cue:'截断'}]}};
  assert.deepEqual(chapterBarChart(comparison,common)?.bars,[{label:'乙',value:70},{label:'丙',value:55}]);
  assert.deepEqual(chapterBarChart(comparison,common)?.panels.map(p=>[p.min,p.max]),[[0,100],[60,100]]);
  assert.equal(inferBarData([{...chapter,visual:{...chapter.visual,items:chapter.visual.items.map(i=>({...i,label:'未提供数据'}))}}]),undefined);
});
test('a chart is rendered as the actual scene graphic instead of unrelated repeated icons',()=>{
  const chapter={id:'c0',title:'比较示意得分',narration:'甲乙比较',visual:{kind:'bar-chart',barChart:chart,takeaway:'回到原始数值',items:[{label:'甲',detail:'40分',cue:'甲'},{label:'乙',detail:'90分',cue:'乙'}]}} as LessonChapter;
  const html=lessonSceneHtml(chapter,0,3,6,'16:9');assert.match(html,/id="graphic"/);assert.match(html,/data-value="40"/);assert.doesNotMatch(html,/data-illustration=/);
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script[1]));
});

test('multiple chart categories do not permanently mark the second category as selected',()=>{
  const chapter={id:'c0',title:'比较示意得分',narration:'丁最高，甲最短。',visual:{kind:'comparison',takeaway:'回到数值',items:[{label:'甲 40分',detail:'最短',cue:'甲最短'},{label:'乙 70分',detail:'示意',cue:'丁最高'},{label:'丙 55分',detail:'示意',cue:'丁最高'},{label:'丁 90分',detail:'最高',cue:'丁最高'}]}} as LessonChapter;
  const html=lessonSceneHtml(chapter,0,3,6,'16:9',undefined,false,chart);
  assert.doesNotMatch(html,/\.comparison-items \.teaching-item:nth-child\(2\)\{background:#eaf3f7/);
  assert.match(html,/tl\.to\('#title',\{opacity:0/);
});

test('numeric chart cards describe verified values and ranks instead of printing animation instructions',()=>{
  const item={label:'乙 90分',detail:'旁白讲到时高亮，作为对照柱保持可见',cue:'乙'};
  assert.equal(barChartDetail(item,chart),'数值 90分；本组最高');
  const chapter={id:'c0',title:'比较数据',narration:'甲乙比较',visual:{kind:'bar-chart',barChart:chart,takeaway:'查看数值',items:[{label:'甲 40分',detail:'旁白讲到时高亮',cue:'甲'},item]}} as LessonChapter;
  const html=lessonSceneHtml(chapter,0,3,6,'16:9');assert.doesNotMatch(html,/旁白讲到|保持可见/);assert.match(html,/数值 40分；本组最低/);assert.match(html,/数值 90分；本组最高/);
});
