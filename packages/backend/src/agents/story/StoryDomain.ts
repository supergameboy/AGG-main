import type {
  StoryDomainPort,
  StoryStateCommit,
  StoryServiceLike,
  StorySnapshot,
} from './types.js';
import type { StoryEvent, StoryEventInput } from '../../game-systems/story/types.js';

const SNAPSHOT_HISTORY_OPTIONS = {
  page: 1,
  pageSize: 20,
} as const;

export class StoryDomain implements StoryDomainPort {
  constructor(private readonly storyService: StoryServiceLike) {}

  async getSnapshot(saveId: string): Promise<StorySnapshot> {
    const [rawContext, history, chapter] = await Promise.all([
      this.storyService.getContext(saveId),
      this.storyService.getHistory(saveId, SNAPSHOT_HISTORY_OPTIONS),
      this.storyService.getChapter(saveId),
    ]);

    return {
      context: this.normalizeContext(rawContext),
      history,
      chapter,
    };
  }

  async saveStoryState(saveId: string, commit: StoryStateCommit): Promise<void> {
    await this.storyService.commitStoryState(saveId, commit);
  }

  async addStoryEvent(saveId: string, event: StoryEventInput): Promise<StoryEvent> {
    return await this.storyService.addStoryEvent(saveId, event);
  }

  private normalizeContext(context: StorySnapshot['context']): StorySnapshot['context'] {
    if (!context.agentContext || typeof context.agentContext !== 'object') {
      return context;
    }

    return {
      ...context,
      agentContext: {
        ...context.agentContext,
        state: this.parseJsonField(context.agentContext.state),
        messages: this.parseJsonField(context.agentContext.messages),
      },
    };
  }

  private parseJsonField(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
