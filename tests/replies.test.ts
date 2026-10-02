import test from 'node:test';
import assert from 'node:assert/strict';
import { recordWorkflowReply, updateReply } from '../server/replies';
import type { Job, Session, WorkflowEvent } from '../src/types';

const fixture=()=>{
  const session:Session={id:'session',title:'test',modelId:null,createdAt:'now',updatedAt:'now',messages:[],plan:null};
  const job:Job={id:'job',sessionId:'session',messageId:'request',kind:'export',status:'running',createdAt:'now',updatedAt:'now'};
  return {session,job};
};
test('incremental sections retain their identities and the final summary never replaces prior progress',()=>{
  const {session,job}=fixture();
  updateReply(session,job,'正在整理','commentary','first');
  updateReply(session,job,'素材已整理','commentary','first');
  updateReply(session,job,'正在渲染','commentary','second');
  assert.equal(session.messages[0].text,'');
  updateReply(session,job,'已生成视频，仍需复核。','final','final','artifact');
  updateReply(session,job,'已生成视频，评分78。','final','final','artifact');
  const reply=session.messages[0];
  assert.equal(session.messages.length,1);assert.equal(reply.parts?.length,3);
  assert.equal(reply.parts?.[0].text,'素材已整理');assert.equal(reply.parts?.[1].text,'正在渲染');
  assert.equal(reply.text,'已生成视频，评分78。');assert.deepEqual(reply.artifactIds,['artifact']);
});
test('workflow polling is idempotent and retries retain failures without claiming successful completion',()=>{
  const {session,job}=fixture();
  const events:WorkflowEvent[]=[{tool:'produce_scenes',stage:'绘制分镜',status:'running',at:'now'}];
  recordWorkflowReply(session,job,events);recordWorkflowReply(session,job,events);
  assert.equal(session.messages[0].parts?.length,1);
  events[0]={...events[0],status:'failed',detail:'字体溢出'};
  events.push({tool:'produce_scenes',stage:'绘制分镜',status:'running',at:'later'});
  recordWorkflowReply(session,job,events);
  assert.equal(session.messages[0].parts?.length,2);
  assert.match(session.messages[0].parts![0].text,/字体溢出/);
  assert.match(session.messages[0].parts![1].text,/正在/);
  assert.equal(session.messages[0].text,'');
});
test('different jobs never overwrite each other and failed results remain explicit',()=>{
  const {session,job}=fixture();
  updateReply(session,job,'检查声音','commentary','start');
  updateReply(session,job,'本次处理未完成：连接超时');
  updateReply(session,{...job,id:'next'},'准备新的任务','commentary','start');
  assert.equal(session.messages.length,2);
  assert.match(session.messages[0].text,/未完成/);
  assert.equal(session.messages[1].parts?.[0].phase,'commentary');
});
