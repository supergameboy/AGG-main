import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { EquipmentSlot } from '../../../../shared/src/types/game.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { ITemplatePoolProvider } from '../shared/types.js';
import type { TemplateItemPoolEntry } from '../../../../shared/src/types/game.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import { DETERMINISTIC_EFFECT_TYPES } from './types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import type { ICharacterService } from '../character/types.js';
import type { INumericalService } from '../numerical/types.js';
import type { INPCService } from '../npc/types.js';
import type { ISaveRepository } from '../save/types.js';
import type {
  IInventoryRepository,
  IItemPoolRepository,
  IInventoryService,
  InventoryItem,
  AddItemParams,
  UpdateItemParams,
  EquipResult,
  UseItemResult,
  TradeParams,
  TradeResult,
  ItemCategory,
  ItemQuality,
  OwnerType,
  ItemPoolEntry,
  ItemEffect,
  ItemValue,
  AddPoolItemParams,
  AppliedEffect,
  DeterministicEffectType,
  CombatItemInfo,
} from './types.js';
import { computeDedupUpdate, formatDedupWarnings } from '../shared/dedup-helper.js';

export { InventoryItem, AddItemParams, UpdateItemParams, EquipResult, UseItemResult };
export type { OwnerType, ItemPoolEntry, ItemEffect, ItemValue, AddPoolItemParams, AppliedEffect, DeterministicEffectType };

const DEFAULT_MAX_STACK = 99;
const WEIGHT_PER_ENDURANCE = 5;

const QUALITY_DURABILITY_MULTIPLIER: Record<ItemQuality, number> = {
  common: 1.0,
  uncommon: 1.2,
  rare: 1.5,
  epic: 2.0,
  legendary: 3.0
};

/**
 * Inventory 领域 Service（S1-5 重构后，S2-2 实现 IInventoryService 端口）。
 * 完全无 Knex db 依赖，通过 Repository 端口接口操作 inventory/item_pool 表，
 * 通过 ICharacterService/INumericalService/ISaveRepository 端口接口跨领域访问，
 * 事务通过 ITransactionManager 端口接口开启。
 */
export class InventoryService implements IInventoryService {
  private readonly logger: ReturnType<typeof createChildLogger>;
  private readonly ruleParser: TemplateRuleParser;
  private readonly templatePoolService: ITemplatePoolProvider | null;

  constructor(
    private readonly inventoryRepo: IInventoryRepository,
    private readonly itemPoolRepo: IItemPoolRepository,
    private readonly characterService: ICharacterService,
    private readonly numericalService: INumericalService,
    private readonly saveRepo: ISaveRepository,
    private readonly txManager: ITransactionManager,
    ruleParser: TemplateRuleParser,
    templatePoolService: ITemplatePoolProvider | null,
    // 可选注入：与 QuestService 一致，bootstrap 不需要时省略
    // 用于 resolveOwnerId 把 NPC 名称（如"村长艾德温"）解析为完整 id，
    // 避免 owner_id 字段存入名字导致后续 recalculateNpcAttributes 查不到
    private readonly npcService?: INPCService,
  ) {
    this.logger = createChildLogger('service:inventory');
    this.ruleParser = ruleParser;
    this.templatePoolService = templatePoolService;
  }

  /**
   * 事务执行辅助：统一处理外部事务复用与自建事务。
   * 消除各方法中 `if (trx) return execute(trx); return this.txManager.transaction(execute);` 样板。
   */
  private runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  private getEffectiveMaxSlots(): number {
    return this.ruleParser.getInventoryRules().max_slots;
  }

  private getEffectiveMaxStack(category?: string): number {
    const stackSizes = this.ruleParser.getInventoryRules().stack_sizes;
    if (category && stackSizes && category in stackSizes) {
      return stackSizes[category];
    }
    return DEFAULT_MAX_STACK;
  }

  private async resolveOwnerId(saveId: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<{ ownerType: OwnerType; ownerId: string }> {
    // character 或未传：自动从 saveId 解析 characterId
    // 玩家角色就是存档主人，saveId 可唯一定位 characterId，不应让 LLM 传
    if (!ownerType || ownerType === 'character') {
      const charInfo = await this.characterService.getCharacterBasicInfo(saveId, trx);
      if (!charInfo) {
        throw new Error(`Character not found for saveId: ${saveId}`);
      }
      return { ownerType: 'character', ownerId: charInfo.characterId };
    }

    // npc: LLM 按 prompt 提示传 NPC 名称（如"村长艾德温"），需通过 resolveNpcId 解析为完整 id，
    // 否则 owner_id 字段会存入名字，后续 recalculateNpcAttributes 按 id 查 npcs 表会失败。
    if (ownerType === 'npc') {
      if (!ownerId) {
        throw new Error('ownerId is required when ownerType is npc');
      }
      if (!this.npcService) {
        throw new Error('NPCService not injected: cannot resolve NPC name to id. Check InventoryServiceTool wiring.');
      }
      const resolvedNpcId = await this.npcService.resolveNpcId(saveId, ownerId, trx);
      return { ownerType: 'npc', ownerId: resolvedNpcId };
    }

    throw new Error(`Invalid ownerType: ${ownerType}. Supported: 'character', 'npc', or undefined (defaults to character)`);
  }

  /**
   * 安全解析 NPC ID：历史数据 owner_id 可能存的是 NPC 名字，装备后做派生属性重算时需要完整 id。
   * resolveNpcId 失败时保留原值，让下方 recalculateNpcAttributes 报出原始错误（不掩盖缺陷）。
   */
  private async resolveNpcIdSafe(saveId: string, ownerId: string): Promise<string> {
    if (!this.npcService) return ownerId;
    try {
      return await this.npcService.resolveNpcId(saveId, ownerId);
    } catch {
      return ownerId;
    }
  }

  private async validateOwnership(inventoryId: string, saveId: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<void> {
    const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, trx);
    const item = await this.inventoryRepo.findById(inventoryId, trx);
    if (!item) throw new Error(`Item not found: ${inventoryId}`);
    if (item.ownerType !== resolved.ownerType || item.ownerId !== resolved.ownerId) {
      throw new Error(`Item ${inventoryId} does not belong to ${resolved.ownerType}:${resolved.ownerId}`);
    }
  }

  /**
   * 消耗物品（IInventoryService 端口接口实现，S2-2 新增）。
   * 覆盖原 SkillService.deductResource item 分支（L367-382）:
   * 读 quantity → 扣减后数量 <= 0 则删除，否则更新数量。
   * D9: 支持事务参数，供事务内跨领域调用。
   */
  async consumeItem(saveId: ID, itemId: string, quantity: number, trx?: Knex.Transaction): Promise<{ deleted: boolean; remainingQuantity: number }> {
    const item = await this.inventoryRepo.findById(itemId, trx);
    if (!item || item.saveId !== saveId) {
      return { deleted: false, remainingQuantity: 0 };
    }

    const newQuantity = Math.max(0, (item.quantity ?? 1) - quantity);

    if (newQuantity <= 0) {
      await this.inventoryRepo.delete(itemId, trx);
      return { deleted: true, remainingQuantity: 0 };
    }

    await this.inventoryRepo.update(itemId, { quantity: newQuantity }, trx);
    return { deleted: false, remainingQuantity: newQuantity };
  }

  /**
   * 查询物品的战斗信息（S3-2 新增，IInventoryService 端口接口实现）。
   * 覆盖 CombatService.useItemInCombat L512-522 直接 SELECT inventory。
   * 从 inventory 表实际字段读取，healAmount/manaAmount 从 customData 提取。
   * D9: 支持事务参数，供 combat useItemInCombat 事务内只读查询使用。
   */
  async getItemForCombat(saveId: ID, itemId: ID, trx?: Knex.Transaction): Promise<CombatItemInfo | null> {
    const item = await this.inventoryRepo.findById(itemId, trx);
    if (!item || item.saveId !== saveId) return null;

    const customData = item.customData ?? {};
    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      healAmount: (customData.heal_amount as number) ?? 0,
      manaAmount: (customData.mana_amount as number) ?? 0,
      quantity: item.quantity,
    };
  }

  /**
   * 检查存档是否拥有指定物品（S3-3 新增，IInventoryService 端口接口实现）。
   * 覆盖 DialogueService.checkConditionalDialogue L663 直接 SELECT inventory。
   * 按 save_id + item_id 查询 inventory 表，存在记录即返回 true。
   * D9: 支持事务参数，供 dialogue checkConditionalDialogue 事务内只读查询使用。
   */
  async hasItem(saveId: ID, itemId: string, trx?: Knex.Transaction): Promise<boolean> {
    const item = await this.inventoryRepo.findBySaveIdAndItemId(saveId, itemId, trx);
    return item !== null;
  }

  // ---------------------------------------------------------------------------
  // 物品池方法
  // ---------------------------------------------------------------------------

  async addPoolItem(saveId: ID, params: AddPoolItemParams, trx?: Knex.Transaction): Promise<ItemPoolEntry & { alreadyExists?: boolean; warnings?: string[] }> {
    // 步骤 1：save pool 预查重（幂等）——已存在则增量更新非黑名单字段
    if (params.name) {
      const existing = await this.itemPoolRepo.findBySaveIdAndName(saveId, params.name, trx);
      if (existing) {
        return await this.applyPoolItemDedupUpdate(saveId, existing, params, trx);
      }
    }

    const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId, trx);

    // 步骤 2：构造数据（可选 merge 模板补全缺失字段，命中与否只影响"读"，不影响"写"）
    let mergedParams: Record<string, unknown> = params as unknown as Record<string, unknown>;
    if (templateId && this.templatePoolService && params.name) {
      const templateEntry = await this.templatePoolService.findItemByName(templateId, params.name);
      if (templateEntry) {
        mergedParams = this.mergeWithTemplate(templateEntry, params as unknown as Record<string, unknown>);
      }
    }

    // 步骤 3：写存档池
    const newEntry = await this.insertPoolItem(saveId, mergedParams, trx);

    // 步骤 4：upsert 模板池（固定调用，无分支）
    // 设计原则：LLM 除读之外任何操作程序都自动回写。以工具调用效果为核心，不以程序路径为核心。
    if (templateId && this.templatePoolService && params.name) {
      await this.templatePoolService.upsertItem(
        templateId,
        { ...mergedParams, source: 'generated' } as import('../../services/template-pool.js').CreateTemplateItemParams,
      );
    }

    return newEntry;
  }

  /**
   * 物品池去重防护：同 saveId+name 已存在时增量更新非黑名单字段 + 返回 alreadyExists + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、itemId、createdAt
   * 可更新字段：description、category、quality、stats、effects、value、tags、weight、
   *            maxStack、equippedSlot、durability、maxDurability、customData、recommendedClasses
   */
  private async applyPoolItemDedupUpdate(
    saveId: ID,
    existing: ItemPoolEntry,
    params: AddPoolItemParams,
    trx?: Knex.Transaction,
  ): Promise<ItemPoolEntry & { alreadyExists?: boolean; warnings?: string[] }> {
    this.logger.info('Pool item already exists, applying incremental update', {
      saveId, existingId: existing.id, existingName: existing.name,
    });

    const newValues: Record<string, unknown> = {
      name: params.name,
      description: params.description,
      category: params.category,
      quality: params.quality,
      stats: params.stats,
      effects: params.effects,
      value: params.value,
      tags: params.tags,
      weight: params.weight,
      maxStack: params.maxStack,
      equippedSlot: params.equippedSlot,
      durability: params.durability,
      maxDurability: params.maxDurability,
      customData: params.customData,
      recommendedClasses: params.recommendedClasses,
    };

    const existingValues: Record<string, unknown> = {
      name: existing.name,
      description: existing.description,
      category: existing.category,
      quality: existing.quality,
      stats: existing.stats,
      effects: existing.effects,
      value: existing.value,
      tags: existing.tags,
      weight: existing.weight,
      maxStack: existing.maxStack,
      equippedSlot: existing.equippedSlot,
      durability: existing.durability,
      maxDurability: existing.maxDurability,
      customData: existing.customData,
      recommendedClasses: existing.recommendedClasses,
    };

    const POOL_ITEM_BLACKLIST = ['id', 'saveId', 'itemId', 'createdAt'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, POOL_ITEM_BLACKLIST,
    );

    if (updatedFields.length > 0) {
      const patch: Record<string, unknown> = {};
      for (const f of updatedFields) {
        patch[f.field] = f.newValue;
      }
      await this.runInTransaction(trx, async (t) => {
        await this.itemPoolRepo.update(existing.id, patch, t);
      });
    }

    const updated = await this.itemPoolRepo.findById(existing.id, trx);
    if (!updated) throw new Error('Failed to retrieve updated pool item');

    const warnings = formatDedupWarnings('物品池', existing.name, updatedFields, blockedFields);

    this.logger.info('Pool item incremental update applied', {
      saveId, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  /**
   * 背包物品去重防护：同 saveId+name+ownerType+ownerId 已存在时增量更新非黑名单字段
   * + 返回 alreadyExists + warnings。
   *
   * 与 applyPoolItemDedupUpdate 实现模式对称，仅黑名单字段不同（inventory 表含归属与装备状态字段）。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、itemId、poolId、createdAt、ownerType、ownerId、
   *   equipped、equippedSlot、equippedIndex、inventorySlot
   * 可更新字段：description、category、quality、stats、effects、value、tags、weight、
   *            maxStack、durability、maxDurability、customData、visible、quantity
   *
   * quantity 堆叠语义：消耗品/材料（maxStack>1）按 maxStack 合并 quantity；
   *                   装备类（maxStack<=1）不合并 quantity，仅做字段更新；
   *                   已装备物品不合并 quantity（避免意外堆叠已装备物品）。
   *
   * 设计文档：docs/design/20260721-inventory-duplicate-creation-fix.md 方案1
   * 设计原则：code-standards "上下游数据读取硬编码" 反模式 + architecture-standards 13.3 数据归属保守处理
   */
  private async applyInventoryItemDedupUpdate(
    saveId: ID,
    existing: InventoryItem,
    params: AddItemParams,
    trx?: Knex.Transaction,
  ): Promise<InventoryItem & { alreadyExists: true; warnings: string[] }> {
    this.logger.info('Inventory item already exists, applying incremental update', {
      saveId, existingId: existing.id, existingName: existing.name,
    });

    const newValues: Record<string, unknown> = {
      name: params.name,
      description: params.description,
      category: params.category,
      quality: params.quality,
      stats: params.stats,
      effects: params.effects,
      value: params.value,
      tags: params.tags,
      weight: params.weight,
      maxStack: params.maxStack,
      durability: params.durability,
      maxDurability: params.maxDurability,
      customData: params.customData,
      visible: params.visible,
      // 黑名单字段也加入 newValues，让 computeDedupUpdate 能检测到 Agent 试图覆盖：
      // itemId/inventorySlot 是 Agent 可直接传入的稳定 ID 字段，可直接比较。
      // ownerType/ownerId 不在此处比较——已由 resolveOwnerId 解析并与 existing 匹配，
      // 比较 LLM 原始值（如 NPC 名字）与 existing 解析值（NPC id）会产生误报。
      itemId: params.itemId,
      inventorySlot: params.inventorySlot,
    };

    const existingValues: Record<string, unknown> = {
      name: existing.name,
      description: existing.description,
      category: existing.category,
      quality: existing.quality,
      stats: existing.stats,
      effects: existing.effects,
      value: existing.value,
      tags: existing.tags,
      weight: existing.weight,
      maxStack: existing.maxStack,
      durability: existing.durability,
      maxDurability: existing.maxDurability,
      customData: existing.customData,
      visible: existing.visible,
      itemId: existing.itemId,
      inventorySlot: existing.inventorySlot,
    };

    const INVENTORY_ITEM_BLACKLIST = [
      'id', 'saveId', 'itemId', 'poolId', 'createdAt',
      'ownerType', 'ownerId',
      'equipped', 'equippedSlot', 'equippedIndex', 'inventorySlot',
    ] as const;

    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, INVENTORY_ITEM_BLACKLIST,
    );

    // quantity 特殊处理：消耗品/材料（maxStack>1）合并 quantity，装备类不合并
    const patch: Record<string, unknown> = {};
    for (const f of updatedFields) {
      patch[f.field] = f.newValue;
    }

    const addQuantity = params.quantity ?? 1;
    const effectiveMaxStack = params.maxStack ?? existing.maxStack ?? this.getEffectiveMaxStack(params.category);
    const canStack = effectiveMaxStack > 1 && !existing.equipped;
    let quantityMergeHint = '';

    if (canStack && addQuantity > 0) {
      const currentQuantity = existing.quantity ?? 0;
      const newQuantity = Math.min(currentQuantity + addQuantity, effectiveMaxStack);
      const merged = newQuantity - currentQuantity;
      if (merged > 0) {
        patch.quantity = newQuantity;
        // 替换/新增 quantity 到 updatedFields 以便 warnings 反映
        const existingQtyFieldIdx = updatedFields.findIndex(f => f.field === 'quantity');
        const qtyDiff = { field: 'quantity', oldValue: currentQuantity, newValue: newQuantity };
        if (existingQtyFieldIdx >= 0) {
          updatedFields[existingQtyFieldIdx] = qtyDiff;
        } else {
          updatedFields.push(qtyDiff);
        }
        quantityMergeHint = `（增量合并 +${merged}）`;
      }
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now() as Timestamp;
      await this.runInTransaction(trx, async (t) => {
        await this.inventoryRepo.update(existing.id, patch, t);
      });
    }

    const updated = await this.inventoryRepo.findById(existing.id, trx);
    if (!updated) throw new Error('Failed to retrieve updated inventory item');

    const warnings = formatDedupWarnings('物品', existing.name, updatedFields, blockedFields);
    // quantity 合并场景额外标注增量合并数（与 addItemFromPool 已有 warnings 格式对称）
    if (quantityMergeHint) {
      const idx = warnings.findIndex(w => w.includes('quantity:'));
      if (idx >= 0) {
        warnings[idx] = `${warnings[idx]}${quantityMergeHint}`;
      } else {
        warnings.push(`quantity${quantityMergeHint}`);
      }
    }

    this.logger.info('Inventory item incremental update applied', {
      saveId, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  private async insertPoolItem(saveId: ID, params: Record<string, unknown>, trx?: Knex.Transaction): Promise<ItemPoolEntry> {
    const entry: Omit<ItemPoolEntry, 'id'> = {
      saveId,
      name: params.name as string,
      description: (params.description as string) || '',
      category: (params.category as ItemCategory) || 'misc',
      quality: (params.quality as ItemQuality) || 'common',
      stats: (params.stats as Record<string, number>) ?? {},
      effects: (params.effects as ItemEffect[]) ?? [],
      value: (params.value as ItemValue) ?? {},
      tags: (params.tags as string[]) ?? [],
      weight: (params.weight as number) ?? 1,
      maxStack: (params.maxStack as number) ?? DEFAULT_MAX_STACK,
      equippedSlot: (params.equippedSlot as string) ?? null,
      durability: (params.durability as number) ?? 100,
      maxDurability: (params.maxDurability as number) ?? 100,
      taken: false,
      customData: (params.customData as Record<string, unknown>) ?? {},
      recommendedClasses: (params.recommendedClasses as string[]) ?? [],
    };

    const inserted = await this.itemPoolRepo.insert(entry, trx);
    this.logger.info('Pool item added', { saveId, poolItemId: inserted.id, name: inserted.name });
    return inserted;
  }

  async listPoolItems(saveId: ID, options?: { taken?: boolean; category?: string }): Promise<ItemPoolEntry[]> {
    const allItems = await this.itemPoolRepo.findBySaveId(saveId);

    let filtered = allItems;
    if (options?.taken === true) {
      filtered = filtered.filter(item => item.taken);
    } else if (options?.taken === false) {
      filtered = filtered.filter(item => !item.taken);
    }

    if (options?.category) {
      filtered = filtered.filter(item => item.category === options.category);
    }

    // 按 createdAt 排序（findBySaveId 已按查询返回，此处保持稳定排序）
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPoolItem(saveId: ID, poolItemId: string, trx?: Knex.Transaction): Promise<ItemPoolEntry | null> {
    const entry = await this.itemPoolRepo.findById(poolItemId, trx);
    if (!entry || entry.saveId !== saveId) return null;
    return entry;
  }

  async removePoolItem(saveId: ID, poolItemId: string): Promise<boolean> {
    // 先查询确认存在且属于该 saveId
    const entry = await this.itemPoolRepo.findById(poolItemId);
    if (!entry || entry.saveId !== saveId) return false;
    const deleted = await this.itemPoolRepo.delete(poolItemId);
    if (deleted) {
      this.logger.info('Pool item removed', { saveId, poolItemId });
    }
    return deleted;
  }

  async resolvePoolItemId(idOrName: string, saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    if (!idOrName || typeof idOrName !== 'string') {
      throw new Error('物品名称不能为空');
    }

    const byId = await this.itemPoolRepo.findById(idOrName, trx);
    if (byId && byId.saveId === saveId) return byId.id;

    const byName = await this.itemPoolRepo.findBySaveIdAndName(saveId, idOrName, trx);
    if (byName) {
      this.logger.info('Resolved pool item by name', { input: idOrName, resolved: byName.id });
      return byName.id;
    }

    return null;
  }

  private async _getPoolItemByName(saveId: ID, name: string): Promise<ItemPoolEntry | null> {
    return this.itemPoolRepo.findBySaveIdAndName(saveId, name);
  }

  private async getInventoryItemByName(saveId: ID, name: string, ownerType?: OwnerType, ownerId?: string): Promise<InventoryItem | null> {
    const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId);
    return this.inventoryRepo.findByNameAndSaveIdAndOwner(saveId, name, resolved.ownerType, resolved.ownerId);
  }

  private mergeWithTemplate(template: TemplateItemPoolEntry, overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      name: overrides.name ?? template.name,
      description: overrides.description ?? template.description,
      category: overrides.category ?? template.category,
      quality: overrides.quality ?? template.quality,
      stats: overrides.stats ?? template.stats,
      effects: overrides.effects ?? template.effects,
      value: overrides.value ?? template.value,
      tags: overrides.tags ?? template.tags,
      weight: overrides.weight ?? template.weight,
      maxStack: overrides.maxStack ?? template.maxStack,
      equippedSlot: overrides.equippedSlot ?? template.equippedSlot,
      durability: overrides.durability ?? template.durability,
      maxDurability: overrides.maxDurability ?? template.maxDurability,
      customData: overrides.customData ?? template.customData,
      recommendedClasses: overrides.recommendedClasses ?? template.recommendedClasses,
    };
  }

  /**
   * 返回缺失的必填字段列表（用于错误信息精确化）。
   * 必填字段：name, category（与 insertPoolItem 的默认值逻辑一致——
   * 缺失时 insertPoolItem 会回退到 'misc'，但 LLM 创建场景应显式提供）。
   */
  private getMissingItemFields(params: Record<string, unknown>): string[] {
    const missing: string[] = [];
    if (!params.name) missing.push('name');
    if (!params.category) missing.push('category');
    return missing;
  }

  private isItemFieldsComplete(params: Record<string, unknown>): boolean {
    return this.getMissingItemFields(params).length === 0;
  }

  async addItemFromPool(
    saveId: ID,
    itemName: string,
    quantity?: number,
    ownerType?: OwnerType,
    ownerId?: string,
    fullParams?: Record<string, unknown>,
    trx?: Knex.Transaction
  ): Promise<InventoryItem & { alreadyExists?: boolean; warnings?: string[] }> {
    try {
      const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, trx);

      // Level 1: 尝试从 save pool 查找
      const poolItemId = await this.resolvePoolItemId(itemName, saveId, trx);
      if (poolItemId) {
        const poolItem = await this.getPoolItem(saveId, poolItemId, trx);
        if (!poolItem) {
          throw new Error(`物品池中未找到: ${itemName}`);
        }

        const addQuantity = quantity ?? 1;

        // 检查堆叠：同 item_id 且未装备的物品
        const existingItem = await this.inventoryRepo.findStackableItem(saveId, poolItemId, resolved.ownerType, resolved.ownerId, trx);

        if (existingItem) {
          const currentQuantity = existingItem.quantity;
          const maxStack = poolItem.maxStack || DEFAULT_MAX_STACK;
          const spaceRemaining = maxStack - currentQuantity;

          if (spaceRemaining > 0) {
            const toAdd = Math.min(addQuantity, spaceRemaining);
            const newQuantity = currentQuantity + toAdd;

            await this.inventoryRepo.update(existingItem.id, {
              quantity: newQuantity,
              updatedAt: Date.now() as Timestamp,
            }, trx);

            // 更新 item_pool taken=1
            await this.itemPoolRepo.update(poolItemId, { taken: true }, trx);

            this.logger.info('Item stacked from pool', { poolItemId, added: toAdd, newQuantity });

            eventBus.emit('item_change', { type: 'item_change', saveId, data: { itemId: poolItemId, action: 'add', itemName: poolItem.name }, timestamp: Date.now() });

            // 溢出处理：堆叠空间不足时，为剩余数量创建新行
            if (toAdd < addQuantity) {
              const remaining = addQuantity - toAdd;
              const overflowItem = await this.addItemFromPool(saveId, poolItemId, remaining, resolved.ownerType, resolved.ownerId, undefined, trx);
              const overflowWarnings: string[] = [`物品 '${poolItem.name}' 已存在，quantity: ${currentQuantity} → ${newQuantity}（堆叠 +${toAdd} 达到 maxStack），新建物品 quantity=${remaining}`];
              return { ...overflowItem, alreadyExists: true, warnings: [...overflowWarnings, ...(overflowItem.warnings ?? [])] };
            }

            const updated = await this.inventoryRepo.findById(existingItem.id, trx);
            const warnings = [`物品 '${poolItem.name}' 已存在，quantity: ${currentQuantity} → ${newQuantity}（增量合并 +${toAdd}）`];
            return { ...updated!, alreadyExists: true, warnings };
          }
        }

        // 全面去重检查：findStackableItem 仅检查非装备物品，
        // 已装备的同类物品会被遗漏导致重复创建（code-standards 去重反模式）
        const anyExisting = await this.inventoryRepo.findByItemId(saveId, poolItemId, trx);
        if (anyExisting) {
          const warnings = [`物品 '${poolItem.name}' 已在背包中（id: ${anyExisting.id}），跳过重复创建`];
          return { ...anyExisting, alreadyExists: true, warnings };
        }

        // 创建新 inventory 行（从 poolItem 复制完整定义）
        const newItem = await this.createNewInventoryItemFromPool(saveId, poolItem, poolItemId, addQuantity, resolved, trx);

        eventBus.emit('item_change', { type: 'item_change', saveId, data: { itemId: poolItemId, action: 'add', itemName: poolItem.name }, timestamp: Date.now() });

        // 更新 item_pool taken=1
        await this.itemPoolRepo.update(poolItemId, { taken: true }, trx);

        this.logger.info('Item created from pool', { poolItemId, name: poolItem.name, quantity: addQuantity });

        return newItem;
      }

      // Level 2: 尝试从模板池查找
      const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId, trx);
      if (templateId && this.templatePoolService) {
        const templateItem = await this.templatePoolService.findItemByName(templateId, itemName);
        if (templateItem) {
          const mergedParams = this.mergeWithTemplate(templateItem, fullParams ?? {});
          const newEntry = await this.addPoolItem(saveId, { saveId, ...mergedParams } as AddPoolItemParams, trx);
          return this.addItemFromPool(saveId, newEntry.id, quantity, resolved.ownerType, resolved.ownerId, undefined, trx);
        }
      }

      // Level 3: 检查字段是否完整，完整则创建 + 取用
      // 回写模板池由 addPoolItem 统一处理（单一数据源原则），此处不再重复回写
      const paramsToUse = fullParams ?? { name: itemName };
      if (this.isItemFieldsComplete(paramsToUse)) {
        const newEntry = await this.addPoolItem(saveId, { saveId, ...paramsToUse } as AddPoolItemParams, trx);
        return this.addItemFromPool(saveId, newEntry.id, quantity, resolved.ownerType, resolved.ownerId, undefined, trx);
      }

      const missingFields = this.getMissingItemFields(paramsToUse);
      throw new Error(
        `物品"${itemName}"取用失败：存档池/模板池均未找到，且 fullParams 缺少必填字段 [${missingFields.join(', ')}]。`
        + `请在 fullParams 中提供 name（物品名）和 category（weapon/armor/accessory/tool/consumable/material/quest/misc 之一）。`
        + `可选字段：description, stats, effects, value, weight, quality, durability 等。`
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to add item from pool', { saveId, itemName, error: errorMessage });
      throw error;
    }
  }

  /**
   * 从物品池条目创建新的 inventory 行（从 addItemFromPool 抽取，单一职责）。
   * D9: 支持 trx 参数，供事务内调用透传。
   */
  private async createNewInventoryItemFromPool(
    saveId: ID,
    poolItem: ItemPoolEntry,
    poolItemId: string,
    quantity: number,
    resolved: { ownerType: OwnerType; ownerId: string },
    trx?: Knex.Transaction,
  ): Promise<InventoryItem> {
    const occupiedSlots = await this.inventoryRepo.findOccupiedSlots(saveId, trx);
    const nextSlot = this.findNextAvailableSlot(occupiedSlots);

    if (nextSlot === -1) {
      throw new Error('Inventory is full, no available slots');
    }

    const now = Date.now() as Timestamp;
    const item: Omit<InventoryItem, 'id'> = {
      saveId,
      itemId: poolItemId,
      poolId: poolItemId,
      name: poolItem.name,
      description: poolItem.description || '',
      category: poolItem.category,
      quantity,
      quality: poolItem.quality,
      durability: poolItem.durability,
      maxDurability: poolItem.maxDurability,
      inventorySlot: nextSlot,
      equippedSlot: null,
      equipped: false,
      equippedIndex: null,
      weight: poolItem.weight,
      maxStack: poolItem.maxStack,
      visible: resolved.ownerType === 'npc' ? false : true,
      ownerType: resolved.ownerType,
      ownerId: resolved.ownerId,
      stats: poolItem.stats ?? {},
      effects: poolItem.effects ?? [],
      value: poolItem.value ?? {},
      tags: poolItem.tags ?? [],
      customData: poolItem.customData ?? {},
      createdAt: now,
      updatedAt: now,
    };

    return this.inventoryRepo.insert(item, trx);
  }

  // ---------------------------------------------------------------------------
  // 背包查询方法
  // ---------------------------------------------------------------------------

  async listInventory(saveId: ID, trx?: Knex.Transaction, visibility?: 'all' | 'visible', ownerType?: OwnerType | 'all', ownerId?: string): Promise<{ items: InventoryItem[]; hint?: string }> {
    try {
      // M12: ownerType 空或 "all" → 查所有 owner；精确 owner → 按 owner 过滤
      let allItems: InventoryItem[];
      if (!ownerType || ownerType === 'all') {
        allItems = await this.inventoryRepo.findBySaveId(saveId, trx);
      } else {
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, trx);
        allItems = await this.inventoryRepo.findBySaveIdAndOwner(saveId, resolved.ownerType, resolved.ownerId, trx);
      }

      // 过滤 visible（visibility='all' 时返回全部，其他情况只返回 visible）
      const filtered = visibility === 'all' ? allItems : allItems.filter(item => item.visible);

      // 排序：按 inventory_slot asc, created_at asc
      const items = filtered.sort((a, b) => {
        const slotA = a.inventorySlot ?? Number.MAX_SAFE_INTEGER;
        const slotB = b.inventorySlot ?? Number.MAX_SAFE_INTEGER;
        if (slotA !== slotB) return slotA - slotB;
        return a.createdAt - b.createdAt;
      });

      if (items.length === 0) {
        return { items: [], hint: "背包为空. 建议：使用 add_item 添加物品" };
      }
      return { items };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get inventory', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getItem(saveId: ID, inventoryId: string, ownerType?: string | 'all', ownerId?: string): Promise<InventoryItem | InventoryItem[]> {
    try {
      // M12: ownerType 空或 "all" → 返回所有 owner 的匹配记录（数组）
      if (!ownerType || ownerType === 'all') {
        // 先按 id 查
        const byId = await this.inventoryRepo.findById(inventoryId);
        if (byId && byId.saveId === saveId) return [byId];
        // 按名称查所有 owner
        const byName = await this.inventoryRepo.findAllByNameAndSaveId(saveId, inventoryId);
        if (byName.length === 0) {
          throw new Error(`Inventory item not found: ${inventoryId}. 建议：使用 list_inventory 查看背包中所有物品`);
        }
        return byName;
      }

      // 精确 owner 查询
      const resolvedId = await this.resolveInventoryId(inventoryId, saveId);
      await this.validateOwnership(resolvedId, saveId, ownerType, ownerId);
      const item = await this.inventoryRepo.findById(resolvedId);

      if (!item || item.saveId !== saveId) {
        throw new Error(`Inventory item not found: ${inventoryId}. 建议：使用 list_inventory 查看背包中所有物品`);
      }

      return item;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get item', { saveId, inventoryId, error: errorMessage });
      throw error;
    }
  }

  async resolveInventoryId(inventoryIdOrItemId: string, saveId: ID, trx?: Knex.Transaction): Promise<string> {
    if (!inventoryIdOrItemId || typeof inventoryIdOrItemId !== 'string') {
      throw new Error('物品ID不能为空');
    }

    // 1. 按 id 查询（带 saveId 校验）
    const byId = await this.inventoryRepo.findById(inventoryIdOrItemId, trx);
    if (byId && byId.saveId === saveId) return byId.id;

    // 2. 按 item_id 查询
    const byItemId = await this.inventoryRepo.findBySaveIdAndItemId(saveId, inventoryIdOrItemId, trx);
    if (byItemId) return byItemId.id;

    // 3. 按 name 查询（不带 owner，原逻辑保留）
    const allItems = await this.inventoryRepo.findBySaveId(saveId, trx);
    const byName = allItems.find(item => item.name === inventoryIdOrItemId);
    if (byName) return byName.id;

    // 4. 未找到，列出可用物品提示
    const available = allItems.slice(0, 20);
    const hint = available.map(i => `${i.name}(${i.id})`).join(', ');
    throw new Error(`物品未找到: ${inventoryIdOrItemId}. 可用物品: ${hint}`);
  }

  // ---------------------------------------------------------------------------
  // addItem：支持 fromPool 流程
  // ---------------------------------------------------------------------------

  async addItem(params: AddItemParams, trx?: Knex.Transaction): Promise<InventoryItem & { alreadyExists?: boolean; warnings?: string[] }> {
    try {
      // fromPool=true 或 itemId 存在时，尝试从物品池取用
      if (params.fromPool || params.itemId) {
        const poolItemId = await this.resolvePoolItemId(params.itemId ?? params.name, params.saveId, trx);
        if (poolItemId) {
          return await this.addItemFromPool(
            params.saveId,
            poolItemId,
            params.quantity,
            params.ownerType,
            params.ownerId,
            undefined,
            trx,
          );
        }
        // 物品池无匹配，继续创建新物品
      }

      const resolved = await this.resolveOwnerId(params.saveId, params.ownerType, params.ownerId, trx);

      // 时序修复（设计文档方案1）: 先按稳定业务键（saveId+name+ownerType+ownerId）查重，
      // 命中时增量更新非黑名单字段 + 返回 alreadyExists + warnings，
      // 未命中时再生成 itemId 创建新物品。
      // 与 addPoolItem 时序对齐，避免 Date.now() 生成的 itemId 永远查不到导致重复创建。
      const existingByName = await this.inventoryRepo.findByNameAndSaveIdAndOwner(
        params.saveId,
        params.name,
        resolved.ownerType,
        resolved.ownerId,
        trx,
      );
      if (existingByName) {
        return await this.applyInventoryItemDedupUpdate(params.saveId, existingByName, params, trx);
      }

      // 自动生成 itemId（仅在查重未命中时执行，与 addPoolItem 时序对称）
      let itemId: string;
      if (params.itemId) {
        itemId = params.itemId;
      } else {
        const snakeName = params.name
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
          .replace(/^_|_$/g, '');
        itemId = `item_${snakeName}_${Date.now()}`;
      }

      const quantity = params.quantity ?? 1;
      const maxStack = params.maxStack ?? this.getEffectiveMaxStack(params.category);
      const itemWeight = params.weight ?? 1;

      // 负重系统检查
      if (this.ruleParser.getInventoryRules().weight_system) {
        const currentWeight = await this.getTotalWeight(params.saveId, trx, resolved.ownerType, resolved.ownerId);
        const maxWeight = await this.getMaxWeight(params.saveId, trx);
        const addedWeight = itemWeight * quantity;

        if (currentWeight + addedWeight > maxWeight) {
          throw new Error(`Overweight: adding ${quantity}x ${params.name} (weight ${addedWeight}) would exceed max weight ${maxWeight}. Current weight: ${currentWeight}`);
        }
      }

      const existingItem = await this.inventoryRepo.findStackableItem(
        params.saveId,
        itemId,
        resolved.ownerType,
        resolved.ownerId,
        trx,
      );

      if (existingItem) {
        const currentQuantity = existingItem.quantity;
        const spaceRemaining = maxStack - currentQuantity;

        if (spaceRemaining > 0) {
          const toAdd = Math.min(quantity, spaceRemaining);
          const newQuantity = currentQuantity + toAdd;

          await this.inventoryRepo.update(existingItem.id, {
            quantity: newQuantity,
            updatedAt: Date.now() as Timestamp,
          }, trx);

          if (toAdd < quantity) {
            const remaining = quantity - toAdd;
            const overflowItem = await this.createNewItem({ ...params, itemId }, remaining, trx, resolved);
            const overflowWarnings: string[] = [`物品 '${params.name}' 已存在，quantity: ${currentQuantity} → ${newQuantity}（堆叠 +${toAdd} 达到 maxStack），新建物品 quantity=${remaining}`];
            return { ...overflowItem, alreadyExists: true, warnings: overflowWarnings };
          }

          this.logger.info('Item stacked', { itemId, added: toAdd, newQuantity });

          eventBus.emit('item_change', { type: 'item_change', saveId: params.saveId, data: { itemId, action: 'add', itemName: params.name }, timestamp: Date.now() });

          const updated = await this.inventoryRepo.findById(existingItem.id, trx);
          const warnings = [`物品 '${params.name}' 已存在，quantity: ${currentQuantity} → ${newQuantity}（增量合并 +${toAdd}）`];
          return { ...updated!, alreadyExists: true, warnings };
        }
      }

      return await this.createNewItem({ ...params, itemId }, quantity, trx, resolved);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to add item', { params, error: errorMessage });
      throw error;
    }
  }

  async removeItem(saveId: ID, inventoryId: ID, quantity?: number, trx?: Knex.Transaction, ownerType?: string, ownerId?: string): Promise<InventoryItem | null> {
    try {
      await this.validateOwnership(inventoryId, saveId, ownerType, ownerId, trx);
      const item = await this.inventoryRepo.findById(inventoryId, trx);

      if (!item || item.saveId !== saveId) {
        throw new Error(`Inventory item not found: ${inventoryId}`);
      }

      const removeQuantity = quantity ?? item.quantity;

      if (removeQuantity >= item.quantity) {
        await this.inventoryRepo.delete(inventoryId, trx);
        this.logger.info('Item removed completely', { inventoryId });

        eventBus.emit('item_change', { type: 'item_change', saveId, data: { itemId: item.itemId, action: 'remove', itemName: item.name }, timestamp: Date.now() });

        return null;
      }

      const newQuantity = item.quantity - removeQuantity;

      await this.inventoryRepo.update(inventoryId, {
        quantity: newQuantity,
        updatedAt: Date.now() as Timestamp,
      }, trx);

      const updated = await this.inventoryRepo.findById(inventoryId, trx);
      this.logger.info('Item quantity reduced', { inventoryId, newQuantity });
      return updated;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to remove item', { saveId, inventoryId, error: errorMessage });
      throw error;
    }
  }

  async updateItem(params: UpdateItemParams, trx?: Knex.Transaction): Promise<InventoryItem | null> {
    try {
      const resolvedId = await this.resolveInventoryId(params.inventoryId, params.saveId, trx);
      await this.validateOwnership(resolvedId, params.saveId, params.ownerType, params.ownerId, trx);
      const item = await this.inventoryRepo.findById(resolvedId, trx);

      if (!item || item.saveId !== params.saveId) {
        throw new Error(`Inventory item not found: ${params.inventoryId}`);
      }

      // quantity=0 时自动删除物品
      if (params.quantity === 0) {
        return await this.removeItem(params.saveId, resolvedId as ID, undefined, trx, params.ownerType, params.ownerId);
      }

      const patch: Partial<InventoryItem> = {
        updatedAt: Date.now() as Timestamp,
        // M9 修复: update 操作携带 owner_type/owner_id 供 EntityGraph 构建
        // 与 equipItem/unequipItem 保持一致，从 item 真实归属读取（不信任外部传入）
        ownerType: item.ownerType,
        ownerId: item.ownerId,
      };

      if (params.name !== undefined) patch.name = params.name;
      if (params.category !== undefined) patch.category = params.category;
      if (params.quantity !== undefined) patch.quantity = params.quantity;
      if (params.equipped === true && params.equippedSlot === undefined && !item.equippedSlot) {
        throw new Error('Cannot set equipped=true without equippedSlot. Use equipItem instead.');
      }
      if (params.equipped !== undefined) {
        patch.equipped = params.equipped;
        if (!params.equipped) {
          patch.equippedSlot = null;
        }
      }
      if (params.equippedSlot !== undefined) {
        if (params.equippedSlot) {
          // 类别-槽位合法性校验：验证物品类别是否允许装备到指定槽位
          const effectiveCategory = params.category ?? item.category;
          const equipmentSlots = this.ruleParser.getInventoryRules().equipment_slots;
          const slotConfig = equipmentSlots.find((s: { id: string }) => s.id === params.equippedSlot);
          if (!slotConfig) {
            throw new Error(`Invalid equipment slot: ${params.equippedSlot}. Use equipItem instead.`);
          }
          if (!slotConfig.accepted_item_types.includes(effectiveCategory)) {
            throw new Error(`Slot ${params.equippedSlot} does not accept category ${effectiveCategory}. Use equipItem instead.`);
          }
          patch.equipped = true;
        }
        patch.equippedSlot = params.equippedSlot;
        if (!params.equippedSlot && params.equipped === undefined) {
          patch.equipped = false;
        }
      }
      if (params.visible !== undefined) patch.visible = params.visible;
      if (params.customData !== undefined) patch.customData = params.customData;
      if (params.description !== undefined) patch.description = params.description;
      if (params.stats !== undefined) patch.stats = params.stats;
      if (params.effects !== undefined) patch.effects = params.effects;
      if (params.value !== undefined) patch.value = params.value;
      if (params.tags !== undefined) patch.tags = params.tags;

      const updated = await this.inventoryRepo.update(resolvedId, patch, trx);
      this.logger.info('Item updated', { inventoryId: resolvedId, fields: Object.keys(patch).filter(k => k !== 'updatedAt') });
      return updated;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update item', { params, error: errorMessage });
      throw error;
    }
  }

  async equipItem(
    saveId: ID,
    inventoryIdOrName: ID,
    targetSlot?: EquipmentSlot,
    ownerType?: OwnerType,
    ownerId?: string,
    fullParams?: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<EquipResult> {
    try {
      // Try to find the item in inventory first
      let inventoryId: ID = inventoryIdOrName;
      let resolvedOwnerType = ownerType;

      this.logger.debug('equipItem: searching inventory', { id: inventoryIdOrName, saveId, targetSlot });
      const inventoryItem = await this.inventoryRepo.findById(inventoryIdOrName as string);

      if (inventoryItem && inventoryItem.saveId === saveId) {
        this.logger.debug('equipItem: found in inventory by ID', { id: inventoryItem.id, name: inventoryItem.name, category: inventoryItem.category, equipped: inventoryItem.equipped });
        if (inventoryItem.equipped) {
          // 兜底：已装备物品返回成功，不让 LLM 卡住
          return { success: true, alreadyEquipped: true, previousSlot: inventoryItem.equippedSlot, newSlot: inventoryItem.equippedSlot, message: `物品"${inventoryIdOrName}"已装备` };
        }
        inventoryId = inventoryItem.id;
        resolvedOwnerType = inventoryItem.ownerType;
      } else {
        // Not found by ID, try by name
        this.logger.debug('equipItem: not found by ID, trying name search', { inventoryIdOrName, saveId });
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId);
        const byName = await this.inventoryRepo.findByNameAndSaveIdAndOwner(saveId, inventoryIdOrName as string, resolved.ownerType, resolved.ownerId);

        if (byName) {
          if (byName.equipped) {
            // 兜底：已装备物品返回成功
            return { success: true, alreadyEquipped: true, previousSlot: byName.equippedSlot, newSlot: byName.equippedSlot, message: `物品"${inventoryIdOrName}"已装备` };
          }
          inventoryId = byName.id;
          resolvedOwnerType = byName.ownerType;
        } else {
          // Level 2: Try save pool
          const poolItem = await this._getPoolItemByName(saveId, inventoryIdOrName as string);
          if (poolItem) {
            await this.addItemFromPool(saveId, poolItem.id, 1, resolved.ownerType, resolved.ownerId);
            const addedItem = await this.getInventoryItemByName(saveId, inventoryIdOrName as string, resolved.ownerType, resolved.ownerId);
            if (addedItem) {
              inventoryId = addedItem.id;
              resolvedOwnerType = resolved.ownerType;
            }
          } else {
            // Level 3: Try template pool
            const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId);
            let addedToInventory = false;

            if (templateId && this.templatePoolService) {
              const templateItem = await this.templatePoolService.findItemByName(templateId, inventoryIdOrName as string);
              if (templateItem) {
                const mergedParams = this.mergeWithTemplate(templateItem, fullParams ?? {});
                await this.addPoolItem(saveId, { saveId, ...mergedParams } as AddPoolItemParams);
                await this.addItemFromPool(saveId, inventoryIdOrName as string, 1, resolved.ownerType, resolved.ownerId);
                addedToInventory = true;
              }
            }

            // Level 4: Create if fields complete
            // 回写模板池由 addPoolItem 统一处理（单一数据源原则），此处不再重复回写
            const paramsToUse = fullParams ?? { name: inventoryIdOrName };
            if (!addedToInventory) {
              if (this.isItemFieldsComplete(paramsToUse)) {
                const newEntry = await this.addPoolItem(saveId, { saveId, ...paramsToUse } as AddPoolItemParams);
                await this.addItemFromPool(saveId, newEntry.id, 1, resolved.ownerType, resolved.ownerId);
                addedToInventory = true;
              }
            }

            if (addedToInventory) {
              const addedItem = await this.getInventoryItemByName(saveId, inventoryIdOrName as string, resolved.ownerType, resolved.ownerId);
              if (addedItem) {
                inventoryId = addedItem.id;
                resolvedOwnerType = resolved.ownerType;
              } else {
                // 创建成功但按名查不到：通常是 owner 归属不匹配或命名不一致
                return {
                  success: false,
                  previousSlot: null,
                  newSlot: null,
                  message: `物品"${inventoryIdOrName}"装备失败：物品已创建但无法在背包中找到（owner=${resolved.ownerType}:${resolved.ownerId}）。请检查物品名与 fullParams.name 是否一致，或 ownerType/ownerId 是否正确。`,
                };
              }
            } else {
              // 字段不全：列出具体缺失字段
              const missingFields = this.getMissingItemFields(paramsToUse);
              return {
                success: false,
                previousSlot: null,
                newSlot: null,
                message: `物品"${inventoryIdOrName}"装备失败：存档池/模板池均未找到，且 fullParams 缺少必填字段 [${missingFields.join(', ')}]。请在 fullParams 中提供 name 和 category（仅 weapon/armor/accessory 可装备）。`,
              };
            }
          }
        }
      }

      const item = await this.inventoryRepo.findById(inventoryId as string);

      if (!item || item.saveId !== saveId) {
        return { success: false, previousSlot: null, newSlot: null, message: `Item not found: ${inventoryId}` };
      }

      if (item.equipped) {
        // 兜底：已装备返回成功
        return { success: true, alreadyEquipped: true, previousSlot: item.equippedSlot, newSlot: item.equippedSlot, message: `物品"${item.name}"已装备` };
      }

      const category = item.category;
      const resolvedSlot = targetSlot ? this.resolveSlotAlias(targetSlot, category) : this.getDefaultEquipmentSlot(category);
      const slot = resolvedSlot;

      this.logger.debug('equipItem: slot resolution', { itemId: item.id, itemName: item.name, category, targetSlot, resolvedSlot });

      if (!slot) {
        this.logger.warn('equipItem: no valid slot', { category, targetSlot });
        return { success: false, previousSlot: null, newSlot: null, message: `No valid equipment slot for category: ${category}` };
      }

      const allowedCategories = this.ruleParser.getInventoryRules().equipment_slots
        .find(s => s.id === slot)?.accepted_item_types;
      if (!allowedCategories) {
        this.logger.warn('equipItem: invalid slot config', { slot });
        return { success: false, previousSlot: null, newSlot: null, message: `Invalid equipment slot: ${slot}` };
      }
      if (!allowedCategories.includes(category)) {
        this.logger.warn('equipItem: category not allowed', { slot, category, allowedCategories });
        return { success: false, previousSlot: null, newSlot: slot, message: `Slot ${slot} does not accept category ${category}` };
      }

      const finalOwnerType = resolvedOwnerType ?? item.ownerType;
      if (!finalOwnerType) {
        throw new Error('Item missing owner_type: cannot determine ownership for equip');
      }
      // 历史数据 owner_id 可能存的是 NPC 名字（修复前 LLM 直接传入），装备后做派生属性重算时
      // 需要完整 id，此处对 NPC 做一次 resolve（与 resolveOwnerId 一致）。
      // 已是 id 时 resolveNpcId 第一按 id 查即可命中，无额外开销。
      const resolvedOwnerId = item.ownerId;
      if (!resolvedOwnerId) {
        throw new Error('Item missing owner_id: cannot determine ownership for equip');
      }
      const finalResolvedOwnerId = finalOwnerType === 'npc' && this.npcService
        ? await this.resolveNpcIdSafe(saveId, resolvedOwnerId)
        : resolvedOwnerId;

      // 数组化槽位 vs 单槽位分支逻辑
      const isArrayList = this.isArrayListSlot(slot);
      let assignedIndex: number | undefined;
      let replacedItems: Array<{ inventoryId: ID; previousIndex: number }> | undefined;
      let previousSlot: EquipmentSlot | null = null;

      await this.runInTransaction(trx, async (t) => {
        // M8: update 操作携带 owner_type/owner_id，确保 EntityGraphUpdater.resolveOwnerInfo 能从 write.data 提取归属
        const ownerPatch = { ownerType: finalOwnerType, ownerId: finalResolvedOwnerId };

        if (isArrayList) {
          // 数组化槽位：查询当前已装备物品（按 equippedIndex 升序）
          const equipped = await this.inventoryRepo.findByEquippedSlotOrdered(saveId, slot, finalOwnerType, finalResolvedOwnerId, t);
          const capacity = this.getSlotCapacity(slot);

          if (equipped.length < capacity) {
            // 有空位：新装备追加到末尾（index = max + 1）
            const nextIndex = equipped.length > 0
              ? (equipped[equipped.length - 1].equippedIndex ?? 0) + 1
              : 0;
            await this.inventoryRepo.update(inventoryId as string, {
              equipped: true,
              equippedSlot: slot,
              equippedIndex: nextIndex,
              updatedAt: Date.now() as Timestamp,
              ...ownerPatch,
            }, t);
            assignedIndex = nextIndex;
          } else {
            // 无空位：堆栈替换 — 撤下 index 最大的（最旧），其余 +1，新装备 index=0
            const oldest = equipped[equipped.length - 1];
            previousSlot = oldest.equippedSlot;
            const oldestIndex = oldest.equippedIndex ?? 0;

            // 撤下最旧装备
            await this.inventoryRepo.update(oldest.id, {
              equipped: false,
              equippedSlot: null,
              equippedIndex: null,
              updatedAt: Date.now() as Timestamp,
              ...ownerPatch,
            }, t);

            // 其余装备 equippedIndex +1（仅 index < oldestIndex 的）
            if (oldestIndex > 0) {
              await this.inventoryRepo.updateEquippedIndexBatch(saveId, slot, 1, { maxIndex: oldestIndex - 1 }, finalOwnerType, finalResolvedOwnerId, t);
            }

            // 新装备 index=0
            await this.inventoryRepo.update(inventoryId as string, {
              equipped: true,
              equippedSlot: slot,
              equippedIndex: 0,
              updatedAt: Date.now() as Timestamp,
              ...ownerPatch,
            }, t);
            assignedIndex = 0;
            replacedItems = [{ inventoryId: oldest.id, previousIndex: oldestIndex }];
          }
        } else {
          // 单槽位：原有逻辑（直接替换）
          const existingEquipped = await this.inventoryRepo.findEquippedBySlot(saveId, slot, finalOwnerType, finalResolvedOwnerId, t);
          if (existingEquipped) {
            previousSlot = existingEquipped.equippedSlot;
            await this.inventoryRepo.update(existingEquipped.id, {
              equipped: false,
              equippedSlot: null,
              equippedIndex: null,
              updatedAt: Date.now() as Timestamp,
              ...ownerPatch,
            }, t);
          }

          await this.inventoryRepo.update(inventoryId as string, {
            equipped: true,
            equippedSlot: slot,
            equippedIndex: null,
            updatedAt: Date.now() as Timestamp,
            ...ownerPatch,
          }, t);
        }

        if (finalOwnerType === 'npc') {
          await this.numericalService.recalculateNpcAttributes(saveId, finalResolvedOwnerId, t);
        } else {
          await this.numericalService.recalculateDerivedAttributes(saveId, t);
        }
      });

      this.logger.info('Item equipped', { inventoryId, slot, isArrayList, assignedIndex, replacedCount: replacedItems?.length ?? 0 });

      eventBus.emit('equip_item', { type: 'equip_item', saveId, data: { itemId: item.itemId, itemName: item.name, slot }, timestamp: Date.now() });

      // 别名映射检测：LLM 传入 chest 被解析为 body 时，返回 requestedSlot 让 LLM 理解映射关系
      // slot 来自 equipmentSlots[].id 约定为小写，比较前需对 targetSlot toLowerCase 避免大小写误报
      const aliasMapped = targetSlot && targetSlot.toLowerCase() !== slot;
      const slotHint = aliasMapped ? ` (${targetSlot}→${slot})` : '';
      const indexHint = assignedIndex !== undefined ? ` [index=${assignedIndex}]` : '';
      const replaceHint = replacedItems && replacedItems.length > 0 ? ` (撤下${replacedItems.length}件)` : '';
      return {
        success: true,
        previousSlot,
        newSlot: slot,
        requestedSlot: aliasMapped ? (targetSlot as string) : undefined,
        assignedIndex,
        replacedItems,
        message: replacedItems && replacedItems.length > 0
          ? `Replaced item in ${slot}${slotHint}${indexHint}${replaceHint} with ${item.name}`
          : `Equipped ${item.name} to ${slot}${slotHint}${indexHint}`
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to equip item', { saveId, inventoryIdOrName, error: errorMessage });
      throw error;
    }
  }

  async unequipItem(saveId: ID, inventoryId: ID, ownerType?: OwnerType, ownerId?: string, trx?: Knex.Transaction): Promise<InventoryItem> {
    try {
      return await this.runInTransaction(trx, async (t) => {
        // 校验归属一致性（与 removeItem/updateItem/useItem/tradeItems 统一，遵循架构规范 13.3）
        // ownerType 空 → 默认 character，若 item 实际属于 NPC 则抛错（LLM 应传 ownerType="npc"）
        await this.validateOwnership(inventoryId as string, saveId, ownerType, ownerId, t);

        const item = await this.inventoryRepo.findById(inventoryId as string, t);

        if (!item || item.saveId !== saveId) {
          throw new Error(`Inventory item not found: ${inventoryId}`);
        }

        if (!item.equipped) {
          throw new Error(`Item is not equipped: ${inventoryId}`);
        }

        const previousSlot = item.equippedSlot;
        const previousIndex = item.equippedIndex;

        // M8: update 操作携带 owner_type/owner_id，确保 EntityGraphUpdater.resolveOwnerInfo 能从 write.data 提取归属
        await this.inventoryRepo.update(inventoryId as string, {
          equipped: false,
          equippedSlot: null,
          equippedIndex: null,
          updatedAt: Date.now() as Timestamp,
          ownerType: item.ownerType,
          ownerId: item.ownerId,
        }, t);

        // 数组化槽位卸下后：后续装备索引前移填补空位（保持数组紧凑）
        if (previousSlot && this.isArrayListSlot(previousSlot) && previousIndex !== null) {
          await this.inventoryRepo.updateEquippedIndexBatch(
            saveId, previousSlot, -1, { minIndex: previousIndex + 1 },
            item.ownerType, item.ownerId, t,
          );
        }

        // M9 修复: 使用 item.ownerType（数据真实归属）而非外部传入的 ownerType 判断分支
        // 避免LLM不传ownerType时NPC物品走character分支导致派生属性重算错误
        if (item.ownerType === 'npc') {
          if (!item.ownerId) throw new Error('NPC item missing owner_id');
          // 历史数据 owner_id 可能存的是 NPC 名字，需 resolve 为完整 id（与 equipItem 一致）
          let npcIdForRecalc = item.ownerId;
          if (this.npcService) {
            try {
              npcIdForRecalc = await this.npcService.resolveNpcId(saveId, item.ownerId, t);
            } catch {
              // resolve 失败保留原值，让 recalculateNpcAttributes 报出原始错误
            }
          }
          await this.numericalService.recalculateNpcAttributes(saveId, npcIdForRecalc, t);
        } else {
          await this.numericalService.recalculateDerivedAttributes(saveId, t);
        }

        const updated = await this.inventoryRepo.findById(inventoryId as string, t);
        this.logger.info('Item unequipped', { inventoryId, previousSlot });
        return updated!;
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to unequip item', { saveId, inventoryId, error: errorMessage });
      throw error;
    }
  }

  async useItem(saveId: ID, inventoryId: ID, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<UseItemResult> {
    try {
      return await this.runInTransaction(trx, async (t) => {
        await this.validateOwnership(inventoryId, saveId, ownerType, ownerId, t);
        const item = await this.inventoryRepo.findById(inventoryId as string, t);

        if (!item || item.saveId !== saveId) {
          return { success: false, effects: [], appliedEffects: [], consumed: false, remainingQuantity: 0, message: `Item not found: ${inventoryId}` };
        }

        if (item.category !== 'consumable') {
          return { success: false, effects: [], appliedEffects: [], consumed: false, remainingQuantity: item.quantity, message: `Cannot use non-consumable item of category: ${item.category}` };
        }

        if (item.quantity <= 0) {
          return { success: false, effects: [], appliedEffects: [], consumed: false, remainingQuantity: 0, message: 'No items left to use' };
        }

        const effects = item.effects;

        // M11: 自动应用确定性效果（character 和 npc 都支持）
        // 原: isCharacterOwner = !ownerType || ownerType === 'character'，NPC 不触发
        // 改: 通过 resolveOwnerId 解析 owner，对 character 和 npc 都自动应用
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, t);
        const appliedEffects: AppliedEffect[] = [];
        for (const effect of effects) {
          if (!DETERMINISTIC_EFFECT_TYPES.includes(effect.type as DeterministicEffectType)) continue;
          try {
            const result = await this.applyDeterministicEffect(
              saveId,
              effect.type as DeterministicEffectType,
              effect.value,
              resolved.ownerType,
              resolved.ownerId,
              t,
            );
            if (result) appliedEffects.push(result);
          } catch (err) {
            this.logger.warn('Failed to auto-apply effect', { type: effect.type, value: effect.value, error: String(err) });
          }
        }

        const newQuantity = item.quantity - 1;
        let durability = item.durability;

        if (newQuantity <= 0) {
          await this.inventoryRepo.delete(inventoryId as string, t);
          this.logger.info('Consumable used and depleted', { inventoryId, itemName: item.name });

          eventBus.emit('use_item', { type: 'use_item', saveId, data: { itemId: item.itemId, itemName: item.name, consumed: true }, timestamp: Date.now() });

          return {
            success: true,
            effects: effects as Array<{ type: string; value: number; target: string }>,
            appliedEffects,
            consumed: true,
            remainingQuantity: 0,
            message: `Used ${item.name}, item consumed`
          };
        }

        durability = Math.max(0, durability - 1);

        await this.inventoryRepo.update(inventoryId as string, {
          quantity: newQuantity,
          durability,
          updatedAt: Date.now() as Timestamp,
        }, t);

        this.logger.info('Consumable used', { inventoryId, itemName: item.name, remaining: newQuantity });

        eventBus.emit('use_item', { type: 'use_item', saveId, data: { itemId: item.itemId, itemName: item.name, consumed: false, remainingQuantity: newQuantity }, timestamp: Date.now() });

        return {
          success: true,
          effects: effects as Array<{ type: string; value: number; target: string }>,
          appliedEffects,
          consumed: false,
          remainingQuantity: newQuantity,
          message: `Used ${item.name}, ${newQuantity} remaining`
        };
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to use item', { saveId, inventoryId, error: errorMessage });
      throw error;
    }
  }

  private async applyDeterministicEffect(
    saveId: ID,
    type: DeterministicEffectType,
    value: number,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction,
  ): Promise<AppliedEffect | null> {
    switch (type) {
      case 'heal': {
        if (ownerType === 'character') {
          const result = await this.characterService.modifyHealth(saveId, value, trx);
          return { type: 'heal', value, previous: result.previous, current: result.current, max: result.max };
        }
        // NPC: 通过 npcService.modifyNpcResource 修改 HP
        if (!this.npcService) {
          throw new Error('NPCService not injected: cannot apply heal effect to NPC');
        }
        await this.npcService.modifyNpcResource(saveId, ownerId, 'hp', value, trx);
        return { type: 'heal', value, previous: null, current: null, max: null };
      }
      case 'mana_restore': {
        if (ownerType === 'character') {
          const result = await this.characterService.modifyMana(saveId, value, trx);
          return { type: 'mana_restore', value, previous: result.previous, current: result.current, max: result.max };
        }
        // NPC: 通过 npcService.modifyNpcResource 修改 MP
        if (!this.npcService) {
          throw new Error('NPCService not injected: cannot apply mana_restore effect to NPC');
        }
        await this.npcService.modifyNpcResource(saveId, ownerId, 'mp', value, trx);
        return { type: 'mana_restore', value, previous: null, current: null, max: null };
      }
      case 'stamina_restore': {
        if (ownerType === 'character') {
          const result = await this.characterService.modifyStamina(saveId, value, trx);
          return { type: 'stamina_restore', value, previous: result.previous, current: result.current, max: null };
        }
        // NPC: 通过 npcService.modifyNpcResource 修改 Stamina
        if (!this.npcService) {
          throw new Error('NPCService not injected: cannot apply stamina_restore effect to NPC');
        }
        await this.npcService.modifyNpcResource(saveId, ownerId, 'stamina', value, trx);
        return { type: 'stamina_restore', value, previous: null, current: null, max: null };
      }
      case 'damage': {
        if (ownerType === 'character') {
          const result = await this.characterService.modifyHealth(saveId, -value, trx);
          return { type: 'damage', value, previous: result.previous, current: result.current, max: result.max };
        }
        // NPC: 通过 npcService.modifyNpcResource 扣减 HP
        if (!this.npcService) {
          throw new Error('NPCService not injected: cannot apply damage effect to NPC');
        }
        await this.npcService.modifyNpcResource(saveId, ownerId, 'hp', -value, trx);
        return { type: 'damage', value, previous: null, current: null, max: null };
      }
      default:
        return null;
    }
  }

  async getTotalWeight(saveId: ID, trx?: Knex.Transaction, ownerType?: OwnerType, ownerId?: string): Promise<number> {
    try {
      const { items } = await this.listInventory(saveId, trx, undefined, ownerType, ownerId);
      let totalWeight = 0;
      for (const item of items) {
        totalWeight += item.weight * item.quantity;
      }
      return totalWeight;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get total weight', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getMaxWeight(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    try {
      const characterInfo = await this.characterService.getCharacterBasicInfo(saveId, trx);

      if (!characterInfo) {
        this.logger.warn('Character not found for max weight calculation, using default', { saveId });
        return 10 * WEIGHT_PER_ENDURANCE;
      }

      const enduranceKey = this.ruleParser.getAttributeRoleMapping().endurance;
      const endurance = characterInfo.attributes[enduranceKey] ?? 10;

      return endurance * WEIGHT_PER_ENDURANCE;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get max weight', { saveId, error: errorMessage });
      throw error;
    }
  }

  async tradeItems(saveId: ID, params: TradeParams): Promise<TradeResult> {
    try {
      return await this.txManager.transaction(async (trx) => {
        const sold: Array<{ itemId: string; name: string; quantity: number; value: number }> = [];
        const bought: Array<{ itemId: string; name: string; quantity: number }> = [];

        for (const sellItem of params.sellItems) {
          await this.validateOwnership(sellItem.inventoryId, saveId, params.ownerType, params.ownerId, trx);
        }

        // M11: 金币按 ownerType 分支查询（原硬编码查角色金币，NPC 交易会扣角色的钱）
        const resolved = await this.resolveOwnerId(saveId, params.ownerType, params.ownerId, trx);

        let currentGold: number;
        if (resolved.ownerType === 'character') {
          const characterInfo = await this.characterService.getCharacterBasicInfo(saveId, trx);
          if (!characterInfo) {
            return {
              success: false,
              sold: [],
              bought: [],
              goldChange: 0,
              newGoldBalance: 0,
              error: 'Character not found'
            };
          }
          currentGold = characterInfo.currency.gold ?? 0;
        } else {
          // NPC: 通过 npcService.getNpcResources 查询金币
          if (!this.npcService) {
            throw new Error('NPCService not injected: cannot query NPC gold for trade');
          }
          const npcResources = await this.npcService.getNpcResources(saveId, resolved.ownerId, trx);
          currentGold = npcResources.currency?.gold ?? 0;
        }

        const goldDelta = params.goldDelta ?? 0;

        if (currentGold + goldDelta < 0) {
          return {
            success: false,
            sold: [],
            bought: [],
            goldChange: 0,
            newGoldBalance: currentGold,
            error: `Insufficient gold. Have: ${currentGold}, Need: ${Math.abs(goldDelta)}`
          };
        }

        // 验证并处理卖出物品
        for (const sellItem of params.sellItems) {
          const item = await this.inventoryRepo.findById(sellItem.inventoryId, trx);

          if (!item || item.saveId !== saveId) {
            throw new Error(`Sell item not found: ${sellItem.inventoryId}`);
          }

          if (item.quantity < sellItem.quantity) {
            throw new Error(`Insufficient quantity for item ${item.name}. Have: ${item.quantity}, Need: ${sellItem.quantity}`);
          }

          const price = item.value.sell || 1;

          await this.removeItem(saveId, sellItem.inventoryId, sellItem.quantity, trx, params.ownerType, params.ownerId);

          sold.push({
            itemId: item.itemId,
            name: item.name,
            quantity: sellItem.quantity,
            value: price * sellItem.quantity
          });
        }

        // 处理买入物品：从物品池取用，找不到则抛错（不再创建 misc 占位物品）
        for (const buyItem of params.buyItems) {
          const addedItem = await this.addItemFromPool(
            saveId,
            buyItem.inventoryId,
            buyItem.quantity,
            params.ownerType,
            params.ownerId,
            undefined,
            trx,
          );

          bought.push({
            itemId: buyItem.inventoryId,
            name: addedItem.name,
            quantity: buyItem.quantity,
          });
        }

        // M11: 更新金币（按 ownerType 分支）
        const newGoldBalance = Math.max(0, currentGold + goldDelta);
        if (resolved.ownerType === 'character') {
          await this.characterService.modifyCurrency(saveId, 'gold', goldDelta, trx);
        } else {
          if (!this.npcService) {
            throw new Error('NPCService not injected: cannot modify NPC gold for trade');
          }
          await this.npcService.modifyNpcResource(saveId, resolved.ownerId, 'currency', goldDelta, trx);
        }

        this.logger.info('Trade completed', {
          saveId,
          soldCount: sold.length,
          boughtCount: bought.length,
          goldDelta,
          newGoldBalance
        });

        return {
          success: true,
          sold,
          bought,
          goldChange: goldDelta,
          newGoldBalance
        };
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to trade items', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getEquipment(saveId: ID, ownerType?: OwnerType | 'all', ownerId?: string): Promise<{ equipment: InventoryItem[]; hint?: string }> {
    try {
      // M12: ownerType 空或 "all" → 查所有 owner 的已装备物品
      let rows: InventoryItem[];
      let logOwnerType: string;
      let logOwnerId: string | undefined;
      if (!ownerType || ownerType === 'all') {
        rows = await this.inventoryRepo.findEquippedBySaveId(saveId);
        logOwnerType = 'all';
        logOwnerId = undefined;
      } else {
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId);
        rows = await this.inventoryRepo.findEquippedBySaveIdAndOwner(saveId, resolved.ownerType, resolved.ownerId);
        logOwnerType = resolved.ownerType;
        logOwnerId = resolved.ownerId;
      }

      // M12 修复: dedup key 包含 owner 维度，避免 ownerType="all" 时
      // 不同 owner 同槽位物品被误判为重复（docs 期望返回所有 owner 的已装备物品）
      // 数组化槽位（capacity>1）dedup key 额外包含 equippedIndex，允许多物品共存于同槽位
      const latestBySlot = new Map<string, InventoryItem>();
      const duplicates: InventoryItem[] = [];

      for (const row of rows) {
        const slot = row.equippedSlot && row.equippedSlot.length > 0 ? row.equippedSlot : null;

        if (!slot) {
          duplicates.push(row);
          continue;
        }

        const isArrayList = this.isArrayListSlot(slot);
        const dedupKey = isArrayList
          ? `${slot}:${row.ownerType}:${row.ownerId}:${row.equippedIndex}`
          : `${slot}:${row.ownerType}:${row.ownerId}`;
        const existing = latestBySlot.get(dedupKey);
        if (!existing) {
          latestBySlot.set(dedupKey, row);
          continue;
        }

        if (row.updatedAt >= existing.updatedAt) {
          duplicates.push(existing);
          latestBySlot.set(dedupKey, row);
        } else {
          duplicates.push(row);
        }
      }

      if (duplicates.length > 0) {
        const duplicateIds = duplicates.map(d => d.id).filter(Boolean);
        this.logger.warn('Detected duplicate equipped items in same slot, auto-healing', {
          saveId,
          ownerType: logOwnerType,
          ownerId: logOwnerId,
          duplicateIds,
        });
        // 包事务确保多个 duplicate 的 auto-healing 原子提交，避免中途失败导致
        // 部分已卸下、部分仍装备的不一致状态（与 equipItem/unequipItem 的 runInTransaction 对称）
        await this.runInTransaction(undefined, async (t) => {
          for (const duplicate of duplicates) {
            if (!duplicate.id) continue;
            // M8 同款修复：auto-healing 路径同样修改 equipped 字段，需携带 owner_type/owner_id
            // 供 EntityGraphUpdater.resolveOwnerInfo 提取，避免抛 "Missing owner_type/owner_id"
            await this.inventoryRepo.update(duplicate.id, {
              equipped: false,
              equippedSlot: null,
              equippedIndex: null,
              updatedAt: Date.now() as Timestamp,
              ownerType: duplicate.ownerType,
              ownerId: duplicate.ownerId,
            }, t);
          }
        });
      }

      // 排序：先按 equippedSlot 升序，同槽位内按 equippedIndex 升序（数组化槽位）
      const equipment = Array.from(latestBySlot.values())
        .sort((a, b) => {
          const slotCompare = String(a.equippedSlot ?? '').localeCompare(String(b.equippedSlot ?? ''));
          if (slotCompare !== 0) return slotCompare;
          const aIdx = a.equippedIndex ?? Number.MAX_SAFE_INTEGER;
          const bIdx = b.equippedIndex ?? Number.MAX_SAFE_INTEGER;
          return aIdx - bIdx;
        });
      if (equipment.length === 0) {
        return { equipment: [], hint: "当前无已装备物品. 建议：使用 equip_item 装备物品" };
      }
      return { equipment };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get equipment', { saveId, error: errorMessage });
      throw error;
    }
  }

  async checkItemQuantity(saveId: ID, itemId: string, ownerType?: string, ownerId?: string): Promise<number> {
    try {
      return await this.inventoryRepo.sumQuantityBySaveIdAndItemId(
        saveId,
        itemId,
        ownerType as OwnerType | undefined,
        ownerId,
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check item quantity', { saveId, itemId, error: errorMessage });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 私有辅助方法
  // ---------------------------------------------------------------------------

  private async createNewItem(params: AddItemParams & { itemId: string }, quantity: number, trx?: Knex.Transaction, resolved?: { ownerType: OwnerType; ownerId: string }): Promise<InventoryItem> {
    const now = Date.now() as Timestamp;
    const quality = params.quality ?? ('common' as ItemQuality);
    const maxDurability = params.maxDurability ?? (100 * QUALITY_DURABILITY_MULTIPLIER[quality]);
    const durability = params.durability ?? maxDurability;
    const weight = params.weight ?? 1;
    const maxStack = params.maxStack ?? this.getEffectiveMaxStack(params.category);

    const itemId = params.itemId;

    const occupiedSlots = await this.inventoryRepo.findOccupiedSlots(params.saveId, trx);
    const nextSlot = this.findNextAvailableSlot(occupiedSlots);

    if (nextSlot === -1) {
      throw new Error('Inventory is full, no available slots');
    }

    const ownerType = resolved?.ownerType;
    const ownerId = resolved?.ownerId;
    if (!ownerType || !ownerId) {
      throw new Error('Owner information is required to create inventory item: ownerType or ownerId missing');
    }
    const customData = params.customData ?? {};
    const inventorySlot = params.inventorySlot ?? nextSlot;

    const item: Omit<InventoryItem, 'id'> = {
      saveId: params.saveId,
      itemId,
      poolId: '',
      name: params.name,
      description: params.description || '',
      category: params.category,
      quantity,
      quality,
      durability,
      maxDurability,
      inventorySlot,
      equippedSlot: null,
      equipped: false,
      equippedIndex: null,
      weight,
      maxStack,
      visible: Boolean(params.visible),
      ownerType,
      ownerId,
      stats: params.stats ?? {},
      effects: params.effects ?? [],
      value: params.value ?? {},
      tags: params.tags ?? [],
      customData,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await this.inventoryRepo.insert(item, trx);

    this.logger.info('New item created', { itemId, name: params.name, quantity, inventorySlot });

    eventBus.emit('item_change', { type: 'item_change', saveId: params.saveId, data: { itemId, action: 'add', itemName: params.name }, timestamp: Date.now() });

    return inserted;
  }

  private findNextAvailableSlot(occupiedSlots: number[]): number {
    for (let i = 0; i < this.getEffectiveMaxSlots(); i++) {
      if (!occupiedSlots.includes(i)) {
        return i;
      }
    }
    return -1;
  }

  private resolveSlotAlias(targetSlot: string, category: ItemCategory): EquipmentSlot | null {
    const equipmentSlots = this.ruleParser.getInventoryRules().equipment_slots;

    // 常见槽位别名映射：LLM 可能用的名称 → 实际槽位 ID
    // 旧别名 accessory1/accessory2 统一映射为 accessory（数组化改造后）
    const slotAliases: Record<string, string> = {
      chest: 'body',
      torso: 'body',
      accessory1: 'accessory',
      accessory2: 'accessory',
      ring1: 'accessory',
      ring2: 'accessory',
      amulet: 'accessory',
      necklace: 'accessory',
      main: 'main_hand',
      off: 'off_hand',
      hand: 'hands',
      boot: 'feet',
      boots: 'feet',
      shoe: 'feet',
      shoes: 'feet',
      hat: 'head',
      helmet: 'head',
      cap: 'head',
    };

    // 类别名映射：类别名 → 优先槽位列表
    const categoryAliases: Record<string, string[]> = {
      accessory: ['accessory'],
      ring: ['accessory'],
      weapon: ['main_hand', 'off_hand'],
      armor: ['body', 'head', 'hands', 'feet'],
    };

    // Step 1: 槽位别名解析（chest → body, accessory1 → accessory）
    const resolvedName = slotAliases[targetSlot.toLowerCase()] ?? targetSlot.toLowerCase();

    // Step 2: 类别名解析（weapon → main_hand/off_hand）
    const candidates = categoryAliases[resolvedName];
    if (candidates) {
      for (const slotId of candidates) {
        const slot = equipmentSlots.find(s => s.id === slotId);
        if (slot && slot.accepted_item_types.includes(category)) {
          return slotId as EquipmentSlot;
        }
      }
    }

    // Step 3: 精确匹配（用解析后的名称）
    const exactMatch = equipmentSlots.find(s => s.id === resolvedName);
    if (exactMatch) return resolvedName as EquipmentSlot;

    // Step 4: 原始名称精确匹配（别名解析失败时的 fallback）
    // equipmentSlots[].id 约定为小写，targetSlot 需 toLowerCase 后比较
    if (resolvedName !== targetSlot.toLowerCase()) {
      const normalizedSlot = targetSlot.toLowerCase();
      const originalMatch = equipmentSlots.find(s => s.id === normalizedSlot);
      if (originalMatch) return normalizedSlot as EquipmentSlot;
    }

    return null;
  }

  /** 判断槽位是否为数组化槽位（capacity > 1） */
  private isArrayListSlot(slotId: string): boolean {
    const slot = this.ruleParser.getInventoryRules().equipment_slots.find(s => s.id === slotId);
    return !!slot && (slot.capacity ?? 1) > 1;
  }

  /** 获取数组化槽位的容量 */
  private getSlotCapacity(slotId: string): number {
    const slot = this.ruleParser.getInventoryRules().equipment_slots.find(s => s.id === slotId);
    return slot?.capacity ?? 1;
  }

  private getDefaultEquipmentSlot(category: ItemCategory): EquipmentSlot | null {
    const equipmentSlots = this.ruleParser.getInventoryRules().equipment_slots;
    if (!equipmentSlots || equipmentSlots.length === 0) return null;

    const preferredSlots: Record<string, string[]> = {
      weapon: ['main_hand', 'off_hand'],
      armor: ['body', 'head', 'hands', 'feet', 'off_hand'],
      accessory: ['accessory', 'off_hand'],
      consumable: [],
      material: [],
      tool: [],
      quest: [],
      misc: []
    };

    const preferred = preferredSlots[category] || [];
    for (const slotId of preferred) {
      const slot = equipmentSlots.find(s => s.id === slotId);
      if (slot && slot.accepted_item_types.includes(category)) {
        return slot.id as EquipmentSlot;
      }
    }

    for (const slot of equipmentSlots) {
      if (slot.accepted_item_types.includes(category)) {
        return slot.id as EquipmentSlot;
      }
    }
    return null;
  }
}
