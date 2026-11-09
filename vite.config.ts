import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // BASE_PATH lets the same source be published at a domain root ("/") or at a
  // subpath such as a GitHub Pages project site ("/repo-name/"). The router
  // picks the same value up through import.meta.env.BASE_URL, so deep links
  // keep working in both layouts.
  base: process.env.BASE_PATH || '/',
  build: {
    // The bundled ECB rate history is loaded on demand, so the main bundle is
    // the only chunk users download up front. Split the heavier vendor
    // libraries so the first paint is not blocked by chart code.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (/[\\/](recharts|d3-[a-z]+|victory-vendor)[\\/]/.test(id)) return 'charts';
          if (/[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'db';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/db/**'],
    },
  },
});
