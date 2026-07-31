import { ID } from '../../../../shared/src/types/core.js';
import { SkillCostEntry } from '../../../../shared/src/types/game.js';
import type { SkillPoolEntry } from '../../../../shared/src/types/game.js';
import type { Knex } from 'knex';

export type SkillCategory = 'attack' | 'defense' | 'healing' | 'buff' | 'debuff' | 'utility' | 'passive';
export type SkillElement = 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark' | 'physical' | 'none';
export type CooldownSystemType = 'turn' | 'time' | 'none';
export type OwnerType = 'character' | 'npc';

export interface EntitySkill {
  id: ID;
  saveId: ID;
  skillId: string;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  experience: number;
  cooldownRemaining: number;
  category: SkillCategory;
  element: SkillElement;
  cost?: SkillCostEntry[];
  effects: Record<string, unknown>;
  customData: Record<string, unknown>;
  unlocked: boolean;
  visible: boolean;
  ownerType: OwnerType;
  ownerId: string;
  /** Number of consecutive uses (for weight cooldown) */
  consecutiveUses?: number;
  /** Last use timestamp/turn (for weight cooldown reset detection) */
  lastUsedAt?: number;
}

export type CharacterSkill = EntitySkill;

export interface LearnSkillResult {
  success: boolean;
  skill?: CharacterSkill;
  alreadyLearned?: boolean;
  warnings?: string[];
  error?: string;
}

export interface UpgradeSkillResult {
  success: boolean;
  previousLevel: number;
  newLevel: number;
  bonuses: Record<string, number>;
  error?: string;
}

export interface SkillTreeInfo {
  learnedSkills: CharacterSkill[];
  availableSkills: Array<{
    skillTemplateId: string;
    name: string;
    requirements: {
      levelRequired?: number;
      prerequisiteSkills?: string[];
    };
  }>;
  masteryLevel: number;
}

export interface UseSkillResult {
  success: boolean;
  skill?: CharacterSkill;
  damage?: number;
  effectsApplied?: Array<{ type: string; value: number; target: string }>;
  expGained?: number;
  costSpent?: SkillCostEntry[];
  cooldownSet?: number;
  error?: string;
}

/**
 * Skill 领域 Repository 端口接口（技能池表 skill_pool）。
 * D7: 一表一 Repository，本接口只操作 skill_pool 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 */
export interface ISkillPoolRepository {
  /** 查询存档下技能池列表（支持 learned/category 过滤，覆盖 listPoolSkills L192） */
  findBySaveId(saveId: ID, options?: { learned?: boolean; category?: string }, trx?: Knex.Transaction): Promise<SkillPoolEntry[]>;
  /** 按 ID 查询单个技能池条目（覆盖 getPoolSkill L209 + insertPoolSkill 回查 L186） */
  findById(saveId: ID, poolSkillId: string, trx?: Knex.Transaction): Promise<SkillPoolEntry | null>;
  /** 按 name 精确查询（覆盖 getPoolSkillByName L251） */
  findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<SkillPoolEntry | null>;
  /** 按 ID 或 name 解析技能池 ID（覆盖 resolvePoolSkillId L227: ID 精确 → name 精确） */
  findByIdOrName(idOrName: string, saveId: ID, trx?: Knex.Transaction): Promise<SkillPoolEntry | null>;
  /** 插入技能池条目（覆盖 insertPoolSkill L159） */
  insert(entry: Omit<SkillPoolEntry, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<SkillPoolEntry>;
  /** 更新技能池 learned 标记（覆盖 learnSkill L608 写 learned=1） */
  updateLearned(saveId: ID, poolSkillId: string, learned: boolean, trx?: Knex.Transaction): Promise<void>;
  /** 通用字段更新（去重防护增量更新使用），patch 为实体字段（camelCase），JSON 字段内部 stringify */
  update(saveId: ID, poolSkillId: string, patch: Partial<SkillPoolEntry>, trx?: Knex.Transaction): Promise<SkillPoolEntry | null>;
  /** 删除技能池条目（覆盖 removePoolSkill L217） */
  delete(saveId: ID, poolSkillId: string, trx?: Knex.Transaction): Promise<boolean>;
  /** 统计存档下技能池条目数量（GameInitService.getInitializationStatus 跨领域 count） */
  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
}

/**
 * Skill 领域 Repository 端口接口（已学技能表 character_skills）。
 * D7: 一表一 Repository，本接口只操作 character_skills 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 */
export interface ICharacterSkillRepository {
  // === 查询 ===
  /** 查询存档下已学技能列表（覆盖 listSkills L432，支持 visibility/owner 过滤） */
  findBySaveId(saveId: ID, options?: { visibility?: string; ownerType?: OwnerType; ownerId?: string }, trx?: Knex.Transaction): Promise<CharacterSkill[]>;
  /**
   * 按 saveId + ownerType 查询（不限定 ownerId）。
   * 与 InventoryRepository.findBySaveIdAndOwnerType 对称，用于 DataRefreshHandler 面板刷新。
   * 期望效果：返回该 saveId 下所有指定 ownerType 的技能记录（含多个 character/NPC 的合并视图）。
   * D9: 支持可选 trx 参数。
   */
  findBySaveIdAndOwnerType(
    saveId: ID,
    ownerType: OwnerType,
    trx?: Knex.Transaction
  ): Promise<CharacterSkill[]>;
  /** 按 skill 记录 ID 查询单个已学技能（覆盖 getSkill L460 + addExperience L981 + setCooldown/updateSkill 回查） */
  findById(saveId: ID, skillId: string, options?: { ownerType?: string; ownerId?: string }, trx?: Knex.Transaction): Promise<CharacterSkill | null>;
  /** 按 skill_id 或 name 解析已学技能（覆盖 resolveSkillId L481: id → skill_id → name） */
  findBySkillIdOrName(skillIdOrName: string, saveId: ID, options?: { ownerType?: string; ownerId?: string }, trx?: Knex.Transaction): Promise<CharacterSkill | null>;
  /** M12: 按 skill_id 或 name 查所有 owner 的记录（findSkill 通配支持，ownerType="all" 时使用） */
  findAllBySkillIdOrName(skillIdOrName: string, saveId: ID, trx?: Knex.Transaction): Promise<CharacterSkill[]>;
  /** 检查已学技能（覆盖 learnSkill L528 已学检查 where save_id+skill_id+owner） */
  findLearnedBySaveIdAndSkillId(saveId: ID, skillId: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<CharacterSkill | null>;
  /** 查询需要冷却衰减的技能（覆盖 tickCooldowns L1008 where cooldown_remaining > 0） */
  findWithActiveCooldown(saveId: ID, trx?: Knex.Transaction): Promise<CharacterSkill[]>;
  /** 查询权重冷却过期技能（覆盖 resetWeightCooldownForExpiredSkills L1071 where consecutive_uses > 0 AND cooldown_remaining = 0） */
  findWeightCooldownExpired(saveId: ID, trx?: Knex.Transaction): Promise<CharacterSkill[]>;
  // === 写入 ===
  /** 插入已学技能（覆盖 learnSkill L584 insert character_skills） */
  insert(skill: Omit<CharacterSkill, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<CharacterSkill>;
  /** 更新已学技能字段（覆盖 upgradeSkill L831 / setCooldown L873 / updateSkill L906 / addExperience L989 / useSkill L1224） */
  update(saveId: ID, skillId: string, patch: Partial<CharacterSkill>, options?: { ownerType?: string; ownerId?: string }, trx?: Knex.Transaction): Promise<CharacterSkill | null>;
  /** 批量更新冷却（覆盖 tickCooldowns L1037 循环内逐条 update cooldown_remaining） */
  updateCooldowns(saveId: ID, updates: Array<{ skillId: string; cooldownRemaining: number; ownerType?: string; ownerId?: string }>, trx?: Knex.Transaction): Promise<number>;
  /** 更新权重冷却字段（覆盖 resetWeightCooldownForExpiredSkills L1108/L1122 update consecutive_uses/last_used_at/custom_data） */
  updateWeightCooldown(saveId: ID, skillId: string, patch: { consecutiveUses?: number; lastUsedAt?: number; cooldownRemaining?: number; customData?: Record<string, unknown> }, trx?: Knex.Transaction): Promise<void>;
  /**
   * 按 saveId 删除所有已学技能（rollbackSave 回滚存档时清理 character_skills 表）。
   * S4-D6: 统一返回 Promise<void>。D9: 支持可选 trx 参数。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

// ============================================================================
// Service 端口接口（S3-1 Phase B 新增，供 quest 跨领域调用）
// ============================================================================

/**
 * Skill 领域 Service 端口接口。
 * S3-1 Phase B 新增: 供 QuestService.grantRewards 跨领域发放技能奖励使用。
 * S3-2 新增: calculateSkillDamage + getSkill 供 CombatService.executeTurn 跨领域查询技能伤害与元素。
 * 仅暴露跨领域所需的最小方法集，域内完整方法在 SkillService 实例上调用。
 */
export interface ISkillService {
  /**
   * 学习技能（覆盖原 QuestService.grantRewards L840 跨领域调用 skillService.learnSkill）。
   * D9: 支持可选 trx 参数，供 completeQuest 事务内调用透传事务。
   * - 传入 trx：在已有事务内执行，所有 Repository 调用透传 trx，不开新事务
   * - 未传 trx：内部通过 txManager 开新事务（保持原行为）
   */
  learnSkill(
    saveId: ID,
    skillIdOrName: string,
    visible?: boolean,
    ownerType?: OwnerType,
    ownerId?: string,
    fullParams?: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<LearnSkillResult>;

  /**
   * 计算技能伤害（S3-2 新增，覆盖 CombatService.executeTurn L784 跨领域调用 skillService.calculateSkillDamage）。
   * 端口接口仅暴露 total 字段（combat 只需 total），域内完整返回 { base, scaling, effects, total }。
   * D9: 端口接口签名不含 trx 参数（calculateSkillDamage 是纯计算，无写操作）。
   * 技能不存在时返回 { total: 0 }（与 SkillService.calculateSkillDamage L1191 一致）。
   */
  calculateSkillDamage(saveId: ID, skillId: ID): Promise<{ total: number }>;

  /**
   * 查询技能元素（S3-2 新增，覆盖 CombatService.executeTurn L786 跨领域调用 skillService.getSkill）。
   * 端口接口仅暴露 element 字段（combat 只需 element 用于克制计算），域内完整返回 CharacterSkill。
   * D9: 端口接口签名不含 trx 参数（getSkill 是只读查询）。
   * 技能不存在时返回 null（端口接口契约；SkillService.getSkill 实现可能 throw，调用方需 try-catch）。
   */
  getSkill(saveId: ID, skillId: ID): Promise<{ element?: string } | null>;

  /**
   * 校验玩家角色技能使用条件（资源是否足够、冷却是否就绪）。
   * P0-2: 从 game-service.validateSkillUsage 迁移到 SkillService，消除 game-service 直接 db 调用。
   * 返回 null 表示校验通过，返回 string 表示错误消息。
   * D9: 端口接口签名不含 trx 参数（validateUsage 是只读校验，无写操作）。
   */
  validateUsage(saveId: ID, skillId?: string, skillName?: string): Promise<string | null>;
}
