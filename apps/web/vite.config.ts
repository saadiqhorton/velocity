import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME } from '@velocity/ui/brand';

/** API origin for the dev proxy (the API server runs separately). */
const API = process.env.VELOCITY_API_URL ?? 'http://localhost:3100';

/** The product name lives in one constant (BRANDING.md); inject it into index.html. */
function brandTitle(): Plugin {
  return {
    name: 'velocity-brand-title',
    transformIndexHtml: (html) => html.replace('%PRODUCT_NAME%', PRODUCT_NAME),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandTitle()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': { target: API, ws: true, changeOrigin: false },
      '/files': { target: API },
      '/api': { target: API },
      '/avatars': { target: API },
      // MCP: streamable HTTP endpoint and the served stdio client tarball.
      '/mcp': { target: API },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
