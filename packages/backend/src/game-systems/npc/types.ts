import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';

export interface NPCProfile {
  id: ID;
  saveId: ID;
  templateNpcId: string | null;
  name: string;
  title: string;
  description: string;
  role: string;
  race: string;
  locationId: string | null;
  level: number;
  services: Array<{ type: string; name: string }>;
  dialogueHistory: Array<{
    speaker: string;
    content: string;
    emotion: string;
    /** 消息类型（player/npc/narrator/system），dialogue 域写入，npc 域 opaque 透传。
     *  可选：旧数据可能不含此字段。 */
    messageType?: string;
    timestamp: Timestamp;
  }>;
  inParty: boolean;
  joinedPartyAt: Timestamp | null;
  reputation: number;
  mood: number;
  visible: boolean;
  visibility?: NPCVisibility;
  attrInitialized: boolean;
  invInitialized: boolean;
  skillInitialized: boolean;
  relation?: string;
  customData: Record<string, unknown>;
  currency: Record<string, number>;
  attributes: Record<string, unknown>;
  derivedAttributes: Record<string, unknown>;
  currentHp: number | null;
  maxHp: number | null;
  currentMp: number | null;
  maxMp: number | null;
  /** 13.2 时间戳兼容：实体引用解析时优先匹配相同时间戳数据 */
  createdAt: number;
}

export interface NPCVisibility {
  attributes: 'hidden' | 'vague' | 'visible';
  hpMp: 'hidden' | 'bar_only' | 'visible';
  equipment: 'hidden' | 'outline' | 'visible';
  inventory: 'hidden' | 'count_only' | 'visible';
  skills: 'hidden' | 'category' | 'visible';
}

export interface PartyMember {
  npcId: ID;
  name: string;
  role: string;
  level: number;
  joinedAt: Timestamp | null;
}

export interface NPCStatusPanel {
  basicInfo: {
    name: string;
    title: string;
    race: string;
    raceName: string;
    role: string;
    level: number;
  };
  location: {
    locationId: string | null;
    locationName: string | null;
  };
  // 模块2 简化：删除 relations 字段（关系数据由 EntityGraphPort.getNpcProfile 查询）
  partyStatus: {
    inParty: boolean;
    joinedAt: Timestamp | null;
  };
  availableServices: Array<{
    type: string;
    name: string;
    /** 模块2 简化：unlocked 恒 true（服务解锁不再依赖关系数据，所有 NPC 服务默认解锁） */
    unlocked: true;
  }>;
  attributes: Record<string, unknown>;
  derivedAttributes: Record<string, unknown>;
  currentHp: number | null;
  maxHp: number | null;
  currentMp: number | null;
  maxMp: number | null;
  attrInitialized: boolean;
  invInitialized: boolean;
  skillInitialized: boolean;
  visibility?: NPCVisibility;
}

// V6: NPC记忆系统接口
export interface NPCMemory {
  id: ID;
  content: string;
  type: 'interaction' | 'quest' | 'trade' | 'combat' | 'event' | 'secret';
  importance: number; // 1-5, 5最重要
  timestamp: Timestamp;
  tags: string[];
}

// 模块3 简化：删除 NPCKnowledge interface（NPCKnowledge 已迁移到 PERCEIVES 感知边的 awarenessScore/awarenessNote 字段）
// 原 NPCKnowledge 为 `{ [key: string]: unknown }` 类型，现由 EntityEdgeProperties.awarenessNote 替代

export interface MemoryCompressionResult {
  success: boolean;
  beforeCount: number;
  afterCount: number;
  compressedCount: number;
  protectedCount: number;
  compressionRatio: number;
  summaries: Array<{
    originalType: string;
    mergedCount: number;
    summaryContent: string;
    timeRange: { start: Timestamp; end: Timestamp };
    preservedTags: string[];
  }>;
  error?: string;
}

export interface CompressOptions {
  timeWindowMs?: number;
  protectThreshold?: number;
  maxSummaryLength?: number;
}

// NPC Richness: 驱动力与目标系统
export interface DriveProfile {
  survival: number;
  social: number;
  ambition: number;
  knowledge: number;
  duty: number;
  creativity: number;
}

export interface MoveResult {
  success: boolean;
  fromLocationId: string | null;
  toLocationId: string;
  distance: number;
  followersMoved: string[];
}

export type GoalCategory = 'survival' | 'wealth' | 'power' | 'knowledge' | 'relationship' | 'duty' | 'creative' | 'freedom';

export interface NPCGoal {
  id: string;
  saveId: string;
  npcId: string;
  type: 'long_term' | 'mid_term';
  category: GoalCategory;
  description: string;
  priority: number;
  status: 'active' | 'completed' | 'abandoned' | 'blocked' | 'archived';
  relatedEntityIds: string[];
  progress: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 单个 NPC 的初始化状态查询结果（P0-1 批量初始化优化）。
 * true = 需要初始化（init flag = 0），false = 已初始化（init flag = 1）。
 * 与现有 ensure_*_initialized 返回值语义一致。
 */
export interface NpcInitStatus {
  npcId: ID;
  attrNeedsInit: boolean;
  invNeedsInit: boolean;
  skillNeedsInit: boolean;
}

/**
 * 批量标记 NPC 初始化状态的更新项（P0-1 批量初始化优化）。
 * 未提供的字段（undefined）保持原状态不变，仅更新提供的字段为 true。
 */
export interface NpcInitUpdate {
  npcId: ID;
  attrInitialized?: boolean;
  invInitialized?: boolean;
  skillInitialized?: boolean;
}

// ============================================================================
// Repository 端口接口（S2-1b 新增，D7 一表一 Repository）
// ============================================================================

/**
 * NPC 领域 Repository 端口接口（npcs 表）。
 * D7: 一表一 Repository，本接口只操作 npcs 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 */
export interface INPCRepository {
  // === 查询 ===
  /** 列出存档下所有 NPC（覆盖 listNPCs L60，支持可见性过滤） */
  findBySaveId(saveId: ID, options?: { visibility?: 'all' | 'visible' | 'hidden' }, trx?: Knex.Transaction): Promise<NPCProfile[]>;
  /** 按 ID 查询单个 NPC（覆盖 getNPC L120 + resolveNpcId L145 byId 分支） */
  findById(npcId: ID, saveId: ID, trx?: Knex.Transaction): Promise<NPCProfile | null>;
  /** 按名称精确查询（覆盖 resolveNpcId L155 byName 分支 + createNPC L901 重名检查） */
  findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<NPCProfile | null>;
  /** 按 templateNpcId 查询（覆盖 resolveNpcId L150 byTemplateId 分支） */
  findByTemplateNpcId(saveId: ID, templateNpcId: string, trx?: Knex.Transaction): Promise<NPCProfile | null>;
  /** 按名称包含匹配查询（覆盖 resolveNpcId L160 byNameContains 分支） */
  findByNameContaining(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<NPCProfile[]>;
  /** 按 ID 列表批量查询（覆盖 getNPCNamesByIds L114 的 NPC 查询需求） */
  findByIds(npcIds: ID[], trx?: Knex.Transaction): Promise<NPCProfile[]>;
  /** 查询 NPC id+name 映射（覆盖 getNPCNamesByIds L112） */
  findNamesByIds(npcIds: ID[], trx?: Knex.Transaction): Promise<Map<ID, string>>;
  /** 按地点批量查 NPC 摘要（覆盖 getNPCsByLocationIds L89） */
  findSummariesByLocationIds(saveId: ID, locationIds: ID[], trx?: Knex.Transaction): Promise<Array<{
    id: string;
    name: string;
    role: string;
    locationId: string;
    services: string | null;
    reputation: number;
    mood: string | null;
    inParty: boolean;
    title: string | null;
  }>>;
  /** 查询队伍成员完整数据（覆盖 getParty L403） */
  findPartyMembers(saveId: ID, trx?: Knex.Transaction): Promise<NPCProfile[]>;
  /** 查询队伍成员 ID（覆盖 moveCharacterTo L705 + quickTravelTo L774 队伍跟随） */
  findPartyMemberIds(saveId: ID, trx?: Knex.Transaction): Promise<ID[]>;
  /** 查询某地点下的 NPC（覆盖 getNPCsByLocation L183） */
  findByLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<NPCProfile[]>;
  // === 写入 ===
  /** 新增 NPC（覆盖 createNPC L950 insert） */
  insert(npc: Omit<NPCProfile, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<NPCProfile>;
  /** 更新 NPC 字段（覆盖 updateNPC L630 + addToParty/removeFromParty/moveNpc + markXxxInitialized） */
  update(npcId: ID, saveId: ID, patch: Partial<NPCProfile>, trx?: Knex.Transaction): Promise<NPCProfile | null>;
  /** 批量更新 NPC 位置（覆盖 moveCharacterTo L709 + quickTravelTo L778 队伍 NPC 跟随） */
  updateLocationForNpcs(saveId: ID, npcIds: ID[], locationId: ID, trx?: Knex.Transaction): Promise<number>;
  /** 更新 NPC custom_data 字段（覆盖 addMemory/addKnowledge/compressMemories/updateNPCDisposition 的 custom_data 写入） */
  updateCustomData(npcId: ID, saveId: ID, customData: Record<string, unknown>, trx?: Knex.Transaction): Promise<NPCProfile | null>;
  /** 更新初始化标记（覆盖 markAttrInitialized/markInvInitialized/markSkillInitialized） */
  updateInitFlag(npcId: ID, saveId: ID, field: 'attrInitialized' | 'invInitialized' | 'skillInitialized', trx?: Knex.Transaction): Promise<void>;
  /** 查询初始化标记（覆盖 ensureAttrInitialized/ensureInvInitialized/ensureSkillInitialized） */
  findInitFlag(npcId: ID, saveId: ID, field: 'attrInitialized' | 'invInitialized' | 'skillInitialized', trx?: Knex.Transaction): Promise<boolean>;
  /** 删除 NPC */
  delete(npcId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean>;
  /**
   * 按 saveId 删除所有 NPC（rollbackSave 回滚存档时清理 npcs 表）。
   * S4-D6: 统一返回 Promise<void>。D9: 支持可选 trx 参数。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  /** 统计存档下 NPC 数量（GameInitService.getInitializationStatus 跨领域 count） */
  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
}

/**
 * NPC 目标 Repository 端口接口（npc_goals 表）。
 * D7: 一表一 Repository，本接口只操作 npc_goals 表。
 */
export interface INPCGoalRepository {
  /** 查询 NPC 的目标列表（覆盖 getGoals L1532，支持状态过滤） */
  findBySaveIdAndNpcId(saveId: ID, npcId: ID, options?: { status?: string }, trx?: Knex.Transaction): Promise<NPCGoal[]>;
  /** 新增目标（覆盖 createGoal L1500） */
  insert(goal: Omit<NPCGoal, 'id' | 'createdAt' | 'updatedAt'>, trx?: Knex.Transaction): Promise<NPCGoal>;
  /** 更新目标（覆盖 updateGoal L1517） */
  update(saveId: ID, goalId: ID, patch: Partial<NPCGoal>, trx?: Knex.Transaction): Promise<void>;
}

// ============================================================================
// Service 端口接口（从 agents/types.ts 迁入，D-S2-2）
// ============================================================================

/**
 * NPC 领域 Service 端口接口。
 * 从 agents/types.ts 迁入 npc/types.ts（D-S2-2 一致性，与 IMapService 位置统一）。
 * S2-3 扩展 3 个方法供 SkillService 跨领域调用。
 */
export interface INPCService {
  // === 原有方法（agents 层 + npc 域内使用） ===
  listNPCs(saveId: ID, visibility?: 'all' | 'visible' | 'hidden'): Promise<NPCProfile[]>;
  getNPCsByLocationIds(saveId: ID, locationIds: ID[]): Promise<Array<{
    id: string;
    name: string;
    role: string;
    locationId: string;
    services: string | null;
    reputation: number;
    mood: string | null;
    inParty: boolean;
    title: string | null;
  }>>;
  getNPCNamesByIds(npcIds: ID[]): Promise<Map<ID, string>>;
  getNPC(saveId: ID, npcId: ID): Promise<NPCProfile>;
  getActiveGoals(saveId: string, npcId: string): Promise<NPCGoal[]>;
  compressMemories(saveId: ID, npcId: ID, options?: CompressOptions, trx?: Knex.Transaction): Promise<MemoryCompressionResult>;
  // === S2-3 新增（skill 跨领域调用） ===
  /** 修改 NPC 资源（mp/hp/stamina/currency，覆盖 SkillService.deductResource NPC 分支） */
  modifyNpcResource(saveId: ID, npcId: ID, resourceType: 'mp' | 'hp' | 'stamina' | 'currency', delta: number, trx?: Knex.Transaction): Promise<void>;
  /** 查询 NPC 当前资源量（覆盖 SkillService.getCurrentResourceAmount NPC 分支） */
  getNpcResources(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<{
    currentMp: number | null;
    currentHp: number | null;
    currentStamina: number | null;
    currency: Record<string, number>;
  }>;
  /** 查询 NPC 属性（覆盖 SkillService.useSkill 取 npc.attributes 算伤害缩放） */
  getNpcAttributes(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<Record<string, unknown>>;

  // === S3-1 Phase B 新增（quest 跨领域调用） ===
  /**
   * 解析 NPC ID 或名称为 NPC ID（覆盖原 QuestService.resolveNpcId L66/L71 直接访问 npcs 表）。
   * 依次尝试: 精确 ID → 模板 ID → 精确名称 → 名称包含匹配。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   * 失败抛异常（与原 QuestService.resolveNpcId 行为一致）。
   */
  resolveNpcId(saveId: ID, npcIdOrName: string, trx?: Knex.Transaction): Promise<string>;

  // === S3-3 新增（dialogue 跨领域调用） ===
  // 模块2 简化：删除 getPlayerRelation / changePlayerRelation 方法
  // （NPC_PARTY 不写关系，关系数据由 EntityGraphService.setRelationship 通过 PERCEIVES 边维护）

  /**
   * 追加 NPC 对话历史到 dialogue_history JSON 字段，含 max 50 截断
   * （覆盖 DialogueService.updateNPCDialogueHistoryWithTrx L924-970 trx('npcs') 读写）。
   * messageType 作为 opaque string 传入（NPC 域不感知 dialogue 的 MessageType 联合类型）。
   * D9: 支持 trx 透传，供 dialogue addDialogueMessage 事务内调用。
   */
  appendDialogueHistory(
    saveId: ID,
    npcId: ID,
    message: { speaker: string; content: string; emotion: string; messageType: string; timestamp: Timestamp },
    trx?: Knex.Transaction,
  ): Promise<void>;

  // === P0-1 新增（批量初始化优化） ===
  /**
   * 批量查询多个 NPC 的初始化状态（attr/inv/skill 三类 init flag）。
   * 一次调用替代多次 ensure_*_initialized 调用，减少 ReAct 迭代次数。
   * 返回结果与入参 npcIds 顺序一致。
   */
  batchCheckInitStatus(saveId: ID, npcIds: ID[]): Promise<NpcInitStatus[]>;

  /**
   * 批量标记 NPC 的初始化完成状态。
   * 一次调用替代多次 mark_*_initialized 调用，在事务内原子化执行。
   * 仅处理 NpcInitUpdate 中显式设为 true 的字段，undefined 字段保持原状态。
   */
  batchMarkInitialized(saveId: ID, updates: NpcInitUpdate[], trx?: Knex.Transaction): Promise<void>;

  /**
   * 修改 NPC 当前 HP（delta 增量，clamp 0~maxHp）。
   * 与 ICharacterService.modifyHealth 对称，供 SkillService.useSkill 应用伤害。
   * 支持 trx 透传，事务内执行避免 read-modify-write race condition。
   */
  modifyNpcHealth(
    saveId: ID,
    npcId: ID,
    delta: number,
    trx?: Knex.Transaction,
  ): Promise<{ previous: number; current: number; max: number }>;
}
