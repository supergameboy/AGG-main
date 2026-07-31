import type { PromptContext, PromptLayer, LayerBuildOutput } from '../types.js';

export class TemplateContextLayer implements PromptLayer {
  readonly name = 'template';
  readonly order = 25;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    if (ctx.templateContext == null) {
      return { content: null, metadata: { templateId: null } };
    }

    return {
      content: `## 世界设定\n${ctx.templateContext}`,
      metadata: { templateId: ctx.templateId ?? null },
    };
  }
}
