import { describe, expect, it, vi } from 'vitest';
import { LLMCheckerImpl } from '../LLMChecker.js';
import type { AuditRequestForLLM, AuditFailure } from '../../../../../shared/src/types/audit.js';
import type { AuditContext } from '../ProgramChecker.js';
import type { LLMService } from '@ai-rpg/ai';

/**
 * LLMChecker 独立性测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md
 * 章节：§5 LLMChecker 独立性恢复 + 支撑根因 4
 *
 * 验证点（architecture-standards 14.4 LLM 审必须独立）：
 * 1. 问题 A：prompt 中禁止注入 programFailureSummary（程序审结果不污染 LLM 审）
 * 2. 问题 B：severity 白名单映射（仅 'error' 映射为 'error'，其余映射为 'warning'）
 * 3. 问题 C：LLM 失败时返回低置信度 warning（而非空 failures 静默降级为"通过"）
 */

function buildLLMRequest(overrides: Partial<AuditRequestForLLM> = {}): AuditRequestForLLM {
  return {
    taskId: 'task-llm-1' as never,
    taskContract: {
      description: '创建 3 个 NPC',
      expected: { counts: { npc: 3 }, quality: ['NPC 名字符合奇幻风格'] },
    },
    actualOutput: {
      taskId: 'task-llm-1' as never,
      agentType: 'NPC',
      output: '已创建 3 个 NPC：村长、铁匠、商人',
      toolCalls: [],
      success: true,
    },
    auditScope: ['content_quality'],
    ...overrides,
  };
}

const mockCtx: AuditContext = {
  saveId: 'save-1' as never,
  templateId: 'tpl-1' as never,
  db: {} as never,
  dataProviders: {} as never,
  auditProviders: {} as never,
};

function createLlmServiceMock(responseContent: string, shouldThrow = false): LLMService {
  const mock = {
    chat: vi.fn().mockImplementation(async () => {
      if (shouldThrow) {
        throw new Error('LLM service unavailable');
      }
      return { content: responseContent };
    }),
  };
  return mock as unknown as LLMService;
}

describe('LLMChecker 独立性测试', () => {
  describe('问题 A: 程序审结果不污染 LLM 审', () => {
    /**
     * 设计文档 §5 期望效果：
     * - 移除 prompt 中的程序审结果注入（programFailureSummary）
     * - LLM 审必须独立评估内容质量
     *
     * 验证方式：传入 programFailures 参数，检查 LLMService.chat 收到的 prompt
     * 不包含 programFailures 中的信息（dimension/reason/expected/actual）
     */
    it('独立性1: prompt 不包含 programFailures 的 dimension', async () => {
      const programFailures: AuditFailure[] = [
        {
          dimension: 'entity_counts',
          expected: { entityType: 'npc', count: 3 },
          actual: { entityType: 'npc', count: 1 },
          reason: '实体数量不足: npc 期望 3，实际 1',
          severity: 'error',
        },
      ];
      const llmService = createLlmServiceMock('[]');
      const checker = new LLMCheckerImpl(llmService);

      await checker.check(buildLLMRequest(), mockCtx, programFailures);

      const callArgs = (llmService.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const prompt = callArgs[0][0].content as string;

      // prompt 不应包含程序审的 dimension
      expect(prompt).not.toContain('entity_counts');
      expect(prompt).not.toContain('程序审');
      expect(prompt).not.toContain('programFailure');
    });

    it('独立性2: prompt 不包含 programFailures 的 reason', async () => {
      const programFailures: AuditFailure[] = [
        {
          dimension: 'entity_counts',
          expected: { entityType: 'npc', count: 3 },
          actual: { entityType: 'npc', count: 1 },
          reason: '实体数量不足: npc 期望 3，实际 1',
          severity: 'error',
        },
      ];
      const llmService = createLlmServiceMock('[]');
      const checker = new LLMCheckerImpl(llmService);

      await checker.check(buildLLMRequest(), mockCtx, programFailures);

      const callArgs = (llmService.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const prompt = callArgs[0][0].content as string;

      // prompt 不应包含程序审的 reason
      expect(prompt).not.toContain('实体数量不足');
      expect(prompt).not.toContain('期望 3');
      expect(prompt).not.toContain('实际 1');
    });

    it('独立性3: prompt 不包含 programFailures 的 expected/actual 数据', async () => {
      const programFailures: AuditFailure[] = [
        {
          dimension: 'npc_location',
          expected: { locationId: 'loc_village_001' },
          actual: { locationId: 'loc_nonexistent' },
          reason: 'NPC location_id 不存在',
          severity: 'error',
        },
      ];
      const llmService = createLlmServiceMock('[]');
      const checker = new LLMCheckerImpl(llmService);

      await checker.check(buildLLMRequest(), mockCtx, programFailures);

      const callArgs = (llmService.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const prompt = callArgs[0][0].content as string;

      // prompt 不应包含程序审的具体数据
      expect(prompt).not.toContain('loc_village_001');
      expect(prompt).not.toContain('loc_nonexistent');
      expect(prompt).not.toContain('NPC location_id 不存在');
    });

    it('独立性4: prompt 仅包含 taskContract + actualOutput（LLM 独立评估）', async () => {
      const llmService = createLlmServiceMock('[]');
      const checker = new LLMCheckerImpl(llmService);
      const request = buildLLMRequest({
        taskContract: {
          description: '创建 5 个物品',
          expected: { quality: ['物品名称符合奇幻风格'] },
        },
        actualOutput: {
          taskId: 'task-llm-1' as never,
          agentType: 'Inventory',
          output: '已创建铁剑、皮甲、药水',
          toolCalls: [],
          success: true,
        },
      });

      await checker.check(request, mockCtx, []);

      const callArgs = (llmService.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const prompt = callArgs[0][0].content as string;

      // prompt 应包含任务描述和实际输出
      expect(prompt).toContain('创建 5 个物品');
      expect(prompt).toContain('已创建铁剑、皮甲、药水');
      expect(prompt).toContain('物品名称符合奇幻风格');
    });
  });

  describe('问题 B: severity 白名单映射', () => {
    /**
     * 设计文档 §5 期望效果：
     * - severity 改为白名单映射：仅 'error' 映射为 'error'，其余映射为 'warning'
     *
     * 原实现问题：`item.severity === 'warning' ? 'warning' : 'error'`
     * 任何非 'warning' 的值（包括 'info'、'low'、拼写错误、缺省、null）都被映射为 'error'
     * 触发 AuditAgent LLM 审升级恶性循环
     */
    it('白名单1: LLM 返回 severity=error - 映射为 error', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '内容质量差', severity: 'error' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
    });

    it('白名单2: LLM 返回 severity=warning - 映射为 warning', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '内容质量一般', severity: 'warning' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('warning');
    });

    it('白名单3: LLM 返回 severity=info - 映射为 warning（非 error）', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '内容信息提示', severity: 'info' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      // 'info' 不在白名单中，映射为 'warning'（非 'error'）
      expect(failures[0].severity).toBe('warning');
    });

    it('白名单4: LLM 返回 severity=low - 映射为 warning（非 error）', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '低优先级问题', severity: 'low' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('warning');
    });

    it('白名单5: LLM 返回 severity 缺省 - 映射为 warning（非 error）', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '未指定 severity' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('warning');
    });

    it('白名单6: LLM 返回 severity 拼写错误 - 映射为 warning（非 error）', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '拼写错误', severity: 'eror' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('warning');
    });

    it('白名单7: LLM 返回多个 failures，severity 分别映射', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: 'error 级', severity: 'error' },
        { dimension: 'content_quality', reason: 'warning 级', severity: 'warning' },
        { dimension: 'content_quality', reason: 'info 级', severity: 'info' },
        { dimension: 'content_quality', reason: '无 severity' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(4);
      expect(failures[0].severity).toBe('error');
      expect(failures[1].severity).toBe('warning');
      expect(failures[2].severity).toBe('warning');
      expect(failures[3].severity).toBe('warning');
    });
  });

  describe('问题 C: LLM 失败时返回低置信度 warning', () => {
    /**
     * 设计文档 §5 期望效果：
     * - LLM 失败时返回低置信度 warning（而非空 failures 静默降级为"通过"）
     *
     * 原实现问题：LLM 调用失败时返回空 failures 数组，
     * audit 结果显示"LLM 审通过"，实际上 LLM 审根本没执行
     */
    it('失败1: LLM 服务抛错 - 返回低置信度 warning（非空 failures）', async () => {
      const llmService = createLlmServiceMock('', true);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      // 不应返回空 failures（空 failures 会让 AuditResult.pass=true，掩盖失败）
      expect(failures).not.toEqual([]);
      expect(failures).toHaveLength(1);
    });

    it('失败2: LLM 失败返回的 failure 维度为 content_quality', async () => {
      const llmService = createLlmServiceMock('', true);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures[0].dimension).toBe('content_quality');
    });

    it('失败3: LLM 失败返回的 failure severity 为 warning（非 error）', async () => {
      const llmService = createLlmServiceMock('', true);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      // 低置信度 warning（不是 error，避免触发 LLM 审升级恶性循环）
      expect(failures[0].severity).toBe('warning');
    });

    it('失败4: LLM 失败返回的 failure reason 包含错误信息', async () => {
      const llmService = createLlmServiceMock('', true);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures[0].reason).toContain('LLM 审核失败');
      expect(failures[0].reason).toContain('LLM service unavailable');
      expect(failures[0].reason).toContain('人工复核');
    });

    it('失败5: LLM 失败返回的 failure 包含 expected 和 actual 上下文', async () => {
      const llmService = createLlmServiceMock('', true);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures[0].expected).toEqual({ llmCheck: 'completed' });
      expect(failures[0].actual).toEqual(
        expect.objectContaining({
          llmCheck: 'failed',
          error: 'LLM service unavailable',
        }),
      );
    });
  });

  describe('LLM 返回正常解析', () => {
    it('解析1: LLM 返回空数组 - 审核通过', async () => {
      const llmService = createLlmServiceMock('[]');
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toEqual([]);
    });

    it('解析2: LLM 返回非数组 - 降级为空 failures', async () => {
      const llmService = createLlmServiceMock('{"not": "array"}');
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toEqual([]);
    });

    it('解析3: LLM 返回无效 JSON - 降级为空 failures', async () => {
      const llmService = createLlmServiceMock('invalid json');
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toEqual([]);
    });

    it('解析4: LLM 返回多 failure - 正确解析所有项', async () => {
      const llmResponse = JSON.stringify([
        { dimension: 'content_quality', reason: '问题1', severity: 'error' },
        { dimension: 'content_quality', reason: '问题2', severity: 'warning' },
      ]);
      const llmService = createLlmServiceMock(llmResponse);
      const checker = new LLMCheckerImpl(llmService);

      const failures = await checker.check(buildLLMRequest(), mockCtx, []);

      expect(failures).toHaveLength(2);
      expect(failures[0].reason).toBe('问题1');
      expect(failures[1].reason).toBe('问题2');
    });
  });
});
