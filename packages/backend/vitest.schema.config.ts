import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 不使用全局 setup，避免 LLM mock 和种子数据干扰
    setupFiles: [],
    testTimeout: 30000,
  },
});
