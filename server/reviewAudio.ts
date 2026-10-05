import { readFile } from 'node:fs/promises';
import { runFFmpeg } from './core';

// Only the review transport is compressed. Loudness, clipping and ASR checks
// continue to use the original media, and the entire audition is retained.
export async function reviewAudio(input: string, output: string) {
  await runFFmpeg(['-v', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', output]);
  return { data: (await readFile(output)).toString('base64'), format: 'mp3' as const };
}
