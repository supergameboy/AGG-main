import { defineConfig } from 'vitest/config';

/**
 * packages/ai 测试配置 — 含 LLMService / SmartRetry / Provider 等测试。
 *
 * 并发约束：LLM 相关测试禁用文件级并发（fileParallelism=false + 单线程池），
 * 避免多文件并行触发 LLM API 限流、provider key 轮询状态竞争。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
  },
});
