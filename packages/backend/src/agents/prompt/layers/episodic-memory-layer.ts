import type { PromptContext, PromptLayer, LayerBuildOutput } from '../types.js';
import type { EpisodicMemoryService } from '../../memory/episodic-memory-service.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export class EpisodicMemoryLayer implements PromptLayer {
  readonly name = 'episodic_memory';
  readonly order = 35;

  private episodicService: EpisodicMemoryService | null = null;

  setService(service: EpisodicMemoryService): void {
    this.episodicService = service;
  }

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const saveId = ctx.domain.saveId as string | undefined;
    if (!this.episodicService || !saveId) {
      return { content: null, metadata: { memoryCount: 0 } };
    }

    try {
      const agentKey = ctx.agentKey ?? 'gamemaster';
      const summary = await this.episodicService.getSummary(saveId, agentKey, 20);

      if (!summary) {
        return { content: null, metadata: { memoryCount: 0 } };
      }

      const memoryCount = await this.episodicService.getMemoryCount(saveId, agentKey);

      return {
        content: `## 历史记忆摘要\n${summary}`,
        metadata: { memoryCount },
      };
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('no such table')) {
        console.warn(`[EpisodicMemoryLayer] Table not found, skipping memory injection. Run migration 078 to create tables.`);
      } else {
        console.warn(`[EpisodicMemoryLayer] Failed to build: ${message}`);
      }
      return { content: null, metadata: { memoryCount: 0 } };
    }
  }
}
