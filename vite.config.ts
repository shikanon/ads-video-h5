import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { releasePlugin } from './tooling/releasePlugin';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), releasePlugin()],
  define: { 'import.meta.env.VITE_ADMIN_URL': JSON.stringify(process.env.VITE_ADMIN_URL || '') },
  server: {
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
