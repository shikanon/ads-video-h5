import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { releasePlugin } from '../../tooling/releasePlugin';

export default defineConfig(({ command }) => {
  const webBase = `${(process.env.VITE_BASE_PATH || '/').replace(/\/$/, '')}/`;
  const base = process.env.VITE_ADMIN_BASE_PATH || (command === 'build' ? `${webBase}admin/` : '/');
  const apiBase = `${(process.env.VITE_API_BASE_PATH || (command === 'build' ? webBase : '/')).replace(/\/+$/, '')}/`;
  return {
    base,
    plugins: [react(), releasePlugin()],
    define: {
      'import.meta.env.VITE_API_BASE_PATH': JSON.stringify(apiBase),
      'import.meta.env.VITE_WEB_URL': JSON.stringify(process.env.VITE_WEB_URL || (command === 'build' ? webBase : 'http://127.0.0.1:5173/')),
    },
    server: {
      proxy: { [`${apiBase.replace(/\/$/, '')}/api`]: { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8787', changeOrigin: false, rewrite: path => apiBase === '/' ? path : path.slice(apiBase.length - 1) } },
    },
  };
});
