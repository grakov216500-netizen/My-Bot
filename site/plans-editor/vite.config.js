import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({ NODE_ENV: 'production' }),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.jsx'),
      // Имя глобальной переменной для бандла Novel.
      // ВАЖНО: отличаться от window.PlansEditor, чтобы не затирать наш API.
      name: 'PlansEditorBundle',
      fileName: 'plans-editor',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        assetFileNames: 'plans-editor.[ext]',
      },
    },
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
  },
});
