import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// 与 packages/frontend/vite.config.ts 保持相同别名约定：
// - `@/` → src/
// - `@ai-rpg/shared` → 本地共享类型副本（使 UIDirectiveParser/DynamicUIRenderer 可原样复制，import 路径不变）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ai-rpg/shared': path.resolve(__dirname, 'src/types/dynamic-ui.ts'),
    },
  },
  server: {
    port: 5199,
  },
});
