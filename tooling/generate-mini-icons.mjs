import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/miniprogram/miniprogram/assets');
const circle = (x, y, radius) => Array.from({ length: 49 }, (_, i) => [x + radius * Math.cos(i * Math.PI / 24), y + radius * Math.sin(i * Math.PI / 24)]);
const paths = {
  chat: [[[14, 13], [58, 13], [58, 48], [36, 48], [22, 59], [22, 48], [14, 48], [14, 13]], [[25, 26], [47, 26]], [[25, 35], [40, 35]]],
  library: [[[21, 14], [58, 14], [58, 53], [21, 53], [21, 14]], [[14, 22], [14, 60], [49, 60]], [[25, 45], [34, 34], [42, 42], [48, 35], [55, 43]], circle(46, 26, 3)],
  films: [[[14, 22], [58, 22], [58, 58], [14, 58], [14, 22]], [[14, 22], [14, 13], [58, 13], [58, 22]], [[23, 13], [29, 22]], [[39, 13], [45, 22]], [[31, 33], [45, 41], [31, 49], [31, 33]]],
  profile: [circle(36, 26, 12), [[15, 59], [16, 51], [20, 44], [28, 40], [44, 40], [52, 44], [56, 51], [57, 59]]],
};
await mkdir(target, { recursive: true });
for (const [name, strokes] of Object.entries(paths)) {
  for (const selected of [false, true]) {
    const color = selected ? [221, 116, 86] : [140, 137, 134], png = new PNG({ width: 72, height: 72 });
    for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
      let nearest = 100;
      for (const stroke of strokes) for (let i = 1; i < stroke.length; i++) {
        const [ax, ay] = stroke[i - 1], [bx, by] = stroke[i], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x + .5 - ax) * dx + (y + .5 - ay) * dy) / (dx * dx + dy * dy)));
        nearest = Math.min(nearest, Math.hypot(x + .5 - ax - t * dx, y + .5 - ay - t * dy));
      }
      const index = (y * 72 + x) * 4; png.data.set(color, index); png.data[index + 3] = Math.round(Math.max(0, Math.min(1, 2.35 - nearest)) * 255);
    }
    await writeFile(path.join(target, name + (selected ? '-active' : '') + '.png'), PNG.sync.write(png));
  }
}
console.log('Generated 8 native tab icons.');
