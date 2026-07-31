import type { Knex } from 'knex';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';

// ─── 领域实体类型（从 agents/memory/types.ts 迁移至业务层） ───

export type EpisodicMemoryType = 'plot' | 'relation' | 'quest' | 'item' | 'location' | 'skill' | 'combat' | 'dialogue';

export interface AgentEpisodicMemory {
  id: ID;
  saveId: ID;
  agentKey: string;
  content: string;
  type: EpisodicMemoryType;
  importance: number;         // 1-5
  relatedEntities: string[];
  tags: string[];
  turnIndex: number;
  createdAt: Timestamp;
}

export interface EpisodicRecallOptions {
  type?: EpisodicMemoryType;
  minImportance?: number;
  tags?: string[];
  timeRange?: { start: Timestamp; end: Timestamp };
  limit?: number;
}

export interface AgentProceduralMemory {
  id: ID;
  saveId: ID;
  agentKey: string;
  condition: string;
  action: string;
  outcome: string;
  effectiveness: number;      // 1-5
  usageCount: number;
  lastUsedAt: Timestamp | null;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProceduralRecallOptions {
  minEffectiveness?: number;
  tags?: string[];
  limit?: number;
}

// ─── Row 类型（数据库行结构，JSON 字段为 string） ───

export interface EpisodicMemoryRow {
  id: string;
  save_id: string;
  agent_key: string;
  content: string;
  type: string;
  importance: number;
  related_entities: string;  // JSON 字符串
  tags: string;              // JSON 字符串
  turn_index: number;
  created_at: number;
}

export interface ProceduralMemoryRow {
  id: string;
  save_id: string;
  agent_key: string;
  condition: string;
  action: string;
  outcome: string;
  effectiveness: number;
  usage_count: number;
  last_used_at: number | null;
  tags: string;  // JSON 字符串
  created_at: number;
  updated_at: number;
}

// ─── 端口接口 ───

/**
 * 情景记忆 Repository 端口接口（agent_episodic_memories 表）。
 * D7: 一表一 Repository。D9: 所有方法支持可选 trx 参数。
 */
export interface IEpisodicMemoryRepository {
  /** 检查表是否存在（兼容原 ensureTable 优雅降级） */
  tableExists(): Promise<boolean>;

  /** 插入单条记忆 */
  insert(
    saveId: ID,
    agentKey: string,
    row: Omit<EpisodicMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at'> & { id: string; created_at: number },
    trx?: Knex.Transaction,
  ): Promise<void>;

  /** 批量插入记忆 */
  insertBatch(
    saveId: ID,
    agentKey: string,
    rows: Array<Omit<EpisodicMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at'> & { id: string; created_at: number }>,
    trx?: Knex.Transaction,
  ): Promise<void>;

  /** 按 saveId + agentKey 查询，支持类型/重要性/标签/时间范围/数量过滤 */
  findBySaveIdAndAgent(
    saveId: ID,
    agentKey: string,
    options?: {
      type?: string;
      minImportance?: number;
      tags?: string;
      timeRange?: { start: number; end: number };
      limit?: number;
    },
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]>;

  /** 按 content LIKE 搜索 */
  searchByContent(
    saveId: ID,
    agentKey: string,
    query: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]>;

  /** 查询低重要性记忆（压缩用） */
  findLowImportance(
    saveId: ID,
    agentKey: string,
    threshold: number,
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]>;

  /** 计数 */
  countBySaveIdAndAgent(saveId: ID, agentKey: string, trx?: Knex.Transaction): Promise<number>;

  /** 按 ID 批量删除 */
  deleteByIds(saveId: ID, agentKey: string, ids: ID[], trx?: Knex.Transaction): Promise<number>;

  /** 按单条 ID 删除 */
  deleteById(saveId: ID, agentKey: string, id: ID, trx?: Knex.Transaction): Promise<boolean>;

  /** 按 saveId 删除全部 */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
}

/**
 * 程序化记忆 Repository 端口接口（agent_procedural_memories 表）。
 * D7: 一表一 Repository。D9: 所有方法支持可选 trx 参数。
 */
export interface IProceduralMemoryRepository {
  /** 检查表是否存在 */
  tableExists(): Promise<boolean>;

  /** 插入单条规则 */
  insert(
    saveId: ID,
    agentKey: string,
    row: Omit<ProceduralMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at' | 'updated_at'> & { id: string; created_at: number; updated_at: number },
    trx?: Knex.Transaction,
  ): Promise<void>;

  /** 按 saveId + agentKey 查询，支持最低有效性/数量过滤 */
  findBySaveIdAndAgent(
    saveId: ID,
    agentKey: string,
    options?: { minEffectiveness?: number; limit?: number },
    trx?: Knex.Transaction,
  ): Promise<ProceduralMemoryRow[]>;

  /** 按ID查单条 */
  findById(id: ID, trx?: Knex.Transaction): Promise<ProceduralMemoryRow | null>;

  /** 更新有效性 */
  updateEffectiveness(id: ID, effectiveness: number, updatedAt: number, trx?: Knex.Transaction): Promise<void>;

  /** 更新使用次数和最后使用时间 */
  updateUsage(id: ID, usageCount: number, lastUsedAt: number, updatedAt: number, trx?: Knex.Transaction): Promise<void>;

  /** 查询剪枝候选（低效 + 长期未用） */
  findPruneCandidates(
    saveId: ID,
    agentKey: string,
    minEffectiveness: number,
    maxAge: number,
    trx?: Knex.Transaction,
  ): Promise<ProceduralMemoryRow[]>;

  /** 计数 */
  countBySaveIdAndAgent(saveId: ID, agentKey: string, trx?: Knex.Transaction): Promise<number>;

  /** 按 ID 批量删除 */
  deleteByIds(ids: ID[], trx?: Knex.Transaction): Promise<number>;

  /** 按单条 ID 删除 */
  deleteById(saveId: ID, agentKey: string, id: ID, trx?: Knex.Transaction): Promise<boolean>;

  /** 按 saveId 删除全部 */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
}
