import type { PromptLayer, PromptContext, LayerBuildResult, LayerBuildOutput, SystemPromptBuildResult } from './types.js';

export class SystemPromptComposer {
  private layers: PromptLayer[] = [];
  private dirty = false;

  addLayer(layer: PromptLayer): this {
    this.layers.push(layer);
    this.dirty = true;
    return this;
  }

  removeLayer(name: string): this {
    this.layers = this.layers.filter(l => l.name !== name);
    return this;
  }

  async build(ctx: PromptContext): Promise<SystemPromptBuildResult> {
    if (this.dirty) {
      this.layers.sort((a, b) => a.order - b.order);
      this.dirty = false;
    }
    const layers: LayerBuildResult[] = [];
    const parts: string[] = [];
    for (const layer of this.layers) {
      const output: LayerBuildOutput = await layer.build(ctx);
      const tokenCount = output.content ? Math.ceil(output.content.length / 2) : 0;
      layers.push({
        name: layer.name,
        order: layer.order,
        content: output.content,
        tokenCount,
        metadata: output.metadata,
      });
      if (output.content) parts.push(output.content);
    }
    const fullContent = parts.join('\n\n');
    return {
      content: fullContent,
      totalTokens: Math.ceil(fullContent.length / 2),
      layers,
    };
  }
}
