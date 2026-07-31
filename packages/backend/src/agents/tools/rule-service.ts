import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import type { ToolType } from '../../../../shared/src/types/agent.js';
import type { IRulesEngine } from '@ai-rpg/shared/types/prompt';

export class RuleServiceTool extends BaseTool {
  private rulesEngine: IRulesEngine | null = null;

  constructor() {
    super(
      'rule_service' as ToolType,
      'Rule Service',
      '规则加载服务 - 按需加载规则完整内容到Agent上下文',
      '1.0.0'
    );
    this.registerMethods();
  }

  setRulesEngine(rulesEngine: IRulesEngine): void {
    this.rulesEngine = rulesEngine;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'load_rule',
      description: '加载指定规则的完整内容。当上下文中只有规则摘要时，使用此工具获取完整规则。hooked规则在匹配时已自动注入完整内容，通常无需再次调用。',
      parameters: {
        ruleName: { type: 'string', required: true, description: '规则名称，如"combat-safety"、"move-safety"' },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '规则名称' },
              description: { type: 'string', description: '规则描述' },
              alwaysApply: { type: 'boolean', description: '是否始终应用' },
              hook: { type: 'string', description: '钩子类型' },
              targetAgent: { type: 'string', description: '目标Agent类型' },
              priority: { type: 'number', description: '优先级' },
              content: { type: 'string', description: '规则完整内容' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        if (!this.rulesEngine) {
          return { success: false, error: 'RulesEngine not initialized' };
        }

        const ruleName = params.ruleName as string;
        if (!ruleName) {
          return { success: false, error: 'ruleName is required' };
        }

        const rule = this.rulesEngine.getRuleByName(ruleName);
        if (!rule) {
          return { success: false, error: `Rule not found: ${ruleName}. Available rules: ${this.rulesEngine.ruleNames.join(', ')}` };
        }

        if (!rule.enabled) {
          return { success: false, error: `Rule is disabled: ${ruleName}` };
        }

        return {
          success: true,
          data: {
            name: rule.name,
            description: rule.description,
            alwaysApply: rule.alwaysApply,
            hook: rule.hook,
            targetAgent: rule.targetAgent,
            priority: rule.priority,
            content: rule.content,
          },
        };
      },
    });
  }
}
