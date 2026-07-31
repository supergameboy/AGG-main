import { ID } from '../../../../shared/src/types/core.js';
import type { EquipmentSlot } from '../../../../shared/src/types/game.js';
import type { Knex } from 'knex';
export type { EquipmentSlot };
export type ItemCategory = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material' | 'tool' | 'quest' | 'misc';
export type ItemQuality = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type OwnerType = 'character' | 'npc';

export interface ItemEffect {
  type: string;
  value: number;
  target?: string;
  duration?: number;
}

export interface ItemValue {
  buy?: number;
  sell?: number;
  currency?: string;
}

export interface ItemPoolEntry {
  id: string;
  saveId: string;
  name: string;
  description: string;
  category: ItemCategory;
  quality: ItemQuality;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  weight: number;
  maxStack: number;
  equippedSlot: string | null;
  durability: number;
  maxDurability: number;
  taken: boolean;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
}

export interface InventoryItem {
  id: ID;
  saveId: ID;
  itemId: string;
  poolId: string;
  name: string;
  description: string;
  category: ItemCategory;
  quantity: number;
  quality: ItemQuality;
  durability: number;
  maxDurability: number;
  inventorySlot: number | null;
  equippedSlot: EquipmentSlot | null;
  equipped: boolean;
  /** 数组化槽位中的索引（capacity>1 的槽位使用）；单槽位时为 null；未装备时为 null；数组首位（最新）为 0 */
  equippedIndex: number | null;
  weight: number;
  maxStack: number;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  customData: Record<string, unknown>;
  visible: boolean;
  ownerType: OwnerType;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AddItemParams {
  saveId: ID;
  itemId?: string;
  name: string;
  category: ItemCategory;
  description?: string;
  quantity?: number;
  quality?: ItemQuality;
  durability?: number;
  maxDurability?: number;
  inventorySlot?: number;
  weight?: number;
  maxStack?: number;
  customData?: Record<string, unknown>;
  visible?: boolean;
  ownerType?: OwnerType;
  ownerId?: string;
  stats?: Record<string, number>;
  effects?: ItemEffect[];
  value?: ItemValue;
  tags?: string[];
  fromPool?: boolean;
}

export interface AddPoolItemParams {
  saveId: ID;
  name: string;
  description?: string;
  category?: ItemCategory;
  quality?: ItemQuality;
  stats?: Record<string, number>;
  effects?: ItemEffect[];
  value?: ItemValue;
  tags?: string[];
  weight?: number;
  maxStack?: number;
  equippedSlot?: string | null;
  durability?: number;
  maxDurability?: number;
  customData?: Record<string, unknown>;
  recommendedClasses?: string[];
}

export interface EquipResult {
  success: boolean;
  alreadyEquipped?: boolean;
  previousSlot: EquipmentSlot | null;
  newSlot: EquipmentSlot | null;
  /** LLM 传入的原始 targetSlot（仅当与 newSlot 不同，即发生别名映射时返回） */
  requestedSlot?: string;
  /** 堆栈替换时撤下的装备列表（仅数组化槽位无空位时填充） */
  replacedItems?: Array<{ inventoryId: ID; previousIndex: number }>;
  /** 新装备分配的 equippedIndex（仅数组化槽位时填充） */
  assignedIndex?: number;
  message: string;
}

/** 确定性 effect 类型 — 程序化自动应用到角色 */
export type DeterministicEffectType = 'heal' | 'mana_restore' | 'stamina_restore' | 'damage';

export const DETERMINISTIC_EFFECT_TYPES: readonly DeterministicEffectType[] = ['heal', 'mana_restore', 'stamina_restore', 'damage'];

export interface AppliedEffect {
  type: DeterministicEffectType;
  value: number;
  previous: number | null;
  current: number | null;
  max: number | null;
}

export interface UseItemResult {
  success: boolean;
  effects: Array<{ type: string; value: number; target: string }>;
  /** 已自动应用到角色的确定性效果 */
  appliedEffects: AppliedEffect[];
  consumed: boolean;
  remainingQuantity: number;
  message: string;
}

export interface UpdateItemParams {
  saveId: ID;
  inventoryId: ID;
  name?: string;
  description?: string;
  category?: ItemCategory;
  customData?: Record<string, unknown>;
  quantity?: number;
  equipped?: boolean;
  equippedSlot?: EquipmentSlot | null;
  visible?: boolean;
  ownerType?: OwnerType;
  ownerId?: string;
  stats?: Record<string, number>;
  effects?: ItemEffect[];
  value?: ItemValue;
  tags?: string[];
}

export interface TradeItem {
  inventoryId: ID;
  quantity: number;
}

export interface TradeParams {
  sellItems: TradeItem[];
  buyItems: TradeItem[];
  goldDelta?: number;
  ownerType?: OwnerType;
  ownerId?: string;
}

export interface TradeResult {
  success: boolean;
  sold: Array<{ itemId: string; name: string; quantity: number; value: number }>;
  bought: Array<{ itemId: string; name: string; quantity: number }>;
  goldChange: number;
  newGoldBalance: number;
  error?: string;
}

/**
 * Inventory 领域 Repository 端口接口（背包表 inventory）。
 * D7: 一表一 Repository，本接口只操作 inventory 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * 参数统一用 saveId：inventory 表用 save_id 字段标识存档（非 character_id）。
 */
export interface IInventoryRepository {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  findById(itemId: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  findBySaveIdAndItemId(saveId: string, itemId: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  // S1-5 偏差 C: 按 owner 过滤查询（覆盖 listInventory L422 的 where({ save_id, owner_type, owner_id })）
  findBySaveIdAndOwner(saveId: string, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  /** 按 saveId + ownerType 查询（不限定 ownerId，覆盖 DataRefreshHandler.createInventoryRefreshConfig 的 where({ save_id, owner_type: 'character' })） */
  findBySaveIdAndOwnerType(saveId: string, ownerType: OwnerType, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  // S1-5 偏差 C 补充: 按名称+owner 查询单个物品（覆盖 L215 getInventoryItemByName + L740 equipItem 名称查询 where({ save_id, name, owner_type, owner_id }).first()）
  findByNameAndSaveIdAndOwner(saveId: string, name: string, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  // S1-5 偏差 F: 查询已装备物品（覆盖 getEquipment L1240 的 where({ save_id, owner_type, owner_id, equipped: true })）
  findEquippedBySaveIdAndOwner(saveId: string, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  // M12: 查询存档下所有 owner 的已装备物品（通配符查询支持，ownerType="all" 时使用）
  findEquippedBySaveId(saveId: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  // M12: 按 saveId + name 查所有 owner 的记录（get_item 通配支持，ownerType="all" 时使用）
  findAllByNameAndSaveId(saveId: string, name: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  // S1-5 偏差 D 补充: 按槽位查询单个已装备物品（覆盖 equipItem L847 的 where({ save_id, equipped_slot, equipped: true, owner_type, owner_id }).first()）
  findEquippedBySlot(saveId: string, slot: EquipmentSlot, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  /** 查询某数组化槽位的所有已装备物品，按 equippedIndex 升序返回（capacity>1 槽位使用） */
  findByEquippedSlotOrdered(saveId: string, slot: EquipmentSlot, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<InventoryItem[]>;
  /** 批量调整某槽位装备的 equippedIndex（delta 正负均可；可选 condition 过滤范围） */
  updateEquippedIndexBatch(saveId: string, slot: EquipmentSlot, delta: number, condition: { minIndex?: number; maxIndex?: number }, ownerType: OwnerType, ownerId: string, trx?: Knex.Transaction): Promise<void>;
  // S1-5 偏差 D: 查询已占用槽位（覆盖 L324/L1350 的 whereNotNull('inventory_slot').where('equipped', false).pluck('inventory_slot')）
  findOccupiedSlots(saveId: string, trx?: Knex.Transaction): Promise<number[]>;
  // S1-5 偏差 D 补充: 查询可堆叠物品（覆盖 L271 addItemFromPool + L549 addItem 的 where({ save_id, item_id, ... }).where('equipped', false).first()）
  findStackableItem(saveId: string, itemId: string, ownerType?: OwnerType, ownerId?: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  // 全面去重查询：查找任意 matching item（不限于未装备），用于 addItemFromPool 防止重复创建
  findByItemId(saveId: string, itemId: string, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  // S1-5 偏差 D: 查询物品总数量（覆盖 checkItemQuantity L1313 的 .sum('quantity as totalQuantity')，支持可选 owner 过滤）
  sumQuantityBySaveIdAndItemId(saveId: string, itemId: string, ownerType?: OwnerType, ownerId?: string, trx?: Knex.Transaction): Promise<number>;
  insert(item: Omit<InventoryItem, 'id'>, trx?: Knex.Transaction): Promise<InventoryItem>;
  update(itemId: string, patch: Partial<InventoryItem>, trx?: Knex.Transaction): Promise<InventoryItem | null>;
  delete(itemId: string, trx?: Knex.Transaction): Promise<boolean>;
  /** S4-D6: 统一返回 Promise<void>，调用方不需要删除数量。 */
  deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void>;
  countBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number>;
  sumWeightBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number>;
}

/**
 * Inventory 领域 Repository 端口接口（物品池表 item_pool）。
 * D7: 一表一 Repository，本接口只操作 item_pool 表，禁止跨领域表访问。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * 参数统一用 saveId：item_pool 表用 save_id 字段标识存档（非 character_id）。
 */
export interface IItemPoolRepository {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<ItemPoolEntry[]>;
  findById(entryId: string, trx?: Knex.Transaction): Promise<ItemPoolEntry | null>;
  findBySaveIdAndName(saveId: string, name: string, trx?: Knex.Transaction): Promise<ItemPoolEntry | null>;
  insert(entry: Omit<ItemPoolEntry, 'id'>, trx?: Knex.Transaction): Promise<ItemPoolEntry>;
  update(entryId: string, patch: Partial<ItemPoolEntry>, trx?: Knex.Transaction): Promise<ItemPoolEntry | null>;
  delete(entryId: string, trx?: Knex.Transaction): Promise<boolean>;
  /** 统计存档下物品池条目数量（GameInitService.getInitializationStatus 跨领域 count） */
  countBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number>;
}

/**
 * Inventory 物品的战斗信息（combat 跨领域查询所需的物品字段集）。
 * 基于 CombatService.useItemInCombat L506-577 实际字段需求：
 * - itemId/name/quantity: 物品标识与库存数量（消耗判定 L551）
 * - category: 物品类型（效果分支判定 L530-549，原 item_data.type/item_type fallback 链路）
 * - healAmount: 治疗 HP 量（potion/health_potion/consumable 分支 L534）
 * - manaAmount: 恢复 MP 量（mana_potion 分支 L541）
 */
export interface CombatItemInfo {
  itemId: ID;
  name: string;
  category: string;
  healAmount: number;
  manaAmount: number;
  quantity: number;
}

/**
 * Inventory 领域 Service 端口接口（最小集）。
 * S2-2 新增: 仅供 SkillService.deductResource item 分支消费物品使用。
 * S3-1 Phase B 新增: addItem 供 QuestService.grantRewards 跨领域发放物品奖励。
 * S3-2 新增: getItemForCombat 供 CombatService.useItemInCombat 跨领域查询物品战斗信息。
 */
export interface IInventoryService {
  /**
   * 消耗物品: 扣减数量，数量 <= 0 则删除。
   * 对应原 SkillService.deductResource item 分支（L367-382）: 读 quantity → delete 或 update。
   * D9: 支持事务参数，供事务内跨领域调用。
   */
  consumeItem(saveId: ID, itemId: string, quantity: number, trx?: Knex.Transaction): Promise<{ deleted: boolean; remainingQuantity: number }>;

  /**
   * 添加物品到库存（覆盖原 QuestService.grantRewards L822 跨领域调用 inventoryService.addItem）。
   * D9: 支持事务参数，供 quest grantRewards 事务内调用。
   */
  addItem(params: AddItemParams, trx?: Knex.Transaction): Promise<InventoryItem>;

  /**
   * 查询物品的战斗信息（S3-2 新增，覆盖 CombatService.useItemInCombat L512-522 直接 SELECT inventory）。
   * 返回结构化的 CombatItemInfo 供 combat 进行效果计算，inventory 不感知"战斗"概念。
   * D9: 支持事务参数，供 combat useItemInCombat 事务内只读查询使用。
   */
  getItemForCombat(saveId: ID, itemId: ID, trx?: Knex.Transaction): Promise<CombatItemInfo | null>;

  /**
   * 检查存档是否拥有指定物品（S3-3 新增，覆盖 DialogueService.checkConditionalDialogue L663 直接 SELECT inventory）。
   * 按 save_id + item_id 查询，返回是否存在。
   * D9: 支持事务参数，供事务内只读查询使用。
   */
  hasItem(saveId: ID, itemId: string, trx?: Knex.Transaction): Promise<boolean>;
}
