import type { PromptBlock, PromptContext, BlockBuildResult, BlockBuildOutput, UserPromptBuildResult } from './types.js';

export class UserPromptComposer {
  private blocks: PromptBlock[] = [];

  addBlock(block: PromptBlock): this {
    this.blocks.push(block);
    return this;
  }

  removeBlock(name: string): this {
    this.blocks = this.blocks.filter(b => b.name !== name);
    return this;
  }

  async build(ctx: PromptContext): Promise<UserPromptBuildResult> {
    const parts: string[] = [];
    const action = ctx.message.payload?.action;
    const intentHint = ctx.message.payload?.intentHint;

    if (action && action !== 'unknown') {
      parts.push(`[玩家操作: ${action}]`);
    }
    if (intentHint && intentHint !== 'chat') {
      parts.push(`[推断意图: ${intentHint}]`);
    }

    const blocks: BlockBuildResult[] = [];
    for (const block of this.blocks) {
      const output: BlockBuildOutput = await block.build(ctx);
      blocks.push({
        name: block.name,
        content: output.content,
        fields: output.fields,
      });
      if (output.content) parts.push(output.content);
    }

    const fallbackAction = action ?? 'unknown';
    const fullContent = parts.length > 0
      ? parts.join('\n')
      : `Action: ${fallbackAction}\nData: ${JSON.stringify((ctx.message.payload?.data as Record<string, unknown>) ?? {})}`;

    return {
      content: fullContent,
      totalTokens: Math.ceil(fullContent.length / 2),
      action: action ?? null,
      intentHint: intentHint ?? null,
      blocks,
    };
  }
}
