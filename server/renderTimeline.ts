import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EditPlan, MediaItem, TimelineText } from '../src/types';
import { runFFmpeg, probeVideo } from './core';
import { timelineDuration, validateTimeline } from './timeline';
import { renderDrawings } from './motionDrawing';
import { lessonDimensions } from './lessonSpec';
import { measureLoudness, parseLoudness, twoPassLoudnorm, voicedSpread, SOUND_LIMITS, type LoudnessMeasurement } from './audioQuality';

export const planHash = (plan: EditPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
export const dimensions = (plan: EditPlan) => plan.lesson ? lessonDimensions(plan.format) : plan.format === '16:9' ? [960, 540] : plan.format === '1:1' ? [720, 720] : plan.reconstruction ? [720, 1280] : [540, 960];
const assTime = (seconds: number) => { const n = Math.round(seconds * 100); return `${Math.floor(n / 360000)}:${String(Math.floor(n / 6000) % 60).padStart(2, '0')}:${String(Math.floor(n / 100) % 60).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`; };
const assText = (text: string) => text.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
const filterPath = (value: string) => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''");

export function createAss(plan: EditPlan): string {
  const [w, h] = dimensions(plan);
  const font = process.env.QINGJIAN_SUBTITLE_FONT || (process.platform === 'darwin' ? 'PingFang SC' : 'Noto Sans CJK SC');
  if (!/^[\w \u4e00-\u9fff-]{1,80}$/.test(font)) throw new Error('字幕字体配置无效。');
  const size = plan.lesson ? (plan.format==='16:9'?34:38) : Math.round(w / 14);
  const subtitleMargin = plan.lesson ? (plan.format==='16:9'?60:100) : Math.round(h*.13);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: subtitle,${font},${size},&H00FFFFFF,&H000000FF,&H00181818,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,32,32,${subtitleMargin},1\nStyle: title,${font},${Math.round(size * 1.45)},&H00FFFFFF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,8,32,32,${Math.round(h * 0.1)},1\nStyle: keyword,${font},${Math.round(size * 1.15)},&H0053BBFF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,8,32,32,${Math.round(h * 0.25)},1\nStyle: lower-third,${font},${size},&H00FFFFFF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,1,32,32,${Math.round(h * 0.28)},1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const event = (item: TimelineText, layer: number) => {
    let animation = '';
    if (item.animation === 'pop') animation = '{\\fscx85\\fscy85\\t(0,180,\\fscx100\\fscy100)\\fad(80,80)}';
    else if (item.animation === 'rise') {
      const y = item.style === 'title' ? h * 0.1 : item.style === 'keyword' ? h * 0.25 : item.style === 'lower-third' ? h * 0.72 : h * 0.87;
      animation = `{\\an5\\move(${w / 2},${Math.round(y + 16)},${w / 2},${Math.round(y)},0,180)\\fad(100,80)}`;
    } else if (item.animation === 'underline') animation = '{\\u1\\fad(100,80)}';
    return `Dialogue: ${layer},${assTime(item.start)},${assTime(item.end)},${item.style},,0,0,0,,${animation}${assText(item.text)}`;
  };
  return header + (plan.captions || []).map((c) => event(c, 0)).concat((plan.overlays || []).map((c) => event(c, 1))).join('\n') + '\n';
}

export async function renderTimeline(inputPlan: EditPlan, media: MediaItem[], mediaDir: string, exportDir: string, narrationFile?: string, bgmFile?: string): Promise<{ id: string; file: string }> {
  const plan = validateTimeline(inputPlan, media);
  const id = randomUUID(); const tempDir = path.join(exportDir, `tmp-${id}`);
  await mkdir(tempDir, { recursive: true });
  const [width, height] = dimensions(plan); const output = path.join(exportDir, `${id}.mp4`);
  try {
    const segments: string[] = [];
    const segmentMeasurements:Array<{sourceId:string;start:number;end:number;measurement:LoudnessMeasurement;preparationFilter:string;filter:string;candidateSpreads:Array<{ratio:number;spreadLu:number|null;method?:string}>}>=[];
    for (const [index, clip] of plan.clips.entries()) {
      const source = media.find((m) => m.id === clip.sourceId);
      if (!source) throw new Error('剪辑方案使用的素材已被移除。');
      const input = path.join(mediaDir, source.id); const segment = path.join(tempDir, `clip-${index}.mp4`);
      const duration = clip.end - clip.start;
      const visual = source.kind === 'image' ? ['-loop', '1', '-framerate', '30', '-i', input] : ['-ss', String(clip.start), '-i', input];
      const hasAudio = source.kind === 'video' && (await probeVideo(input)).hasAudio;
      let audioBase='aformat=sample_rates=44100:channel_layouts=stereo';
      let normalizeFilter='';
      if(plan.audio!.normalize&&hasAudio&&(clip.volume??1)>0){
        const raw=await measureLoudness(input,clip.start,duration,audioBase);
        if(raw.integrated!==null){
          const gain=Math.max(-24,Math.min(24,-18-raw.integrated));
          const candidates=source.generation?.mode==='generated'?[[0.1,2],[0.05,4],[0.04,6]]:[[0.1,2]];
          let best:{ratio:number;preparation:string;measurement:LoudnessMeasurement;filter:string;spreadLu:number|null}|undefined;
          const candidateSpreads:Array<{ratio:number;spreadLu:number|null;method?:string}>=[];
          for(const [threshold,ratio] of candidates){
            const preparation=`${audioBase},volume=${gain.toFixed(3)}dB,acompressor=threshold=${threshold}:ratio=${ratio}:attack=10:release=160:knee=2.828:makeup=1:link=average`;
            const measurement=await measureLoudness(input,clip.start,duration,preparation);const filter=twoPassLoudnorm(measurement);
            const log=await runFFmpeg(['-hide_banner','-nostats','-ss',String(clip.start),'-i',input,'-t',String(duration),'-vn','-af',`atrim=duration=${duration},asetpts=PTS-STARTPTS,${preparation},${filter},ebur128=framelog=info`,'-f','null','-'],180000,250000);
            const spreadLu=voicedSpread(log);candidateSpreads.push({ratio,spreadLu});
            if(!best||(spreadLu??Infinity)<(best.spreadLu??Infinity))best={ratio,preparation,measurement,filter,spreadLu};
            // Prefer the gentlest passing treatment, with a small margin for
            // resampling/AAC. Final encoded output still has an independent gate.
            if(best.spreadLu!==null&&best.spreadLu<=SOUND_LIMITS.withinSpreadLu-.5)break;
          }
          if(best&&source.generation?.mode==='generated'&&best.spreadLu!==null&&best.spreadLu>SOUND_LIMITS.withinSpreadLu-.5){
            const preparation=best.preparation+',dynaudnorm=f=100:g=5:p=0.7:m=6:r=0.15';
            const measurement=await measureLoudness(input,clip.start,duration,preparation),filter=twoPassLoudnorm(measurement);
            const log=await runFFmpeg(['-hide_banner','-nostats','-ss',String(clip.start),'-i',input,'-t',String(duration),'-vn','-af',`atrim=duration=${duration},asetpts=PTS-STARTPTS,${preparation},${filter},ebur128=framelog=info`,'-f','null','-'],180000,250000);
            const spreadLu=voicedSpread(log);candidateSpreads.push({ratio:best.ratio,spreadLu,method:'compressor+dynaudnorm'});
            if(spreadLu!==null&&spreadLu<best.spreadLu)best={ratio:best.ratio,preparation,measurement,filter,spreadLu};
          }
          if(best){audioBase=best.preparation;normalizeFilter=best.filter+',';segmentMeasurements.push({sourceId:source.id,start:clip.start,end:clip.end,measurement:best.measurement,preparationFilter:audioBase,filter:best.filter,candidateSpreads});}
        }
      }
      let vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`;
      if ((clip.zoom || 1) > 1) vf += `,zoompan=z='1+${(clip.zoom! - 1).toFixed(4)}*on/${Math.ceil(duration * 30)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=30`;
      await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...visual, ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']), '-t', String(duration), '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0', '-vf', vf, '-af', `atrim=duration=${duration},asetpts=PTS-STARTPTS,${audioBase},${normalizeFilter}volume=${clip.volume ?? 1},apad`, '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', segment]);
      segments.push(segment);
    }
    const merged = path.join(tempDir, 'merged.mp4');
    if (!plan.clips.some((c) => c.transition?.kind === 'fade')) {
      const list = path.join(tempDir, 'concat.txt');
      await writeFile(list, segments.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join('\n'));
      // Container/encoder padding is longer than some fractional clip cuts.
      // Concatenate trimmed audio samples separately so padding cannot move
      // later voices past the planned subtitle and review boundaries.
      const audioSegments=plan.clips.map((c,i)=>`[${i+1}:a]atrim=duration=${c.end-c.start},asetpts=PTS-STARTPTS[sa${i}]`);
      audioSegments.push(`${segments.map((_,i)=>`[sa${i}]`).join('')}concat=n=${segments.length}:v=0:a=1[voice]`);
      await runFFmpeg(['-v','error','-y','-f','concat','-safe','0','-i',list,...segments.flatMap(s=>['-i',s]),'-filter_complex',audioSegments.join(';'),'-map','0:v:0','-map','[voice]','-t',String(timelineDuration(plan)),'-c:v','copy','-c:a','aac','-b:a','128k',merged]);
    } else {
      // Timebase/PTS conversion can leave an unknown frame rate on Linux.
      // Establish CFR after conversion and after each join before another xfade.
      const filters = segments.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=30,settb=AVTB[v${i}];[${i}:a]atrim=duration=${plan.clips[i].end-plan.clips[i].start},asetpts=PTS-STARTPTS[a${i}]`);
      let v = 'v0'; let a = 'a0'; let elapsed = plan.clips[0].end - plan.clips[0].start;
      for (let i = 1; i < segments.length; i++) {
        const fade = plan.clips[i].transition?.kind === 'fade' ? plan.clips[i].transition!.duration : 0;
        if (fade) filters.push(`[${v}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(elapsed - fade).toFixed(3)}[joined${i}];[${a}][a${i}]acrossfade=d=${fade}:c1=tri:c2=tri[am${i}]`);
        else filters.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[joined${i}][am${i}]`);
        filters.push(`[joined${i}]fps=30,settb=AVTB[vm${i}]`);
        v = `vm${i}`; a = `am${i}`; elapsed += plan.clips[i].end - plan.clips[i].start - fade;
      }
      await runFFmpeg(['-v', 'error', '-y', '-filter_complex_threads', '1', ...segments.flatMap((s) => ['-i', s]), '-filter_complex', filters.join(';'), '-map', `[${v}]`, '-map', `[${a}]`, '-t', String(timelineDuration(plan)), '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', merged]);
    }
    let composed = merged;
    const drawings = await renderDrawings(plan, width, height, tempDir);
    if (drawings) {
      composed = path.join(tempDir, 'composed.mp4');
      // Force libvpx to decode WebM's alpha plane; the native decoder discards it.
      await runFFmpeg(['-v','error','-y','-i',merged,'-c:v','libvpx-vp9','-i',drawings,'-filter_complex_threads','1','-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto[v]','-map','[v]','-map','0:a','-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','copy',composed]);
    }
    const inputs = ['-i', composed, ...(bgmFile ? ['-stream_loop', '-1', '-i', bgmFile] : []), ...(narrationFile ? ['-i', narrationFile] : [])];
    const audio = plan.audio!;
    const tracks = [`[0:a]volume=${audio.originalVolume}[original]`]; const labels = ['[original]'];
    if (bgmFile) { tracks.push(`[1:a]volume=${audio.bgmVolume}[music]`); labels.push('[music]'); }
    if (narrationFile) { tracks.push(`[${bgmFile ? 2 : 1}:a]volume=${audio.narrationVolume}[voice]`); labels.push('[voice]'); }
    const mix=`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0`;
    let mixMeasurement:LoudnessMeasurement|undefined;let mixNormalize='';
    if(audio.normalize){
      const log=await runFFmpeg(['-hide_banner','-nostats',...inputs,'-filter_complex_threads','1','-filter_complex',[...tracks,`${mix},loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json[measure]`].join(';'),'-map','[measure]','-t',String(plan.targetSeconds),'-f','null','-']);
      mixMeasurement=parseLoudness(log);if(mixMeasurement.integrated!==null)mixNormalize=twoPassLoudnorm(mixMeasurement)+',';
    }
    tracks.push(`${mix},${mixNormalize}alimiter=limit=0.95:level=0[a]`);
    const hasText = Boolean(plan.captions?.length || plan.overlays?.length);
    const assFile = path.join(tempDir, 'timeline.ass');
    if (hasText) await writeFile(assFile, createAss(plan));
    const fontsDir = process.env.QINGJIAN_FONTS_DIR || (existsSync('/System/Library/Fonts') ? '/System/Library/Fonts' : '/usr/share/fonts');
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex_threads', '1', '-filter_complex', tracks.join(';'), '-map', '0:v:0', '-map', '[a]', ...(hasText ? ['-vf', `ass=filename='${filterPath(assFile)}':fontsdir='${filterPath(fontsDir)}'`, '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23'] : ['-c:v', 'copy']), '-t', String(plan.targetSeconds), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]);
    await writeFile(path.join(exportDir, `${id}.render.json`), JSON.stringify({ planHash: planHash(inputPlan), width, height, duration: plan.targetSeconds, captions: plan.captions?.length || 0, overlays: plan.overlays?.length || 0, motions: plan.motions || [], drawingEngine: drawings ? 'GSAP/HyperFrames' : null, audioNormalization:audio.normalize?{mode:'segment-two-pass+mix-two-pass',targetLufs:SOUND_LIMITS.targetLufs,targetTruePeakDb:SOUND_LIMITS.truePeakDb,segments:segmentMeasurements,mix:mixMeasurement,mixFilter:mixNormalize}:undefined, narration: Boolean(narrationFile), generatedNarration: plan.reconstruction?.beats.filter(b=>b.mode==='generated').map(b=>({beatId:b.id,mediaId:b.mediaId,audioHash:b.audioHash,referenceHash:plan.reconstruction?.voiceReference?.audioHash})), htmlScenes: plan.reconstruction?.beats.filter(b=>b.visual==='html').map(b=>({beatId:b.id,mediaId:b.mediaId,htmlHash:b.htmlHash})), bgm: Boolean(bgmFile) }, null, 2));
    return { id, file: output };
  } catch (error) { await rm(output, { force: true }); throw error; }
  finally { await rm(tempDir, { recursive: true, force: true }); }
}
