import { describe, expect, it, vi } from 'vitest';
import { AuditAgent } from '../AuditAgent.js';
import type { AuditRequest, AuditFailure } from '../../../../../shared/src/types/audit.js';
import type { ProgramChecker, LLMChecker, RootCauseClassifier, AuditContext } from '../ProgramChecker.js';

/**
 * AuditAgent multi-llm-checkers 回归测试。
 *
 * 设计文档 §6 测试用例大纲：
 *   - 单 LLMChecker（仅 LLMCheckerImpl）：行为与改造前一致
 *   - 双 LLMChecker（LLMCheckerImpl + DialogueConsistencyChecker）：两者 failures 合并
 *   - LLMChecker 抛错：不影响其他 LLMChecker 执行
 *   - 空数组：llmFailures 为空
 *
 * 006 升级核心改动（AuditAgent.ts L17-22, L55-71）：
 *   - `llmChecker: LLMChecker` → `llmCheckers: LLMChecker[]`
 *   - audit() 遍历所有 LLMChecker，failures 合并
 *   - 单个 LLMChecker 抛错时 try-catch 隔离，不影响其他 LLMChecker 执行
 *
 * 验证点（architecture-standards 14.4 LLM 审必须独立）：
 *   - 每个 LLMChecker 独立执行，互不干扰
 *   - 一个 LLMChecker 抛错不阻塞其他 LLMChecker
 *   - failures 合并去重由 AuditAgent 聚合阶段负责
 */

const mockCtx: AuditContext = {
  saveId: 'save-1' as never,
  templateId: 'tpl-1' as never,
  db: {} as never,
  dataProviders: {} as never,
  auditProviders: {
    stagingPoolProvider: {} as never,
    shadowStateProvider: {} as never,
  },
};

function buildAuditRequest(mode: 'program' | 'llm' | 'both' = 'both'): AuditRequest {
  return {
    taskId: 'task-multi-1' as never,
    taskContract: {
      description: '创建 3 个 NPC',
      expected: { counts: { npc: 3 }, quality: ['名字符合奇幻风格'] },
    },
    actualOutput: {
      taskId: 'task-multi-1' as never,
      agentType: 'GM',
      output: '已创建村长、铁匠、商人',
      toolCalls: [],
      success: true,
    },
    auditMode: mode,
  };
}

function createFailure(
  dimension: AuditFailure['dimension'],
  reason: string,
  severity: 'error' | 'warning' = 'warning',
): AuditFailure {
  return {
    dimension,
    expected: {},
    actual: {},
    reason,
    severity,
  };
}

function createProgramChecker(dimension: ProgramChecker['dimension'], failures: AuditFailure[] = []): ProgramChecker {
  return {
    dimension,
    check: vi.fn().mockResolvedValue(failures),
  };
}

function createLLMChecker(failures: AuditFailure[] = [], shouldThrow = false): LLMChecker & {
  _checkSpy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () => {
    if (shouldThrow) throw new Error('LLMChecker error');
    return failures;
  });
  return {
    check: spy,
    _checkSpy: spy,
  } as unknown as LLMChecker & { _checkSpy: ReturnType<typeof vi.fn> };
}

function createRootCauseClassifier(): RootCauseClassifier {
  return {
    classify: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AuditAgent multi-llm-checkers 回归测试', () => {
  describe('单 LLMChecker（行为与改造前一致）', () => {
    /**
     * 设计文档 §6 期望效果：
     *   - 单 LLMChecker 时行为与改造前一致
     *   - LLMChecker 返回 failures 正常聚合到 AuditResult.failures
     */
    it('单 LLMChecker 返回 2 个 failures：AuditResult.failures 包含全部 2 个', async () => {
      const llmFailures = [
        createFailure('content_quality', '内容质量差', 'warning'),
        createFailure('content_quality', '名字不符风格', 'warning'),
      ];
      const llmChecker = createLLMChecker(llmFailures);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(false);
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0].reason).toBe('内容质量差');
      expect(result.failures[1].reason).toBe('名字不符风格');
    });

    it('单 LLMChecker 返回空 failures + 程序审无 failure：pass=true', async () => {
      const llmChecker = createLLMChecker([]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('单 LLMChecker 被调用 1 次（auditMode=llm 触发）', async () => {
      const llmChecker = createLLMChecker([]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker],
        createRootCauseClassifier(),
      );

      await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(llmChecker._checkSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('双 LLMChecker（failures 合并）', () => {
    /**
     * 设计文档 §6 期望效果：
     *   - 双 LLMChecker（LLMCheckerImpl + DialogueConsistencyChecker）：两者 failures 合并
     *   - 每个 LLMChecker 独立调用，互不干扰
     */
    it('双 LLMChecker 各返回 1 个 failure：AuditResult.failures 包含 2 个（合并）', async () => {
      const llmChecker1 = createLLMChecker([
        createFailure('content_quality', '内容质量问题', 'warning'),
      ]);
      const llmChecker2 = createLLMChecker([
        createFailure('dialogue_consistency', '对话-awareness 不一致', 'warning'),
      ]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(false);
      expect(result.failures).toHaveLength(2);
      // 两个 LLMChecker 的 failures 都在结果中
      const reasons = result.failures.map(f => f.reason);
      expect(reasons).toContain('内容质量问题');
      expect(reasons).toContain('对话-awareness 不一致');
      // 维度各自保留
      const dimensions = result.failures.map(f => f.dimension);
      expect(dimensions).toContain('content_quality');
      expect(dimensions).toContain('dialogue_consistency');
    });

    it('双 LLMChecker 各返回 0 个 failure：pass=true', async () => {
      const llmChecker1 = createLLMChecker([]);
      const llmChecker2 = createLLMChecker([]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('双 LLMChecker 都被调用 1 次', async () => {
      const llmChecker1 = createLLMChecker([]);
      const llmChecker2 = createLLMChecker([]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(llmChecker1._checkSpy).toHaveBeenCalledTimes(1);
      expect(llmChecker2._checkSpy).toHaveBeenCalledTimes(1);
    });

    it('双 LLMChecker + 程序审 failures：三者 failures 合并', async () => {
      const programFailures = [createFailure('entity_counts', '数量不足', 'error')];
      const llmChecker1 = createLLMChecker([
        createFailure('content_quality', '内容质量差', 'warning'),
      ]);
      const llmChecker2 = createLLMChecker([
        createFailure('dialogue_consistency', '对话矛盾', 'warning'),
      ]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts', programFailures)],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('both'), mockCtx);

      expect(result.failures).toHaveLength(3);
      const reasons = result.failures.map(f => f.reason);
      expect(reasons).toContain('数量不足');
      expect(reasons).toContain('内容质量差');
      expect(reasons).toContain('对话矛盾');
    });
  });

  describe('LLMChecker 抛错：不影响其他 LLMChecker 执行', () => {
    /**
     * 设计文档 §6 期望效果：
     *   - LLMChecker 抛错：不影响其他 LLMChecker 执行
     *   - 抛错的 LLMChecker 不贡献 failures（被 try-catch 隔离）
     *   - 其他 LLMChecker 正常返回的 failures 仍被聚合
     *
     * 实现位置：AuditAgent.ts L60-70
     *   - for (const checker of this.llmCheckers) { try { ... } catch (error) { logger.warn } }
     */
    it('LLMChecker1 抛错 + LLMChecker2 返回 1 failure：仅 LLMChecker2 的 failure 被聚合', async () => {
      const llmChecker1 = createLLMChecker([], true); // 抛错
      const llmChecker2 = createLLMChecker([
        createFailure('dialogue_consistency', '对话矛盾', 'warning'),
      ]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      // 抛错的 LLMChecker 不贡献 failures，但 LLMChecker2 的 failure 正常聚合
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].reason).toBe('对话矛盾');
    });

    it('LLMChecker1 抛错：LLMChecker2 仍被调用 1 次', async () => {
      const llmChecker1 = createLLMChecker([], true);
      const llmChecker2 = createLLMChecker([]);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      await agent.audit(buildAuditRequest('llm'), mockCtx);

      // 第一个抛错，但第二个仍被执行
      expect(llmChecker1._checkSpy).toHaveBeenCalledTimes(1);
      expect(llmChecker2._checkSpy).toHaveBeenCalledTimes(1);
    });

    it('所有 LLMChecker 都抛错：不传播异常，AuditResult.failures 为空', async () => {
      const llmChecker1 = createLLMChecker([], true);
      const llmChecker2 = createLLMChecker([], true);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker1, llmChecker2],
        createRootCauseClassifier(),
      );

      // 不应抛错（AuditAgent 内部 try-catch 隔离）
      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('LLMChecker 抛错：AuditResult 仍返回有效结构（pass/failures/confidence）', async () => {
      const llmChecker = createLLMChecker([], true);
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [llmChecker],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result).toHaveProperty('pass');
      expect(result).toHaveProperty('failures');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.confidence).toBe('number');
    });
  });

  describe('空数组（llmCheckers=[]）', () => {
    /**
     * 设计文档 §6 期望效果：
     *   - 空数组：llmFailures 为空
     *   - 即使 auditMode='llm'，无 LLMChecker 可执行时 llmFailures 仍为空数组
     */
    it('llmCheckers=[] + auditMode=llm：llmFailures 为空，pass=true', async () => {
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('llm'), mockCtx);

      expect(result.pass).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('llmCheckers=[] + auditMode=both + 程序审 failure：仅程序审 failure', async () => {
      const programFailures = [createFailure('entity_counts', '数量不足', 'error')];
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts', programFailures)],
        [],
        createRootCauseClassifier(),
      );

      const result = await agent.audit(buildAuditRequest('both'), mockCtx);

      expect(result.pass).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].reason).toBe('数量不足');
    });

    it('llmCheckers=[]：循环 0 次，无异常', async () => {
      const agent = new AuditAgent(
        [createProgramChecker('entity_counts')],
        [],
        createRootCauseClassifier(),
      );

      // 不应抛错（空数组循环 0 次正常）
      await expect(agent.audit(buildAuditRequest('llm'), mockCtx)).resolves.toBeDefined();
    });
  });
});
