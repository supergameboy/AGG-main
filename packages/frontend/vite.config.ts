import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:17334',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:17334',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        compact: true,
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('mermaid')) return 'mermaid';
            if (id.includes('react-dom') || id.includes('react/') || id.includes('zustand')) return 'react-core';
            if (id.includes('react-router-dom') || id.includes('react-router/')) return 'react-router';
            if (id.includes('react-markdown') || id.includes('remark-gfm') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('micromark') || id.includes('mdast')) return 'markdown';
            if (id.includes('react-hook-form') || id.includes('zod') || id.includes('@hookform/resolvers')) return 'form';
            if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
            if (id.includes('@dnd-kit')) return 'dnd';
            if (id.includes('date-fns')) return 'date';
            if (id.includes('framer-motion')) return 'motion';
            if (id.includes('@heroicons')) return 'icons';
            if (id.includes('axios')) return 'network';
            if (id.includes('clsx') || id.includes('tailwind-merge')) return 'style-utils';
            if (id.includes('@tanstack')) return 'virtual';
            if (id.includes('react-resizable-panels')) return 'panels';
            if (id.includes('@ai-rpg/shared')) return 'shared';
          }
        },
      },
    },
  },
});
