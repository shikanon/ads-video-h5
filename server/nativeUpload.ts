import { open } from 'node:fs/promises';
import { detectImage } from './core';

// Native multipart clients can omit the per-file MIME type. Only recognize
// known containers from bytes; extension and user-provided fields prove nothing.
export function binaryMediaType(bytes: Buffer): string | null {
  const image = detectImage(bytes); if (image) return image;
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if ((bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}
export async function uploadMediaType(file: string, declared: string): Promise<string> {
  if (declared !== 'application/octet-stream') return declared;
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(512), result = await handle.read(bytes, 0, bytes.length, 0);
    const detected = binaryMediaType(bytes.subarray(0, result.bytesRead));
    if (!detected) throw new Error('无法识别素材格式，请选择有效的视频、图片或音频。');
    return detected;
  } finally { await handle.close(); }
}
