import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { ISkillRegistry } from '@ai-rpg/shared/types/prompt';

/**
 * SkillLayer — 技能列表摘要注入层
 *
 * 在systemPrompt中注入当前Agent可用的技能列表摘要（不含正文），
 * LLM根据whenToUse描述自主判断是否调用load_skill加载完整内容。
 *
 * 注入顺序：在RulesLayer之后（Rules > Skills）
 */
export class SkillLayer implements PromptLayer {
  readonly name = 'skills';
  readonly order = 16; // RulesLayer=15, Skills=16

  constructor(private skillRegistry: ISkillRegistry) {}

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const intentHint = ctx.message.payload?.intentHint;
    const skills = intentHint
      ? this.skillRegistry.getSkillsByIntent(ctx.agentKey, intentHint)
      : this.skillRegistry.getSkillListForAgent(ctx.agentKey);

    if (skills.length === 0) {
      return { content: null, metadata: { includedCount: 0, skillNames: [], triggeredBy: [] } };
    }

    const parts = skills.map(s =>
      `<skill name="${s.name}">\n${s.description}\n何时使用: ${s.whenToUse}\n</skill>`
    );

    const content = `<available_skills>\n注意：规则是约束（必须遵守），技能是指导（灵活执行）。当规则与技能指导冲突时，必须遵循规则。\n\n${parts.join('\n\n')}\n</available_skills>`;

    return {
      content,
      metadata: {
        includedCount: skills.length,
        skillNames: skills.map(s => s.name),
        triggeredBy: intentHint ? [intentHint] : [],
      },
    };
  }
}
