import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createEffectStore } from '../server/htmlEffects';

const root = process.cwd();
const store = createEffectStore(path.join(root, 'data'));
await store.init();
const outputDir = path.join(root, 'public', 'effects');
await mkdir(outputDir, { recursive: true });
const selected = process.argv.slice(2);
for (const effect of store.list().filter((item) => (selected.length ? selected : ['sunny-opening', 'photo-drift', 'story-outro']).includes(item.id))) {
  console.log(`Rendering ${effect.id}...`);
  const render = await store.render(effect, { ...(effect.id === 'photo-drift' ? { imageUrl: 'https://video.shikanon.com/qingjian/amalfi-coast-hero.jpg' } : {}) });
  while (render.status === 'queued' || render.status === 'running') await new Promise((resolve) => setTimeout(resolve, 1000));
  if (render.status !== 'succeeded' || !render.file) throw new Error(`${effect.id}: ${render.error || 'failed'}`);
  const destination = path.join(outputDir, `${effect.id}.mp4`);
  await copyFile(render.file, destination);
  console.log(destination);
}
if (!selected.length) {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const inputs = ['sunny-opening', 'photo-drift', 'story-outro'].flatMap((id) => ['-i', path.join(outputDir, `${id}.mp4`)]);
  const destination = path.join(outputDir, 'showcase.mp4');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=5.5[v1];[v1][2:v]xfade=transition=fade:duration=0.5:offset=11[v2]', '-map', '[v2]', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination], { stdio: 'inherit' });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`)));
  });
  console.log(destination);
}
