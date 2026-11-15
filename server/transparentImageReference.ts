import ffmpeg from 'ffmpeg-static';
import { PNG } from 'pngjs';
import { spawnForJob, throwIfJobCancelled } from './jobExecution';

const LIMIT = 30 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function hasTransparentReferencePixel(bytes:Buffer):boolean {
  const png=PNG.sync.read(bytes,{checkCRC:true});
  for(let p=3;p<png.data.length;p+=4)if(png.data[p]<255)return true;
  return false;
}

function validatePng(bytes: Buffer): void {
  if (bytes.length < 33 || bytes.length > LIMIT || !bytes.subarray(0, 8).equals(signature)) throw Error('参考图片转换失败，请换一张完整的图片。');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PIXELS) throw Error('参考图片总像素不能超过 1600 万。');
  try { PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw Error('参考图片无法解码，请换一张完整的图片。'); }
}

// Seedream 5.0 transparent generation requires a PNG with an alpha channel.
// Convert the request copy only: do not rename JPEG bytes, alter stored media,
// erase backgrounds, or change the user's approval/reference fingerprint.
export async function transparentImageReference(bytes: Buffer): Promise<Buffer> {
  throwIfJobCancelled();
  if (bytes.subarray(0, 8).equals(signature)) {
    validatePng(bytes);
    if (bytes[25] === 6) return bytes;
  }
  const child = spawnForJob(ffmpeg || 'ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-threads', '1', '-max_pixels', String(MAX_PIXELS),
    '-i', 'pipe:0', '-map_metadata', '-1', '-frames:v', '1', '-threads', '1',
    '-pix_fmt', 'rgba', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const chunks: Buffer[] = [];
  let size = 0, limited = false, timedOut = false;
  child.stdout!.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > LIMIT) { limited = true; child.kill('SIGKILL'); }
    else chunks.push(chunk);
  });
  // A decoder may close stdin early on corrupt/oversized input.
  child.stdin!.on('error', () => {});
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(Error('参考图片转换暂不可用，请稍后重试。')));
      child.once('close', code => {
        if (code === 0 && !limited && !timedOut) resolve();
        else reject(Error(limited ? '参考图片转换后超过 30 MB，请缩小图片。' : timedOut ? '参考图片转换超时，请缩小图片后重试。' : '参考图片无法解码或尺寸过大，请换一张完整的图片。'));
      });
      child.stdin!.end(bytes);
    });
    throwIfJobCancelled();
    const result = Buffer.concat(chunks);
    validatePng(result);
    if (result[25] !== 6) throw Error('参考图片转换未得到 RGBA PNG。');
    return result;
  } catch (error) { throwIfJobCancelled(); throw error; }
  finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); }
}
