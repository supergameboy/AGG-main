import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';

export type MessageType = 'player' | 'npc' | 'narrator' | 'system';

export interface DialogueMessage {
  id: ID;
  saveId: ID;
  npcId: ID | null;
  speaker: string;
  content: string;
  emotion: string;
  messageType: MessageType;
  timestamp: Timestamp;
}

export interface DialogueSession {
  sessionId: ID;
  saveId: ID;
  npcId: ID;
  startedAt: Timestamp;
  lastActivityAt: Timestamp;
  messageCount: number;
  currentTopic: string | null;
  emotions: Array<{
    emotion: string;
    count: number;
    percentage: number;
  }>;
}

export interface DialogueOption {
  id: ID;
  text: string;
  npcId: ID;
  requiresQuest?: string;
  requiresItem?: string;
  emotion?: string;
  nextTopic?: string;
  effects?: DialogueEffect[];
  response?: { emotion: string; responseTemplate: string };
}

export interface DialogueContext {
  npcName: string;
  npcRole: string;
  npcDisposition: string;
  recentMessages: DialogueMessage[];
  availableOptions: DialogueOption[];
  timeContext: {
    currentTime: Timestamp;
    lastDialogueTime: Timestamp | null;
    timeSinceLastDialogue: number | null;
  };
}

export interface CreateDialogueParams {
  saveId: ID;
  npcId?: ID;
  speaker: string;
  content: string;
  emotion?: string;
  messageType?: MessageType;
}

// V4: 条件检查结果接口
// 模块2 简化：删除 relation* 字段（NPC_PARTY 不再读关系数据）
export interface ConditionalCheckResult {
  available: boolean;
  optionId: ID;
  blockedReason?: string;
  requirements: {
    questCompleted?: boolean;
    questRequired?: string;
    itemOwned?: boolean;
    itemRequired?: string;
  };
}

// V5: 对话效果接口
// 模块2 简化：删除 'relation_change' 类型（NPC_PARTY 不再写关系数据，由 GM 通过 set_relationship 维护）
export interface DialogueEffect {
  type: 'quest_trigger' | 'item_grant' | 'topic_switch' | 'emotion_change';
  target?: string;
  value?: number | string;
  data?: Record<string, unknown>;
}

// V5: 对话选择处理结果接口
export interface DialogueChoiceResult {
  success: boolean;
  choiceId: ID;
  effectsApplied: DialogueEffect[];
  npcResponse?: DialogueMessage;
  newOptions?: DialogueOption[];
  error?: string;
}

// 所有NPC对话上下文摘要
// 模块2 简化：删除 playerRelationValue 字段（NPC_PARTY 不再读关系数据）
export interface DialogueContextSummary {
  npcId: ID;
  npcName: string;
  npcRole: string;
  recentMessageCount: number;
}

// ============================================================================
// S3-3: Repository 端口接口 + Record 类型
// ============================================================================

/**
 * dialogues 表记录类型（数据库 snake_case ↔ 实体 camelCase 映射的中间结构）。
 * Row 与 InsertInput 语义完全一致（dialogue 消息插入即最终形态，无 DB 生成字段），
 * 合并为单一类型避免 DRY 违规（code-standards §2.4）。
 */
export interface DialogueMessageRecord {
  id: ID;
  saveId: string;
  npcId: string | null;
  speaker: string;
  content: string;
  emotion: string;
  messageType: string;
  timestamp: number;
}

/**
 * Dialogue 领域 Repository 端口接口（dialogues 表）。
 * D7: 一表一 Repository，本接口只操作 dialogues 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 */
export interface IDialogueRepository {
  /** 分页查询对话历史（覆盖 getDialogueHistory L58） */
  findWithPagination(
    saveId: string,
    npcId: string | null,
    limit: number,
    offset: number,
    trx?: Knex.Transaction,
  ): Promise<{ rows: DialogueMessageRecord[]; total: number }>;

  /** 查询最近 N 条对话（覆盖 getRecentDialogue L100） */
  findRecent(
    saveId: string,
    npcId: string | null,
    count: number,
    trx?: Knex.Transaction,
  ): Promise<DialogueMessageRecord[]>;

  /** 按 saveId+npcId 统计数量（覆盖 createDialogueSession L194 + getDialogueContextForAll L353） */
  countBySaveIdAndNpcId(saveId: string, npcId: string | null, trx?: Knex.Transaction): Promise<number>;

  /** 查询全部对话按时间升序（覆盖 getDialogueSummary L395 + getEmotionTrend L528） */
  findAllBySaveId(saveId: string, npcId: string | null, trx?: Knex.Transaction): Promise<DialogueMessageRecord[]>;

  /** 搜索对话（覆盖 searchDialogues L466，支持 keyword/emotion/speaker 过滤） */
  search(
    saveId: string,
    filters: { keyword?: string; emotion?: string; speaker?: string },
    trx?: Knex.Transaction,
  ): Promise<DialogueMessageRecord[]>;

  /** 插入对话消息（覆盖 addDialogueMessage L160） */
  insert(message: DialogueMessageRecord, trx?: Knex.Transaction): Promise<void>;

  /** 删除对话历史（覆盖 clearDialogueHistory L492）。S4-D6: 统一返回 Promise<void>。 */
  deleteBySaveId(saveId: string, npcId: string | null, trx?: Knex.Transaction): Promise<void>;

  /** 按情绪分组统计（覆盖 getEmotionStatistics L977） */
  groupCountByEmotion(
    saveId: string,
    npcId: string,
    trx?: Knex.Transaction,
  ): Promise<Array<{ emotion: string; count: number }>>;
}

/**
 * IDialogueService 已删除（技术债出清）。
 *
 * dialogue 是叶子领域（出度 3 入度 0），无任何跨领域消费者。
 * DialogueService 类的 public 方法签名是事实契约，无需冗余端口接口。
 * 若未来引入真实跨领域消费方，再按需提取端口接口。
 */
