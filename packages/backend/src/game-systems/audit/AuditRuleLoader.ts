import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { AuditDimension } from '../../../../shared/src/types/audit.js';

const logger = createChildLogger('audit-rule-loader');

/**
 * 审核策略 - 按 action 配置的审核规则。
 */
export interface AuditRule {
  mode: 'program' | 'llm' | 'both';
  scope?: AuditDimension[];
  retry_budget: number;
}

interface AuditRulesConfig {
  audit_strategies?: Record<string, AuditRule>;
}

/**
 * 审核策略加载器 - 从 YAML 配置加载 action→AuditRule 映射。
 * coordinator 在子Agent完成后查询此加载器决定是否审核及如何审核。
 */
export class AuditRuleLoader {
  private rules: Record<string, AuditRule> = {};

  constructor(configPath: string) {
    this.load(configPath);
  }

  private load(configPath: string): void {
    try {
      const resolvedPath = resolve(configPath);
      if (!existsSync(resolvedPath)) {
        logger.warn('Audit rules config not found, coordinator audit disabled', { path: resolvedPath });
        return;
      }

      const content = readFileSync(resolvedPath, 'utf-8');
      const config = yaml.load(content) as AuditRulesConfig;

      if (config?.audit_strategies) {
        this.rules = config.audit_strategies;
        logger.info('Audit rules loaded', { actionCount: Object.keys(this.rules).length });
      } else {
        logger.warn('Audit rules config has no audit_strategies section');
      }
    } catch (error) {
      logger.error('Failed to load audit rules config', { error: getErrorMessage(error) });
    }
  }

  /**
   * 查询 action 对应的审核策略。
   * 返回 null 表示该 action 不需要审核。
   */
  getRule(action: string): AuditRule | null {
    return this.rules[action] ?? null;
  }
}
