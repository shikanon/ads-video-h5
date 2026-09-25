import { writeFile } from 'node:fs/promises';

// A small original loop for the built-in "轻快" BGM option. No external media is required.
export async function writePresetBgm(file: string): Promise<void> {
  const rate = 22_050;
  const seconds = 16;
  const samples = rate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  const chords = [
    [261.63, 329.63, 392],
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
  ];
  for (let i = 0; i < samples; i++) {
    const time = i / rate;
    const chord = chords[Math.floor(time / 4) % chords.length];
    const beat = time % 0.5;
    const pluck = Math.exp(-beat * 8);
    const note = chord[Math.floor(time / 0.5) % 3];
    const melody = Math.sin(2 * Math.PI * note * time) * 0.26 * pluck;
    const harmony = chord.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0) * 0.045;
    const bass = Math.sin(2 * Math.PI * (chord[0] / 2) * time) * 0.15 * Math.exp(-(time % 1) * 3);
    const fade = Math.min(1, time / 0.18, (seconds - time) / 0.3);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((melody + harmony + bass) * Math.max(0, fade) * 32767))), i * 2);
  }
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  await writeFile(file, Buffer.concat([wav, pcm]), { mode: 0o600 });
}
