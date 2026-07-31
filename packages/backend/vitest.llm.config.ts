import { defineConfig } from 'vitest/config';

/**
 * LLM 测试专用配置 — 只运行 tests/llm/ 下的测试
 *
 * 运行方式: npm run test:llm
 * 这些测试需要 LLM API 可用，会产生实际 API 调用费用。
 *
 * 并发约束：LLM 测试禁用并发（fileParallelism=false + 单线程池），
 * 避免多文件并行触发 LLM API 限流、竞争共享 DB/setup 状态。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 120000,
    include: ['tests/llm/**/*.test.ts'],
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
  },
});
