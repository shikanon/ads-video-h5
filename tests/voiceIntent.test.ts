import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, wantsConversation, wantsPlanOnly } from '../server/intents';
import { inferCreationRoute } from '../server/creativeRequest';

const transcript='把附加的视频剪成三秒竖屏成片保留原素材画面不要旁白或音乐直接导出';

test('actual unpunctuated ASR command retains the authorization to export footage',()=>{
  const punctuated='把附加的视频剪成三秒竖屏成片，保留原素材画面，不要旁白或音乐，直接导出。';
  for(const prompt of [transcript,punctuated]) {
    assert.equal(classify(prompt),'export',prompt);
    const route=inferCreationRoute({prompt,history:[],sourceCount:1,hasPlan:false})!;
    assert.equal(route.mode,'footage');assert.equal(route.export,true);
  }
});

for(const prompt of [
  '把上传视频剪成三秒不要旁白直接生成成片',
  '把上传视频做成竖屏不要背景音乐直接生成视频',
  '用原素材不加字幕直接导出',
  '保留原素材不用BGM直接出片',
  '把上传视频剪成三秒不要生成旁白直接导出',
  '把上传视频剪成三秒不要旁白也不要音乐直接导出',
  '把上传视频剪成三秒不要字幕不要配乐然后导出',
]) test(`unpunctuated feature exclusions still allow delivery: ${prompt}`,()=>{
  assert.equal(wantsConversation(prompt),false);
  assert.equal(wantsPlanOnly(prompt),false);
  assert.equal(classify(prompt),'export');
  assert.equal(inferCreationRoute({prompt,history:[],sourceCount:1,hasPlan:false})!.export,true);
});

for(const prompt of [
  '把上传视频剪成三秒不要直接导出',
  '把上传视频剪成三秒不用直接导出',
  '把上传视频剪成三秒不要把这条视频直接导出',
  '把上传视频剪成三秒不要配乐也不要直接导出',
  '把上传视频剪成三秒先给方案不要导出',
  '把上传视频剪成三秒不要旁白或音乐但暂时不导出',
]) test(`explicit no-export requests remain planning only: ${prompt}`,()=>{
  assert.equal(classify(prompt),'plan');
  assert.equal(inferCreationRoute({prompt,history:[],sourceCount:1,hasPlan:false})!.export,false);
});
