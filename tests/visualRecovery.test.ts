import test from 'node:test';
import assert from 'node:assert/strict';
import type { LessonReport, RenderReview } from '../src/types';
import { drawingHtml, validateDrawing, type HtmlDrawing } from '../server/narrativeScenes';
import { visualRepairTargets } from '../server/visualRecovery';

test('a landscape diagram uses the requested canvas and protects the subtitle area',()=>{
  const drawing:HtmlDrawing={title:'柱长示意',nodes:[{id:'axis',kind:'line',x:100,y:460,w:1000,h:0,text:'',tone:'ink',fontSize:24,highlight:false},{id:'bar',kind:'path',pathData:'M300 460V220H400V460Z',x:300,y:220,w:100,h:240,text:'',tone:'blue',fontSize:24,highlight:true},{id:'label',kind:'text',x:290,y:465,w:240,h:70,text:'甲 40分',tone:'ink',fontSize:32,highlight:false}]};
  assert.doesNotThrow(()=>validateDrawing(drawing,'16:9'));
  assert.throws(()=>validateDrawing(drawing,'9:16'),/安全区/);
  assert.throws(()=>validateDrawing({...drawing,nodes:drawing.nodes.map(n=>n.id==='label'?{...n,y:610}:n)},'16:9'),/安全区/);
  const html=drawingHtml(drawing,6,'16:9');
  assert.match(html,/data-width="1280" data-height="720"/);
  assert.match(html,/viewBox="0 0 1280 720"/);
  assert.match(html,/M300 460V220H400V460Z/);
  assert.match(html,/甲 40分/);
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script[1]));
});

test('only a verified visual rendering defect can preserve the script during repair',()=>{
  const report={chapters:[{id:'c0'},{id:'c1'},{id:'c2'}],factReview:{score:95,needsRepair:false,findings:[]}} as LessonReport;
  const rejected=(findings:string[]):RenderReview=>({status:'needs-review',score:85,checks:[{name:'成片语义审查',passed:false,detail:findings.join(';')}],semantic:{score:85,findings,suggestions:[]},limitations:[],createdAt:''});
  assert.deepEqual(visualRepairTargets(report,rejected(['c1：没有出现柱状图，配图为无关图标'])),['c1']);
  assert.deepEqual(visualRepairTargets(report,rejected(['全局：静态卡片未呈现实际示意图'])),['c0','c1','c2']);
  for(const finding of ['c0：图解说明不准确','c0：字幕错误，图标无关','c0：数据错误，柱状图错误','c0：音色漂移'])assert.deepEqual(visualRepairTargets(report,rejected([finding])),[]);
  assert.deepEqual(visualRepairTargets({...report,factReview:{score:70,needsRepair:true,findings:['事实未核验']}},rejected(['全局：配图无关'])),[]);
});
