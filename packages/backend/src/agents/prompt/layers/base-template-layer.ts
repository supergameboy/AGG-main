import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { TemplateLoader } from '../template-loader.js';

export class BaseTemplateLayer implements PromptLayer {
  readonly name = 'base';
  readonly order = 10;

  constructor(private templateLoader: TemplateLoader) {}

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const templateFile = `${ctx.agentKey}.md`;
    const content = await this.templateLoader.load(templateFile);
    return {
      content,
      metadata: { templateFile },
    };
  }
}
