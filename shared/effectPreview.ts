export function effectPreview(html: string, duration: number): { html: string; previewId: string } {
  if (!Number.isFinite(duration) || duration < 1 || duration > 15) throw new Error('预览时长需为 1–15 秒。');
  const previewId = crypto.randomUUID();
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const controller = `<script>(()=>{
    const id=${JSON.stringify(previewId)}, duration=${duration};
    const timeline=window.__timelines&&window.__timelines.main;
    const send=(type,extra={})=>parent.postMessage({type:'qingjian:effect:'+type,previewId:id,...extra},'*');
    if(!timeline||typeof timeline.seek!=='function'){send('error',{error:'此特效没有可播放的动画时间轴。'});return;}
    let time=0,playing=false,previous=0,lastReport=0,frame=0;
    const videos=Array.from(document.querySelectorAll('video'));
    const syncMedia=()=>videos.forEach(video=>{if(video.readyState>=1&&Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(time%video.duration,Math.max(0,video.duration-.02));});
    const playMedia=()=>videos.forEach(video=>{void video.play().catch(()=>send('error',{error:'素材视频无法播放，请检查视频格式或重新上传。'}));});
    videos.forEach(video=>{video.autoplay=false;video.pause();video.addEventListener('loadedmetadata',()=>{syncMedia();if(playing)playMedia();});});
    timeline.pause();
    const seek=(value,sync=true)=>{time=Math.min(duration,Math.max(0,Number(value)||0));timeline.seek(time,true);if(sync)syncMedia();};
    const report=()=>send('state',{time,duration,playing});
    function tick(now){
      if(!playing){frame=0;return;}
      if(previous)time+=(now-previous)/1000;
      previous=now;const looped=time>=duration;if(looped)time%=duration;
      seek(time,looped);if(now-lastReport>150){report();lastReport=now;}
      frame=requestAnimationFrame(tick);
    }
    const pause=()=>{playing=false;previous=0;if(frame)cancelAnimationFrame(frame);frame=0;videos.forEach(video=>video.pause());report();};
    window.addEventListener('message',event=>{
      const data=event.data;if(event.source!==parent||!data||data.type!=='qingjian:effect:control'||data.previewId!==id)return;
      if(data.action==='pause')pause();
      else if(data.action==='seek'){seek(data.time);report();}
      else if(data.action==='restart'){seek(0);previous=0;report();}
      else if(data.action==='play'){if(!playing){playing=true;previous=0;syncMedia();playMedia();frame=requestAnimationFrame(tick);}report();}
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
    window.addEventListener('error',event=>send('error',{error:String(event.message||'动画运行失败。').slice(0,240)}));
    seek(0);send('ready',{time,duration,playing});
  })();</script>`;
  const protectedHtml = /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${policy}`) : `${policy}${html}`;
  return { previewId, html: /<\/body>/i.test(protectedHtml) ? protectedHtml.replace(/<\/body>/i, `${controller}</body>`) : `${protectedHtml}${controller}` };
}
