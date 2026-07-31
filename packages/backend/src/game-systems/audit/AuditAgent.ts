import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { randomUUID } from 'crypto';
import type { ID } from '../../../../shared/src/types/core.js';
import type { ToolResult } from '../../../../shared/src/types/agent.js';
import type { AuditRequest, AuditResult, AuditFailure, AuditRootCause, AuditRequestForLLM, AuditDimension, TaskContent, AuditReport, AuditIssue, SubAgentResult } from '../../../../shared/src/types/audit.js';
import type { ProgramChecker, LLMChecker, RootCauseClassifier, AuditContext, IAuditAgent } from './ProgramChecker.js';
import { isCreateOperation } from './program-checkers/index.js';

/**
 * AuditAgent - 无状态审核Agent。
 *
 * 设计理念：作为类似无状态函数的存在，但有独立的AuditRequest/AuditResult契约。
 * 程序审为主（始终执行），LLM审按需触发（auditMode含'llm'或程序审有error级失败）。
 * 审核Agent不持有运行时状态，每次调用独立。
 *
 * 006 升级：LLM 审数组化（llmChecker → llmCheckers: LLMChecker[]）。
 *   - 支持 DialogueConsistencyChecker（对话-awareness 一致性审核）等多个 LLMChecker 并行执行
 *   - audit() 遍历所有 LLMChecker，failures 合并
 *   - 单个 LLMChecker 抛错不影响其他 LLMChecker 执行（独立隔离）
 *   - 设计文档 §8：`for (const checker of this.llmCheckers) { ... allLlmFailures.push(...failures); }`
 *
 * 位置（Q-2决策）：game-systems/audit/ 而非 agents/audit/。
 * 理由：无状态函数化的"Agent"不参与ReAct Loop、不继承BaseAgent，
 * 放在game-systems/与entity-graph/quest/等业务领域并列更符合职责。
 */
export class AuditAgent implements IAuditAgent {
  private readonly logger = createChildLogger('audit-agent');

  constructor(
    private readonly programCheckers: ProgramChecker[],
    private readonly llmCheckers: LLMChecker[],
    private readonly rootCauseClassifier: RootCauseClassifier,
  ) {}

  /**
   * 任务级审核 - 无状态，每次调用独立。
   * 程序审始终执行，LLM审按auditMode按需触发。
   *
   * 006 升级：LLM 审遍历所有 llmCheckers，failures 合并。
   * 单个 LLMChecker 抛错时记 warn 日志，不影响其他 LLMChecker 执行（独立隔离）。
   */
  async audit(request: AuditRequest, ctx: AuditContext): Promise<AuditResult> {
    this.logger.debug('Audit started', { taskId: request.taskId, mode: request.auditMode });

    // 1. 程序审（始终执行）
    const programFailures = await this.runProgramCheckers(request, ctx);

    // 2. LLM审（按需触发：auditMode含'llm' 或程序审有error级失败）
    const shouldRunLLM =
      request.auditMode === 'llm' ||
      request.auditMode === 'both' ||
      programFailures.some((f) => f.severity === 'error');

    let llmFailures: AuditFailure[] = [];
    if (shouldRunLLM) {
      const llmRequest = this.toLLMRequest(request);
      // 006 升级：遍历所有 LLMChecker，failures 合并
      // 单个 LLMChecker 抛错不影响其他 LLMChecker 执行（独立隔离，设计文档 §8）
      for (const checker of this.llmCheckers) {
        try {
          const failures = await checker.check(llmRequest, ctx, programFailures);
          llmFailures.push(...failures);
        } catch (error) {
          this.logger.warn('LLMChecker failed (isolated, continue others)', {
            checker: checker.constructor.name,
            error: getErrorMessage(error),
          });
        }
      }
    }

    // 3. 根因分类
    const rootCause = await this.rootCauseClassifier.classify(programFailures, llmFailures, request, ctx);

    // 4. 聚合结果
    const allFailures = [...programFailures, ...llmFailures];
    const result: AuditResult = {
      pass: allFailures.length === 0,
      failures: allFailures,
      rootCause,
      repairSuggestion: this.buildRepairSuggestion(rootCause),
      confidence: this.calculateConfidence(programFailures.length, llmFailures.length),
    };

    this.logger.info('Audit completed', {
      taskId: request.taskId,
      pass: result.pass,
      failureCount: allFailures.length,
      programFailureCount: programFailures.length,
      llmFailureCount: llmFailures.length,
      llmCheckerCount: this.llmCheckers.length,
      rootCause,
    });

    return result;
  }

  /**
   * 世界级审核 - 长时间游戏后或发现矛盾时调用。
   * 7项 ContinuityAuditor 校验 + 实体关系图交叉验证。
   */
  async auditWorld(saveId: ID, ctx: AuditContext): Promise<AuditResult> {
    this.logger.info('World audit started', { saveId });

    const dummyRequest: AuditRequest = {
      taskId: `world-${saveId}` as ID,
      taskContract: { description: '世界级审核' },
      actualOutput: { taskId: `world-${saveId}`, agentType: 'system', output: '', success: true },
      auditMode: 'program',
    };

    const programFailures = await this.runProgramCheckers(dummyRequest, ctx);

    return {
      pass: programFailures.length === 0,
      failures: programFailures,
      rootCause: programFailures.length > 0 ? 'data_missing' : undefined,
      repairSuggestion: programFailures.length > 0 ? '检查存档数据完整性' : undefined,
      confidence: 0.9,
    };
  }

  /**
   * 包装 audit() 输出 AuditReport - 供 on_task_complete hook 调用。
   *
   * 与 audit() 区别：
   * - 输入 TaskContent（含 agentType/agentRunId）而非完整 AuditRequest
   * - 输出 AuditReport（含 taskContent/auditKey/auditRound=1）而非 AuditResult
   * - 按 agentType 自动选择 auditMode 和 auditScope
   *
   * 期望效果（设计文档 EC1-EC8）：
   * - 调用现有 audit() 得到 AuditResult
   * - 包装为 AuditReport（含 taskContent/auditKey/auditRound=1/uuid）
   * - auditMode 按 agentType 选择（GM='both'，子 Agent='program'）
   * - 抛错不 catch（EC5：由 dispatch 现有 catch 机制处理）
   */
  async auditForReport(params: {
    saveId: string;
    taskContent: TaskContent;
    ctx: AuditContext;
    /** reactEngine.execute 返回值（actualOutput 来源） */
    result: unknown;
  }): Promise<AuditReport> {
    const { saveId, taskContent, ctx, result } = params;

    // 1. 按 agentType 选择 auditMode 和 auditScope（设计文档"审核维度组合"表）
    // GM 可通过 taskContract.audit_mode 覆盖（创造性任务如 map/npc/quest 设 'both' 强制 LLM 审）
    const policy = this.resolveAuditPolicy(taskContent.agentType);
    const auditMode = taskContent.auditMode ?? policy.auditMode;
    const auditScope = policy.auditScope;

    // 2. 构造 AuditRequest（将 TaskContent 转为 TaskContract + 构造 SubAgentResult）
    const request: AuditRequest = {
      taskId: taskContent.agentRunId as ID,
      taskContract: {
        description: taskContent.description,
        action: taskContent.action,
        expected: taskContent.expected,
      },
      actualOutput: this.toSubAgentResult(taskContent, result),
      auditMode,
      auditScope,
    };

    // 3. 调用现有 audit()（不 try/catch，让错误传到 dispatch）
    const auditResult = await this.audit(request, ctx);

    // 4. 包装为 AuditReport
    const auditKey = `${taskContent.agentRunId}::${taskContent.description}`;
    const issues = this.wrapFailures(auditResult.failures);
    // 14.3 第3条：从 toolCalls 提取已存在实体清单，引导 Agent 使用 update_xxx 修改而非 create_xxx 重建
    const currentState = this.extractCurrentState(request.actualOutput);

    return {
      reportId: randomUUID(),
      agentRunId: taskContent.agentRunId,
      saveId,
      timestamp: Date.now(),
      taskContent,
      issues,
      summary: this.buildReportSummary(issues, auditResult.pass),
      currentState,
      auditKey,
      auditRound: 1,
      rootCause: auditResult.rootCause,
      repairSuggestion: auditResult.repairSuggestion,
      confidence: auditResult.confidence,
    };
  }

  /**
   * 从 SubAgentResult.toolCalls 提取已存在实体清单（14.3 第3条：current_state 必须提供）。
   *
   * 期望效果：
   * - 遍历 toolCalls，提取 create_xxx / add_xxx / learn_xxx / upsert_xxx 等创建类操作的实体名称
   * - 从 params.name / params.npcName / params.locationName 等平铺字段提取实体名
   * - 从 params.items[].name / params.npcs[].name 等数组字段提取批量创建的实体名（方案 4 修复）
   * - 返回格式化字符串数组，如 "地点 '白杨村'" / "NPC '村长'" / "技能 '剑术'"
   * - 让 Agent 知道哪些数据已存在，引导使用 update_xxx 修改而非 create_xxx 重建
   *
   * 修复（方案 4）：
   * - 使用精确前缀匹配 isCreateOperation（与 EntityCountsChecker 对齐）
   * - 支持 params.items[].name / params.npcs[].name 等数组嵌套字段（批量调用场景）
   * - 去重 + 过滤空值
   */
  private extractCurrentState(actualOutput: SubAgentResult): string[] {
    const stateEntries: string[] = [];
    const seenNames = new Set<string>();
    const toolCalls = actualOutput.toolCalls ?? [];

    for (const tc of toolCalls) {
      // 仅提取创建类操作的实体（与 EntityCountsChecker 对齐：精确前缀匹配）
      if (!isCreateOperation(tc.method)) continue;

      const names = extractEntityNamesFromToolCall(tc.params);
      if (names.length === 0) continue;

      const entityType = this.inferEntityType(tc.tool, tc.method);
      for (const name of names) {
        if (seenNames.has(name)) continue;
        seenNames.add(name);
        stateEntries.push(`${entityType} '${name}'`);
      }
    }

    return stateEntries;
  }

  /**
   * 根据工具名/方法名推断实体类型描述（中文）。
   */
  private inferEntityType(tool: string, method: string): string {
    const combined = (tool + method).toLowerCase();
    if (combined.includes('npc')) return 'NPC';
    if (combined.includes('location') || combined.includes('map')) return '地点';
    if (combined.includes('skill')) return '技能';
    if (combined.includes('item') || combined.includes('inventory')) return '物品';
    if (combined.includes('quest')) return '任务';
    if (combined.includes('character')) return '角色';
    return '实体';
  }

  /**
   * 按 agentType 解析审核策略 - auditMode + auditScope。
   * 设计文档"审核维度组合"表：
   * - GM (init/chat): auditMode='both'，程序审覆盖 entity_counts/npc_location/item_ownership
   * - 子 Agent (NPC/Quest/Map): auditMode='program'（audit() 内部 error 时自动升级 'both'），程序审覆盖各自维度
   *
   * 模块2 简化：graph_consistency 维度已移除（GraphConsistencyChecker 已删除，图关系由 Reconciler 兜底）
   */
  private resolveAuditPolicy(agentType: string): {
    auditMode: AuditRequest['auditMode'];
    auditScope?: AuditDimension[];
  } {
    if (agentType === 'GM') {
      return {
        auditMode: 'both',
        auditScope: ['entity_counts', 'npc_location', 'item_ownership'],
      };
    }

    // 子 Agent：初始 program 审，audit() 内部 error 时自动升级 LLM 审
    const subAgentScopes: Record<string, AuditDimension[]> = {
      NPC: ['npc_location', 'entity_counts'],
      Quest: ['entity_counts'],
      Map: ['entity_counts'],
    };
    return {
      auditMode: 'program',
      auditScope: subAgentScopes[agentType] ?? ['entity_counts'],
    };
  }

  /**
   * 将 ReActEngineResult 转换为 SubAgentResult（audit 输入契约）。
   * result 是 unknown（来自 reactEngine.execute），做最小化字段提取。
   *
   * 字段映射 adapter：ToolResult._meta.* → SubAgentResult.toolCalls[i].*
   * - _meta 是 ReActEngine 对每次工具调用的强制注入字段，缺失即视为上游 bug，必须抛错暴露
   * - result 字段优先取 writeOperation.result（写操作的明确返回值），回退取 data（通用结果）
   */
  private toSubAgentResult(taskContent: TaskContent, result: unknown): SubAgentResult {
    const raw = (result ?? {}) as Record<string, unknown>;
    const rawToolCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls as Partial<ToolResult>[] : undefined;

    let toolCalls: SubAgentResult['toolCalls'] | undefined;
    if (rawToolCalls) {
      toolCalls = rawToolCalls.map((tc): NonNullable<SubAgentResult['toolCalls']>[number] => {
        const meta = tc._meta;
        if (!meta) {
          throw new Error(
            `ToolResult missing _meta field, toolCallId=${tc.toolCallId ?? 'unknown'}`,
          );
        }
        return {
          tool: meta.toolType,
          method: meta.method,
          params: meta.params,
          result: tc.writeOperation?.result ?? tc.data,
        };
      });
    }

    return {
      taskId: taskContent.agentRunId as ID,
      agentType: taskContent.agentType,
      output: typeof raw.content === 'string' ? raw.content : '',
      toolCalls,
      success: typeof raw.success === 'boolean' ? raw.success : true,
    };
  }

  /**
   * 将 AuditFailure[] 包装为 AuditIssue[]（uuid + entity 提取 + suggestedFix 填充）。
   * severity 保留但仅用于报告展示（EC8：loop 只看 issues.length）。
   *
   * 设计原则（architecture-standards 14.3 审核反馈必须引导修改而非重新创建）：
   * - suggestedFix 必须填充（基于 dimension 生成具体修复建议），禁止 undefined
   * - entity 必须具体（实体 ID/名称），禁止兜底到 failure.dimension
   */
  private wrapFailures(failures: AuditFailure[]): AuditIssue[] {
    return failures.map((failure) => {
      const entity = this.extractEntityFromFailure(failure);
      return {
        issueId: randomUUID(),
        dimension: failure.dimension,
        severity: failure.severity,
        entity,
        description: failure.reason,
        evidence: this.formatEvidence(failure.expected, failure.actual),
        // 006 升级：优先使用 failure 自带的 suggestedFix（LLMChecker 可填充更具体的修复建议），
        // 缺失时按 dimension 生成（保持 14.3 第1条 suggestedFix 必须填充约束）
        suggestedFix: failure.suggestedFix ?? this.buildSuggestedFix(failure, entity),
      };
    });
  }

  /**
   * 从 AuditFailure 提取受影响实体标识（14.3 第4条：entity 必须具体，禁止兜底）。
   *
   * 提取优先级：
   * 1. actual/expected 对象中的 npc/item/location/id/name 等具体字段
   * 2. actual/expected 字符串本身
   * 3. "未知实体"（明确标识未能提取，禁止兜底到 dimension）
   */
  private extractEntityFromFailure(failure: AuditFailure): string {
    // 1. 从 actual/expected 对象中提取具体实体字段
    const actualEntity = this.extractEntityFromObject(failure.actual);
    if (actualEntity) return actualEntity;
    const expectedEntity = this.extractEntityFromObject(failure.expected);
    if (expectedEntity) return expectedEntity;

    // 2. 字符串本身
    if (typeof failure.actual === 'string' && failure.actual) return failure.actual;
    if (typeof failure.expected === 'string' && failure.expected) return failure.expected;

    // 3. 明确标识未能提取（禁止兜底到 dimension）
    return '未知实体';
  }

  /**
   * 从对象中提取具体实体标识（npc_id/item_id/location_id/id/name 等字段）。
   */
  private extractEntityFromObject(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const obj = value as Record<string, unknown>;
    // 优先级：具体 ID 字段 > name 字段 > entityType 字段
    const idFields = ['npc_id', 'item_id', 'location_id', 'skill_id', 'quest_id', 'id', 'entityId'];
    for (const field of idFields) {
      const v = obj[field];
      if (typeof v === 'string' && v) return v;
    }
    if (typeof obj.name === 'string' && obj.name) return obj.name;
    if (typeof obj.entityType === 'string' && obj.entityType) return obj.entityType;
    return undefined;
  }

  /**
   * 基于 dimension 生成 suggestedFix（14.3 第1条：suggestedFix 必须填充）。
   *
   * 期望效果：按 dimension 分类生成具体修复建议，引导 Agent 使用 modify 而非 recreate。
   * - entity_counts (under): 创建缺失实体
   * - npc_location: 修改 NPC location_id
   * - item_ownership: 修改物品 owner 或删除物品
   * - content_quality: 修正输出内容
   *
   * 模块2 简化：删除 graph_consistency/orphan_node case（GraphConsistencyChecker 已删除，
   * 图关系由 Reconciler 兜底，孤立节点是合法中间状态 §14.5 第4条）
   */
  private buildSuggestedFix(failure: AuditFailure, entity: string): string {
    switch (failure.dimension) {
      case 'entity_counts':
        return `实体数量不足，请调用 create_xxx/learn_xxx/add_item 创建缺失实体（优先使用 update_xxx 修改已存在实体，create_xxx 会自动增量更新）`;
      case 'npc_location':
        return `NPC location_id 不存在，请调用 npc_service.update_npc 修改 location_id（当前实体: ${entity}）`;
      case 'item_ownership':
        return `物品 owner 不存在，请调用 inventory_service.update_item 修改 owner 或 remove_item 删除（当前实体: ${entity}）`;
      case 'content_quality':
        return `内容质量问题，请根据 description 修正输出内容（当前实体: ${entity}）`;
      case 'info_boundary':
        return `信息边界违规，请检查 NPC/角色是否引用了不应知道的信息（当前实体: ${entity}）`;
      default:
        return `请根据 description 修正问题（当前实体: ${entity}）`;
    }
  }

  private formatEvidence(expected: unknown, actual: unknown): string | undefined {
    if (expected === undefined && actual === undefined) return undefined;
    return `expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`;
  }

  private buildReportSummary(issues: AuditIssue[], pass: boolean): string {
    if (pass) return '审核通过';
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    return `审核未通过：${errorCount} error + ${warningCount} warning，共 ${issues.length} 项问题`;
  }

  /**
   * 运行程序审 - B-7 调度策略。
   * parallelizable=true 的 Checker 用 Promise.allSettled 并行执行；
   * parallelizable=false 的串行执行。
   * 单个 Checker 抛异常时，记 warn 日志，返回空 failures（不中断整个审核）。
   */
  private async runProgramCheckers(request: AuditRequest, ctx: AuditContext): Promise<AuditFailure[]> {
    const scope = request.auditScope;
    const checkers = scope
      ? this.programCheckers.filter((c) => scope.includes(c.dimension))
      : this.programCheckers;

    const parallel = checkers.filter((c) => c.parallelizable !== false);
    const serial = checkers.filter((c) => c.parallelizable === false);

    const failures: AuditFailure[] = [];

    // 并行执行
    const parallelResults = await Promise.allSettled(
      parallel.map((checker) => checker.check(request, ctx)),
    );
    for (const result of parallelResults) {
      if (result.status === 'fulfilled') {
        failures.push(...result.value);
      } else {
        this.logger.warn('ProgramChecker failed (parallel)', {
          error: getErrorMessage(result.reason),
        });
      }
    }

    // 串行执行
    for (const checker of serial) {
      try {
        const result = await checker.check(request, ctx);
        failures.push(...result);
      } catch (error) {
        this.logger.warn('ProgramChecker failed (serial)', {
          dimension: checker.dimension,
          error: getErrorMessage(error),
        });
      }
    }

    return failures;
  }

  /**
   * Q-4 输入隔离：将 AuditRequest 转换为 AuditRequestForLLM（剥离 expected.names）。
   * 编译期守门：LLMChecker 只接收此类型。
   */
  private toLLMRequest(request: AuditRequest): AuditRequestForLLM {
    const { names: _names, ...expectedWithoutNames } = request.taskContract.expected ?? {};
    return {
      taskId: request.taskId,
      taskContract: {
        ...request.taskContract,
        expected: expectedWithoutNames,
      },
      actualOutput: request.actualOutput,
      auditScope: request.auditScope,
    };
  }

  private buildRepairSuggestion(rootCause?: AuditRootCause): string | undefined {
    if (!rootCause) return undefined;
    const suggestions: Record<AuditRootCause, string> = {
      context_injection_error: '检查方案L manifest注入配置，确保数据源可用',
      llm_understanding_error: '优化prompt（方案H），增强任务描述清晰度',
      data_missing: '检查数据层（方案D/J/F），确保存档池数据完整',
      tool_execution_failure: '检查工具实现，修复执行错误',
    };
    return suggestions[rootCause];
  }

  private calculateConfidence(programFailureCount: number, llmFailureCount: number): number {
    const totalFailures = programFailureCount + llmFailureCount;
    if (totalFailures === 0) return 1.0;
    if (totalFailures <= 2) return 0.8;
    if (totalFailures <= 5) return 0.6;
    return 0.4;
  }
}

/**
 * 从 toolCall.params 中提取所有实体名称（平铺字段 + 数组嵌套字段）。
 *
 * 设计文档方案 4：支持批量调用的嵌套字段提取，避免 currentState 为空。
 *
 * 提取范围：
 * - 平铺字段：name, npcName, locationName, skillName, itemName, questName, characterName
 * - 数组字段：items[].name, npcs[].name, locations[].name, skills[].name,
 *            quests[].name, characters[].name, sub_locations[].name
 *
 * 约束：仅提取字符串类型且非空的 name；返回结果去重。
 */
function extractEntityNamesFromToolCall(params: unknown): string[] {
  if (!params || typeof params !== 'object') return [];
  const record = params as Record<string, unknown>;
  const names: string[] = [];
  const seen = new Set<string>();

  // 平铺字段提取
  const flatNameFields = [
    'name', 'npcName', 'locationName', 'skillName',
    'itemName', 'questName', 'characterName',
  ];
  for (const field of flatNameFields) {
    const value = record[field];
    if (typeof value === 'string' && value && !seen.has(value)) {
      seen.add(value);
      names.push(value);
    }
  }

  // 数组字段提取（批量调用场景）
  const arrayFieldNames = [
    'items', 'npcs', 'locations', 'skills',
    'quests', 'characters', 'sub_locations',
  ];
  for (const field of arrayFieldNames) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const itemName = (item as Record<string, unknown>).name;
      if (typeof itemName === 'string' && itemName && !seen.has(itemName)) {
        seen.add(itemName);
        names.push(itemName);
      }
    }
  }

  return names;
}
