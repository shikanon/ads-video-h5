const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage, shareTimeline } = require("../../utils/share");
const { mediaView, artifactView, jobView, active } = require('../../utils/view');
const { notify, withSession, hide, requireLogin, guestState } = require('../../utils/page');
const { chooseFiles, uploadMedia, livePhotoHelp } = require('../../utils/upload');
const { loadThumbnails, coverError } = require('../../utils/thumbnails');
const { collectionOf, isProduction } = require('../../utils/media-collections');
const emptySelection = { selecting: false, selectedIds: [], pickingFolder: false };
Page({
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
  data: Object.assign(appearanceData(), emptySelection, { section: 'materials', jobs: [], materialCount: 0, filmCount: 0, items: [], collection: 'library', query: '', filter: 'all', more: false, uploading: false, uploadText: '', count: 0, deleting: false, deleteProgress: '', deleteError: '' }),
  onLoad() { this._limit = 30; this._sectionViews = {};this._generation=getApp()._generation;this.setData({folderId:'all',folders:[]}); },
  onShow() {
    const app = getApp();
    if(this._generation!==app._generation){this._generation=app._generation;this.setData({...emptySelection,folderId:'all',folders:[],deleting:false,deleteProgress:'',deleteError:''});}
    if (app.pendingResourceSection) { this.changeSection(app.pendingResourceSection, false); app.pendingResourceSection = null; }
    if (app.pendingLibraryCollection) { this.changeSection('materials', false); this.setData({ collection: app.pendingLibraryCollection }); this._limit = 30; app.pendingLibraryCollection = null; }
    withSession(this, this.render);
  },
  onHide() { hide(this); }, onUnload() { hide(this); },
  render(state) {
    const films = this.data.section === 'films';
    const folders = state.mediaFolders || [];
    let folderId = this.data.folderId || 'all';
    if (!['all', 'none'].includes(folderId) && !folders.some(folder => folder.id === folderId)) folderId = 'all';
    const existing = new Set((films ? state.artifacts : state.media).map(item => item.id));
    const selectedIds = this.data.selectedIds.filter(id => existing.has(id));
    this.setData({ folders, folderId, folderName: folders.find(folder => folder.id === folderId)?.name || '', selectedIds });
    const source = films ? state.artifacts.filter(a=>!a.productionOnly) : state.media.filter(item => !item.character && (this.data.collection === 'clips' ? Boolean(item.archive) && collectionOf(item) === 'library' : collectionOf(item) === this.data.collection));
    const kindFilters = [{ id: 'all', name: '全部' }, { id: 'video', name: '视频' }, { id: 'image', name: '图片' }, { id: 'audio', name: '音频' }].concat(films ? [{ id: 'sticker-pack', name: '表情包' }, { id: 'game', name: '游戏' }] : [{id:'document',name:'文档'}]);
    const kindCounts = { all: source.length }; for (const item of source) kindCounts[item.kind] = (kindCounts[item.kind] || 0) + 1;
    this.setData({ kindFilters, kindCounts });
    this.setData({ materialCount: state.media.filter(item => !item.character && collectionOf(item) === 'library').length, filmCount: state.artifacts.filter(a=>!a.productionOnly).length });
    if (films) {
      const needle = this.data.query.trim().toLowerCase();
      const all = state.artifacts.filter(item => !item.productionOnly && (this.data.filter === 'all' || item.kind === this.data.filter) && item.name.toLowerCase().includes(needle)).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.setData({ items: all.slice(0, this._limit).map(item => ({ ...artifactView(item, getApp().client), selected: selectedIds.includes(item.id) })), jobs: state.jobs.filter(active).slice(0, 10).map(job => jobView(job)), more: all.length > this._limit, count: all.length });
      loadThumbnails(this, 'items', getApp().client);
      return;
    }
    const needle = this.data.query.trim().toLowerCase(), all = state.media.filter(item => !item.character && (folderId==='all'||(folderId==='none'?!item.folderId:item.folderId===folderId)) && (this.data.collection === 'clips' ? Boolean(item.archive) && collectionOf(item) === 'library' : collectionOf(item) === this.data.collection) && (this.data.filter === 'all' || item.kind === this.data.filter) && (item.name + ' ' + (item.archive && item.archive.tags || []).join(' ')).toLowerCase().includes(needle)).slice().reverse();
    this.setData({ items: all.slice(0, this._limit).map(item => Object.assign(mediaView(item, getApp().client), { selected:selectedIds.includes(item.id), production: collectionOf(item) === 'production', productionSource: isProduction(item), archivedClip: Boolean(item.archive), tags: item.archive && item.archive.tags || [] })), jobs: [], more: all.length > this._limit, count: all.length, productionCount: state.media.filter(m => !m.character && collectionOf(m) === 'production').length });
    loadThumbnails(this, 'items', getApp().client);
  },
  section(event) { if (!this.data.deleting) this.changeSection(event.currentTarget.dataset.section, true); },
  changeSection(section, render) {
    if (!['materials', 'films'].includes(section) || section === this.data.section) return;
    const views = this._sectionViews || (this._sectionViews = {});
    views[this.data.section] = { query: this.data.query, filter: this.data.filter, limit: this._limit || 30 };
    const next = views[section] || { query: '', filter: 'all', limit: 30 };
    this._limit = next.limit;
    this.setData({ ...emptySelection, section, query: next.query, filter: next.filter, items: [], jobs: [], deleteError: '' });
    if (render) { this.render(getApp().state || guestState()); if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 }); }
  },
  filter(event) { this.changeFilter('filter', event.currentTarget.dataset.kind); },
  collection(event) { this.changeFilter('collection', event.currentTarget.dataset.collection); },
  search(event) { this.changeFilter('query', event.detail.value); },
  changeFilter(key, value) {
    if (this.data.deleting || this.data[key] === value) return;
    this._limit = 30;
    this.setData({ ...emptySelection, [key]: value, deleteError: '' });
    this.render(getApp().state || guestState());
  },
  film(event) { wx.navigateTo({ url: '/pages/film/index' + (event.currentTarget.dataset.id ? '?id=' + encodeURIComponent(event.currentTarget.dataset.id) : '') }); },
  async itemMenu(event) {
    if (this.data.selecting || this.data.deleting) return;
    const item = this.data.items.find(item => item.id === event.currentTarget.dataset.id); if (!item) return;
    const app = getApp(), generation = app._generation, section = this.data.section;
    const options = [{ name: '预览', run: () => this.play(event) }];
    options.push({name:'重命名',run:()=>require('../../utils/manage').rename(this,'/api/'+(section==='materials'?'media':'artifacts')+'/'+encodeURIComponent(item.id),'name',item.name)});
    if(section==='films')options.push({name:'删除作品',run:()=>require('../../utils/manage').deleteArtifact(this,item.id)});
    const materialOptions=[];
    if (section === 'materials') {
      materialOptions.push({name:'移入文件夹',run:()=>{this.setData({selectedIds:[item.id],pickingFolder:true});}});
      const original=(app.state.media||[]).find(m=>m.id===item.id);if(original?.folderId&&['video','audio'].includes(item.kind)){if(item.kind==='video')materialOptions.push({name:'设为MV参考片',run:()=>this.setMvRole(original,'referenceId')});materialOptions.push({name:'设为MV配乐',run:()=>this.setMvRole(original,'audioId')});}
      if (!item.production) options.push({ name: '用来创作', run: () => this.use(event) });
      if (item.kind === 'video' && !item.production) options.push({ name: '拉片分析', run: () => this.film(event) });
      if (item.production || item.productionSource) materialOptions.push({ name: item.production ? '恢复到可用素材' : '移到制作归档', run: () => this.moveCollection({ currentTarget: { dataset: { id: item.id, collection: item.production ? 'library' : 'production' } } }) });
      options.push({ name: '删除素材', run: () => this.remove(event) });
    }
    if(materialOptions.length)options.push({name:'素材整理 / MV设置',run:async()=>{const at=await new Promise(resolve=>wx.showActionSheet({itemList:materialOptions.map(v=>v.name),success:r=>resolve(r.tapIndex),fail:()=>resolve(-1)}));if(app._generation===generation&&this._visible&&materialOptions[at])return materialOptions[at].run();}});
    const index = await new Promise(resolve => wx.showActionSheet({ itemList: options.map(option => option.name), success: result => resolve(result.tapIndex), fail: () => resolve(-1) }));
    if (!this._visible || this.data.selecting || app._generation !== generation || this.data.section !== section || !this.data.items.some(current => current.id === item.id)) return;
    if (options[index]) return options[index].run();
  },
  async moveCollection(event) { if (!requireLogin()) return; if (!getApp().state.features || !getApp().state.features.filmAnalysis) { notify(new Error('当前服务暂不支持保存素材归档位置。')); return; } try { await getApp().mutate('/api/media/' + encodeURIComponent(event.currentTarget.dataset.id) + '/collection', { collection: event.currentTarget.dataset.collection }, 'PATCH'); wx.showToast({ title: '已更新归档位置', icon: 'none' }); } catch (error) { notify(error); } },
  more() { this._limit += 30; this.render(getApp().state || guestState()); },
  play(event) {
    if (this.data.deleting) return;
    const id = event.currentTarget.dataset.id;
    if (this.data.selecting) {
      if (!this.data.items.some(item => item.id === id)) return;
      const selected = this.data.selectedIds;
      this.updateSelection(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
      return;
    }
    wx.navigateTo({ url: '/pages/player/index?type=' + (this.data.section === 'films' ? 'artifact' : 'media') + '&id=' + encodeURIComponent(id) });
  },
  selectOnHold(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.deleting || !this.data.items.some(item => item.id === id) || !requireLogin()) return;
    this.setData({ selecting: true, deleteError: '' });
    this.updateSelection([...new Set([...this.data.selectedIds, id])]);
  },
  updateSelection(selectedIds) {
    const selected = new Set(selectedIds);
    this.setData({ selectedIds, items: this.data.items.map(item => ({ ...item, selected: selected.has(item.id) })) });
  },
  async removeSelected() {
    if (!this.data.selecting || this.data.deleting || !this.data.selectedIds.length || !requireLogin()) return;
    const app = getApp();
    const generation = app._generation;
    const section = this.data.section;
    const ids = [...this.data.selectedIds];
    const resource = section === 'films' ? '作品' : '素材';
    const endpoint = section === 'films' ? '/api/artifacts/' : '/api/media/';
    const failed = [];
    let deleted = 0;
    this.setData({ deleting: true, deleteError: '' });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '删除这 ' + ids.length + ' 项' + resource + '？',
        content: section === 'films' ? '作品将从资源和对话中移除，原素材保留。' : '素材将从资源库移除，引用这些素材的项目可能需要重新选择文件。',
        confirmText: '删除',
        confirmColor: '#b55841',
        success: result => resolve(result.confirm),
        fail: () => resolve(false),
      }));
      if (!confirmed || !this._visible || section !== this.data.section || generation !== app._generation) return;
      for (const [index, id] of ids.entries()) {
        if (generation !== app._generation || !app.client.hasSession()) return;
        this.setData({ deleteProgress: '删除中 ' + (index + 1) + '/' + ids.length });
        try {
          await app.mutate(endpoint + encodeURIComponent(id), undefined, 'DELETE');
          deleted++;
        } catch (error) {
          failed.push({ id, message: error.message || '请稍后重试。' });
          if (!error.status) {
            for (const pending of ids.slice(index + 1)) failed.push({ id: pending, message: '等待重试。' });
            break;
          }
        }
      }
      if (generation !== app._generation || !app.client.hasSession()) return;
      // A timed-out request may already have deleted the file.
      if (failed.length) {
        try { await app.refresh(); } catch {}
      }
      if (generation !== app._generation || !app.client.hasSession()) return;
      const existing = new Set((section === 'films' ? app.state.artifacts : app.state.media).map(item => item.id));
      const remaining = failed.filter(item => existing.has(item.id));
      this.setData({
        selecting: remaining.length > 0,
        deleteError: remaining.length ? '已移除 ' + (ids.length - remaining.length) + ' 项，' + remaining.length + ' 项未删除。' + remaining[0].message : '',
      });
      this.updateSelection(remaining.map(item => item.id));
      if (this._visible && !remaining.length) wx.showToast({ title: deleted === ids.length ? '已删除 ' + deleted + ' 项' : '所选项目已移除', icon: 'success' });
    } finally {
      if (generation === app._generation) this.setData({ deleting: false, deleteProgress: '' });
    }
  },
  create() { wx.switchTab({ url: '/pages/chat/index' }); },
  async session(event) {
    const app = getApp(), job = app.state && app.state.jobs.find(item => item.id === event.currentTarget.dataset.id);
    if (!job) return;
    try { await app.mutate('/api/sessions/' + encodeURIComponent(job.sessionId) + '/activate', {}); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); }
  },
  coverError(event) { coverError(this, 'items', event, getApp().client); },
  retryCover() { loadThumbnails(this, 'items', getApp().client); },
  livePhotoHelp,
  use(event) { getApp().pendingAttachments = [event.currentTarget.dataset.id]; wx.switchTab({ url: '/pages/chat/index' }); },
  async upload() {
    if (this.data.uploading || this.data.selecting) return;
    if (!requireLogin()) return;
    const app=getApp(),generation=app._generation,targetFolder=this.data.folderId;
    this.setData({ uploading: true });
    try {
      const source = await new Promise(resolve => wx.showActionSheet({ itemList: ['相册 / 拍摄（图视频混选）', '聊天文件 / 音频', 'Word / 文本设定'], success: result => resolve(result.tapIndex), fail: () => resolve(null) }));
      if (source === null) return;
      const files = await chooseFiles(source === 1,20,source === 2); if (!files.length) return;
      if(generation!==app._generation)return;
      const ids=await uploadMedia(app, files, (at, total, percent) => {if(generation===app._generation)this.setData({ uploadText: '上传 ' + at + '/' + total + ' · ' + percent + '%' });});
      if(generation!==app._generation)return;
      if(!['all','none'].includes(targetFolder)&&ids.length)await app.mutate('/api/media-folders/assign',{folderId:targetFolder,mediaIds:ids});
      wx.showToast({ title: '已添加 ' + files.length + ' 个素材', icon: 'success' });
    } catch (error) { notify(error); }
    finally { this.setData({ uploading: false, uploadText: '' }); }
  },
  async remove(event) {
    if (!requireLogin()) return;
    const id = event.currentTarget.dataset.id;
    const confirm = await new Promise(resolve => wx.showModal({ title: '删除素材？', content: '此操作会从账号素材库删除该文件，请确认无需继续使用。', confirmText: '删除', confirmColor: '#b55841', success: result => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirm) return;
    try { await getApp().mutate('/api/media/' + encodeURIComponent(id), undefined, 'DELETE'); } catch (error) { notify(error); }
  },
  folder(e){this.changeFilter('folderId',e.currentTarget.dataset.id);},
  async addFolder(){if(!requireLogin())return;const app=getApp(),g=app._generation;const name=await new Promise(resolve=>wx.showModal({title:'新建文件夹',editable:true,placeholderText:'如：画中归人',success:r=>resolve(r.confirm?r.content:''),fail:()=>resolve('')}));if(name&&g===app._generation)try{await app.mutate('/api/media-folders',{name});}catch(e){notify(e);}},
  async folderMenu(e){const f=(this.data.folders||[]).find(f=>f.id===e.currentTarget.dataset.id);if(!f)return;const app=getApp(),g=app._generation;const at=await new Promise(resolve=>wx.showActionSheet({itemList:['重命名','用来做MV','重设MV素材','删除文件夹'],success:r=>resolve(r.tapIndex),fail:()=>resolve(-1)}));if(g!==app._generation)return;if(at===2){try{await app.mutate('/api/media-folders/'+encodeURIComponent(f.id),{mv:{referenceId:null,audioId:null,recipeProjectId:null}},'PATCH');}catch(e){notify(e);}return;}if(at===0)return require('../../utils/manage').rename(this,'/api/media-folders/'+encodeURIComponent(f.id),'name',f.name,40);if(at===1){app.pendingMvFolder=f.id;return wx.switchTab({url:'/pages/templates/index'});}if(at===3&&await new Promise(resolve=>wx.showModal({title:'删除文件夹？',content:'素材保留，移回未分类。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))&&g===app._generation)try{await app.mutate('/api/media-folders/'+encodeURIComponent(f.id),undefined,'DELETE');}catch(e){notify(e);}},
  organize(){
    if (this.data.deleting || !requireLogin()) return;
    this.setData({ selecting: !this.data.selecting, deleteError: '' });
    this.updateSelection([]);
  },
  pickFolder(){if(!this.data.deleting && this.data.section==='materials' && this.data.selectedIds.length)this.setData({pickingFolder:true});},
  closeFolder(){this.setData({pickingFolder:false});},
  async assignFolder(e){const folderId=e.currentTarget.dataset.id||null,mediaIds=this.data.selectedIds||[];if(!mediaIds.length||this.data.deleting)return;try{await getApp().mutate('/api/media-folders/assign',{folderId,mediaIds});this.setData(emptySelection);this.updateSelection([]);}catch(e){notify(e);}},
  async setMvRole(item,role){try{await getApp().mutate('/api/media-folders/'+encodeURIComponent(item.folderId),{mv:{[role]:item.id}},'PATCH');wx.showToast({title:role==='referenceId'?'已设为参考片':'已设为配乐',icon:'none'});}catch(e){notify(e);}},
  mvFolder(){if(!['all','none'].includes(this.data.folderId)){getApp().pendingMvFolder=this.data.folderId;wx.switchTab({url:'/pages/templates/index'});}},
});
