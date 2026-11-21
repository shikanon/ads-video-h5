import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {capturePage} from './fixtures/nativeClient';
import {noteInput,detachNoteMedia} from '../server/creativeNoteRoutes';
const require=createRequire(import.meta.url),doc=require('../apps/miniprogram/miniprogram/utils/note-document.js');
test('inline image insertion splits at the cursor, survives storage and deletion keeps surrounding text',()=>{
 const blocks=doc.blocksOf({text:'第一段第二段',attachmentIds:['old-image']});
 const next=doc.insertMedia(blocks,blocks[0].id,3,['sketch']);
 assert.deepEqual(next.blocks.slice(0,3).map((b:any)=>b.type==='text'?b.text:b.mediaId),['第一段','sketch','第二段']);
 const content=doc.contents(next.blocks),body={title:'正文',kind:'note',...content,blocks:next.blocks,category:'项目灵感',strokes:[]},media=['old-image','sketch'].map(id=>({id,ownerId:'a'})) as any;
 const saved=noteInput(body,media,'a');assert.deepEqual(doc.blocksOf(saved),next.blocks);assert.equal(saved.category,'项目灵感');
 const removed=doc.removeBlock(saved.blocks,saved.blocks![1].id);assert.equal(doc.contents(removed).text,content.text);assert.deepEqual(doc.contents(removed).attachmentIds,['old-image']);assert.equal(media.length,2);
 assert.throws(()=>noteInput({...body,attachmentIds:['old-image']},media,'a'),/正文附件/);assert.throws(()=>noteInput(body,media,'other'),/附件/);assert.throws(()=>noteInput({...body,text:'stale'},media,'a'),/不一致/);
});
test('old notes retain every attachment when opened; old clients can still update legacy note input',()=>{
 const b=doc.blocksOf({text:'旧正文',attachmentIds:['a','b']});assert.deepEqual(doc.contents(b).attachmentIds,['a','b']);assert.match(doc.contents(b).text,/旧正文/);
 assert.equal(noteInput({title:'旧笔记',text:'内容',kind:'note',attachmentIds:[],strokes:[]},[],'a').blocks,undefined);
});
test('deleting source media removes inline references and invalidates stale editors only for its owner',()=>{
 const a:any={id:'n',ownerId:'a',revision:3,text:'keep',attachmentIds:['m'],blocks:[{id:'t',type:'text',text:'keep'},{id:'i',type:'media',mediaId:'m'}]},b:any={...structuredClone(a),ownerId:'b'},notes=[a,b];detachNoteMedia(notes,'a','m');assert.equal(a.revision,4);assert.equal(a.text,'keep');assert.equal(a.blocks.length,1);assert.deepEqual(a.attachmentIds,[]);assert.equal(b.revision,3);assert.equal(b.blocks.length,2);
});
test('legacy 300 by 200 hand drawings keep their shape on a portrait drawing page',()=>{const [s]=doc.legacySketch([[{x:0,y:0},{x:1,y:1}]],390,485);const dx=(s.points[1].x-s.points[0].x)*390,dy=(s.points[1].y-s.points[0].y)*485;assert.ok(Math.abs(dx/dy-1.5)<1e-9);assert.ok(s.points.every((p:any)=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));});
function fixture(){const storage=new Map(),calls:any[]=[],state:any={account:{id:'a'},media:[],sessions:[],artifacts:[],jobs:[],models:[],settings:{}},app:any={_generation:1,user:{id:'a'},state,client:{hasSession:()=>true,previewUrl:()=>'',request:async(route:string,body:any)=>{calls.push({route,body});if(body)return {note:{...body,id:'saved',revision:2}};return {notes:[]};}},subscribe:()=>()=>{},refresh:async()=>state};const wx:any={showShareMenu(){},getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:any)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key),showToast(){},showModal:(o:any)=>o.success({confirm:true}),setClipboardData(){}};return {storage,calls,app,wx};}
test('editor undo, redo, save and draft recovery retain mixed content and separate accounts',async()=>{
 const f=fixture(),p=await capturePage('notes',f.app,f.wx);p.onLoad({});p.edit({title:'灵感',text:'正文',attachmentIds:[],strokes:[]});p._active=p.data.blocks[0].id;p._cursor=1;p.insert(['image']);assert.equal(p.data.dirty,true);assert.equal(doc.contents(p.data.blocks).attachmentIds.length,1);p.undo();assert.equal(doc.contents(p.data.blocks).attachmentIds.length,0);p.redo();assert.equal(doc.contents(p.data.blocks).attachmentIds[0],'image');
 p.stash();assert.equal(f.storage.get('lightmao.note-draft.a').blocks[1].mediaId,'image');const reopened=await capturePage('notes',f.app,f.wx);reopened.onLoad({});await reopened.load();assert.equal(reopened.data.editor,true);assert.equal(reopened.data.dirty,true);assert.deepEqual(doc.contents(reopened.data.blocks).attachmentIds,['image']);
 assert.equal(await reopened.save(),true);assert.equal(f.storage.has('lightmao.note-draft.a'),false);assert.equal(f.calls.at(-1).body.blocks[1].mediaId,'image');
 f.app._generation++;f.app.user={id:'b'};f.app.state={...f.app.state,account:{id:'b'}};reopened.onShow();assert.equal(reopened.data.editor,false);assert.equal(reopened.data.title,'');assert.equal(reopened.data.blocks.length,0);reopened.onHide();p.onHide();
});
test('conflicted saves retain the exact local draft and do not close the editor',async()=>{
 const f=fixture(),p=await capturePage('notes',f.app,f.wx);p.onLoad({});p.edit({id:'n',revision:1,title:'本地修改',text:'不得丢失',attachmentIds:[],strokes:[]});p.setData({dirty:true});f.app.client.request=async()=>{throw Object.assign(Error('conflict'),{status:409});};await p.done();assert.equal(p.data.editor,true);assert.equal(p.data.dirty,true);assert.match(p.data.error,/别处更新/);p.onHide();assert.equal(f.storage.get('lightmao.note-draft.a').title,'本地修改');
});
test('all note entry points reach the full-page editor while MV and template drafts retain their specialized tools',async()=>{
 const f=fixture(),routes:string[]=[];f.wx.navigateTo=(o:any)=>routes.push(o.url);f.wx.redirectTo=(o:any)=>routes.push(o.url);const old=await capturePage('creative-studio',f.app,f.wx);old.onLoad({mode:'character'});await old.mode({currentTarget:{dataset:{id:'note'}}});assert.equal(routes.pop(),'/pages/notes/index');
 old.onLoad({noteId:'legacy'});f.app.client.request=async()=>({notes:[{id:'legacy',kind:'note'}]});await old.loadNotes();assert.equal(routes.pop(),'/pages/notes/index?noteId=legacy');
 const p=await capturePage('notes',f.app,f.wx);p.onLoad({});for(const kind of ['mv','template']){p.edit({id:'draft',kind});assert.equal(routes.pop(),'/pages/creative-studio/index?mode='+kind+'&noteId=draft');}assert.equal(p.data.editor,false);
});
test('discarding unsaved edits exits without writing or deleting the saved note and cannot resurrect its draft',async()=>{
 const f=fixture(),p=await capturePage('notes',f.app,f.wx);p.onLoad({});p.edit({id:'existing',revision:2,title:'已保存',text:'原正文',strokes:[],attachmentIds:[]});p.field({currentTarget:{dataset:{field:'title'}},detail:{value:'临时修改'}});p.stash();assert.ok(f.storage.has('lightmao.note-draft.a'));let label='';f.wx.showModal=(o:any)=>{label=o.cancelText;o.success({cancel:true});};await p.back();await new Promise(r=>setTimeout(r,350));assert.equal(label,'不保存');assert.equal(p.data.editor,false);assert.equal(p.data.dirty,false);assert.equal(f.storage.has('lightmao.note-draft.a'),false);assert.ok(f.calls.every(c=>c.body===undefined));p.onUnload();
});
