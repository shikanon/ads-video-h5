import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function releaseRevision(): string {
  // CD builds a git archive outside the checkout. export-subst stamps that
  // archive; local checkout builds obtain their revision directly from Git.
  const archived = readFileSync(new URL('./ops/release-revision.txt', import.meta.url), 'utf8').trim();
  const revision = /^[a-f0-9]{40}$/.test(archived) ? archived : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Cannot determine deployment revision.');
  return revision;
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), {
    name: 'qingjian-release-revision',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ revision: releaseRevision() }) + '\n' });
    },
  }],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
