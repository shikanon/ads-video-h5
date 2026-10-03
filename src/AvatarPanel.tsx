import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Download, ImagePlus, Pause, Play, Sparkles, Upload, UserRound, X } from 'lucide-react';
import type { AppState, MediaItem } from './types';
import { isActiveJob } from './jobStatus';
import './avatars.css';

export function SpritePreview({ item }: { item: MediaItem }) {
  const sprite=item.character?.sprite;
  const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    setFrame(0);
    if(!sprite||!playing)return;
    const timer=window.setInterval(()=>{if(!document.hidden)setFrame(n=>(n+1)%sprite.frameCount);},1000/sprite.fps);
    return()=>window.clearInterval(timer);
  },[sprite?.sha256,sprite?.frameCount,sprite?.fps,playing]);
  if(!sprite)return <img src={item.url} alt={item.name} className="avatar-reference" />;
  const col=frame%sprite.columns,row=Math.floor(frame/sprite.columns);
  return <div className="avatar-animation">
    <div role="img" aria-label={`${item.name}，${sprite.frameCount} 帧动画`} data-avatar-frame={frame} className="avatar-sprite" style={{aspectRatio:`${sprite.frameWidth}/${sprite.frameHeight}`,backgroundImage:`url("${item.url}")`,backgroundSize:`${sprite.columns*100}% ${sprite.rows*100}%`,backgroundPosition:`${sprite.columns===1?0:col/(sprite.columns-1)*100}% ${sprite.rows===1?0:row/(sprite.rows-1)*100}%`}} />
    <button type="button" className="avatar-preview-control" aria-label={playing?'暂停动画':'播放动画'} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>
  </div>;
}

export default function AvatarPanel({state,pending,mutate,error,openChat}:{state:AppState;pending:boolean;error:string;mutate:(url:string,method:string,body?:unknown)=>Promise<boolean>;openChat:()=>void}) {
  const [mode,setMode]=useState<'reference'|'sprite'|null>(null),[name,setName]=useState('我的 Q 版形象');
  const [file,setFile]=useState<File|null>(null),[columns,setColumns]=useState(4),[rows,setRows]=useState(2),[frameCount,setFrameCount]=useState(8),[fps,setFps]=useState(6),[formError,setFormError]=useState('');
  const picker=useRef<HTMLInputElement>(null);
  const assets=state.media.filter(m=>m.character),active=assets.find(m=>m.id===state.settings.authorAvatarId);
  async function submit(event:FormEvent){
    event.preventDefault();setFormError('');
    if(!file){setFormError('请选择一张图片。');return;}
    if(file.size>20*1024*1024){setFormError('形象图片不能超过 20 MB。');return;}
    const form=new FormData();form.append('file',file);form.append('role',mode!);form.append('name',name);
    if(mode==='sprite')for(const [key,value] of Object.entries({columns,rows,frameCount,fps}))form.append(key,String(value));
    if(await mutate('/api/avatars','POST',form)){setMode(null);setFile(null);}
  }
  const imageReady=state.models.some(m=>m.kind==='image'&&m.enabled);
  function choose(next:'reference'|'sprite'){setMode(next);setFile(null);setFormError('');setName(next==='reference'?'我的 Q 版形象':'我的形象动画');}
  return <section className="subpage-content avatar-panel">
    <div className="avatar-intro"><div className="avatar-intro-icon"><UserRound size={25}/></div><div><h2>让你的形象，出现在每支视频里</h2><p>上传 Q 版原图生成动画，或导入已有序列帧。设为默认作者后，Agent 会将它放入成片。</p></div></div>
    <div className="avatar-toolbar"><button className="avatar-primary" type="button" onClick={()=>choose('reference')}><ImagePlus size={17}/>上传形象原图</button><button type="button" onClick={()=>choose('sprite')}><Upload size={17}/>导入序列帧</button></div>
    {error?<p className="error-banner" role="alert">{error}</p>:null}
    {mode?<form className="avatar-upload" onSubmit={event=>void submit(event)}>
      <div className="avatar-form-heading"><h3>{mode==='reference'?'上传作者形象':'导入动画序列帧'}</h3><button type="button" aria-label="关闭上传" onClick={()=>setMode(null)} disabled={pending}><X size={18}/></button></div>
      <label>形象名称<input value={name} maxLength={60} onChange={e=>setName(e.target.value)} required/></label>
      <label className="avatar-file-label">{mode==='reference'?'形象图片':'序列帧 PNG'}<input ref={picker} type="file" accept={mode==='reference'?'image/png,image/jpeg,image/webp':'image/png'} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
      <p className="avatar-hint">{mode==='reference'?'建议使用完整、透明背景的 Q 版人物图，PNG / JPEG / WebP，最大 20 MB。':'使用透明背景的等分网格，按从左到右、从上到下播放。最大 20 MB。'}</p>
      {mode==='sprite'?<div className="avatar-grid-fields"><label>列数<input type="number" min={1} max={8} value={columns} onChange={e=>setColumns(Number(e.target.value))}/></label><label>行数<input type="number" min={1} max={8} value={rows} onChange={e=>setRows(Number(e.target.value))}/></label><label>动画帧数<input type="number" min={2} max={32} value={frameCount} onChange={e=>setFrameCount(Number(e.target.value))}/></label><label>每秒帧数<input type="number" min={1} max={24} value={fps} onChange={e=>setFps(Number(e.target.value))}/></label></div>:null}
      {formError?<p role="alert" className="error-banner">{formError}</p>:null}
      <button className="avatar-primary" type="submit" disabled={pending||!file}>{pending?'正在上传与校验…':mode==='reference'?'保存形象原图':'导入并预览动画'}</button>
    </form>:null}
    {active?<div className="avatar-active" role="status"><Check size={17}/><span>默认作者：{active.name} · 后续视频自动使用</span><button type="button" disabled={pending} onClick={()=>void mutate('/api/avatars/active','POST',{mediaId:null})}>停用</button><button type="button" onClick={openChat}>去制作视频</button></div>:null}
    {assets.length?<div className="avatar-assets">{[...assets].reverse().map(item=>{
      const sprite=item.character?.sprite;
      const job=[...state.jobs].reverse().find(j=>j.kind==='avatar'&&j.avatarSourceId===item.id);
      const busy=job&&isActiveJob(job),chosen=item.id===active?.id;
      return <article key={item.id} className={`avatar-card${chosen?' chosen':''}`}><div className="avatar-preview"><SpritePreview item={item}/>{chosen?<span className="avatar-badge"><Check size={13}/>默认作者</span>:null}</div><div className="avatar-card-body"><h3>{item.name}</h3><p>{sprite?`${sprite.columns} × ${sprite.rows} · ${sprite.frameCount} 帧 · ${sprite.fps} fps · ${(sprite.frameCount/sprite.fps).toFixed(2)} 秒循环`:'作者原图 · 可生成动画'}</p>
        <div className="avatar-card-actions">{sprite?<button type="button" className={chosen?'':'avatar-primary'} disabled={pending||chosen} onClick={()=>void mutate('/api/avatars/active','POST',{mediaId:item.id})}>{chosen?'已设为默认作者':'设为默认作者'}</button>:<button type="button" className="avatar-primary" disabled={pending||Boolean(busy)||!imageReady} onClick={()=>void mutate(`/api/avatars/${item.id}/generate`,'POST',{sessionId:state.activeSessionId})}><Sparkles size={15}/>{busy?'正在生成动画…':'生成序列帧动画'}</button>}<a className="avatar-download" href={item.url} download={`${item.name}.png`}><Download size={15}/>{sprite?'下载序列帧':'下载原图'}</a></div>
        {busy?<div className="avatar-generation" role="status"><span>{job.stage||'等待生成'} · {job.progress||0}%</span><button type="button" onClick={()=>void mutate(`/api/sessions/${job.sessionId}/stop`,'POST')}>停止运行</button></div>:null}
        {job?.status==='failed'?<p role="alert" className="avatar-generation-error">{job.error}</p>:null}
        {job?.status==='cancelled'?<p className="avatar-hint">生成已停止，可重新生成。</p>:null}
        {!sprite&&!imageReady?<p className="avatar-hint">请在管理后台配置图片模型。</p>:null}
      </div></article>;
    })}</div>:<div className="avatar-empty"><UserRound size={42}/><h3>把你变成视频里的小作者</h3><p>上传一张 Q 版图，生成眨眼、思考、点头的循环动画。</p></div>}
    <p className="avatar-footnote">动画作为独立画面层使用，保留主视频和声音。当前支持状态动画，尚未支持声音驱动的口型同步。</p>
  </section>;
}
