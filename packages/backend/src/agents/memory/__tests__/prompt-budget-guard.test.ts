import { describe, expect, it } from 'vitest';
import { PromptBuildBudgetGuard } from '../prompt-budget-guard.js';
import type { PromptBuildResult } from '../../prompt/types.js';

function createMockPromptBuildResult(overrides: Partial<PromptBuildResult> = {}): PromptBuildResult {
  return {
    systemPrompt: '',
    userPrompt: '',
    apiTools: [],
    allowedFunctionNames: new Set(),
    ...overrides,
  };
}

describe('PromptBuildBudgetGuard', () => {
  const BUDGET_LIMIT = 1000;

  describe('check - compressionUrgency 分级', () => {
    it('utilization <= 0.6 时 urgency 应为 none', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(200),   // ~67 tokens
        userPrompt: 'b'.repeat(200),     // ~67 tokens
      });
      const contextMessages = [
        { role: 'user', content: 'c'.repeat(200) },  // ~67 tokens
      ];

      const result = guard.check(promptResult, contextMessages);

      expect(result.compressionUrgency).toBe('none');
      expect(result.shouldCompress).toBe(false);
    });

    it('0.6 < utilization <= 0.75 时 urgency 应为 low', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      // estimateTokens: Math.ceil(len / 3)
      // apiTools: [] → JSON.stringify = '[]' → 2 chars → 1 token
      // 目标: totalTokens ≈ 700 → ratio ≈ 0.7 → low
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(900),   // 300 tokens
        userPrompt: 'b'.repeat(900),     // 300 tokens
      });
      const contextMessages = [
        { role: 'user', content: 'c'.repeat(300) },  // 100 tokens
      ];
      // total = 300 + 300 + 100 + 1(apiTools) = 701 → ratio = 0.701 → low

      const result = guard.check(promptResult, contextMessages);

      expect(result.compressionUrgency).toBe('low');
      expect(result.shouldCompress).toBe(false);
    });

    it('0.75 < utilization <= 0.9 时 urgency 应为 medium', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      // 目标: totalTokens ≈ 850 → ratio ≈ 0.85 → medium
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(1050),  // 350 tokens
        userPrompt: 'b'.repeat(1050),    // 350 tokens
      });
      const contextMessages = [
        { role: 'user', content: 'c'.repeat(450) },  // 150 tokens
      ];
      // total = 350 + 350 + 150 + 1(apiTools) = 851 → ratio = 0.851 → medium

      const result = guard.check(promptResult, contextMessages);

      expect(result.compressionUrgency).toBe('medium');
      expect(result.shouldCompress).toBe(true);
    });

    it('utilization > 0.9 时 urgency 应为 high', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(1200),  // 400 tokens
        userPrompt: 'b'.repeat(1200),    // 400 tokens
      });
      const contextMessages = [
        { role: 'user', content: 'c'.repeat(600) },  // 200 tokens
      ];
      // total = 400 + 400 + 200 + 1(apiTools) = 1001 → ratio = 1.001 → high

      const result = guard.check(promptResult, contextMessages);

      expect(result.compressionUrgency).toBe('high');
      expect(result.shouldCompress).toBe(true);
    });
  });

  describe('check - utilizationRatio 计算', () => {
    it('应正确计算 utilizationRatio', () => {
      const guard = new PromptBuildBudgetGuard(1000);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'x'.repeat(250),   // 84 tokens
        userPrompt: 'y'.repeat(250),     // 84 tokens
      });
      const contextMessages: Array<{ role: string; content?: string }> = [];

      const result = guard.check(promptResult, contextMessages);

      // total = 84 + 84 + 1(apiTools) = 169 tokens / 1000 budget ≈ 0.17
      expect(result.utilizationRatio).toBeGreaterThan(0);
      expect(result.utilizationRatio).toBeLessThan(0.5);
    });

    it('budgetLimit 为 0 时 utilizationRatio 应为 0', () => {
      const guard = new PromptBuildBudgetGuard(0);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'some text',
      });

      const result = guard.check(promptResult, []);

      expect(result.utilizationRatio).toBe(0);
      expect(result.compressionUrgency).toBe('none');
    });

    it('空内容时 totalTokens 应仅含 apiTools 开销', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult();

      const result = guard.check(promptResult, []);

      // apiTools: [] → JSON.stringify('[]') → 2 chars → 1 token
      expect(result.totalTokens).toBe(1);
      expect(result.utilizationRatio).toBeGreaterThan(0);
    });
  });

  describe('check - warnings 生成', () => {
    it('应从 systemPromptTrace.layers 生成 warnings', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'system content',
        systemPromptTrace: {
          content: 'system content',
          totalTokens: 10,
          layers: [
            { name: 'identity', order: 1, content: 'identity layer', tokenCount: 50, metadata: {} },
            { name: 'rules', order: 2, content: 'rules layer', tokenCount: 100, metadata: {} },
          ],
        },
      });

      const result = guard.check(promptResult, []);

      const layerWarnings = result.warnings.filter(w => w.layer !== 'context_messages');
      expect(layerWarnings.length).toBe(2);
      expect(layerWarnings[0].layer).toBe('identity');
      expect(layerWarnings[0].tokenCount).toBe(50);
      expect(layerWarnings[1].layer).toBe('rules');
      expect(layerWarnings[1].tokenCount).toBe(100);
    });

    it('应包含 context_messages warning', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult();
      const contextMessages = [
        { role: 'user', content: 'hello' },
      ];

      const result = guard.check(promptResult, contextMessages);

      const ctxWarning = result.warnings.find(w => w.layer === 'context_messages');
      expect(ctxWarning).toBeDefined();
      expect(ctxWarning!.tokenCount).toBeGreaterThan(0);
    });

    it('无 systemPromptTrace 时不应生成 layer warnings', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResult = createMockPromptBuildResult();

      const result = guard.check(promptResult, []);

      const layerWarnings = result.warnings.filter(w => w.layer !== 'context_messages');
      expect(layerWarnings.length).toBe(0);
    });
  });

  describe('check - apiTools 计入 token', () => {
    it('应将 apiTools 的 JSON 字符串计入 totalTokens', () => {
      const guard = new PromptBuildBudgetGuard(BUDGET_LIMIT);
      const promptResultNoTools = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(100),
        apiTools: [],
      });
      const promptResultWithTools = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(100),
        apiTools: [{ name: 'tool1', description: 'a'.repeat(200) }],
      });

      const resultNoTools = guard.check(promptResultNoTools, []);
      const resultWithTools = guard.check(promptResultWithTools, []);

      expect(resultWithTools.totalTokens).toBeGreaterThan(resultNoTools.totalTokens);
    });
  });

  describe('updateBudgetLimit', () => {
    it('应更新预算限制', () => {
      const guard = new PromptBuildBudgetGuard(1000);
      const promptResult = createMockPromptBuildResult({
        systemPrompt: 'a'.repeat(800),
      });

      const resultBefore = guard.check(promptResult, []);
      guard.updateBudgetLimit(2000);
      const resultAfter = guard.check(promptResult, []);

      expect(resultAfter.budgetLimit).toBe(2000);
      expect(resultAfter.utilizationRatio).toBeLessThan(resultBefore.utilizationRatio);
    });
  });
});
