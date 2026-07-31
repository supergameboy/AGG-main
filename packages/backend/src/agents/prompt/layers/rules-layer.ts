import type { PromptContext, PromptLayer, LayerBuildOutput } from '../types.js';
import type { IRulesEngine, RuleDefinition } from '@ai-rpg/shared/types/prompt';

/**
 * RulesLayer: 统一的规则注入层，替换 SharedRulesLayer + ModeRulesLayer + ConvergenceLayer + ActionAdaptationLayer
 *
 * - alwaysApply 规则注入到 systemPrompt（每次请求都注入）
 * - hooked 规则注入到 systemPrompt（intentHint 匹配时注入）
 * - 收敛指导作为 alwaysApply 规则的一部分注入
 *
 * order=15: 在 BaseTemplateLayer(10) 之后，TemplateContextLayer(25) 之前
 */
export class RulesLayer implements PromptLayer {
  readonly name = 'rules';
  readonly order = 15;

  constructor(private rulesEngine: IRulesEngine) {}

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const intentHint = ctx.message.payload?.intentHint;
    const rules = this.rulesEngine.getAllRulesForAgent(ctx.agentKey, intentHint);

    if (rules.length === 0) {
      return { content: null, metadata: { alwaysApplyCount: 0, hookedCount: 0, matchedHooks: [], ruleNames: [] } };
    }

    // 分组：alwaysApply 规则和 hooked 规则
    const alwaysApplyRules = rules.filter(r => r.alwaysApply);
    const hookedRules = rules.filter(r => !r.alwaysApply);

    const parts: string[] = [];

    if (alwaysApplyRules.length > 0) {
      parts.push(this.formatSection('始终生效规则', alwaysApplyRules));
    }

    if (hookedRules.length > 0) {
      parts.push(this.formatSection('场景规则', hookedRules));
    }

    const matchedHooks = hookedRules.flatMap(r => r.hook);
    const ruleNames = rules.map(r => r.name);

    return {
      content: parts.length > 0 ? parts.join('\n\n') : null,
      metadata: {
        alwaysApplyCount: alwaysApplyRules.length,
        hookedCount: hookedRules.length,
        matchedHooks,
        ruleNames,
      },
    };
  }

  private formatSection(title: string, rules: RuleDefinition[]): string {
    const ruleParts = rules.map(r =>
      `<rule name="${r.name}" priority="${r.priority}">\n${r.content}\n</rule>`
    );
    return `## ${title}\n\n<rules>\n${ruleParts.join('\n\n')}\n</rules>`;
  }

}
