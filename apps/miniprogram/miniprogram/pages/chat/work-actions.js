const { active } = require('../../utils/view');
const { notify, privacy, requireLogin } = require('../../utils/page');
const { loadThumbnails } = require('../../utils/thumbnails');

const statusNames = { pending: '待启动', queued: '排队中', running: '制作中', stopping: '停止中', succeeded: '已完成', failed: '未完成', cancelled: '已停止', unconfirmed: '待核对' };

function context(page) {
  const app = getApp();
  const generation = app._generation;
  const sessionId = page.data.sessionId;
  return { app, generation, sessionId, current: () => generation === app._generation && sessionId === page.data.sessionId };
}

async function run(page, action) {
  if (page.data.workBusy || !requireLogin()) return;
  const ctx = context(page);
  page.setData({ workBusy: true, error: '' });
  try {
    if (ctx.app._restored) await ctx.app.refresh();
    if (!ctx.current() || !page._visible) return;
    if (ctx.app._restored) throw Error('会话仍在同步，请稍后再试。');
    return await action(ctx);
  } catch (error) {
    if (ctx.current()) page.setData({ error: error.message || error.errMsg || '操作未完成，请重试。' });
  } finally {
    if (ctx.current()) page.setData({ workBusy: false });
  }
}

function confirm(title, content) {
  return new Promise(resolve => wx.showModal({ title, content, confirmText: '确认', success: result => resolve(result.confirm), fail: () => resolve(false) }));
}

function canContinue(page, ctx) {
  return page._visible && ctx.current();
}

// Keep a stable request ID when a response is lost and the same form is retried.
function requestId(page, type, payload) {
  const ids = page._workRequests || (page._workRequests = {});
  const key = JSON.stringify(payload);
  if (!ids[type] || ids[type].key !== key) ids[type] = { key, id: type + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) };
  return ids[type].id;
}

function commit(ctx, response) {
  if (ctx.current() && response.state) (ctx.app.commit || ctx.app.apply).call(ctx.app, response.state);
}

function panelOptions(state) {
  const folders = state.mediaFolders || [];
  const media = state.media || [];
  return {
    folderOptions: folders.map(item => ({ id: item.id, name: item.name })),
    audioOptions: media.filter(item => ['video', 'audio'].includes(item.kind) && item.duration && item.hasAudio !== false).map(item => ({ id: item.id, name: item.name })),
    batchTemplates: (state.templates || []).filter(item => !item.output || item.output === 'video').map(({ id, name }) => ({ id, name })),
    resolutions: [480, 720, 1080],
  };
}

function panel(page, value) {
  page.setData({ workPanel: value, workPanelCommand: page.data.prompt.trim(), focus: false, error: '' });
  if (wx.hideKeyboard) wx.hideKeyboard();
  page.scroll();
}

function closeCompletedPanel(page) {
  const same = page.data.prompt.trim() === page.data.workPanelCommand;
  if (same) page._recognized = null;
  page.setData(Object.assign({ workPanel: null, workPanelCommand: '' }, same ? { prompt: '', templateName: '', cursor: 0, voiceReady: false } : {}));
  page.scroll();
}

function requiredSession(ctx) {
  const session = (ctx.app.state.sessions || []).find(item => item.id === ctx.sessionId && !item.archivedAt);
  if (!session) throw Error('请先打开一个可继续使用的会话。');
  return session;
}

function notePanel(note) {
  return {
    type: 'note',
    name: note && note.title || '',
    text: note && note.text || '',
  };
}

function showCurrentBatch(page, state) {
  const batch = (state.toolBatches || []).find(item => item.id === page.data.workBatchId);
  if (!batch) return;
  const batchView = { ...batch, items: batch.items.map(item => ({ ...item, statusLabel: statusNames[item.status] || item.status })) };
  if (JSON.stringify(page.data.workBatch) !== JSON.stringify(batchView)) page.setData({ workBatch: batchView });
}

async function syncProject(page, type, job) {
  if (!job || !page._visible) return;
  const ctx = context(page);
  const key = [job.id, job.status, type === 'mv' ? job.stage : ''].join(':');
  const keys = page._workProjectKeys || (page._workProjectKeys = {});
  if (keys[type] === key) return;
  keys[type] = key;
  try {
    if (type === 'sticker') {
      const { project } = await ctx.app.client.request('/api/sticker-projects/' + encodeURIComponent(job.stickerGenerationTask.projectId));
      if (!canContinue(page, ctx) || page._workProjectKeys !== keys || keys[type] !== key) return;
      const candidates = project.styleCandidates || [];
      const stage = (project.completed || []).map(item => ({ ...item, name: item.name || '动作 ' + item.id, coverSource: item.thumbnailUrl, cover: '' }));
      page.setData({
        stickerProject: project,
        stickerJob: { id: job.id, phase: job.stickerGenerationTask.phase, active: active(job), retryable: ['failed', 'cancelled'].includes(job.status) && job.failure?.retryable !== false && job.failure?.code !== 'STICKER_REFERENCE_UNSUITABLE' && job.cancelReason !== 'superseded' },
        stickerCandidates: candidates.map(item => ({ ...item, name: item.label || item.name || item.id, coverSource: item.previewUrl, cover: '' })),
        stickerItems: stage,
      });
      await Promise.all([loadThumbnails(page, 'stickerCandidates', ctx.app.client), loadThumbnails(page, 'stickerItems', ctx.app.client)]);
    } else {
      const { projects } = await ctx.app.client.request('/api/mv-recreations');
      if (!canContinue(page, ctx) || page._workProjectKeys !== keys || keys[type] !== key) return;
      const project = projects.find(item => item.id === job.mvTask.projectId);
      const ids = Object.values(project && project.nodeArtifacts || {});
      const artifacts = ctx.app.state && ctx.app.state.artifacts || [];
      page.setData({ mvItems: ids.map(id => artifacts.find(item => item.id === id)).filter(Boolean).map(item => ({ id: item.id, name: item.name })) });
    }
  } catch (error) {
    if (canContinue(page, ctx) && page._workProjectKeys === keys && keys[type] === key) delete keys[type];
  }
}

const data = {
  workPanel: null, workPanelCommand: '', workBusy: false, workNotice: '', workPreview: null,
  folderOptions: [], audioOptions: [], batchTemplates: [], resolutions: [],
  workBatchId: '', workBatch: null, batchList: [],
  stickerProject: null, stickerJob: null, stickerCandidates: [], stickerItems: [], mvItems: [],
};

const methods = {
  renderWorkTools(state, changed) {
    if (changed) {
      this._workProjectKeys = {};
      this._workRequests = {};
      this._inlineNote = null;
      this._workNotes = null;
      for (const key of ['stickerCandidates', 'stickerItems']) {
        if (this._thumbnailGenerations) this._thumbnailGenerations[key] = (this._thumbnailGenerations[key] || 0) + 1;
      }
      this.setData(data);
    }
    const current = this.data.workPanel;
    if (current?.type === 'mv') {
      const options = panelOptions(state);
      const folderId = this.data.folderOptions[current.folderIndex]?.id;
      const audioId = this.data.audioOptions[current.audioIndex]?.id;
      const folderIndex = options.folderOptions.findIndex(item => item.id === folderId);
      const audioIndex = options.audioOptions.findIndex(item => audioId ? item.id === audioId : this.data.attachmentIds.includes(item.id));
      if (JSON.stringify(options.folderOptions) !== JSON.stringify(this.data.folderOptions) || JSON.stringify(options.audioOptions) !== JSON.stringify(this.data.audioOptions) || audioIndex !== current.audioIndex) {
        this.setData({ ...options, workPanel: { ...current, folderIndex, audioIndex, quote: null } });
      }
    }
    showCurrentBatch(this, state);
    const jobs = (state.jobs || []).filter(item => item.sessionId === this.data.sessionId).slice().reverse();
    syncProject(this, 'sticker', jobs.find(item => item.stickerGenerationTask));
    syncProject(this, 'mv', jobs.find(item => item.mvTask));
  },

  openWorkCommand(command) {
    const state = getApp().state;
    if (command.type === 'assets' || command.type === 'projects') {
      this.setData({ prompt: '', templateName: '', cursor: 0, focus: false, voiceReady: false });
      if (command.type === 'assets') this.pick();
      else {
        this.setData({ sidebarFilter: 'work', sidebarQuery: '', sidebarArchived: false });
        this.openSidebar();
      }
      return;
    }
    if (command.type === 'notes') return this.listWorkNotes();
    if (command.type === 'batches') {
      this.setData({ batchList: (state.toolBatches || []).map(({ id, name, done, count }) => ({ id, name, done, count })) });
      panel(this, { type: 'batches' });
      return;
    }
    if (command.type === 'note') {
      this._inlineNote = null;
      panel(this, { ...notePanel(), text: command.text });
      return;
    }
    const options = panelOptions(state);
    this.setData(options);
    if (command.type === 'sticker') {
      panel(this, { ...command, style: command.text.slice(0, 240), name: '角色表情包' });
    } else if (command.type === 'mv') {
      const audioIndex = options.audioOptions.findIndex(item => this.data.attachmentIds.includes(item.id));
      panel(this, { ...command, folderIndex: -1, audioIndex, duration: '30', resolutionIndex: 1, quote: null });
    } else {
      const scienceIndex = options.batchTemplates.findIndex(item => item.id === 'animated-science-video' || item.id === 'video-style-diagram');
      panel(this, { type: 'batch', templateIndex: Math.max(0, scienceIndex), topics: command.text });
    }
  },

  closeWorkPanel() { if (!this.data.workBusy) this.setData({ workPanel: null, workPanelCommand: '' }); },
  workField(event) {
    const field = event.currentTarget.dataset.field;
    if (!this.data.workPanel || this.data.workBusy) return;
    const value = event.detail.value;
    this.setData({ workPanel: { ...this.data.workPanel, [field]: field.endsWith('Index') ? Number(value) : value, quote: null } });
  },
  workStickerMode(event) {
    if (!this.data.workBusy && this.data.workPanel?.type === 'sticker') this.setData({ workPanel: { ...this.data.workPanel, mode: event.currentTarget.dataset.mode } });
  },

  startWorkSticker() {
    return run(this, async ctx => {
      const current = this.data.workPanel;
      if (!current || current.type !== 'sticker') return;
      const session = requiredSession(ctx);
      const refs = (ctx.app.state.media || []).filter(item => this.data.attachmentIds.includes(item.id) && item.kind === 'image');
      if (refs.length !== 1) throw Error('请用「＋」选择一张角色参考图。');
      const recipe = { referenceMediaId: refs[0].id, name: current.name.trim() || '角色表情包', style: current.style.trim() || '保留角色的特征，做成轻喵风格表情', styleId: 'lightmao', styleSelection: 'lightmao', mode: current.mode };
      const config = await ctx.app.client.request('/api/sticker-projects/config');
      if (!canContinue(this, ctx)) return;
      if (!config.available || !Number.isFinite(config.pricing?.styleCandidates)) throw Error(config.pricingError || '表情制作暂不可用。');
      const ok = await confirm('制作两种候选画风？', '当前阶段需要 ' + config.pricing.styleCandidates + ' 积分。');
      if (!ok || !canContinue(this, ctx)) return;
      const input = { sessionId: session.id, recipe };
      const result = await ctx.app.client.request('/api/sticker-projects', { ...input, requestId: requestId(this, 'stickers', input), pricingHash: config.pricing.pricingHash });
      if (!ctx.current()) return;
      commit(ctx, result);
      delete this._workRequests.stickers;
      closeCompletedPanel(this);
    });
  },

  workStickerStage(event) {
    const action = event.currentTarget.dataset.action;
    const candidateId = event.currentTarget.dataset.id;
    return run(this, async ctx => {
      const project = this.data.stickerProject;
      const job = this.data.stickerJob;
      if (!project || project.compatible === false || !job || job.active) return;
      requiredSession(ctx);
      const base = '/api/sticker-projects/' + encodeURIComponent(project.id);
      const phase = action === 'retry' ? job.phase : action === 'style' ? 'samples' : 'batch';
      const quote = await ctx.app.client.request(base + '/quote?phase=' + phase);
      if (!canContinue(this, ctx)) return;
      const title = action === 'style' ? '选定画风并制作样张？' : action === 'retry' ? '继续当前制作阶段？' : '确认生成整套？';
      const ok = await confirm(title, '当前阶段需要 ' + quote.points + ' 积分。');
      if (!ok || !canContinue(this, ctx) || this.data.stickerProject?.id !== project.id) return;
      if (action === 'retry' && job.retryable) {
        await ctx.app.mutate('/api/jobs/' + encodeURIComponent(job.id) + '/retry', { pricingHash: quote.pricingHash });
      } else if (action === 'style' && !project.styleSelection) {
        const item = (project.styleCandidates || []).find(row => row.id === candidateId);
        if (!item) return;
        commit(ctx, await ctx.app.client.request(base + '/style', { id: item.id, candidateHash: item.hash, pricingHash: quote.pricingHash }));
      } else if (action === 'approve' && project.previewHash && !project.ready) {
        commit(ctx, await ctx.app.client.request(base + '/approve', { previewHash: project.previewHash, makeVideo: project.recipe.mode === 'dynamic', bgm: project.recipe.mode === 'dynamic', pricingHash: quote.pricingHash }));
      }
    });
  },

  submitWorkMv(event) {
    const start = event.currentTarget.dataset.start === 'yes';
    return run(this, async ctx => {
      const current = this.data.workPanel;
      if (!current || current.type !== 'mv') return;
      const options = panelOptions(ctx.app.state);
      const folder = this.data.folderOptions[current.folderIndex];
      const audio = this.data.audioOptions[current.audioIndex];
      const duration = Number(current.duration), resolution = options.resolutions[current.resolutionIndex];
      if (!folder || !audio) throw Error('请选择素材文件夹和音源；音源可先用「＋」上传。');
      if (!Number.isInteger(duration) || duration < 5 || duration > 600 || !resolution) throw Error('请输入 5–600 秒的整数时长，并选择清晰度。');
      const input = { folderId: folder.id, audioId: audio.id, duration, resolution, prompt: current.text.trim() || '用所选素材和音源制作音乐 MV。', sessionId: requiredSession(ctx).id };
      const quote = await ctx.app.client.request('/api/mv-recreations/template/quote', input);
      if (!canContinue(this, ctx)) return;
      this.setData({ workPanel: { ...current, quote } });
      if (!start) return;
      if (quote.points > quote.balance) throw Error('预计积分不足，可以缩短时长或减少素材。');
      if (!await confirm('开始剪辑 MV？', '预计需要 ' + quote.points + ' 积分，按实际用量结算。') || !canContinue(this, ctx)) return;
      const result = await ctx.app.client.request('/api/mv-recreations/template', { ...input, pricingHash: quote.pricingHash, requestId: requestId(this, 'music_mv', input) });
      if (!ctx.current()) return;
      commit(ctx, result);
      delete this._workRequests.music_mv;
      closeCompletedPanel(this);
    });
  },

  startWorkBatch() {
    return run(this, async ctx => {
      const current = this.data.workPanel;
      if (!current || current.type !== 'batch') return;
      const template = this.data.batchTemplates[current.templateIndex];
      const topics = current.topics.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
      if (!template || topics.length < 1 || topics.length > 20 || topics.some(text => text.length > 2000)) throw Error('选一个模板，每行一个主题，每批 1–20 条。');
      if (!await confirm('制作 ' + topics.length + ' 条视频？', '使用「' + template.name + '」，按实际用量扣积分。') || !canContinue(this, ctx)) return;
      const name = (template.name + ' · ' + topics.length + ' 条视频').slice(0, 60);
      const input = { name, templateId: template.id, topics, attachmentIds: this.data.attachmentIds };
      const before = new Set((ctx.app.state.toolBatches || []).map(item => item.id));
      const result = await ctx.app.client.request('/api/tool-batches', { ...input, requestId: requestId(this, 'work_batch', input) });
      if (!ctx.current()) return;
      commit(ctx, result);
      delete this._workRequests.work_batch;
      const matches = (result.state?.toolBatches || []).filter(item => item.templateId === input.templateId && item.name === input.name && item.items.length === topics.length && item.items.every((row, index) => row.topic === topics[index]));
      const batch = matches.find(item => !before.has(item.id)) || matches[0];
      if (batch) {
        this.setData({ workBatchId: batch.id });
        showCurrentBatch(this, ctx.app.state);
      }
      closeCompletedPanel(this);
    });
  },

  openWorkBatch(event) {
    this.setData({ workBatchId: event.currentTarget.dataset.id, workPanel: null, workPanelCommand: '' });
    showCurrentBatch(this, getApp().state);
    this.scroll();
  },
  closeWorkBatch() { if (!this.data.workBusy) this.setData({ workBatchId: '', workBatch: null }); },
  workBatchAction(event) {
    const action = event.currentTarget.dataset.action;
    return run(this, async ctx => {
      const batch = this.data.workBatch;
      if (!batch || !['stop', 'resume'].includes(action)) return;
      if (action === 'resume' && (!await confirm('继续未完成的视频？', '已有的成片会保留，续做按实际用量扣积分。') || !canContinue(this, ctx))) return;
      const result = await ctx.app.client.request('/api/tool-batches/' + encodeURIComponent(batch.id) + '/' + action, {});
      if (!ctx.current()) return;
      commit(ctx, result);
      if (action === 'resume') {
        const current = (ctx.app.state.toolBatches || []).find(item => item.id === batch.id);
        for (const item of current?.items || []) {
          if (!canContinue(this, ctx)) return;
          if (item.jobId && !item.unavailable && ['failed', 'cancelled'].includes(item.status)) await ctx.app.mutate('/api/jobs/' + encodeURIComponent(item.jobId) + '/retry', {});
        }
      }
    });
  },
  openWorkBatchItem(event) { this.sidebarActivate(event); },

  listWorkNotes() {
    return run(this, async ctx => {
      const { notes } = await ctx.app.client.request('/api/creative-notes');
      if (!canContinue(this, ctx)) return;
      this._workNotes = notes;
      panel(this, { type: 'notes', notes: notes.map(({ id, title }) => ({ id, title })) });
    });
  },
  editWorkNote(event) {
    const note = (this._workNotes || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!note) return;
    // Rich notes keep their existing editor so editing text cannot drop drawings or attachments.
    if (note.blocks || (note.strokes || []).length || (note.attachmentIds || []).length) {
      wx.navigateTo({ url: '/pages/notes/index?noteId=' + encodeURIComponent(note.id) });
      return;
    }
    this._inlineNote = note;
    panel(this, notePanel(note));
  },
  saveWorkNote() {
    return run(this, async ctx => {
      const current = this.data.workPanel;
      if (!current || current.type !== 'note') return;
      const text = current.text.trim();
      if (!text) throw Error('请写下笔记正文。');
      const note = this._inlineNote;
      const input = {
        title: current.name.trim() || text.split('\n')[0].slice(0, 80),
        text, kind: note?.kind || 'note',
        attachmentIds: note ? note.attachmentIds : this.data.attachmentIds,
        strokes: [], category: note?.category || '',
        ...(note?.sessionId ? { sessionId: note.sessionId } : ctx.sessionId && !note ? { sessionId: ctx.sessionId } : {}),
        ...(note ? { revision: note.revision } : {}),
      };
      const result = await ctx.app.client.request('/api/creative-notes' + (note ? '/' + encodeURIComponent(note.id) : ''), input, note ? 'PATCH' : 'POST');
      if (!ctx.current()) return;
      this.setData({ workNotice: '已保存笔记「' + result.note.title + '」' });
      closeCompletedPanel(this);
    });
  },

  previewWorkImage(event) {
    const { id, category } = event.currentTarget.dataset;
    return run(this, async ctx => {
      const item = (category === 'style' ? this.data.stickerCandidates : this.data.stickerItems).find(row => row.id === id);
      if (!item) return;
      const path = await ctx.app.client.download(item.previewUrl);
      if (canContinue(this, ctx)) this.setData({ workPreview: { id, name: item.name, path, category } });
    });
  },
  previewWorkArtifact(event) {
    const id = event.currentTarget.dataset.id;
    return run(this, async ctx => {
      const artifact = (ctx.app.state.artifacts || []).find(item => item.id === id);
      if (!artifact) throw Error('作品暂不可用，请刷新后重试。');
      if (!['video', 'image'].includes(artifact.kind)) { this.play(event); return; }
      const client = ctx.app.client;
      let path = client.previewUrl(artifact.url);
      if (!path && artifact.kind === 'video') {
        const playback = await client.request('/api/media-playback', { type: 'artifact', id });
        if (!canContinue(this, ctx)) return;
        path = client.mediaUrl(playback.url);
      }
      if (!path) path = await client.download(artifact.url);
      if (canContinue(this, ctx)) this.setData({ workPreview: { artifactId: id, kind: artifact.kind, name: artifact.name, path, category: 'artifact' } });
    });
  },
  workPreviewError() { notify(Error('预览暂不可用，请关闭后重新打开。')); },
  closeWorkPreview() { this.setData({ workPreview: null }); },
  saveWorkFile(event) {
    const kind = event.currentTarget.dataset.kind;
    return run(this, async ctx => {
      const preview = this.data.workPreview;
      const id = event.currentTarget.dataset.id || preview?.artifactId;
      const artifact = id && (ctx.app.state.artifacts || []).find(item => item.id === id);
      if (!artifact && (!preview || preview.category === 'style' || id)) return;
      if (kind === 'project' && !artifact?.projectUrl) return;
      if (kind !== 'project' && artifact && artifact.kind === 'video' && artifact.sizeBytes > 200 * 1024 * 1024) {
        wx.navigateTo({ url: '/pages/player/index?type=artifact&id=' + encodeURIComponent(artifact.id) });
        return;
      }
      await privacy();
      if (!canContinue(this, ctx)) return;
      const filePath = artifact ? await ctx.app.client.download(kind === 'project' ? artifact.projectUrl : artifact.downloadUrl || artifact.url) : preview.path;
      if (!canContinue(this, ctx)) return;
      if (kind !== 'project' && (artifact?.kind === 'video' || artifact?.kind === 'image')) {
        const method = artifact.kind === 'video' ? 'saveVideoToPhotosAlbum' : 'saveImageToPhotosAlbum';
        await new Promise((resolve, reject) => wx[method]({ filePath, success: resolve, fail: reject }));
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      } else {
        const fileName = kind === 'project' ? artifact.name.replace(/\.mp4$/i, '') + '-工程.zip' : artifact?.name || preview.name + (this.data.stickerProject?.recipe.mode === 'dynamic' ? '.gif' : '.png');
        await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName, success: resolve, fail: reject }));
      }
    });
  },
  learnWorkTemplate(event) {
    const id = event.currentTarget.dataset.id;
    return run(this, async ctx => {
      if (!(ctx.app.state.artifacts || []).some(item => item.id === id)) return;
      const { note } = await ctx.app.client.request('/api/artifacts/' + encodeURIComponent(id) + '/template-draft', {});
      if (!canContinue(this, ctx)) return;
      this.setData({ workNotice: '已保存「' + note.title + '」，可在对话里发送「查看笔记」打开。' });
      this.scroll();
    });
  },
};

module.exports = { data, methods };
