import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../shared/src/types/core.js';
import type { AgentType, DecisionLog } from '../../../shared/src/types/agent.js';
import { randomUUID } from 'crypto';

/**
 * 系统级 save_id 常量集合
 * 这些值不需要关联 saves 表中的记录，用于系统级决策日志记录
 */
const SYSTEM_SAVE_IDS: ReadonlySet<string> = new Set(['default', 'system']);

// const logger = createChildLogger('decision-log');

export interface DecisionLogQueryOptions {
  page?: number;
  pageSize?: number;
  agentType?: AgentType;
  decisionType?: string;
  startDate?: Timestamp;
  endDate?: Timestamp;
  minConfidence?: number;
  maxConfidence?: number;
}

export interface PaginatedDecisionLogs {
  data: DecisionLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class DecisionLogService {
  private db: Knex;
  private logger: ReturnType<typeof createChildLogger>;

  constructor(db: Knex) {
    this.db = db;
    this.logger = createChildLogger('decision-log');
  }

  /**
   * 判断 save_id 是否为有效的存档ID
   * 系统级 save_id（如 'default'、'system'）被视为有效，无需关联 saves 表
   * 非 null 且非系统级的 save_id 需要在 saves 表中存在才被视为有效
   *
   * @param saveId - 待验证的存档ID
   * @returns true 表示有效，false 表示无效（save_id 在 saves 表中不存在）
   */
  async isValidSaveId(saveId: ID | null | undefined): Promise<boolean> {
    // null 或 undefined 视为有效（nullable 字段允许为空）
    if (saveId === null || saveId === undefined) {
      return true;
    }

    // 系统级 save_id 无需关联 saves 表
    if (SYSTEM_SAVE_IDS.has(String(saveId))) {
      return true;
    }

    // 非 null 且非系统级，需要验证在 saves 表中存在
    const save = await this.db('saves').where({ id: saveId }).first();
    return !!save;
  }

  async logDecision(
    saveId: ID,
    agentType: AgentType,
    decisionType: string,
    input: unknown,
    reasoning: string,
    output: unknown,
    confidence: number = 1.0
  ): Promise<void> {
    try {
      // 应用层校验：当 save_id 非系统级值时，验证该 save_id 在 saves 表中存在
      // 校验失败仅记录警告，不阻止写入（避免影响主流程）
      if (saveId !== null && saveId !== undefined && !SYSTEM_SAVE_IDS.has(String(saveId))) {
        const saveExists = await this.db('saves').where({ id: saveId }).first();
        if (!saveExists) {
          this.logger.debug('save_id not yet in saves table, writing decision log anyway', {
            saveId,
            agentType,
            decisionType,
          });
        }
      }

      const now = Date.now() as Timestamp;

      await this.db('decision_logs').insert({
        id: randomUUID() as ID,
        save_id: saveId,
        agent_type: agentType,
        decision_type: decisionType,
        input: JSON.stringify(input),
        reasoning: reasoning,
        decision: JSON.stringify(output),
        confidence: Math.max(0, Math.min(1, confidence)),
        timestamp: now,
      });

      this.logger.debug('Decision logged', {
        saveId,
        agentType,
        decisionType,
        confidence,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to log decision', {
        saveId,
        agentType,
        decisionType,
        error: errorMessage,
      });
      // Don't throw - logging failures should not disrupt the main flow
      this.logger.warn('Decision logging failed silently');
    }
  }

  async getDecisions(
    saveId: ID,
    options: DecisionLogQueryOptions = {}
  ): Promise<PaginatedDecisionLogs> {
    try {
      const page = options.page || 1;
      const pageSize = options.pageSize || 20;
      const offset = (page - 1) * pageSize;

      let query = this.db('decision_logs')
        .where({ save_id: saveId });

      // Apply filters
      if (options.agentType) {
        query = query.where({ agent_type: options.agentType });
      }

      if (options.decisionType) {
        query = query.where({ decision_type: options.decisionType });
      }

      if (options.startDate !== undefined) {
        query = query.where('timestamp', '>=', options.startDate);
      }

      if (options.endDate !== undefined) {
        query = query.where('timestamp', '<=', options.endDate);
      }

      if (options.minConfidence !== undefined) {
        query = query.where('confidence', '>=', options.minConfidence);
      }

      if (options.maxConfidence !== undefined) {
        query = query.where('confidence', '<=', options.maxConfidence);
      }

      // Get total count
      const [{ total }] = await query
        .clone()
        .count('* as total');

      // Get paginated results
      const rows = await query
        .orderBy('timestamp', 'desc')
        .offset(offset)
        .limit(pageSize)
        .select();

      const decisions: DecisionLog[] = rows.map((row) => ({
        id: row.id,
        save_id: row.save_id,
        agentType: row.agent_type as AgentType,
        decisionType: row.decision_type,
        input: JSON.parse(row.input),
        reasoning: row.reasoning,
        output: JSON.parse(row.decision),
        confidence: row.confidence,
        timestamp: row.timestamp as Timestamp,
      }));

      const totalPages = Math.ceil(Number(total) / pageSize);

      this.logger.debug('Decisions retrieved', {
        saveId,
        page,
        pageSize,
        total: Number(total),
        returnedCount: decisions.length,
      });

      return {
        data: decisions,
        total: Number(total),
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get decisions', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async getDecisionsByAgent(
    saveId: ID,
    agentType: AgentType
  ): Promise<DecisionLog[]> {
    try {
      const rows = await this.db('decision_logs')
        .where({
          save_id: saveId,
          agent_type: agentType,
        })
        .orderBy('timestamp', 'desc')
        .select();

      const decisions: DecisionLog[] = rows.map((row) => ({
        id: row.id,
        save_id: row.save_id,
        agentType: row.agent_type as AgentType,
        decisionType: row.decision_type,
        input: JSON.parse(row.input),
        reasoning: row.reasoning,
        output: JSON.parse(row.decision),
        confidence: row.confidence,
        timestamp: row.timestamp as Timestamp,
      }));

      this.logger.debug('Agent decisions retrieved', {
        saveId,
        agentType,
        count: decisions.length,
      });

      return decisions;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get decisions by agent', {
        saveId,
        agentType,
        error: errorMessage,
      });
      throw error;
    }
  }

  async getRecentDecisions(
    saveId: ID,
    count: number = 10
  ): Promise<DecisionLog[]> {
    try {
      const rows = await this.db('decision_logs')
        .where({ save_id: saveId })
        .orderBy('timestamp', 'desc')
        .limit(count)
        .select();

      const decisions: DecisionLog[] = rows.map((row) => ({
        id: row.id,
        save_id: row.save_id,
        agentType: row.agent_type as AgentType,
        decisionType: row.decision_type,
        input: JSON.parse(row.input),
        reasoning: row.reasoning,
        output: JSON.parse(row.decision),
        confidence: row.confidence,
        timestamp: row.timestamp as Timestamp,
      }));

      this.logger.debug('Recent decisions retrieved', {
        saveId,
        count: decisions.length,
        requestedCount: count,
      });

      return decisions;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get recent decisions', {
        saveId,
        count,
        error: errorMessage,
      });
      throw error;
    }
  }

  async clearDecisions(saveId: ID): Promise<void> {
    try {
      await this.db('decision_logs')
        .where({ save_id: saveId })
        .delete();

      this.logger.info('Decisions cleared', { saveId });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to clear decisions', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }
}
