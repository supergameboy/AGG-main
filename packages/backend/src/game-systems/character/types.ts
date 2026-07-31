import { ID } from '../../../../shared/src/types/core.js';
import type { Gender, AgeGroup } from '../../../../shared/src/types/game.js';
import type { Knex } from 'knex';

export interface CreateCharacterInput {
  saveId: ID;
  name: string;
  gender: Gender;
  customGender?: string;
  ageGroup?: AgeGroup;
  race: string;
  classType: string;
  background: string;
  currentLocationId?: string;
  attributes: Record<string, number>;
  customOptions?: Record<string, string | number | boolean>;
}

export interface CharacterData {
  id: ID;
  saveId: ID;
  name: string;
  gender: Gender;
  customGender?: string;
  ageGroup?: AgeGroup;
  race: string;
  raceName?: string;
  class: string;
  className?: string;
  background: string;
  backgroundName?: string;
  level: number;
  experience: number;
  currentLocationId: string | null;
  attributes: Record<string, number>;
  attributeNames?: Record<string, string>;
  derivedAttributes: Record<string, number>;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  currency: Record<string, number>;
  status: Record<string, unknown>;
}

export interface CharacterStatusPanel {
  basicInfo: {
    name: string;
    gender: Gender;
    customGender?: string;
    ageGroup?: AgeGroup;
    race: string;
    raceName: string;
    class: string;
    className: string;
    background: string;
    backgroundName: string;
    level: number;
  };
  attributes: Record<string, number>;
  attributeNames: Record<string, string>;
  derivedAttributes: Record<string, number>;
  vitals: { currentHP: number; maxHP: number; currentMP: number; maxMP: number };
  experience: { current: number; nextLevel: number; progress: number };
  currency: Record<string, number>;
}

/**
 * Character 领域基本信息（inventory 跨领域查询所需的最小字段集）。
 * 基于 InventoryService 4 处跨领域访问的实际字段需求：
 * - characterId: resolveOwnerId (L79) 查 characters.id 解析物品所有者
 * - attributes: getMaxWeight (L1087) 查 characters.attributes 提取 endurance 计算最大负重
 * - currency: tradeItems (L1121/L1207) 查/改 characters.currency（JSON 多货币）
 */
export interface CharacterBasicInfo {
  characterId: string;
  attributes: Record<string, number>;
  currency: Record<string, number>;
}

/**
 * Character 领域战斗信息（combat 跨领域查询所需的角色战斗字段集）。
 * 基于 CombatService.startCombat L56-89 实际字段需求：
 * - characterId/name/level: 构建 CombatParticipant
 * - currentHP/maxHP/currentMP/maxMP: 角色 HP/MP 状态
 * - attributes: 基础属性（fallback 计算攻击/防御/速度）
 * - derivedAttributes: 派生属性（优先用于攻击/防御/速度）
 */
export interface CharacterCombatInfo {
  characterId: ID;
  name: string;
  level: number;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  attributes: Record<string, number>;
  derivedAttributes: Record<string, number>;
}

/**
 * Character 领域 Service 端口接口。
 * 供跨领域消费方（inventory/quest 等）注入使用，切断直接 characters 表访问。
 * 参数统一用 saveId：与现有代码 where({ save_id: saveId }) 一致，ToolContext 提供 saveId。
 */
export interface ICharacterService {
  /**
   * 获取角色基本信息（跨领域只读查询）。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用（如 tradeItems 事务内查询当前角色货币余额）。
   */
  getCharacterBasicInfo(saveId: string, trx?: Knex.Transaction): Promise<CharacterBasicInfo | null>;

  /**
   * 修改角色货币（D9: 支持事务参数，供跨领域事务调用）。
   * 多货币模型：currencyId 指定货币种类（如 'gold'）。
   * inventory.tradeItems 在事务内调用此方法更新金币。
   * 返回更新后的完整货币记录。
   */
  modifyCurrency(
    saveId: string,
    currencyId: string,
    delta: number,
    trx?: Knex.Transaction
  ): Promise<Record<string, number>>;

  /**
   * 修改角色生命值（S1-5 偏差 G 新增，S2-2 补充 trx 参数）。
   * inventory.applyDeterministicEffect 在 useItem 时调用此方法应用 heal/damage 效果。
   * D9: 支持 trx 参数，供事务内跨领域调用（如 SkillService.deductResource 事务内扣减 hp）。
   * 返回变更前/后/最大值，供 inventory 回传给 LLM。
   */
  modifyHealth(saveId: ID, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number; max: number }>;

  /**
   * 修改角色魔法值（S1-5 偏差 G 新增，S2-2 补充 trx 参数）。
   * inventory.applyDeterministicEffect 在 useItem 时调用此方法应用 mana_restore 效果。
   * D9: 支持 trx 参数，供事务内跨领域调用（如 SkillService.deductResource 事务内扣减 mp）。
   * 返回变更前/后/最大值，供 inventory 回传给 LLM。
   */
  modifyMana(saveId: ID, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number; max: number }>;

  // === S2-1 新增（map + npc 跨领域 characters 表访问） ===

  /**
   * 获取角色当前所在地点 ID。
   * 覆盖原 MapService.getCurrentLocation 跨领域 characters 查询（L65）。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  getCurrentLocationId(saveId: string, trx?: Knex.Transaction): Promise<string | null>;

  /**
   * 更新角色当前位置。
   * 覆盖原 NPCService.moveCharacterTo（L700）+ quickTravelTo（L765）跨领域 characters 更新。
   * D9: 支持 trx 参数，供事务内跨领域调用（角色+队伍 NPC 位置原子性）。
   */
  updateLocationId(saveId: string, locationId: string, trx?: Knex.Transaction): Promise<void>;

  /**
   * 统计在某地点的角色数量。
   * 覆盖原 MapService.deleteLocation 跨领域 characters 计数校验（L718）。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  countCharactersAtLocation(saveId: string, locationId: string, trx?: Knex.Transaction): Promise<number>;

  // === S2-2 新增（skill 跨领域 characters 表访问） ===

  /**
   * 修改角色体力（stamina）。
   * 覆盖原 SkillService.deductResource stamina 分支（L397-408），
   * stamina 存储在 characters.custom_data.stamina（JSON 字段）。
   * D9: 支持 trx 参数，供事务内跨领域调用。
   */
  modifyStamina(saveId: string, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number }>;

  /**
   * 查询角色资源量（一次性读取 mp/hp/stamina/currency）。
   * 覆盖原 SkillService.getCurrentResourceAmount（L289-342）跨领域 characters 查询。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  getCharacterResources(saveId: string, trx?: Knex.Transaction): Promise<{
    currentMp: number;
    currentHp: number;
    currentStamina: number;
    currency: Record<string, number>;
  }>;

  /**
   * 查询角色等级。
   * 覆盖原 SkillService.learnSkill（L551）等级前置检查。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  getCharacterLevel(saveId: string, trx?: Knex.Transaction): Promise<number>;

  // === S3-1 Phase B 新增（quest 跨领域 characters 表写入） ===

  /**
   * 增加角色经验值（覆盖原 QuestService.grantRewards L860 直接 UPDATE characters.experience）。
   * D9: 支持事务参数，供 quest grantRewards 事务内调用。
   * 返回变更前/后的经验值。
   */
  grantExperience(saveId: string, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number }>;

  // === S3-2 新增（combat 跨领域 characters 表读写） ===

  /**
   * 获取角色战斗信息（覆盖 CombatService.startCombat L56-89 直接 SELECT characters）。
   * D9: 支持事务参数，供 combat startCombat 事务内只读查询使用。
   * 返回 CharacterCombatInfo 或 null（角色不存在）。
   */
  getCharacterCombatInfo(saveId: string, trx?: Knex.Transaction): Promise<CharacterCombatInfo | null>;

  /**
   * 设置角色 HP/MP（覆盖 CombatService.finalizeCombat L907-913 直接 UPDATE characters HP/MP）。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   */
  setVitals(saveId: string, hp: number, mp: number, trx?: Knex.Transaction): Promise<void>;

  /**
   * 合并货币到角色现有 currency（覆盖 CombatService.finalizeCombat L923-940 读 currency + 合并 + 更新）。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   * 返回合并后的完整货币记录。
   */
  mergeCurrency(saveId: string, currency: Record<string, number>, trx?: Knex.Transaction): Promise<Record<string, number>>;

  /**
   * 获取角色 status JSON 字段（覆盖 CombatService.finalizeCombat L945-951 读 status）。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内只读查询使用。
   */
  getCharacterStatus(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>>;

  /**
   * 设置角色 permadeath 状态（覆盖 CombatService.finalizeCombat L944-958 读 status + 合并 permadeath + 更新）。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   */
  setPermadeath(saveId: string, trx?: Knex.Transaction): Promise<void>;
}

// === S4 新增：Repository 端口接口 ===

/**
 * characters 表 Row 类型（数据库行结构）。
 * JSON 字段在 Row 中声明为 string，Repository 的 rowToEntity 方法负责 JSON.parse。
 * 禁止联合类型 string | Record（Row 类型单一化原则）。
 *
 * 字段补齐记录（2026-07-09）：
 * - base_max_hp/base_max_mp（migration 048）：区分裸属性 vs 装备后属性上限
 * - custom_data（migration 002）：存储 stamina 等扩展数据
 * - gender/custom_gender/age_group/race/class/background（migration 002 既有）：createCharacter 全字段插入需要
 *
 * 修订记录（2026-07-09 BUG 修复）：
 * - 移除 template_id 字段：characters 表无此字段（059 migration 重建后确认），
 *   template_id 属于 saves 表。原 CharacterRow 错误包含此字段导致 insert 失败。
 */
export interface CharacterRow {
  id: string;
  save_id: string;
  name: string;
  gender: string;
  custom_gender: string | null;
  age_group: string | null;
  race: string;
  class: string;
  background: string;
  level: number;
  experience: number;
  current_hp: number;
  max_hp: number;
  base_max_hp: number | null;
  current_mp: number;
  max_mp: number;
  base_max_mp: number | null;
  currency: string;              // JSON 字符串，Repository 内部 rowToEntity 负责 JSON.parse
  attributes: string;            // JSON 字符串
  derived_attributes: string;    // JSON 字符串
  status: string;                // JSON 字符串
  custom_data: string;           // JSON 字符串，存储 stamina 等
  current_location_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Character 领域 Repository 端口接口（characters 表）。
 * D7: 一表一 Repository，本接口只操作 characters 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 *
 * 方法扩展记录（2026-07-09）：
 * 原 10 方法无法覆盖 CharacterService(31 处) + NumericalService(13 处) 实际 db 调用，
 * 扩展为 17 方法（新增 insert/updateBaseAttributes/updateDerivedAttributes/
 * updateLevel/updateExperience/updateStatus/updateCustomData/countBySaveIdAndLocation）。
 */
export interface ICharacterRepository {
  // 查询方法
  findById(saveId: ID, trx?: Knex.Transaction): Promise<CharacterRow | null>;
  findFullStatusBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<CharacterRow | null>;
  findBySaveIdWithNames(saveId: ID, names?: string[], trx?: Knex.Transaction): Promise<CharacterRow[]>;
  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
  countBySaveIdAndLocation(saveId: ID, locationId: string, trx?: Knex.Transaction): Promise<number>;
  /**
   * 按 saveId 查询并返回已映射的 CharacterData 实体（Service 层使用）。
   * 消除 CharacterService.rowToCharacterData 与 Repository.rowToEntity 的重复映射逻辑。
   * D9: 支持 trx 参数，供事务内只读查询使用。
   */
  findEntityBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<CharacterData | null>;

  // 写入方法
  insert(row: Omit<CharacterRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }, trx?: Knex.Transaction): Promise<void>;
  updateCurrency(saveId: ID, currency: Record<string, unknown>, trx?: Knex.Transaction): Promise<void>;
  updateHealth(saveId: ID, currentHp: number, currentMp: number, trx?: Knex.Transaction): Promise<void>;
  updateAttributes(saveId: ID, attributes: Record<string, unknown>, derivedAttributes: Record<string, unknown>, trx?: Knex.Transaction): Promise<void>;
  /** NumericalService.recalculateDerivedAttributes 一次更新 derived_attributes + max_hp + max_mp + base_max_hp + base_max_mp + current_hp + current_mp（不含 attributes） */
  updateDerivedAttributes(saveId: ID, derivedAttributes: Record<string, unknown>, maxHp: number, maxMp: number, baseMaxHp: number, baseMaxMp: number, currentHp?: number, currentMp?: number, trx?: Knex.Transaction): Promise<void>;
  /** CharacterService.updateAttributes + NumericalService.processLevelUp 更新 attributes + base_max_hp + base_max_mp（不含 derived_attributes） */
  updateBaseAttributes(saveId: ID, attributes: Record<string, unknown>, baseMaxHp: number, baseMaxMp: number, trx?: Knex.Transaction): Promise<void>;
  updateLevelAndExp(saveId: ID, level: number, exp: number, trx?: Knex.Transaction): Promise<void>;
  updateLevel(saveId: ID, level: number, trx?: Knex.Transaction): Promise<void>;
  updateExperience(saveId: ID, experience: number, trx?: Knex.Transaction): Promise<void>;
  updateLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void>;
  updateStatus(saveId: ID, status: Record<string, unknown>, trx?: Knex.Transaction): Promise<void>;
  updateCustomData(saveId: ID, customData: Record<string, unknown>, trx?: Knex.Transaction): Promise<void>;
  /**
   * 通用字段更新（去重防护增量更新使用）。
   * patch 为数据库行格式（snake_case），JSON 字段需调用方自行 JSON.stringify。
   * D9: 支持 trx 参数，供事务内调用。
   */
  updateFields(saveId: ID, patch: Record<string, unknown>, trx?: Knex.Transaction): Promise<void>;

  // 删除方法
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;

  // === S6 新增（StoryKernel 跨领域 characters 表只读查询） ===
  /**
   * 获取角色资源状态（HP/MP/金币）。
   * 覆盖 StoryKernel.assessResourceFactor 跨领域 characters 查询。
   * 映射 characters 表 current_hp→hp, current_mp→mp, currency.gold→gold。
   * D9: 支持 trx 参数，供事务内只读查询使用。
   */
  getResourceStatus(saveId: ID, trx?: Knex.Transaction): Promise<{ hp: number; max_hp: number; mp: number; max_mp: number; gold: number } | null>;
}
