import { defineConfig } from 'vitest/config';

/**
 * 纯单元测试 vitest 配置（不加载全局 setup.ts，避免 better-sqlite3 native 模块依赖）
 *
 * 用于运行不依赖数据库的单元测试，如：
 * - AuditAgent.multi-llm-checkers.test.ts（mock LLMChecker 数组）
 * - AwarenessAutoSubscriber.test.ts（mock EntityGraphService，使用真实 EventBus）
 *
 * 使用方式：pnpm --filter @ai-rpg/backend exec vitest run --config vitest.unit.config.ts <test-file>
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/llm/**',
    ],
  },
});
