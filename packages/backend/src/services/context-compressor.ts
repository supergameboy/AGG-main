import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, generateDeterministicId } from '../../../shared/src/types/core.js';
import { LLMService } from '@ai-rpg/ai';
import { config } from '../utils/config.js';

const logger = createChildLogger('context-compressor');

interface StoryEvent {
  id: string;
  event_type: string;
  title: string;
  description: string;
  importance: string;
  chapter: string;
  participants: string;
  impact: string;
  timestamp: number;
}

interface CompressionResult {
  compressed: boolean;
  originalEventCount: number;
  retainedEventCount: number;
  summaryGenerated: boolean;
}

const COMPRESS_PROMPT = `你是一个游戏故事摘要生成器。你的任务是将一组游戏故事事件压缩为一段精炼的叙事摘要。

## 规则
1. 保留所有关键情节转折和重要决策
2. 保留涉及重要NPC的交互
3. 保留对后续剧情有影响的事件
4. 使用连贯的叙事风格，而非列表
5. 摘要长度控制在200-400字
6. 使用中文
7. 只输出摘要文本，不要输出其他内容

## 事件列表
{events}

## 输出
直接输出叙事摘要文本：`;

const DIALOGUE_COMPRESS_PROMPT = `你是一个游戏对话摘要生成器。你的任务是将一组游戏对话记录压缩为一段精炼的叙事摘要。

## 规则
1. 保留所有关键对话内容和重要决策
2. 保留涉及重要NPC的交互要点
3. 保留对后续剧情有影响的信息
4. 使用连贯的叙事风格
5. 摘要长度控制在200-400字
6. 使用中文
7. 只输出摘要文本，不要输出其他内容

## 对话记录
{events}

## 输出
直接输出叙事摘要文本：`;

export class ContextCompressor {
  private db: Knex;
  private llmService: LLMService;
  private eventThreshold: number;
  private retainRecentCount: number;

  constructor(db: Knex, llmService: LLMService, options?: { eventThreshold?: number; retainRecentCount?: number }) {
    this.db = db;
    this.llmService = llmService;
    const compressionConfig = config.contextCompression as { eventThreshold?: number; maxMessages?: number; retainRecentCount?: number } | undefined;
    this.eventThreshold = options?.eventThreshold ?? compressionConfig?.eventThreshold ?? 50;
    this.retainRecentCount = options?.retainRecentCount ?? compressionConfig?.retainRecentCount ?? 10;
  }

  async checkAndCompress(saveId: ID): Promise<CompressionResult> {
    try {
      const eventCount = await this.getEventCount(saveId);

      if (eventCount <= this.eventThreshold) {
        return { compressed: false, originalEventCount: eventCount, retainedEventCount: eventCount, summaryGenerated: false };
      }

      logger.info('Event threshold exceeded, starting compression', {
        saveId,
        eventCount,
        threshold: this.eventThreshold,
      });

      await this.compressDialogueHistory(saveId);

      return await this.compress(saveId);
    } catch (error) {
      logger.error('Compression check failed', {
        saveId,
        error: getErrorMessage(error),
      });
      return { compressed: false, originalEventCount: 0, retainedEventCount: 0, summaryGenerated: false };
    }
  }

  async compress(saveId: ID): Promise<CompressionResult> {
    try {
      const events = await this.getAllEvents(saveId);
      const originalCount = events.length;

      if (originalCount === 0) {
        return { compressed: false, originalEventCount: 0, retainedEventCount: 0, summaryGenerated: false };
      }

      const criticalEvents = events.filter(e => e.importance === 'critical');
      const recentEvents = events.slice(-this.retainRecentCount);
      const recentIds = new Set(recentEvents.map(e => e.id));
      const criticalNotInRecent = criticalEvents.filter(e => !recentIds.has(e.id));

      const eventsToCompress = events.filter(e =>
        e.importance !== 'critical' && !recentIds.has(e.id)
      );

      let summaryGenerated = false;

      if (eventsToCompress.length > 0) {
        const summary = await this.generateSummary(eventsToCompress);
        if (summary) {
          await this.saveSummaryAsContext(saveId, summary, eventsToCompress.length);
          summaryGenerated = true;
        }
      }

      const idsToDelete = eventsToCompress.map(e => e.id);
      if (idsToDelete.length > 0) {
        await this.db('story_events')
          .where({ save_id: saveId })
          .whereIn('id', idsToDelete)
          .delete();
      }

      const retainedCount = criticalNotInRecent.length + recentEvents.length;

      logger.info('Context compression completed', {
        saveId,
        originalCount,
        compressedCount: idsToDelete.length,
        retainedCount,
        criticalPreserved: criticalNotInRecent.length,
        recentPreserved: recentEvents.length,
        summaryGenerated,
      });

      return { compressed: true, originalEventCount: originalCount, retainedEventCount: retainedCount, summaryGenerated };
    } catch (error) {
      logger.error('Compression failed', {
        saveId,
        error: getErrorMessage(error),
      });
      return { compressed: false, originalEventCount: 0, retainedEventCount: 0, summaryGenerated: false };
    }
  }

  private async getEventCount(saveId: ID): Promise<number> {
    const result = await this.db('story_events')
      .where({ save_id: saveId })
      .count('* as count')
      .first();
    return parseInt(result?.count as string) || 0;
  }

  private async getAllEvents(saveId: ID): Promise<StoryEvent[]> {
    return await this.db('story_events')
      .where({ save_id: saveId })
      .orderBy('timestamp', 'asc');
  }

  private async generateSummary(events: StoryEvent[]): Promise<string | null> {
    try {
      const eventDescriptions = events.map(e => {
        const participants = e.participants ? JSON.parse(e.participants) : [];
        const participantStr = participants.length > 0 ? `（涉及：${participants.join('、')}）` : '';
        return `[${e.importance}][${e.event_type}] ${e.title}${e.description ? ' - ' + e.description : ''}${participantStr}`;
      }).join('\n');

      const prompt = COMPRESS_PROMPT.replace('{events}', eventDescriptions);

      const response = await this.llmService.chat(
        [
          { role: 'system', content: '你是一个游戏故事摘要生成器，专门将游戏事件历史压缩为精炼的叙事摘要。' },
          { role: 'user', content: prompt }
        ],
        { temperature: 0.3, maxTokens: 1024 }
      );

      const summary = response.content?.trim();
      if (!summary) {
        logger.warn('LLM returned empty summary');
        return null;
      }

      return summary;
    } catch (error) {
      logger.error('Failed to generate summary via LLM', {
        error: getErrorMessage(error),
        eventCount: events.length,
      });
      return null;
    }
  }

  private async saveSummaryAsContext(saveId: ID, summary: string, originalEventCount: number): Promise<void> {
    const existing = await this.db('agent_contexts')
      .where({ save_id: saveId, agent_type: 'story' })
      .first();

    const currentState = existing
      ? (typeof existing.state === 'string' ? JSON.parse(existing.state) : existing.state)
      : {};

    const summaries = currentState._compressionSummaries || [];
    summaries.push({
      summary,
      compressedEventCount: originalEventCount,
      compressedAt: Date.now(),
    });

    const newState = {
      ...currentState,
      _compressionSummaries: summaries,
      _lastCompressedAt: Date.now(),
    };

    if (existing) {
      await this.db('agent_contexts')
        .where({ save_id: saveId, agent_type: 'story' })
        .update({
          state: JSON.stringify(newState),
          updated_at: Date.now(),
        });
    } else {
      await this.db('agent_contexts').insert({
        id: generateDeterministicId('ctx', saveId, 'compressed'),
        save_id: saveId,
        agent_type: 'story',
        messages: JSON.stringify([]),
        state: JSON.stringify(newState),
        updated_at: Date.now(),
      });
    }
  }

  async compressDialogueHistory(saveId: ID): Promise<CompressionResult> {
    try {
      const dialogueCount = await this.db('dialogues')
        .where({ save_id: saveId })
        .count('id as count')
        .first();

      const count = (dialogueCount?.count as number) || 0;
      const dialogueThreshold = this.eventThreshold;

      if (count <= dialogueThreshold) {
        return { compressed: false, originalEventCount: count, retainedEventCount: count, summaryGenerated: false };
      }

      logger.info('Dialogue threshold exceeded, starting compression', {
        saveId,
        count,
        threshold: dialogueThreshold,
      });

      const retainCount = this.retainRecentCount;

      const oldDialogues = await this.db('dialogues')
        .where({ save_id: saveId })
        .orderBy('timestamp', 'asc')
        .limit(Math.max(0, count - retainCount));

      if (oldDialogues.length === 0) {
        return { compressed: false, originalEventCount: count, retainedEventCount: count, summaryGenerated: false };
      }

      const eventsText = oldDialogues.map((d: { speaker: string; content: string; timestamp: number }) =>
        `[${d.speaker}]: ${d.content}`
      ).join('\n');

      const prompt = DIALOGUE_COMPRESS_PROMPT.replace('{events}', eventsText);

      const response = await this.llmService.chat(
        [
          { role: 'system', content: '你是一个游戏对话摘要生成器，专门将游戏对话历史压缩为精炼的叙事摘要。' },
          { role: 'user', content: prompt }
        ],
        { temperature: 0.3, maxTokens: 1024 }
      );

      const summaryText = response.content?.trim() || '';

      if (summaryText) {
        await this.db('dialogue_summaries').insert({
          id: generateDeterministicId('dsum', saveId, 'summary'),
          save_id: saveId,
          summary: summaryText,
          original_count: oldDialogues.length,
          timestamp: Date.now() as number,
        }).onConflict('id').ignore();
      }

      const idsToDelete = oldDialogues.map((d: { id: string }) => d.id);
      if (idsToDelete.length > 0) {
        await this.db('dialogues')
          .where({ save_id: saveId })
          .whereIn('id', idsToDelete)
          .delete();
      }

      const retainedResult = await this.db('dialogues')
        .where({ save_id: saveId })
        .count('id as count')
        .first();

      return {
        compressed: true,
        originalEventCount: count,
        retainedEventCount: (retainedResult?.count as number) || 0,
        summaryGenerated: !!summaryText,
      };
    } catch (error) {
      logger.error('Dialogue compression failed', {
        saveId,
        error: getErrorMessage(error),
      });
      return { compressed: false, originalEventCount: 0, retainedEventCount: 0, summaryGenerated: false };
    }
  }
}
