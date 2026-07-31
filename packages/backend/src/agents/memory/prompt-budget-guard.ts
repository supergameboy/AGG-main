import { BudgetCheckResult, BudgetWarning } from './types.js';
import { createChildLogger } from '../../utils/logger.js';
import type { PromptBuildResult } from '../prompt/types.js';
import { estimateTokens } from '@ai-rpg/shared/utils/token-estimate';

const logger = createChildLogger('PromptBudgetGuard');

export class PromptBuildBudgetGuard {
  private budgetLimit: number;

  constructor(budgetLimit: number) {
    this.budgetLimit = budgetLimit;
  }

  check(
    promptBuildResult: PromptBuildResult,
    contextMessages: Array<{ role: string; content?: string }>,
  ): BudgetCheckResult {
    const systemTokens = estimateTokens(promptBuildResult.systemPrompt);
    const userTokens = estimateTokens(promptBuildResult.userPrompt);
    const toolsTokens = estimateTokens(JSON.stringify(promptBuildResult.apiTools));
    const contextTokens = contextMessages.reduce(
      (sum, msg) => sum + estimateTokens(msg.content ?? ''),
      0,
    );
    const totalTokens = systemTokens + userTokens + toolsTokens + contextTokens;

    const utilizationRatio = this.budgetLimit > 0 ? totalTokens / this.budgetLimit : 0;

    const warnings: BudgetWarning[] = [];

    // 检查各层预算占比
    if (promptBuildResult.systemPromptTrace) {
      for (const layer of promptBuildResult.systemPromptTrace.layers) {
        const share = this.budgetLimit > 0 ? layer.tokenCount / this.budgetLimit : 0;
        warnings.push({
          layer: layer.name,
          tokenCount: layer.tokenCount,
          budgetShare: parseFloat(share.toFixed(3)),
          truncated: false,
        });
      }
    }

    // 上下文消息预算占比
    const contextShare = this.budgetLimit > 0 ? contextTokens / this.budgetLimit : 0;
    warnings.push({
      layer: 'context_messages',
      tokenCount: contextTokens,
      budgetShare: parseFloat(contextShare.toFixed(3)),
      truncated: false,
    });

    // 确定紧急度
    let compressionUrgency: BudgetCheckResult['compressionUrgency'] = 'none';
    let shouldCompress = false;

    if (utilizationRatio > 0.9) {
      compressionUrgency = 'high';
      shouldCompress = true;
    } else if (utilizationRatio > 0.75) {
      compressionUrgency = 'medium';
      shouldCompress = true;
    } else if (utilizationRatio > 0.6) {
      compressionUrgency = 'low';
      shouldCompress = false; // 低紧急度不立即压缩，标记告警
    }

    const result: BudgetCheckResult = {
      totalTokens,
      budgetLimit: this.budgetLimit,
      utilizationRatio: parseFloat(utilizationRatio.toFixed(3)),
      warnings,
      shouldCompress,
      compressionUrgency,
    };

    if (shouldCompress) {
      logger.info('Budget guard triggered compression', {
        totalTokens,
        budgetLimit: this.budgetLimit,
        utilizationRatio: result.utilizationRatio,
        urgency: compressionUrgency,
      });
    }

    return result;
  }

  updateBudgetLimit(newLimit: number): void {
    this.budgetLimit = newLimit;
  }
}
