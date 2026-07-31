import type { PromptBlock, PromptContext, FieldMapping, FieldBuildResult, BlockBuildOutput } from '../types.js';

export class ContextBlock implements PromptBlock {
  readonly name = 'context';
  private fields: FieldMapping[] = [];

  addField(mapping: FieldMapping): this {
    this.fields.push(mapping);
    return this;
  }

  async build(ctx: PromptContext): Promise<BlockBuildOutput> {
    const parts: string[] = [];
    const fieldResults: FieldBuildResult[] = [];

    for (const field of this.fields) {
      const value = field.extract(ctx);
      const present = value != null;
      const formatted = present ? field.format(value) : null;
      fieldResults.push({
        key: field.key,
        label: field.label,
        present,
        content: formatted,
      });
      if (present) parts.push(`[${field.label}]\n${formatted}`);
    }

    return {
      content: parts.length > 0 ? parts.join('\n') : null,
      fields: fieldResults,
    };
  }
}
