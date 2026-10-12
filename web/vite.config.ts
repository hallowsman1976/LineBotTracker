import { defineConfig } from 'vite';

// Served from https://hallowsman1976.github.io/LineBotTracker/, so asset URLs must be relative.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
