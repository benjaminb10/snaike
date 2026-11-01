import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: 'index.html', advertise: 'advertise.html' } },
  },
});
