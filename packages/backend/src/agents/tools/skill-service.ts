import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { ISkillRegistry, IRulesEngine } from '@ai-rpg/shared/types/prompt';
import type { HelpRegistry } from '../../services/help-registry.js';

function hasInjectedMethod(
  injectedMethods: ToolContext['injectedMethods'],
  toolType: string,
  method: string,
  requiredLevel: 'summary' | 'detail' = 'detail',
): boolean {
  return injectedMethods?.some(
    (entry) =>
      entry.source === toolType
      && entry.method === method
      && (entry.level ?? 'detail') === requiredLevel,
  ) ?? false;
}

function markInjectedMethod(
  injectedMethods: ToolContext['injectedMethods'],
  toolType: string,
  method: string,
  level: 'summary' | 'detail',
): void {
  if (!injectedMethods) {
    return;
  }
  const existing = injectedMethods.find(
    (entry) => entry.source === toolType && entry.method === method,
  );
  if (existing) {
    if ((existing.level ?? 'detail') === 'detail' || existing.level === level) {
      return;
    }
    existing.level = 'detail';
    return;
  }
  injectedMethods.push({ source: toolType, method, level });
}

/**
 * SkillLoaderTool — 技能加载服务
 *
 * 提供 load_skill 方法，Agent按需加载技能完整内容。
 * 技能列表摘要已通过SkillLayer注入systemPrompt，
 * LLM根据whenToUse描述自主判断是否加载。
 *
 * 加载技能时自动附带 recommendedTools 的帮助文档（路径1预注入）。
 */
export class SkillLoaderTool extends BaseTool {
  private skillRegistry: ISkillRegistry | null = null;
  private helpRegistry: HelpRegistry | null = null;
  private rulesEngine: IRulesEngine | null = null;

  constructor() {
    super(
      'skill_loader' as ToolType,
      'Skill Loader',
      '技能加载服务 - 按需加载技能完整内容到Agent上下文',
      '1.0.0',
    );
    this.registerMethods();
  }

  setSkillRegistry(skillRegistry: ISkillRegistry): void {
    this.skillRegistry = skillRegistry;
  }

  setHelpRegistry(helpRegistry: HelpRegistry): void {
    this.helpRegistry = helpRegistry;
  }

  setRulesEngine(rulesEngine: IRulesEngine): void {
    this.rulesEngine = rulesEngine;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'load_skill',
      description: '加载指定技能的完整内容。当你判断当前任务匹配某个技能时，先调用此工具获取操作指南。技能列表摘要已在上下文中，根据"何时使用"描述判断是否需要加载。',
      cacheable: false,
      parameters: {
        skillName: {
          type: 'string',
          required: true,
          description: '技能名称，如"game-initialization"、"combat-orchestration"',
        },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        const skillName = params.skillName as string;
        if (!this.skillRegistry) {
          return { success: false, error: 'Skill registry not initialized' };
        }

        const content = await this.skillRegistry.loadSkillContent(skillName);
        if (!content) {
          return { success: false, error: `Skill not found or disabled: ${skillName}` };
        }

        const skill = this.skillRegistry.getSkillByName(skillName);
        const skillContent = `<skill name="${skillName}" version="${skill?.version ?? '1.0'}">\n${content}\n</skill>`;

        // H1: 权限过滤 — 只注入当前 Agent 有权使用的工具帮助
        const agentTools = _context.agentTools;
        const helpSections = await this.buildRecommendedToolsHelp(
          skill?.recommendedTools ?? [],
          agentTools,
          _context.injectedMethods,
        );

        let fullContent = helpSections
          ? `${skillContent}\n\n${helpSections}`
          : skillContent;

        // H3: 预注入关联规则（hooked 规则仅在 intentHint 匹配时注入）
        if (skill?.relatedRules && skill.relatedRules.length > 0 && this.rulesEngine) {
          const intentHint = _context.intentHint;
          const rulesSection = this.buildRelatedRulesHelp(skill.relatedRules, intentHint);
          if (rulesSection) {
            fullContent += '\n\n' + rulesSection;
          }
        }

        return {
          success: true,
          data: { content: fullContent },
        };
      },
    });
  }

  /**
   * 构建技能推荐工具的帮助文档集合
   * 路径1：技能加载时预注入，优先级最高
   * H1: 权限过滤 — 只注入当前 Agent 有权使用的工具帮助
   */
  private async buildRecommendedToolsHelp(
    recommendedTools: string[],
    agentTools?: string[],
    injectedMethods?: ToolContext['injectedMethods'],
  ): Promise<string | null> {
    if (!this.helpRegistry || recommendedTools.length === 0) return null;

    // H1: 按 Agent 权限过滤推荐工具
    const permittedTools = agentTools
      ? recommendedTools.filter(t => {
          const toolType = t.includes('.') ? t.split('.')[0] : t;
          return agentTools.includes(toolType);
        })
      : recommendedTools;

    if (permittedTools.length === 0) return null;

    const sections: string[] = [];
    for (const toolRef of permittedTools) {
      // recommendedTools 格式: "toolType.method" 或 "toolType"
      const [toolType, method] = toolRef.includes('.')
        ? toolRef.split('.')
        : [toolRef, undefined];

      if (method) {
        // 指定了具体方法
        if (hasInjectedMethod(injectedMethods, toolType, method, 'detail')) {
          continue;
        }
        const help = await this.helpRegistry.getHelp(toolType, method);
        if (help) {
          sections.push(this.helpRegistry.formatHelpForPrompt(help, toolType, method));
          markInjectedMethod(injectedMethods, toolType, method, 'detail');
        }
      } else {
        // 只指定了工具类型，加载该工具所有方法的摘要
        const summaries = this.helpRegistry.getHelpSummary(toolType);
        if (summaries.length > 0) {
          const summaryLines = summaries
            .map(s => `- ${s.method}: ${s.description}`)
            .join('\n');
          sections.push(`<tool_help_summary tool="${toolType}">\n${summaryLines}\n</tool_help_summary>`);
          for (const s of summaries) {
            markInjectedMethod(injectedMethods, toolType, s.method, 'summary');
          }
        }
      }
    }

    if (sections.length === 0) return null;

    return [
      '【推荐工具帮助文档】以下是你在此技能中需要使用的工具的详细帮助：',
      '',
      ...sections,
    ].join('\n');
  }

  /**
   * H3: 构建关联规则的预注入内容
   * 技能加载时将关联规则一并注入，避免 Agent 额外调用 load_rule
   * - alwaysApply 规则：始终注入
   * - hooked 规则：仅在 intentHint 匹配该规则的 hook 条件时注入
   */
  private buildRelatedRulesHelp(ruleNames: string[], intentHint?: string): string | null {
    const rules: string[] = [];
    for (const ruleName of ruleNames) {
      const rule = this.rulesEngine!.getRuleByName(ruleName);
      if (!rule || !rule.enabled) continue;

      // alwaysApply 规则始终注入
      if (rule.alwaysApply) {
        rules.push(`<rule name="${rule.name}">\n${rule.content}\n</rule>`);
        continue;
      }

      // hooked 规则仅在 intentHint 匹配时注入
      if (intentHint && (rule.hook.includes(intentHint) || rule.hook.includes('*'))) {
        rules.push(`<rule name="${rule.name}">\n${rule.content}\n</rule>`);
      }
    }
    if (rules.length === 0) return null;
    return `## 关联规则（已预加载，无需调用load_rule）\n${rules.join('\n\n')}`;
  }
}
