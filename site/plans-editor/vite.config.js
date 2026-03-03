import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.jsx'),
      name: 'PlansEditor',
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
