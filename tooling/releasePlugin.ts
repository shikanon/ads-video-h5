import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export function releasePlugin(): Plugin {
  return {
    name: 'qingjian-release-revision',
    generateBundle() {
      const archived = readFileSync(new URL('../ops/release-revision.txt', import.meta.url), 'utf8').trim();
      const revision = /^[a-f0-9]{40}$/.test(archived) ? archived : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Cannot determine deployment revision.');
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ revision }) + '\n' });
    },
  };
}
