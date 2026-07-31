import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';

export interface StoryContext {
  agentContext: Record<string, unknown> | null;
  saveInfo: {
    chapter: string | null;
    location: string | null;
    main_quest: string | null;
    level: number | null;
  } | null;
  compressionSummaries?: string;
}

export interface StoryEventInput {
  event_type: string;
  title: string;
  description?: string;
  importance?: 'critical' | 'major' | 'minor';
  chapter?: string;
  participants?: string[];
  impact?: Record<string, unknown>;
}

export interface StoryEvent {
  id: string;
  save_id: string;
  chapter: string;
  event_type: string;
  title: string;
  description: string;
  importance: 'critical' | 'major' | 'minor';
  participants: string;
  impact: string;
  timestamp: number;
}

export interface ChapterInfo {
  chapter: string | null;
  level: number | null;
  mainQuest: string | null;
}

export interface ContextUpdateData {
  state?: Record<string, unknown>;
  messages?: unknown[];
}

export interface AdvanceChapterResult {
  previousChapter: string;
  currentChapter: string;
}

/**
 * Story 领域事件读写端口接口。
 * D-S3-2: story_events 表归 story 领域，EventService 通过此端口统一读写。
 * S3-1 阶段 StoryService 实现此接口（完整 Repository 化在 S4）。
 * D9: 支持 trx 参数，供 EventService.resolveTrigger 事务内调用。
 */
export interface IStoryEventWriter {
  /**
   * 写入故事事件（覆盖 EventService L618/L849 跨服务调用）。
   * 原 EventService 通过 this.getStoryService(db).addStoryEvent() 调用，
   * S3-1 统一为通过此端口调用。
   * 含去重逻辑（同 saveId+chapter+event_type+title 复用已有事件）。
   */
  addStoryEvent(saveId: string, event: StoryEventInput, trx?: Knex.Transaction): Promise<StoryEvent>;

  /**
   * 查询故事事件（覆盖 EventService L598 直接 SELECT story_events）。
   * D-S3-2: 移除 EventService 直接 SELECT story_events，统一通过此端口读取。
   * 返回 StoryEvent（story 领域类型，participants/impact 为 JSON 字符串）。
   */
  getStoryEvents(saveId: string, options?: { chapter?: string; limit?: number }, trx?: Knex.Transaction): Promise<StoryEvent[]>;
}

// === S4 新增：Repository 端口接口（D7 拆分） ===

/**
 * story_events 表 Row 类型（数据库行结构）。
 * JSON 字段在 Row 中声明为 string，Repository 内部 rowToEntity 负责 JSON.parse。
 */
export interface StoryEventRow {
  id: string;
  save_id: string;
  chapter: string;
  event_type: string;
  title: string;
  description: string;
  importance: string;
  participants: string;    // JSON 字符串，Repository 内部 rowToEntity 负责 JSON.parse
  impact: string;
  timestamp: number;
}

/**
 * agent_contexts 表 Row 类型（数据库行结构，migration 004）。
 * messages + state 为两个独立 JSON 字符串字段，Repository 直接透传 string，
 * 由消费方（Service 层）负责 JSON.parse/JSON.stringify。
 * Row 类型单一化：JSON 字段在 Row 中声明为 string。
 */
export interface AgentContextRow {
  id: string;
  save_id: string;
  agent_type: string;
  messages: string;    // JSON 字符串，默认 '[]'
  state: string;       // JSON 字符串，默认 '{}'
  updated_at: number;
}

/**
 * Story 领域事件 Repository 端口接口（story_events 表）。
 * D7: 一表一 Repository，本接口只操作 story_events 表，禁止跨领域表访问。
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 *
 * 方法扩展记录（2026-07-09）：
 * 原 4 方法无法覆盖 StoryService(19 处) 实际 db 调用，扩展为 6 方法：
 * - findExistingEvent — addStoryEvent 去重检查
 * - getStoryEvents 扩展签名为 options 模式（chapter 过滤 + limit + offset 分页）
 */
export interface IStoryEventRepository {
  /** 插入故事事件，返回新事件 ID。 */
  addStoryEvent(saveId: ID, event: Omit<StoryEventRow, 'id' | 'save_id' | 'timestamp'>, trx?: Knex.Transaction): Promise<string>;

  /**
   * 查询故事事件（支持 chapter 过滤 + limit + offset 分页）。
   * StoryService.getHistory 使用 offset + limit 分页，StoryService.getStoryEvents 使用 chapter + limit 过滤。
   * options.offset 默认 0，options.limit 不传则不限制。
   */
  getStoryEvents(saveId: ID, options?: { chapter?: string; limit?: number; offset?: number }, trx?: Knex.Transaction): Promise<StoryEventRow[]>;

  /** 去重检查：查询是否已存在相同 saveId + chapter + event_type + title 的事件。 */
  findExistingEvent(saveId: ID, chapter: string, eventType: string, title: string, trx?: Knex.Transaction): Promise<StoryEventRow | null>;

  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  // === S6 新增（StoryKernel 跨方法复用） ===
  /** 获取最近 N 条事件的 title + description（用于 LLM 修正叙事上下文） */
  getRecentForNarrative(saveId: ID, limit: number, trx?: Knex.Transaction): Promise<Array<{ title: string; description: string }>>;
  /** 统计指定时间戳之后的事件数（用于本轮事件计数，timestamp 列） */
  countSince(saveId: ID, sinceTimestamp: number, trx?: Knex.Transaction): Promise<number>;
}

/**
 * Story 领域 Agent 上下文 Repository 端口接口（agent_contexts 表）。
 * D7: 一表一 Repository，本接口只操作 agent_contexts 表，禁止跨领域表访问。
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 *
 * messages + state 为两个独立 JSON 字符串字段，Repository 只做 CRUD 透传，
 * 不负责 JSON 解析或合并（合并逻辑属于 Service 层职责）。
 */
export interface IAgentContextRepository {
  /** 读取指定 agent 的上下文行（messages + state 为 JSON 字符串）。 */
  getContext(saveId: ID, agentType: string, trx?: Knex.Transaction): Promise<AgentContextRow | null>;

  /** Upsert：插入或更新 messages + state（ON CONFLICT (save_id, agent_type) MERGE）。 */
  upsert(saveId: ID, agentType: string, messages: string, state: string, trx?: Knex.Transaction): Promise<void>;

  /** 删除指定 saveId 的所有 agent 上下文（rollbackSave 使用）。 */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

// ============================================================================
// S6 新增：pacing Repository 端口接口（D7 一表一 Repository）
// ============================================================================

/**
 * pacing_config 表 Row 类型（数据库行结构）。
 * JSON 字段在 Row 中声明为 string，Repository 内部 rowToEntity 负责 JSON.parse。
 */
export interface PacingConfigRow {
  id: number;
  save_id: string;
  tension_range: string;         // JSON
  tension_weights: string;       // JSON
  density_params: string;        // JSON
  progress_params: string;       // JSON
  stage_thresholds: string;      // JSON
  pacing_interval: number;
  generated_by: string;
  template_context_hash: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * pacing_history 表 Row 类型（数据库行结构）。
 * JSON 字段在 Row 中声明为 string，Repository 内部 rowToEntity 负责 JSON.parse。
 */
export interface PacingHistoryRow {
  id: number;
  save_id: string;
  round_number: number;
  deterministic_value: number;
  llm_adjusted_value: number | null;
  adjustment_reason: string | null;
  factors: string;               // JSON
  stage: string;
  event_count: number;
  main_quest_progress: number | null;
  is_calculation_round: number;  // 0 | 1
  created_at: number;
}

/**
 * pacing_config 表 Repository 端口接口。
 * D7: 一表一 Repository，本接口只操作 pacing_config 表，禁止跨领域表访问。
 * D9: 所有写操作支持可选 trx 参数。
 * 覆盖 StoryKernel 全部 pacing_config 表 db 调用（5 处）。
 */
export interface IPacingRepository {
  /** 获取指定存档的完整 pacing_config 行 */
  getConfig(saveId: ID, trx?: Knex.Transaction): Promise<PacingConfigRow | null>;
  /** 获取 template_context_hash 字段（用于变更检测） */
  getTemplateContextHash(saveId: ID, trx?: Knex.Transaction): Promise<string | null>;
  /** 获取 updated_at 字段（用于距上次生成的轮次计算） */
  getUpdatedAt(saveId: ID, trx?: Knex.Transaction): Promise<number | null>;
  /** 插入新的 pacing_config 行 */
  insert(saveId: ID, row: Omit<PacingConfigRow, 'id' | 'save_id' | 'created_at' | 'updated_at'>, trx?: Knex.Transaction): Promise<void>;
  /** 更新 pacing_config 行（部分字段） */
  update(saveId: ID, row: Partial<Omit<PacingConfigRow, 'id' | 'save_id' | 'created_at'>>, trx?: Knex.Transaction): Promise<void>;
}

/**
 * pacing_history 表 Repository 端口接口。
 * D7: 一表一 Repository，本接口只操作 pacing_history 表，禁止跨领域表访问。
 * D9: 所有写操作支持可选 trx 参数。
 * 覆盖 StoryKernel 全部 pacing_history 表 db 调用（9 处）。
 */
export interface IPacingHistoryRepository {
  /** 统计指定时间戳之后的记录数（用于距上次生成的轮次计算） */
  countSince(saveId: ID, sinceTimestamp: number, trx?: Knex.Transaction): Promise<number>;
  /** 获取最近 N 条记录的 factors 字段（用于冷却期检测） */
  getRecentFactors(saveId: ID, limit: number, trx?: Knex.Transaction): Promise<PacingHistoryRow[]>;
  /** 获取最大轮次号 */
  getMaxRoundNumber(saveId: ID, trx?: Knex.Transaction): Promise<number>;
  /** 获取最后一条记录 */
  getLast(saveId: ID, trx?: Knex.Transaction): Promise<PacingHistoryRow | null>;
  /** 获取最后一条计算轮记录 */
  getLastCalculationRound(saveId: ID, trx?: Knex.Transaction): Promise<PacingHistoryRow | null>;
  /** 获取最近 N 条记录 */
  getRecent(saveId: ID, limit: number, trx?: Knex.Transaction): Promise<PacingHistoryRow[]>;
  /** 插入新的 pacing_history 记录 */
  insert(saveId: ID, row: Omit<PacingHistoryRow, 'id' | 'save_id' | 'created_at'>, trx?: Knex.Transaction): Promise<void>;
  /** 获取最后一条记录的 created_at（用于统计本轮事件数） */
  getCreatedAtOfLast(saveId: ID, trx?: Knex.Transaction): Promise<number | null>;
  /** 清理旧记录，保留最近 keepCount 条 */
  cleanOld(saveId: ID, keepCount: number, trx?: Knex.Transaction): Promise<void>;
}
