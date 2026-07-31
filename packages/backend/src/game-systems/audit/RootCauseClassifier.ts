import type { AuditFailure, AuditRequest, AuditRootCause } from '../../../../shared/src/types/audit.js';
import type { RootCauseClassifier, AuditContext } from './ProgramChecker.js';

/**
 * RootCauseClassifier - 失败根因分类。
 *
 * 4类根因指导修复方向，避免无脑二次派发：
 * - context_injection_error：manifest注入数据缺失/错误 → 修方案L
 * - llm_understanding_error：LLM偏离taskContract（content_quality维度）→ 修prompt（方案H）
 * - data_missing：存档池数据缺失 → 修数据层（方案D/J/F）
 * - tool_execution_failure：工具调用失败 → 修工具
 *
 * 模块5 简化：删除 graph_structure_issue 分类（图结构问题由程序全权派生维护，不再由 LLM 审核）
 *
 * 设计原则（architecture-standards 14.5 第6条）：
 * - 仅 content_quality 维度 warning 分类为 'llm_understanding_error'
 * - 禁止所有 warning 统一分类为 'llm_understanding_error'（导致错误修复建议）
 */
export class RootCauseClassifierImpl implements RootCauseClassifier {
  async classify(
    programFailures: AuditFailure[],
    llmFailures: AuditFailure[],
    request: AuditRequest,
    ctx: AuditContext,
  ): Promise<AuditRootCause | undefined> {
    const allFailures = [...programFailures, ...llmFailures];
    if (allFailures.length === 0) return undefined;

    // 1. context_injection_error: actualOutput 为空 + 程序审全 fail
    if (!request.actualOutput.output || request.actualOutput.output.trim() === '') {
      if (programFailures.length > 0) {
        return 'context_injection_error';
      }
    }

    // 2. data_missing: savePoolProvider 查询返回空
    const dataMissingFailure = programFailures.find(
      (f) => f.dimension === 'npc_location' || f.dimension === 'item_ownership',
    );
    if (dataMissingFailure) {
      const npcs = await ctx.dataProviders.savePoolProvider.listNpcs(ctx.saveId);
      const items = await ctx.dataProviders.savePoolProvider.listItems(ctx.saveId);
      if (npcs.length === 0 && items.length === 0) {
        return 'data_missing';
      }
    }

    // 3. llm_understanding_error: LLM 审 content_quality 失败 或 程序审 content_quality warning
    // 仅 content_quality 维度才分类为 llm_understanding_error
    const llmFailure = llmFailures.find((f) => f.dimension === 'content_quality');
    const contentQualityWarning = programFailures.find(
      (f) => f.dimension === 'content_quality' && f.severity === 'warning',
    );
    if (llmFailure || contentQualityWarning) {
      return 'llm_understanding_error';
    }

    // 4. tool_execution_failure: 程序审抛异常或 actualOutput.error 存在
    if (request.actualOutput.error) {
      return 'tool_execution_failure';
    }

    // 默认: 无明确根因时不分类（返回 undefined）
    // 修复（方案 3）：默认分支违反 architecture-standards 14.5 第6条——
    // 仅 content_quality 维度 warning 才分类为 'llm_understanding_error'，
    // 其他维度（如 entity_counts / npc_location / item_ownership）的 warning 不应误分类为 'llm_understanding_error'。
    // 无明确根因时返回 undefined，让调用方按通用流程处理（重派 LLM 或人工介入）。
    return undefined;
  }
}
