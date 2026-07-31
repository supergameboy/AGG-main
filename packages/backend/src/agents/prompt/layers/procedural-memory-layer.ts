import type { PromptContext, PromptLayer, LayerBuildOutput } from '../types.js';
import type { ProceduralMemoryService } from '../../memory/procedural-memory-service.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export class ProceduralMemoryLayer implements PromptLayer {
  readonly name = 'procedural_memory';
  readonly order = 36;

  private proceduralService: ProceduralMemoryService | null = null;

  setService(service: ProceduralMemoryService): void {
    this.proceduralService = service;
  }

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const saveId = ctx.domain.saveId as string | undefined;
    if (!this.proceduralService || !saveId) {
      return { content: null, metadata: { ruleCount: 0 } };
    }

    try {
      const agentKey = ctx.agentKey ?? 'gamemaster';
      const summary = await this.proceduralService.getSummary(saveId, agentKey, 10);

      if (!summary) {
        return { content: null, metadata: { ruleCount: 0 } };
      }

      const ruleCount = await this.proceduralService.getRuleCount(saveId, agentKey);

      return {
        content: `## 行为经验\n${summary}`,
        metadata: { ruleCount },
      };
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('no such table')) {
        console.warn(`[ProceduralMemoryLayer] Table not found, skipping memory injection. Run migration 078 to create tables.`);
      } else {
        console.warn(`[ProceduralMemoryLayer] Failed to build: ${message}`);
      }
      return { content: null, metadata: { ruleCount: 0 } };
    }
  }
}
