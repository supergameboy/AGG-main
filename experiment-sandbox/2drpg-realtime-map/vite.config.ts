import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// 与 experiment-sandbox/dynamic-ui-sandbox 保持相同别名约定：
// - `@/` → src/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5200,
  },
});
