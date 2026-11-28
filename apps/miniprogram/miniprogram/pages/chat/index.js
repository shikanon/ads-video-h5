const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage, shareTimeline } = require("../../utils/share");
const { chatView, mediaView } = require('../../utils/view');
const { notify, withSession, hide, privacy, requireLogin } = require('../../utils/page');
const { version, sections, hasVoiceConsent } = require('../../utils/voice-consent');
const { chooseFiles, uploadMedia, livePhotoHelp } = require('../../utils/upload');
const { attachmentLimit } = require('../../utils/media-limits');
const { loadThumbnails, coverError } = require('../../utils/thumbnails');
const { selectedTemplateName, withoutTemplateMentions, skillStarter, skillStarters, isSkillPrompt } = require('../../utils/templates');
const bundledTemplates = require('../../utils/tool-catalog');
const { createVoice } = require('../../utils/voice');
const { keyboardLayout } = require('../../utils/keyboard-layout');
const { openDraft, modeOf, activateSession } = require('../../utils/sessions');
const { sidebarView } = require('../../utils/sidebar');
const { hydrateAccountAvatar } = require('../../utils/account-avatar');
const { markSessionRead } = require('../../utils/session-notifications');
const { readDrafts, writeDrafts } = require('../../utils/chat-drafts');
const workEntry = require('./work-entry');
const workActions = require('./work-actions');
const accountEditor = require('./account-editor');
const voiceLabels = { idle: '长按说话，松开发送', authorizing: '等待麦克风授权', starting: '准备录音…', recording: '正在录音 · 松开发送，上滑取消', finishing: '整理录音…', transcribing: '正在识别语音…', sending: '识别完成，正在发送…' };
Page(Object.assign({
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
  data: Object.assign(appearanceData(), workActions.data, accountEditor.data, { canAvatar: false, hasAvatar: false, visibleSuggestions: workEntry.pickSuggestions(), workHint: null, workCatalogOpen: false, workCatalog: [], typing: false, messages: [], empty: true, running: false, title: '新会话', prompt: '', templateName: '', attachmentIds: [], attached: [], pick: false, sources: [], sending: false, creatingSession: false, uploading: false, uploadText: '', error: '', voice: 'idle', voiceLabel: voiceLabels.idle, voiceReady: false, cursor: 0, editorCursor: -1, focus: false, scrollTarget: '', balance: '0.00', insufficient: false, hasOlder: false, voiceConsentVisible: false, voiceConsentVersion: version, voiceConsentSections: sections }),
  onLoad() {
    this._drafts = readDrafts(wx,getApp().state?.account?.id); this._draftGeneration = getApp()._generation; this._pendingSends = getApp()._pendingMessageSessions || (getApp()._pendingMessageSessions = new Set());
    this._sidebarLimit = 40;
    this.setData({ sidebarOpen: false, sidebarFilter: 'all', sidebarQuery: '', sidebarArchived: false, sidebarGroups: [], sidebarMore: false, sidebarTotal: 0, sidebarBusy: false, sidebarMenuId: '' });
    this.setData({ mode: 'chat', researchMode: 'auto', models: [], modelIndex: 0, modelName: '选择模型', modelChanging: false });
    // The textarea owns keyboard events. A second global listener used to
    // reapply the same native layout while iOS was still animating its keyboard.
    this._windowListener = event => { if (this._visible) this.windowResize(event); };
    if (wx.onWindowResize) wx.onWindowResize(this._windowListener);
    this._expanded = {}; this._count = 50; this._offset = 0;
    const app = getApp();
    this._voice = createVoice(wx, { client: app.client, submit: (route, body) => app.mutate(route, body),
      authorize: async () => {
        if (!hasVoiceConsent(app)) throw new Error('请先阅读并同意《声纹授权协议》。');
        await privacy();
        if (!hasVoiceConsent(app) || !this._visible) throw new Error('语音授权已撤回，请重新操作。');
        await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: () => reject(new Error('请在微信设置中允许使用麦克风后，再长按说话。')) }));
        if (!hasVoiceConsent(app) || !this._visible) throw new Error('语音授权已撤回，请重新操作。');
      },
      onState: voice => { this._voicePhase = voice; if (this._visible) this.setData({ voice, voiceLabel: voiceLabels[voice] }); },
      onRecognized: (message, snapshot, ticket) => {
        if (this.data.sessionId !== snapshot.sessionId) return;
        this._recognized = ticket ? { message, ticket, sessionId: snapshot.sessionId, at: Date.now() } : null;
        this.setData({ prompt: message, cursor: message.length, templateName: selectedTemplateName(message, this.templates()), voiceReady: Boolean(ticket) });
      },
      onError: error => { this._voiceError = error.message; if (this._visible) { this.setData({ error: error.message }); notify(error); } },
      onAccepted: (state, _message, snapshot) => { this._voiceError = ''; if (this.data.sessionId === snapshot.sessionId) { this._offset = 0; this._recognized = null; this.setData({ prompt: '', attachmentIds: [], attached: [], cursor: 0, error: '', voiceReady: false }); this.render(state); } this.scroll(); },
    });
  },
  onShow() {
    this._editorFocused = false;
    this._windowBaseline = this.windowInfo();
    this.setData(Object.assign({ focus: false, typing: false, visibleSuggestions: workEntry.pickSuggestions() }, keyboardLayout(this._windowBaseline, this._windowBaseline, 0)));
    this.rotateWorkHint();
    this.setData({ voice: this._voicePhase || 'idle', voiceLabel: voiceLabels[this._voicePhase || 'idle'] });
    if (this._voiceError) this.setData({ error: this._voiceError });
    const loggedIn = withSession(this, this.render);
    this.resumeSuggestions();
    if (!loggedIn) return;
    if (getApp().pendingAttachments) { const ids = getApp().pendingAttachments; getApp().pendingAttachments = null; this.addAttachments(ids); if (getApp().state) this.render(getApp().state); }
  },
  saveDraft() { if(this.data.sessionId){this._drafts[this.data.sessionId]={prompt:this.data.prompt,cursor:this.data.cursor,attachmentIds:this.data.attachmentIds,researchMode:this.data.researchMode};writeDrafts(wx,getApp().state?.account?.id,this._drafts);} },
  onHide() { this.pauseSuggestions(); this.saveDraft();hide(this); this._editorFocused = false; this._workProjectKeys = {}; this.setData({ focus: false, typing: false, keyboardHeight: 0, keyboardOffset: 0, workPreview: null, workCatalogOpen: false }); this.closeEditors(); this.cancelConsent(); if (this._voice) this._voice.cancel(); },
  onUnload() { this.pauseSuggestions(); this.saveDraft();hide(this); if (wx.offWindowResize) wx.offWindowResize(this._windowListener); this.cancelConsent(); if (this._voice) this._voice.dispose(); },
  windowInfo() { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}; } catch (_) { return {}; } },
  keyboardChange(event) {
    if (!this._visible) return;
    const detail = event.detail || event;
    this.updateKeyboardLayout(detail.height, this.windowInfo());
  },
  updateKeyboardLayout(height, current) {
    const layout = keyboardLayout(this._windowBaseline, current, height), patch = {};
    for (const key of Object.keys(layout)) if (this.data[key] !== layout[key]) patch[key] = layout[key];
    if (Object.keys(patch).length) this.setData(patch);
  },
  windowResize(event) {
    const current = Object.assign({}, this.windowInfo(), event && event.size);
    const base = this._windowBaseline || current;
    // A keyboard resize can arrive before its height event. Never record the
    // shortened window as the closed-keyboard baseline.
    if (!this.data.keyboardHeight && !this._editorFocused && (current.windowHeight >= base.windowHeight || current.windowWidth !== base.windowWidth)) this._windowBaseline = current;
    this.updateKeyboardLayout(this.data.keyboardHeight || 0, current);
  },
  focusEditor(event) {
    this._editorFocused = true;
    this.setData({ typing: true });
    // Native focus is already acquired: writing focus=true here can reopen the
    // keyboard after a blur on iOS. Only explicit editing actions request focus.
    if (event.detail && event.detail.height) this.keyboardChange(event);
  },
  finishVoiceConsent(accepted) {
    const resolve = this._resolveVoiceConsent; this._resolveVoiceConsent = null; this._voiceConsentPending = false;
    this.setData({ voiceConsentVisible: false });
    if (resolve) resolve(accepted);
  },
  cancelConsent() { this.finishVoiceConsent(false); },
  agreeVoiceConsent() {
    if (!this.data.voiceConsentVisible || !this._resolveVoiceConsent) return;
    getApp().voiceConsent = { version, agreedAt: new Date().toISOString() };
    this.finishVoiceConsent(true);
    if (this._visible) wx.showToast({ title: '已授权，请重新按住说话', icon: 'none' });
  },
  render(state) {
    this.setData({researchAvailable:Boolean(state.features && state.features.researchModes)});
    const accountChanged = this._draftGeneration !== getApp()._generation;
    if (accountChanged) { this._drafts = readDrafts(wx,state.account?.id); this._draftGeneration = getApp()._generation; this._pendingSends = getApp()._pendingMessageSessions || new Set(); this.setData(accountEditor.data); }
    this._sidebarState = state;
    if (this.data.sidebarOpen) this.renderSidebar(state);
    hydrateAccountAvatar(this, state, getApp());
    const canAvatar = Boolean(state.features?.accountAvatars);
    const hasAvatar = Boolean((state.account || getApp().user)?.avatarUrl);
    if (this.data.canAvatar !== canAvatar || this.data.hasAvatar !== hasAvatar) this.setData({ canAvatar, hasAvatar });
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (session) {
      this.setData({ mode: modeOf(session) });
    }
    if (this.data.sessionId && this.data.sessionId !== state.activeSessionId) { this._offset = 0; this._expanded = {}; this._recognized = null; }
    const models = (state.models || []).filter(m => m.enabled && m.kind === 'text').map(m => ({ id: m.id, name: m.name }));
    const modelId = session && session.modelId || (state.settings || {}).defaultModelId;
    const modelIndex = models.findIndex(m => m.id === modelId);
    this.setData({ models, modelIndex: Math.max(0, modelIndex), modelName: modelIndex >= 0 ? models[modelIndex].name : '选择模型' });
    const view = chatView(state, getApp().client, this._expanded, this._count, this._offset);
    const projectFiles = new Set((state.artifacts || []).filter(item => item.projectUrl).map(item => item.id));
    for (const message of view.messages) {
      for (const artifact of message.artifacts) artifact.hasProject = projectFiles.has(artifact.id);
    }
    const changed = accountChanged || this.data.sessionId !== view.sessionId;
    const ids = changed ? [] : this.data.attachmentIds.filter(id => state.media.some(item => item.id === id && !item.character));
    if (changed && !accountChanged && this.data.sessionId) {
      (this._drafts || (this._drafts = {}))[this.data.sessionId] = { prompt: this.data.prompt, cursor: this.data.cursor, attachmentIds: this.data.attachmentIds, error: this.data.error, researchMode: this.data.researchMode || 'auto' };
    }
    const draft = changed && this._drafts && this._drafts[view.sessionId];
    const restoredIds = draft ? draft.attachmentIds.filter(id => state.media.some(m => m.id === id)) : ids;
    const prompt = changed ? draft ? draft.prompt : '' : this.data.prompt;
    const patch = Object.assign(view, { templateName: selectedTemplateName(prompt, this.templates()), attachmentIds: restoredIds, attached: restoredIds.map(id => mediaView(state.media.find(m => m.id === id), getApp().client)), voiceReady: Boolean(this.voiceTicket()), sending: Boolean(this._pendingSends && this._pendingSends.has(view.sessionId)), modelChanging: this._modelChangingId === view.sessionId }, changed ? { editorCursor: -1, prompt: draft ? draft.prompt : '', cursor: draft ? draft.cursor : 0, researchMode: draft ? draft.researchMode : 'auto', error: draft ? draft.error : '', focus: false } : {});
    if (this.data.workCatalogOpen) patch.workCatalog = this.workCatalogEntries();
    const cache = this._renderCache || (this._renderCache = {}), delta = {};
    for (const key of Object.keys(patch)) { const encoded = JSON.stringify(patch[key]); if (cache[key] !== encoded || JSON.stringify(this.data[key]) !== encoded) { cache[key] = encoded; delta[key] = patch[key]; } }
    if (Object.keys(delta).length) this.setData(delta);
    this.renderWorkTools(state, changed);
    const covers=view.messages.flatMap(message=>(message.attachments||[]).map(item=>Object.assign({},item,{id:message.id+':'+item.id,mediaId:item.id,messageId:message.id})));
    this.setData({messageAttachments:covers});loadThumbnails(this,'messageAttachments',getApp().client,40);
    if (this._visible && !this.data.sidebarOpen && getApp()._foreground !== false && !getApp()._pendingNotice && !getApp()._openingNotice) markSessionRead(getApp(), view.sessionId);
    if (this._lastCount !== view.messages.length || this._lastSession !== view.sessionId) { this._lastCount = view.messages.length; this._lastSession = view.sessionId; this.scroll(); }
    this.consumeTemplate();
  },
  scroll() {
    if (this._visible) this.setData({ scrollTarget: '' }, () => {
      const hasWork = this.data.workPanel || this.data.workBatch || this.data.workNotice || this.data.stickerProject;
      this.setData({ scrollTarget: this.data.empty && !hasWork ? 'thread-start' : 'thread-end' });
    });
  },
  input(event) { this.setData({ prompt: event.detail.value, cursor: event.detail.cursor, templateName: selectedTemplateName(event.detail.value, this.templates()), error: '' }); this.setData({ voiceReady: Boolean(this.voiceTicket()) }); },
  voiceTicket() { const value = this._recognized; return value && value.sessionId === this.data.sessionId && value.message === this.data.prompt.trim() && Date.now() - value.at < 15 * 60000 ? value.ticket : null; },
  blur(event) { this._editorFocused = false; this.setData({ focus: false, typing: false, editorCursor: -1 }); if (event.detail.cursor !== undefined) this.setData({ cursor: event.detail.cursor }); },
  newline() {
    if (this.data.prompt.length >= 20000) return;
    const at = Math.max(0, Math.min(this.data.prompt.length, this.data.cursor));
    const prompt = this.data.prompt.slice(0, at) + '\n' + this.data.prompt.slice(at);
    this.setData({ prompt, templateName: selectedTemplateName(prompt, this.templates()), cursor: at + 1, editorCursor: at + 1, focus: true });
    this.setData({ voiceReady: Boolean(this.voiceTicket()) });
  },
  async send() {
    if (this.data.modelChanging || this.data.sending || this.data.workBusy || this.data.creatingSession || this.data.uploading || this.data.voice !== 'idle') return;
    const ticket = this.voiceTicket();
    const draft = this.data.prompt.trim();
    if (!draft) { this.setData({ error: this.data.mode === 'chat' ? '写下一句话，我们开始聊聊。' : '说说你想实现什么。' }); return; }
    if (draft === '@' || draft === '＠') {
      if (this.data.mode === 'chat') this.showWorkTemplates();
      else this.setData({ error: '请填写制作要求，或到「对话」选择模板。' });
      return;
    }
    if (!requireLogin()) return;
    const app = getApp(), sessionId = this.data.sessionId, generation = app._generation;
    if (!app.state || !sessionId) { this.setData({ error: '会话仍在同步，请稍后再发送。' }); return; }
    const request = ticket ? draft : workEntry.suggestedRequest(draft);
    const command = !ticket && (this.data.mode === 'work' || /^[@＠]/.test(request)) ? workEntry.studioCommand(request) : null;
    if (command) return this.openWorkCommand(command);
    if (this.data.insufficient && !ticket) { this.setData({ error: '积分不足，请先去积分页面签到领取。' }); return; }
    if (!this.checkMode()) return;
    let message;
    try { message = ticket ? draft : workEntry.videoMessage(request, this.templates()); }
    catch (error) { this.setData({ error: error.message }); return; }
    const pending = this._pendingSends || (this._pendingSends = new Set()); pending.add(sessionId);
    this.setData({ sending: true, error: '', focus: false, workPanel: null, workPanelCommand: '' });
    try {
      const state = await app.mutate('/api/chat', { sessionId, message, interaction: this.interaction(), researchMode: this.requestResearchMode(), attachmentIds: this.data.attachmentIds, ...(ticket ? { voiceTicket: ticket } : {}) });
      if (generation !== app._generation) return;
      if (this.data.sessionId === sessionId) { this._offset = 0; this._recognized = null; this.setData({ prompt: '', cursor: 0, attachmentIds: [], attached: [], voiceReady: false }); }
      else if (this._drafts && this._drafts[sessionId] && this._drafts[sessionId].prompt.trim() === draft) this._drafts[sessionId] = { prompt: '', cursor: 0, attachmentIds: [], error: '', researchMode: this._drafts[sessionId].researchMode };
      this.render(app.state || state);
    } catch (error) {
      if (generation !== app._generation) return;
      if (this.data.sessionId === sessionId) { this.setData({ error: error.message }); if (error.code === 'INVALID_VOICE_TICKET') { this._recognized = null; this.setData({ voiceReady: false }); app.refresh().catch(() => {}); } }
      else if (this._drafts && this._drafts[sessionId]) this._drafts[sessionId].error = error.message;
    } finally { pending.delete(sessionId); if (generation === app._generation && this.data.sessionId === sessionId) this.setData({ sending: false }); }
  },
  templates() {
    const app = getApp(), cached = this._workCatalogCache;
    if (app.state?.templates?.length) return app.state.templates;
    if (cached && cached.generation === app._generation) return cached.templates;
    return bundledTemplates;
  },
  rotateWorkHint() { this.setData({ workHint: workEntry.nextHint(this.data.workHint?.id) }); },
  pauseSuggestions() { clearInterval(this._suggestionTimer); this._suggestionTimer = null; },
  resumeSuggestions() {
    this.pauseSuggestions();
    if (this._visible) this._suggestionTimer = setInterval(() => this.rotateSuggestions(), 5000);
  },
  rotateSuggestions() {
    const data = this.data;
    if (!this._visible || data.mode !== 'chat' || data.keyboardHeight || data.typing || data.focus || data.hasNewer || data.workPanel ||
      data.sidebarOpen || data.pick || data.workCatalogOpen || data.workPreview || data.voiceConsentVisible ||
      data.sending || data.uploading || data.workBusy || data.modelChanging || data.creatingSession || data.voice !== 'idle') return;
    const next = workEntry.replaceSuggestion(data.visibleSuggestions);
    if (next !== data.visibleSuggestions) this.setData({ visibleSuggestions: next });
  },
  async selectWorkStarter(event) {
    if (this.data.sending || this.data.creatingSession || this.data.modelChanging || this.data.uploading || this.data.workBusy || this.data.voice !== 'idle') return;
    const { id } = event.currentTarget.dataset;
    const selected = workEntry.starts.find(item => item.id === id);
    const templates = this.templates(), skill = skillStarter(id), template = templates.find(item => item.id === id);
    if (!selected && !skill && !template) return;
    if (this.data.mode === 'work' && this.data.workCatalogOpen && !(await this.openSkillChat())) return;
    const existing = this.data.prompt.trimStart();
    const previous = skillStarters.find(item => item.prompt && existing.startsWith(item.prompt));
    const text = previous ? existing.slice(previous.prompt.length) : existing;
    const body = withoutTemplateMentions(text.trim(), templates.concat(skillStarters)).replace(/^[@＠](?:表情包动画视频|知识科普动态图视频|音乐\s?MV)(?=$|\s)\s*/, '');
    const prefix = selected?.prompt || skill?.prompt || '@' + (skill ? skill.name : template.id) + ' ';
    const mention = prefix.match(/^[@＠]\S+\s/);
    let prompt = prefix;
    if (body) prompt = skill ? prefix + body : mention ? mention[0] + body : body + '\n' + prefix;
    if (prompt.length > 20000) { notify(Error('请先缩短草稿，再添加模板。')); return; }
    this._recognized = null;
    this.setData({ prompt, templateName: selectedTemplateName(prompt, this.templates()), cursor: prompt.length, editorCursor: prompt.length, voiceReady: false, focus: true, workCatalogOpen: false, workPanel: null, error: '' });
  },
  async openSkillChat() {
    const app = getApp(), generation = app._generation;
    if (!app.client.hasSession()) {
      await this.switchMode({ currentTarget: { dataset: { mode: 'chat' } } });
      return this.data.mode === 'chat';
    }
    this.saveDraft();
    this.setData({ creatingSession: true, focus: false });
    try {
      const state = await openDraft(app, 'chat', { reuseOtherMode: false });
      if (generation !== app._generation || !this._visible || !this.data.workCatalogOpen ||
        !state._openedDraftId || app.state?.activeSessionId !== state._openedDraftId) return false;
      this.render(state);
      return this.data.mode === 'chat' && this.data.sessionId === state._openedDraftId;
    } catch (error) {
      if (generation === app._generation && this._visible) notify(error);
      return false;
    } finally {
      if (generation === app._generation) this.setData({ creatingSession: false });
    }
  },
  canUseWorkHint() {
    const data = this.data;
    return Boolean(data.workHint && data.empty && data.mode === 'chat' && !data.prompt && !data.typing && !data.focus && !data.keyboardHeight && !data.workPanel && !data.workBusy && !data.modelChanging && !data.sending && !data.creatingSession && !data.uploading && data.voice === 'idle');
  },
  acceptWorkHint() {
    if (!this.canUseWorkHint()) return;
    const prompt = this.data.workHint.hint;
    this._recognized = null;
    this.setData({ prompt, cursor: prompt.length, editorCursor: -1, focus: false, voiceReady: false, error: '' });
    this.saveDraft();
  },
  editInsteadOfHint() {
    if (!this.canUseWorkHint()) return;
    this.setData({ typing: true, focus: true, editorCursor: -1 });
  },
  workCatalogEntries() {
    const featured = workEntry.templates.map(({ id, label }) => ({ id, name: label }));
    const entries = featured.concat(skillStarters.map(({ id, name }) => ({ id, name })));
    const seen = new Set(['qingmao-stickers', 'animated-science-video', ...entries.map(item => item.id)]);
    for (const { id, name } of this.templates()) {
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({ id, name });
    }
    return entries;
  },
  async showWorkTemplates() {
    if (this.data.modelChanging || this.data.sending || this.data.uploading || this.data.creatingSession || this.data.workBusy || this.data.voice !== 'idle') return;
    this.setData({ sidebarOpen: false, workCatalog: this.workCatalogEntries(), workCatalogOpen: true, focus: false });
    if (wx.hideKeyboard) wx.hideKeyboard();
    const app = getApp(), generation = app._generation;
    const cache = this._workCatalogCache, pending = this._workCatalogRequest;
    if (app.state?.templates?.length || !app.client.request ||
      (cache && cache.generation === generation) || (pending && pending.generation === generation)) return;
    const request = { generation };
    this._workCatalogRequest = request;
    try {
      const result = await app.client.request('/api/templates');
      if (generation !== app._generation || !Array.isArray(result?.templates)) return;
      const templates = result.templates.filter(item => typeof item?.id === 'string' && typeof item.name === 'string' && item.id && item.name);
      this._workCatalogCache = { generation, templates };
      if (this._visible && this.data.workCatalogOpen) this.setData({ workCatalog: this.workCatalogEntries() });
    } catch {
      // Keep the bundled catalog usable while the server is unavailable.
    } finally {
      if (this._workCatalogRequest === request) this._workCatalogRequest = null;
    }
  },
  closeWorkTemplates() { this.setData({ workCatalogOpen: false }); },
  openTemplates() {
    if (this.data.modelChanging || this.data.creatingSession || this.data.sending || this.data.uploading || this.data.voice !== 'idle') return;
    const app = getApp();
    app.templateOrigin = { sessionId: this.data.sessionId, generation: app._generation };
    wx.switchTab({
      url: '/pages/templates/index',
      fail: () => { app.templateOrigin = null; notify(new Error('暂时无法打开模板页。')); },
    });
  },
  consumeTemplate() {
    const app = getApp(), selection = app.pendingTemplate;
    if (!selection || !this._visible || app._restored || !this.data.sessionId) return;
    app.pendingTemplate = null;
    if (selection.generation !== app._generation) return;
    if (selection.sessionId && selection.sessionId !== this.data.sessionId) { notify(new Error('会话已切换，请重新选择模板。')); return; }
    if (this.data.sending || this.data.creatingSession || this.data.modelChanging || this.data.uploading || this.data.voice !== 'idle') { notify(new Error('请等当前操作结束，再选择模板。')); return; }
    this.applyTemplate(Object.assign({}, selection, { sessionId: this.data.sessionId }));
  },
  applyTemplate({ id, sessionId, generation }) {
    const app = getApp();
    if (!app.client.hasSession() || sessionId !== this.data.sessionId || generation !== app._generation) return;
    const starter = skillStarter(id);
    if (starter && starter.prompt) {
      const prompt = starter.prompt + withoutTemplateMentions(this.data.prompt, this.templates());
      if (prompt.length > 2000) { notify(new Error('请先缩短草稿，再选择创作方式。')); return; }
      this._recognized = null;
      this.setData({ prompt, templateName: '', cursor: prompt.length, editorCursor: prompt.length, voiceReady: false, focus: true, error: '' });
      return;
    }
    const template = this.templates().find(item => item.id === id);
    if (!template) { notify(new Error('模板已更新，请重新打开工作台。')); return; }
    const prompt = '@' + template.name + ' ' + withoutTemplateMentions(this.data.prompt, this.templates());
    if (prompt.length > 2000) { notify(new Error('请先缩短对话草稿，再添加模板。')); return; }
    this._recognized = null;
    this.setData({ prompt, templateName: template.name, cursor: prompt.length, editorCursor: prompt.length, voiceReady: false, focus: true, error: '' });
  },
  removeTemplate() {
    const prompt = withoutTemplateMentions(this.data.prompt, this.templates());
    this._recognized = null;
    this.setData({ prompt, templateName: '', cursor: prompt.length, editorCursor: prompt.length, voiceReady: false, focus: true });
  },
  suggestion(event) {
    this.setData({ prompt: event.currentTarget.dataset.text, templateName: '', cursor: event.currentTarget.dataset.text.length, editorCursor: event.currentTarget.dataset.text.length, focus: true });
  },
  expand(event) { const id = event.currentTarget.dataset.id; this._expanded = this._expanded[id] ? {} : { [id]: true }; this.render(getApp().state); },
  older() { this._offset += 50; this._expanded = {}; this.render(getApp().state); },
  latest() { this._offset = 0; this._expanded = {}; this.render(getApp().state); this.scroll(); },
  async changeModel(event) {
    if (this.data.modelChanging || this.data.sending || this.data.creatingSession || this.data.uploading || this.data.voice !== 'idle') return;
    if (!requireLogin()) return;
    const app = getApp(), model = this.data.models[Number(event.detail.value)], id = this.data.sessionId;
    if (!model || !id) return;
    this._modelChangingId = id; this.setData({ modelChanging: true });
    let currentUpdated = false;
    try {
      const selected = await app.mutate('/api/sessions/' + encodeURIComponent(id) + '/model', { modelId: model.id }, 'PATCH');
      currentUpdated = true; this.render(selected);
      const saved = await app.mutate('/api/settings', { defaultModelId: model.id }, 'PATCH');
      this.render(saved); wx.showToast({ title: this.data.running ? '后续消息使用新模型' : '已切换模型', icon: 'none' });
    } catch (error) {
      notify(currentUpdated ? new Error('当前会话已切换，新会话默认模型未保存，请重试。') : error);
    } finally { if (this._modelChangingId === id) this._modelChangingId = null; if (this.data.sessionId === id) this.setData({ modelChanging: false }); }
  },
  openSidebar() { this.setData({ sidebarOpen: true, focus: false }); if (wx.hideKeyboard) wx.hideKeyboard(); this.renderSidebar(); },
  closeSidebar(skipRead) { this.setData({ sidebarOpen: false }); if (skipRead !== true && this._visible && getApp()._foreground !== false) markSessionRead(getApp(), this.data.sessionId); },
  renderSidebar(state) { const current = state || this._sidebarState; if (current) this.setData(sidebarView(current, this.data.sidebarFilter || 'all', this.data.sidebarQuery, this.data.sidebarArchived, this._sidebarLimit)); },
  sidebarSearch(event) { this._sidebarLimit = 40; this.setData({ sidebarQuery: event.detail.value }); this.renderSidebar(); },
  sidebarFilter(event) { this._sidebarLimit = 40; this.setData({ sidebarFilter: event.currentTarget.dataset.filter }); this.renderSidebar(); },
  sidebarArchiveFilter() { this._sidebarLimit = 40; this.setData({ sidebarArchived: !this.data.sidebarArchived }); this.renderSidebar(); },
  sidebarMore() { this._sidebarLimit += 40; this.renderSidebar(); },
  async sidebarNew(event) { this.closeSidebar(true); await this.newSession(event.currentTarget.dataset.mode); },
  tasks() { this.closeSidebar(true); wx.navigateTo({ url: '/pages/tasks/index' }); },
  settings() { this.closeSidebar(true); wx.navigateTo({ url: '/pages/settings/index' }); },
  avatarError() { this.setData({ userAvatar: '' }); },
  sidebarActivate(event) {
    if (this.data.sidebarBusy || !requireLogin()) return;
    if (this.data.uploading || this.data.voice !== 'idle') { notify(new Error('请等待上传或语音操作完成后再切换。')); return; }
    const app = getApp(), state = app.state || this._sidebarState, id = event.currentTarget.dataset.id;
    const session = state && state.sessions.find(s => s.id === id);
    if (!session || session.archivedAt) { notify(new Error('请先取消归档，再打开对话。')); return; }
    if (modeOf(session) === 'chat' && id !== this.data.sessionId) this.rotateWorkHint();
    this.closeSidebar(true); activateSession(app, id);
  },
  async sidebarActions(event) {
    if (this.data.sidebarBusy || !requireLogin()) return;
    const app = getApp(), state = app.state || this._sidebarState, id = event.currentTarget.dataset.id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    if (!state.features || !state.features.sessionManagement) { notify(new Error('当前连接的版本暂不支持归档和删除。')); return; }
    this.setData({ sidebarBusy: true, sidebarMenuId: id });
    try {
      const choice = await new Promise(resolve => wx.showActionSheet({ itemList: [session.archivedAt ? '取消归档' : '归档', '删除', '重命名'], success: r => resolve(r.tapIndex), fail: () => resolve(-1) }));
      if(choice===2){const name=await require('../../utils/manage').editName('会话名称',session.title);if(name!==null)await app.mutate('/api/sessions/'+encodeURIComponent(id),{title:name},'PATCH');return;}
      if(choice>=0&&state.jobs.some(j=>j.sessionId===id&&['queued','running','stopping'].includes(j.status)))throw Error('请先停止或等待当前任务完成。');
      if (choice === 0) await app.mutate('/api/sessions/' + encodeURIComponent(id) + '/archive', { archived: !session.archivedAt }, 'PATCH');
      if (choice === 1) {
        const confirmed = await new Promise(resolve => wx.showModal({ title: '删除这段对话？', content: '删除后无法恢复，素材和已生成的作品会保留。', confirmText: '删除', success: r => resolve(r.confirm), fail: () => resolve(false) }));
        if (confirmed) await app.mutate('/api/sessions/' + encodeURIComponent(id), {}, 'DELETE');
      }
    } catch (error) { notify(error); } finally { this.setData({ sidebarBusy: false, sidebarMenuId: '' }); }
  },
  interaction() {
    const template = selectedTemplateName(this.data.prompt, this.templates());
    return this.data.mode === 'chat' && !template && !isSkillPrompt(this.data.prompt) && !workEntry.explicitWork(this.data.prompt.trim()) ? 'chat' : 'create';
  },
  requestResearchMode() { return this.interaction() === 'chat' ? this.data.researchMode || 'auto' : 'auto'; },
  research(event) { if (this.data.sending || this.data.voice !== 'idle') return; if(!this.data.researchAvailable){notify(new Error('此功能需要连接 0.2.8 本地后端，正式后端尚未更新。'));return;}const mode = event.currentTarget.dataset.mode; this.setData({ researchMode: this.data.researchMode === mode ? 'auto' : mode }); },
  checkMode() {
    if (this.requestResearchMode() !== 'auto' && !this.data.researchAvailable) { this.setData({error:'请连接 0.2.8 本地后端后再使用联网搜索或深度探索。'}); return false; }
    if (this.interaction() === 'create' || getApp().state && getApp().state.features && getApp().state.features.conversationModes) return true;
    this.setData({ error: '新版对话功能尚在本地开发，当前连接的版本暂不可用。' });
    return false;
  },
  async switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    if (this.data.uploading || this.data.creatingSession || this.data.workBusy || this.data.voice !== 'idle') { notify(new Error('请等待当前操作完成后再切换。')); return; }
    if (!getApp().client.hasSession()) {
      this.setData({ mode, typing: false, focus: false });
      if (mode === 'chat') this.rotateWorkHint();
      return;
    }
    await this.newSession(mode);
  },
  async newSession(requestedMode) {
    if (this.data.creatingSession || this.data.workBusy) return;
    if (this.data.modelChanging || this.data.uploading || this.data.voice !== 'idle') { notify(new Error('请等待当前上传或语音操作完成后再新建对话。')); return; }
    if (!requireLogin()) return;
    this.setData({ creatingSession: true, error: '', focus: false });
    try {
      const mode = typeof requestedMode === 'string' ? requestedMode : this.data.mode;
      const state = await openDraft(getApp(), mode);
      if (!state._openedDraftId || getApp().state.activeSessionId !== state._openedDraftId) return;
      this._count = 50; this._offset = 0; this._expanded = {}; this._recognized = null;
      this.setData({ prompt: '', templateName: '', cursor: 0, editorCursor: -1, attachmentIds: [], attached: [], voiceReady: false, pick: false });
      // Render the receipt directly; the button must work even if a page's
      // polling subscription was interrupted by a hide/show transition.
      this.render(state); this.scroll(); wx.showToast({ title: '已进入空白新对话', icon: 'none' });
      if (mode === 'chat') this.rotateWorkHint();
    } catch (error) { this.setData({ error: error.message }); notify(error); }
    finally { this.setData({ creatingSession: false }); }
  },
  async stop() { try { await getApp().mutate('/api/sessions/' + encodeURIComponent(this.data.sessionId) + '/stop', {}); } catch (error) { notify(error); } },
  async retry(event) { const app=getApp(),job=app.state&&(app.state.jobs||[]).find(j=>j.id===event.currentTarget.dataset.id);if(job&&job.stickerGenerationTask){wx.navigateTo({url:'/pages/sticker-studio/index?sessionId='+encodeURIComponent(job.sessionId)+'&projectId='+encodeURIComponent(job.stickerGenerationTask.projectId)});return;}try { await app.mutate('/api/jobs/' + encodeURIComponent(event.currentTarget.dataset.id) + '/retry', {}); } catch (error) { notify(error); } },
  play(event) { wx.navigateTo({ url: '/pages/player/index?type=artifact&id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  openProject(event){const {openProject}=require('../../utils/project-links');const message=(this.data.messages||[]).find(m=>m.id===event.currentTarget.dataset.message);openProject(message&&(message.projectLinks||[]).find(l=>l.id===event.currentTarget.dataset.id));},
  deleteSource(event){return require('../../utils/manage').deleteMedia(this,event.currentTarget.dataset.id);},
  credits() { wx.navigateTo({ url: '/pages/credits/index' }); },
  livePhotoHelp,
  sourceCoverError(event) { coverError(this, 'sources', event, getApp().client); },
  addAttachments(ids) {
    const limit = attachmentLimit(getApp().state), combined = Array.from(new Set(this.data.attachmentIds.concat(ids)));
    if (combined.length > limit) notify(new Error('当前每条指令最多附加 ' + limit + ' 个素材，其余已上传素材保存在素材库，可分次使用。'));
    this.setData({ attachmentIds: combined.slice(0, limit), attachmentLimit: limit });
  },
  pick() {
    if (this.data.creatingSession || this.data.uploading || this.data.sending || this.data.voice !== 'idle') return;
    if (!requireLogin()) return;
    const app = getApp();
    this.setData({ pick: true, attachmentLimit: attachmentLimit(app.state), sources: app.state.media.filter(item => !item.character).slice().reverse().slice(0, 100).map(item => Object.assign(mediaView(item, app.client), { selected: this.data.attachmentIds.includes(item.id) })) });
    loadThumbnails(this, 'sources', app.client);
  },
  closePick() { this.setData({ pick: false }); }, noop() {},
  select(event) {
    const id = event.currentTarget.dataset.id, ids = this.data.attachmentIds;
    if (!ids.includes(id) && ids.length >= attachmentLimit(getApp().state)) { notify(new Error('每条指令最多附加 ' + attachmentLimit(getApp().state) + ' 个素材，可分次制作。')); return; }
    this.setData({ attachmentIds: ids.includes(id) ? ids.filter(value => value !== id) : ids.concat(id) });
    this.render(getApp().state); this.pick();
  },
  removeAttachment(event) { this.setData({ attachmentIds: this.data.attachmentIds.filter(id => id !== event.currentTarget.dataset.id) }); this.render(getApp().state); },
  async sourceMenu(event){const id=event.currentTarget.dataset.id,item=(getApp().state.media||[]).find(m=>m.id===id);if(!item)return;const choice=await new Promise(resolve=>wx.showActionSheet({itemList:['查看素材','重命名','删除素材'],success:r=>resolve(r.tapIndex),fail:()=>resolve(-1)}));if(choice===0)return this.openAttachment(event);if(choice===1)return require('../../utils/manage').rename(this,'/api/media/'+encodeURIComponent(id),'name',item.name);if(choice===2){await require('../../utils/manage').deleteMedia(this,id);if(this.data.pick)this.pick();}},
  async upload(event) {
    if (this.data.creatingSession || this.data.uploading) return;
    if (!requireLogin()) return;
    this.setData({ pick: false, uploading: true });
    try {
      const files = await chooseFiles(event.currentTarget.dataset.audio === 'yes',20,event.currentTarget.dataset.document === 'yes');
      if (!files.length) return;
      this.setData({ error: '' });
      const ids = await uploadMedia(getApp(), files, (at, total, percent) => this.setData({ uploadText: '上传 ' + at + '/' + total + ' · ' + percent + '%' }));
      this.addAttachments(ids); this.render(getApp().state);
    } catch (error) { if (error.uploadedIds) { this.addAttachments(error.uploadedIds); this.render(getApp().state); } this.setData({ error: error.message }); }
    finally { this.setData({ uploading: false, uploadText: '' }); }
  },
  async openAttachment(event) {
    const app=getApp(),item=app.state.media.find(item=>item.id===event.currentTarget.dataset.id);if(!item)return;
    try{if(item.kind==='image'){const file=await app.client.download(item.url);wx.previewImage({current:file,urls:[file]});}else wx.navigateTo({url:'/pages/player/index?type=media&id='+encodeURIComponent(item.id)});}catch(error){notify(error);}
  },
  voiceHold(event) {
    this._voiceLongPress = false;
    if (!getApp().client.hasSession() || this.data.modelChanging || this._voiceConsentPending || this.data.insufficient || this.data.creatingSession || this.data.sending || this.data.uploading || this.data.workBusy || workEntry.explicitWork(this.data.prompt.trim())) return;
    this._pressY = event.touches && event.touches[0] && event.touches[0].clientY; this._voice.hold();
  },
  async voiceStart() {
    this._voiceLongPress = true;
    if (!requireLogin()) return;
    if (!this.checkMode()) return;
    if (this._voiceConsentPending) return;
    if (workEntry.explicitWork(this.data.prompt.trim())) { notify(Error('请先发出当前模板指令，或清空草稿后再录音。')); return; }
    if (this.data.insufficient) { notify(new Error('积分不足，请先签到领取。')); return; }
    if (this.data.modelChanging || this.data.creatingSession || this.data.sending || this.data.uploading) return;
    if (!hasVoiceConsent(getApp())) { await this.requestVoiceConsent(); return; }
    this._voiceError = ''; this.setData({ error: '', focus: false }); this._voice.start({ sessionId: this.data.sessionId, interaction: this.interaction(), researchMode: this.requestResearchMode(), prefix: this.data.prompt, attachmentIds: this.data.attachmentIds });
  },
  requestVoiceConsent() {
    if (hasVoiceConsent(getApp())) return Promise.resolve(true);
    if (this._voiceConsentPending) return Promise.resolve(false);
    this._voice.cancel();
    this._voiceConsentPending = true;
    this.setData({ focus: false, voiceConsentVisible: true });
    return new Promise(resolve => { this._resolveVoiceConsent = resolve; });
  },
  async voiceTap() {
    // Some clients emit tap after longpress. Do not reopen consent or show an
    // unrelated hint after that gesture has already started/cancelled audio.
    if (this._voiceLongPress) { this._voiceLongPress = false; return; }
    if (!requireLogin() || this._voiceConsentPending) return;
    if (this.data.voice !== 'idle') return;
    if (this.data.insufficient) { notify(new Error('积分不足，请先签到领取。')); return; }
    if (this.data.creatingSession || this.data.sending || this.data.uploading) { notify(new Error('请等待当前操作完成后再使用语音。')); return; }
    if (!hasVoiceConsent(getApp())) { await this.requestVoiceConsent(); return; }
    wx.showToast({ title: '请长按说话，松开后发送', icon: 'none' });
  },
  voiceRelease() { this._voice.release(); },
  voiceMove(event) { if (event.touches && event.touches[0] && this._pressY - event.touches[0].clientY > 70) this._voice.cancel(); },
  voiceCancel() { this._voice.cancel(); },
}, workActions.methods, accountEditor.methods));
