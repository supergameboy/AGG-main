import { createChildLogger } from '../../utils/logger.js';
import type { Knex } from 'knex';
import type {
  StoryContext,
  StoryEventInput,
  StoryEvent,
  ChapterInfo,
  ContextUpdateData,
  AdvanceChapterResult,
  IStoryEventWriter,
  IStoryEventRepository,
  IAgentContextRepository,
  StoryEventRow,
} from './types.js';
import type { IContextCompressor } from '../shared/types.js';
import type { ISaveRepository } from '../save/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';

const logger = createChildLogger('story-service');
const DEFAULT_STORY_EVENT_IMPORTANCE: StoryEvent['importance'] = 'minor';

function normalizeStoryEventImportance(importance?: string): StoryEvent['importance'] {
  if (importance === 'critical' || importance === 'major' || importance === 'minor') {
    return importance;
  }
  return DEFAULT_STORY_EVENT_IMPORTANCE;
}

/** StoryEventRow → StoryEvent 转换（importance 类型规范化）。 */
function rowToStoryEvent(row: StoryEventRow): StoryEvent {
  return {
    id: row.id,
    save_id: row.save_id,
    chapter: row.chapter,
    event_type: row.event_type,
    title: row.title,
    description: row.description,
    importance: normalizeStoryEventImportance(row.importance),
    participants: row.participants,
    impact: row.impact,
    timestamp: row.timestamp,
  };
}

/**
 * Story 领域 Service（S4 重构：移除 db，注入 Repository + TransactionManager）。
 *
 * 依赖注入：
 * - storyEventRepo: 操作 story_events 表（本领域）
 * - agentContextRepo: 操作 agent_contexts 表（本领域）
 * - saveRepo: 跨领域访问 saves 表 chapter/location/main_quest/level 字段
 * - txManager: 事务边界管理（commitStoryState）
 * - contextCompressor: 上下文压缩（可选，init.ts 注入）
 *
 * 19 处 db 调用迁移到 Repository：
 * - story_events: 8 处 → storyEventRepo
 * - agent_contexts: 5 处 → agentContextRepo
 * - saves: 6 处 → saveRepo
 */
export class StoryService implements IStoryEventWriter {
  private storyEventRepo: IStoryEventRepository;
  private agentContextRepo: IAgentContextRepository;
  private saveRepo: ISaveRepository;
  private txManager: ITransactionManager;
  private contextCompressor: IContextCompressor | null;

  constructor(
    storyEventRepo: IStoryEventRepository,
    agentContextRepo: IAgentContextRepository,
    saveRepo: ISaveRepository,
    txManager: ITransactionManager,
    contextCompressor?: IContextCompressor,
  ) {
    this.storyEventRepo = storyEventRepo;
    this.agentContextRepo = agentContextRepo;
    this.saveRepo = saveRepo;
    this.txManager = txManager;
    this.contextCompressor = contextCompressor ?? null;
  }

  async getContext(saveId: string): Promise<StoryContext & { hint?: string }> {
    const agentContextRow = await this.agentContextRepo.getContext(saveId, 'story');
    const saveInfo = await this.saveRepo.getSaveContextInfo(saveId);

    const result: StoryContext & { hint?: string } = {
      agentContext: agentContextRow ? { ...agentContextRow } : null,
      saveInfo: saveInfo
        ? {
            chapter: saveInfo.chapter,
            location: saveInfo.location,
            main_quest: saveInfo.mainQuest,
            level: saveInfo.level,
          }
        : null,
    };

    if (!agentContextRow) {
      result.hint = "暂无故事上下文. 建议：使用 update_context 初始化故事上下文";
    }

    const compressionSummaries = await this.getCompressionSummaries(saveId);
    if (compressionSummaries) {
      result.compressionSummaries = compressionSummaries;
    }

    return result;
  }

  async getHistory(
    saveId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<{
    events: StoryEvent[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
    compressionSummaries?: string;
    hint?: string;
  }> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      this.storyEventRepo.getStoryEvents(saveId, { limit: pageSize, offset }),
      this.storyEventRepo.countBySaveId(saveId),
    ]);

    const result = {
      events: rows.map(rowToStoryEvent),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    } as {
      events: StoryEvent[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
      compressionSummaries?: string;
      hint?: string;
    };

    if (rows.length === 0) {
      result.hint = "暂无历史故事事件. 建议：使用 add_story_event 记录故事事件";
    }

    const compressionSummaries = await this.getCompressionSummaries(saveId);
    if (compressionSummaries) {
      result.compressionSummaries = compressionSummaries;
    }

    return result;
  }

  async getChapter(saveId: string): Promise<ChapterInfo> {
    const saveInfo = await this.saveRepo.getSaveContextInfo(saveId);
    if (!saveInfo) {
      throw new Error('Save not found');
    }
    return {
      chapter: saveInfo.chapter,
      level: saveInfo.level,
      mainQuest: saveInfo.mainQuest,
    };
  }

  async addStoryEvent(
    saveId: string,
    event: StoryEventInput,
    trx?: Knex.Transaction,
  ): Promise<StoryEvent> {
    const chapter = event.chapter || '';

    // 去重检查：同 saveId + chapter + event_type + title 复用已有事件
    const existingEvent = await this.storyEventRepo.findExistingEvent(
      saveId,
      chapter,
      event.event_type,
      event.title,
      trx,
    );
    if (existingEvent) {
      logger.info(`Story event reused: ${event.title}`, { saveId });
      return rowToStoryEvent(existingEvent);
    }

    const insertData: Omit<StoryEventRow, 'id' | 'save_id' | 'timestamp'> = {
      chapter,
      event_type: event.event_type,
      title: event.title,
      description: event.description || '',
      importance: normalizeStoryEventImportance(event.importance),
      participants: JSON.stringify(event.participants || []),
      impact: JSON.stringify(event.impact || {}),
    };

    const newId = await this.storyEventRepo.addStoryEvent(saveId, insertData, trx);
    logger.info(`Story event added: ${event.title}`, { saveId });

    // 使用已知数据构造返回值，避免二次查询
    return {
      id: newId,
      save_id: saveId,
      chapter,
      event_type: event.event_type,
      title: event.title,
      description: event.description || '',
      importance: normalizeStoryEventImportance(event.importance),
      participants: JSON.stringify(event.participants || []),
      impact: JSON.stringify(event.impact || {}),
      timestamp: Date.now(),
    };
  }

  async getStoryEvents(
    saveId: string,
    options?: { chapter?: string; limit?: number },
    trx?: Knex.Transaction,
  ): Promise<StoryEvent[]> {
    const rows = await this.storyEventRepo.getStoryEvents(saveId, options, trx);
    return rows.map(rowToStoryEvent);
  }

  async updateContext(saveId: string, data: ContextUpdateData): Promise<void> {
    await this.applyContextUpdate(saveId, data);
    logger.info('Story context updated', { saveId });
  }

  async commitStoryState(
    saveId: string,
    commit: {
      runtimeState: Record<string, unknown>;
      projection: { chapter: string | null; mainQuest: string | null };
    },
  ): Promise<void> {
    await this.txManager.transaction(async (trx) => {
      // 检查 save 是否存在
      const existingSave = await this.saveRepo.getSaveContextInfo(saveId, trx);
      if (!existingSave) {
        throw new Error('Save not found');
      }

      await this.applyContextUpdate(
        saveId,
        {
          state: {
            runtimeState: commit.runtimeState,
            projection: commit.projection,
          },
        },
        trx,
      );

      await this.saveRepo.updateStoryState(
        saveId,
        commit.projection.chapter ?? '',
        commit.projection.mainQuest ?? '',
        trx,
      );
    });

    logger.info('Story state committed', {
      saveId,
      chapter: commit.projection.chapter,
      mainQuest: commit.projection.mainQuest,
    });
  }

  async advanceChapter(saveId: string): Promise<AdvanceChapterResult> {
    const ctx = await this.saveRepo.getStoryContext(saveId);
    if (!ctx) {
      throw new Error('Save not found');
    }

    const currentChapter = ctx.chapter || 'chapter_1';
    const match = currentChapter.match(/chapter_(\d+)/i);
    let nextChapter: string;

    if (match) {
      const num = parseInt(match[1]) + 1;
      nextChapter = `chapter_${num}`;
    } else {
      nextChapter = 'chapter_2';
    }

    // chapter 推进时保留原有 mainQuest
    await this.saveRepo.updateStoryState(saveId, nextChapter, ctx.mainQuest ?? '');

    logger.info(`Chapter advanced to ${nextChapter}`, { saveId });

    return {
      previousChapter: currentChapter,
      currentChapter: nextChapter,
    };
  }

  async compressContext(saveId: string): Promise<void> {
    if (!this.contextCompressor) {
      throw new Error('ContextCompressor 未注入，无法压缩上下文');
    }
    await this.contextCompressor.compressContext(saveId, 'story' as never);
    logger.info('Story context compressed', { saveId });
  }

  private async getCompressionSummaries(saveId: string): Promise<string | null> {
    const agentContext = await this.agentContextRepo.getContext(saveId, 'story');
    if (!agentContext) return null;

    const state =
      typeof agentContext.state === 'string'
        ? JSON.parse(agentContext.state)
        : agentContext.state;

    const summaries = state?._compressionSummaries;
    if (!Array.isArray(summaries) || summaries.length === 0) return null;

    const formattedSummaries = summaries.map((s: { summary: string }) => s.summary).join('\n');
    return `[历史事件摘要]\n${formattedSummaries}`;
  }

  private async applyContextUpdate(
    saveId: string,
    data: ContextUpdateData,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const existing = await this.agentContextRepo.getContext(saveId, 'story', trx);

    if (existing) {
      const currentState =
        typeof existing.state === 'string' ? JSON.parse(existing.state) : existing.state;
      const currentMessages =
        typeof existing.messages === 'string' ? JSON.parse(existing.messages) : existing.messages;

      const newState =
        data.state !== undefined ? { ...currentState, ...data.state } : currentState;
      const newMessages = data.messages !== undefined ? data.messages : currentMessages;

      await this.agentContextRepo.upsert(
        saveId,
        'story',
        JSON.stringify(newMessages),
        JSON.stringify(newState),
        trx,
      );
      return;
    }

    await this.agentContextRepo.upsert(
      saveId,
      'story',
      JSON.stringify(data.messages || []),
      JSON.stringify(data.state || {}),
      trx,
    );
  }
}
