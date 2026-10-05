import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewAudio } from '../server/reviewAudio';
import { probeAudio, runFFmpeg } from '../server/core';

test('review transport preserves the full audition, reduces payload and leaves the actual media unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qingjian-review-audio-'));
  try {
    const input = path.join(dir, 'actual.wav'), output = path.join(dir, 'audition.mp3');
    await runFFmpeg(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '8.37', '-c:a', 'pcm_s16le', input]);
    const original = await readFile(input), request = await reviewAudio(input, output);
    const encoded = await readFile(output), duration = await probeAudio(output);
    assert.equal(request.format, 'mp3');
    assert.deepEqual(Buffer.from(request.data, 'base64'), encoded);
    assert.ok(encoded.length < original.length * .6, `${encoded.length}/${original.length}`);
    assert.ok(Math.abs(duration - 8.37) < .15, String(duration));
    assert.deepEqual(await readFile(input), original);
    await runFFmpeg(['-v', 'error', '-i', output, '-f', 'null', '-']);
    const info = await runFFmpeg(['-hide_banner', '-i', output, '-f', 'null', '-']);
    assert.match(info, /Audio: mp3/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
