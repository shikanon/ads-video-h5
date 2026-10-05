import { readFile } from 'node:fs/promises';
import { runFFmpeg } from './core';
import type { ReviewAssetPublisher } from './reviewAssets';

// Only the review transport is compressed. Loudness, clipping and ASR checks
// continue to use the original media, and the entire audition is retained.
export async function reviewAudio(input: string, output: string, publish?: ReviewAssetPublisher) {
  await runFFmpeg(['-v', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', output]);
  if (publish) return { url: await publish(output, 'audio/mpeg'), format: 'mp3' as const };
  return { data: (await readFile(output)).toString('base64'), format: 'mp3' as const };
}
