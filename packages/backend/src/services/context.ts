import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateDeterministicId } from '../../../shared/src/types/core.js';
import type { AgentType, AgentContext, LLMMessage } from '../../../shared/src/types/agent.js';
import { config } from '../utils/config.js';
import type { IContextCompressor, IContextProvider } from '../game-systems/shared/types.js';
import { findSafeCutIndex } from '../agents/runtime/context-manager.js';

// const logger = createChildLogger('context');

export class ContextService implements IContextCompressor, IContextProvider {
  private db: Knex;
  private logger: ReturnType<typeof createChildLogger>;

  constructor(db: Knex) {
    this.db = db;
    this.logger = createChildLogger('context');
  }

  async getContext(saveId: ID, agentType: AgentType): Promise<AgentContext> {
    try {
      const row = await this.db('agent_contexts')
        .where({ save_id: saveId, agent_type: agentType })
        .first();

      if (!row) {
        this.logger.debug('No context found, creating new one', {
          saveId,
          agentType,
        });

        const newContext: AgentContext = {
          agentType,
          messages: [],
          state: {},
          lastUpdate: Date.now() as Timestamp,
        };

        await this.saveContext(saveId, agentType, newContext);
        return newContext;
      }

      const context: AgentContext = {
        agentType: row.agent_type as AgentType,
        messages: JSON.parse(row.messages || '[]'),
        state: JSON.parse(row.state || '{}'),
        lastUpdate: row.updated_at as Timestamp,
      };

      this.logger.debug('Context loaded', {
        saveId,
        agentType,
        messageCount: context.messages.length,
      });

      return context;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get context', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async saveContext(
    saveId: ID,
    agentType: AgentType,
    context: Partial<AgentContext>
  ): Promise<void> {
    try {
      const now = Date.now() as Timestamp;
      const existing = await this.db('agent_contexts')
        .where({ save_id: saveId, agent_type: agentType })
        .first();

      const data = {
        messages: JSON.stringify(context.messages || []),
        state: JSON.stringify(context.state || {}),
        updated_at: now,
      };

      if (existing) {
        await this.db('agent_contexts')
          .where({ save_id: saveId, agent_type: agentType })
          .update(data);

        this.logger.debug('Context updated', { saveId, agentType });
      } else {
        await this.db('agent_contexts').insert({
          id: generateDeterministicId('ctx', saveId, agentType) as ID,
          save_id: saveId,
          agent_type: agentType,
          ...data,
        });

        this.logger.debug('Context created', { saveId, agentType });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to save context', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async updateMessages(
    saveId: ID,
    agentType: AgentType,
    messages: LLMMessage[]
  ): Promise<void> {
    try {
      const now = Date.now() as Timestamp;

      await this.db('agent_contexts')
        .where({ save_id: saveId, agent_type: agentType })
        .update({
          messages: JSON.stringify(messages),
          updated_at: now,
        });

      this.logger.debug('Messages updated', {
        saveId,
        agentType,
        messageCount: messages.length,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update messages', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async updateState(
    saveId: ID,
    agentType: AgentType,
    state: Record<string, unknown>
  ): Promise<void> {
    try {
      const now = Date.now() as Timestamp;
      const existing = await this.getContext(saveId, agentType);
      const mergedState = { ...existing.state, ...state };

      await this.db('agent_contexts')
        .where({ save_id: saveId, agent_type: agentType })
        .update({
          state: JSON.stringify(mergedState),
          updated_at: now,
        });

      this.logger.debug('State updated', {
        saveId,
        agentType,
        keys: Object.keys(state),
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update state', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async clearContext(saveId: ID, agentType?: AgentType): Promise<void> {
    try {
      if (agentType) {
        await this.db('agent_contexts')
          .where({ save_id: saveId, agent_type: agentType })
          .delete();

        this.logger.info('Context cleared for agent', { saveId, agentType });
      } else {
        await this.db('agent_contexts')
          .where({ save_id: saveId })
          .delete();

        this.logger.info('All contexts cleared for save', { saveId });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to clear context', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async getAllContexts(saveId: ID): Promise<Record<AgentType, AgentContext>> {
    try {
      const rows = await this.db('agent_contexts')
        .where({ save_id: saveId })
        .select();

      const contexts: Partial<Record<AgentType, AgentContext>> = {};

      for (const row of rows) {
        const agentType = row.agent_type as AgentType;
        contexts[agentType] = {
          agentType,
          messages: JSON.parse(row.messages || '[]'),
          state: JSON.parse(row.state || '{}'),
          lastUpdate: row.updated_at as Timestamp,
        };
      }

      this.logger.debug('All contexts loaded', {
        saveId,
        count: Object.keys(contexts).length,
      });

      return contexts as Record<AgentType, AgentContext>;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get all contexts', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async compressContext(
    saveId: ID,
    agentType: AgentType,
    maxMessages?: number
  ): Promise<void> {
    const compressionConfig = config.contextCompression as { eventThreshold?: number; maxMessages?: number; retainRecentCount?: number } | undefined;
    const effectiveMaxMessages = maxMessages ?? compressionConfig?.maxMessages ?? 100;
    try {
      const context = await this.getContext(saveId, agentType);

      if (context.messages.length <= effectiveMaxMessages) {
        this.logger.debug('Context compression not needed', {
          saveId,
          agentType,
          currentCount: context.messages.length,
          maxMessages: effectiveMaxMessages,
        });
        return;
      }

      const systemMessage = context.messages.find(m => m.role === 'system' && !m.content.startsWith('## 历史事件摘要'));
      const summaries = (context.state as Record<string, unknown>)?._compressionSummaries;
      const summaryMessage = this.buildCompressionSummaryMessage(summaries);
      const reservedCount = (systemMessage ? 1 : 0) + (summaryMessage ? 1 : 0);

      // M8 路径B（Q1-B 拍板）：裸 slice 截断会切断 tool_call ↔ tool_result 配对，
      // 复用 G 层 findSafeCutIndex 选安全切点（E 层依赖 G 层合规，§12.3）
      const pool = context.messages.filter(m => !m.content.startsWith('## 历史事件摘要'));
      const retainCount = Math.max(0, effectiveMaxMessages - reservedCount);
      const desiredCut = Math.max(0, pool.length - retainCount);
      const safeCut = findSafeCutIndex(pool, desiredCut);
      const recentMessages = pool.slice(safeCut);

      const compressedMessages: LLMMessage[] = [];
      if (systemMessage) {
        compressedMessages.push(systemMessage);
      }
      if (summaryMessage) {
        compressedMessages.push(summaryMessage);
      }
      compressedMessages.push(...recentMessages);

      await this.updateMessages(saveId, agentType, compressedMessages);

      this.logger.info('Context compressed', {
        saveId,
        agentType,
        originalCount: context.messages.length,
        newCount: compressedMessages.length,
        desiredCut,
        safeCut,
        cutAdjusted: safeCut !== desiredCut,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to compress context', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  private buildCompressionSummaryMessage(summaries: unknown): LLMMessage | null {
    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) return null;

    const summaryTexts = (summaries as Array<{ summary: string; compressedEventCount: number; compressedAt: number }>)
      .map((s, i) => `### 摘要 ${i + 1}（压缩了${s.compressedEventCount}个事件）\n${s.summary}`)
      .join('\n\n');

    return {
      role: 'system',
      content: `## 历史事件摘要\n\n以下是之前被压缩的游戏事件摘要：\n\n${summaryTexts}`
    };
  }

  async exportContext(saveId: ID): Promise<Record<string, unknown>> {
    try {
      const allContexts = await this.getAllContexts(saveId);

      const exportData: Record<string, unknown> = {
        saveId,
        exportedAt: Date.now(),
        contexts: {},
      };

      for (const [agentType, context] of Object.entries(allContexts)) {
        (exportData.contexts as Record<string, unknown>)[agentType] = {
          ...context,
          exportedAt: Date.now(),
        };
      }

      this.logger.info('Context exported', {
        saveId,
        agentTypes: Object.keys(allContexts),
      });

      return exportData;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to export context', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async importContext(
    saveId: ID,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      const contexts = data.contexts as Record<string, Partial<AgentContext>> | undefined;

      if (!contexts) {
        throw new Error('Invalid import data: missing contexts field');
      }

      for (const [agentTypeStr, context] of Object.entries(contexts)) {
        const agentType = agentTypeStr as AgentType;

        if (context && typeof context === 'object') {
          await this.saveContext(saveId, agentType, {
            messages: context.messages || [],
            state: context.state || {},
            lastUpdate: Date.now() as Timestamp,
          });
        }
      }

      this.logger.info('Context imported', {
        saveId,
        agentTypes: Object.keys(contexts),
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to import context', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }
}
