import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'src/renderer', plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) } },
  build: { outDir: '../../dist/web', emptyOutDir: true, rollupOptions: { input: { main: 'src/renderer/index.html', display: 'src/renderer/display.html', startup: 'src/renderer/startup.html' } } },
});
