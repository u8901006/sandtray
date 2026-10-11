import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// G33 demo：sand-engine 專屬 Vite（root 指到本目錄，port 5179，不佔 apps/web 的 8788）。
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  server: {
    port: 5179,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
