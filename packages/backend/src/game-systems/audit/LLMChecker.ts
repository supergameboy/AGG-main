import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { extractJSONFromContent } from '../../utils/llm-json.js';
import type { AuditRequestForLLM, AuditFailure, AuditDimension } from '../../../../shared/src/types/audit.js';
import type { LLMChecker, AuditContext } from './ProgramChecker.js';
import type { LLMService } from '@ai-rpg/ai';

const logger = createChildLogger('llm-checker');

/**
 * LLMChecker - LLM内容质量审核。
 *
 * Q-4 输入隔离：只接收 AuditRequestForLLM（编译期剥离 expected.names），不接收完整 AuditRequest。
 * 避免 LLM "想大象"——不把期望的具体名称泄露给 LLM。
 *
 * 设计原则（architecture-standards 14.4 LLM 审必须独立）：
 * - prompt 中禁止注入程序审结果（programFailureSummary），LLM 审必须独立评估内容质量
 * - severity 白名单映射：仅 'error' 映射为 'error'，其余映射为 'warning'（避免非 warning 一律映射为 error）
 * - LLM 失败时返回低置信度 warning（而非空 failures 静默降级为"通过"）
 *
 * LLM 审 token 预算：默认 2000 tokens（B-7 约束）。
 */
export class LLMCheckerImpl implements LLMChecker {
  private static readonly DEFAULT_LLM_BUDGET = 2000;

  constructor(
    private readonly llmService: LLMService,
    private readonly llmBudget: number = LLMCheckerImpl.DEFAULT_LLM_BUDGET,
  ) {}

  async check(
    request: AuditRequestForLLM,
    _ctx: AuditContext,
    _programFailures: AuditFailure[],
  ): Promise<AuditFailure[]> {
    // 14.4: prompt 不注入 programFailures，LLM 审独立评估内容质量
    const prompt = this.buildPrompt(request);

    try {
      const response = await this.llmService.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: this.llmBudget },
      );

      return this.parseLLMResponse(response.content, request.actualOutput.output);
    } catch (error) {
      // 14.4: LLM 失败时返回低置信度 warning，而非空 failures 静默降级为"通过"
      // 空 failures 会让 AuditResult.pass=true，掩盖 LLM 审失败的事实
      logger.warn('LLM check failed, returning low-confidence warning', {
        taskId: request.taskId,
        error: getErrorMessage(error),
      });
      return [
        {
          dimension: 'content_quality',
          expected: { llmCheck: 'completed' },
          actual: { llmCheck: 'failed', error: getErrorMessage(error) },
          reason: `LLM 审核失败（低置信度 warning）：${getErrorMessage(error)}。请人工复核本次任务输出质量。`,
          severity: 'warning',
        },
      ];
    }
  }

  /**
   * 构建 LLM 审核 prompt（14.4: 不注入程序审结果，保持 LLM 审独立性）。
   *
   * 审核原则（architecture-standards 14.1 补充）：
   * - 只审核"不满足要求"的情况（缺失、错误、不完整）才报告为 failure
   * - 超出任务范围的自由发挥/创造性扩展不应被视为 failure
   */
  private buildPrompt(request: AuditRequestForLLM): string {
    const quality = request.taskContract.expected?.quality ?? [];

    return `你是一个游戏内容质量审核员。请审核以下子Agent的输出是否满足任务契约的基本要求。

任务描述: ${request.taskContract.description}
质量要求: ${quality.join(', ') || '无特殊要求'}

子Agent输出:
${request.actualOutput.output}

审核原则（必须遵守）：
1. 只审核"不满足要求"的情况（缺失、错误、不完整），才报告为 failure
2. 超出任务范围的额外输出（自由发挥、创造性扩展、补充内容）不应被视为 failure
3. 如果输出满足所有基本要求，即使包含额外内容，也视为通过

请以JSON数组格式返回审核结果，每个失败项包含: dimension, reason, severity(error/warning)。
如果全部通过，返回空数组 []。`;
  }

  private parseLLMResponse(content: string, actualOutput: string): AuditFailure[] {
    // 先用 extractJSONFromContent 剥离 markdown 代码块（LLM 输出常带 ```json ... ``` 包裹）
    let cleanContent: string;
    try {
      cleanContent = extractJSONFromContent(content);
      if (!cleanContent) {
        logger.warn('LLM response: no JSON content found after extraction, degrading');
        return [];
      }
    } catch {
      logger.warn('LLM response: content extraction failed, degrading', {
        content: content.substring(0, 200),
      });
      return [];
    }

    try {
      const parsed = JSON.parse(cleanContent);
      if (!Array.isArray(parsed)) {
        logger.warn('LLM response is not array, degrading', { content: cleanContent.substring(0, 200) });
        return [];
      }

      return parsed
        .filter((item): item is { dimension: string; reason: string; severity?: string } =>
          typeof item === 'object' && item !== null && 'dimension' in item && 'reason' in item)
        .map((item) => ({
          dimension: item.dimension as AuditDimension,
          expected: null,
          actual: actualOutput,
          reason: item.reason,
          // 14.4: severity 白名单映射 - 仅 'error' 映射为 'error'，其余映射为 'warning'
          // 原实现 `item.severity === 'warning' ? 'warning' : 'error'` 过于激进，
          // 任何非 warning 值（包括 typo、缺省、null）都被映射为 error，触发 AuditAgent LLM 审升级恶性循环
          severity: item.severity === 'error' ? 'error' : ('warning' as 'error' | 'warning'),
        }));
    } catch {
      logger.warn('LLM response JSON parse failed after extraction, degrading', {
        extractedLength: cleanContent.length,
        first100: cleanContent.substring(0, 100),
      });
      return [];
    }
  }
}
