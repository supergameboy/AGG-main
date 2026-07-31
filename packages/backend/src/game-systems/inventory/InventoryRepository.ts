import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { parseJsonField } from '../../utils/pool-helpers.js';
import type {
  IInventoryRepository,
  InventoryItem,
  ItemCategory,
  ItemQuality,
  OwnerType,
  ItemEffect,
  ItemValue,
} from './types.js';
import type { EquipmentSlot } from '../../../../shared/src/types/game.js';

/**
 * Inventory 表 Repository 实现（D7: 操作 inventory 表）。
 * 从 InventoryService.rowToInventoryItem (L1528-1558) 迁移映射逻辑。
 */
export class InventoryRepository
  extends BaseRepository<'inventory', InventoryItem>
  implements IInventoryRepository
{
  constructor(db: Knex) {
    super(db, 'inventory');
  }

  protected rowToEntity(row: Record<string, unknown>): InventoryItem {
    return {
      id: row.id as ID,
      saveId: row.save_id as ID,
      itemId: row.item_id as string,
      poolId: (row.pool_id as string) || '',
      name: row.name as string,
      description: (row.description as string) || '',
      category: row.category as ItemCategory,
      quantity: row.quantity as number,
      quality: row.quality as ItemQuality,
      durability: row.durability as number,
      maxDurability: row.max_durability as number,
      inventorySlot: row.inventory_slot !== null && row.inventory_slot !== undefined
        ? (row.inventory_slot as number) : null,
      equippedSlot: row.equipped_slot !== null ? (row.equipped_slot as EquipmentSlot) : null,
      equipped: Boolean(row.equipped),
      equippedIndex: row.equipped_index !== null && row.equipped_index !== undefined
        ? (row.equipped_index as number) : null,
      weight: row.weight as number,
      maxStack: row.max_stack as number,
      stats: parseJsonField<Record<string, number>>(row.stats, {}),
      effects: parseJsonField<ItemEffect[]>(row.effects, []),
      value: parseJsonField<ItemValue>(row.value, {}),
      tags: parseJsonField<string[]>(row.tags, []),
      visible: Boolean(row.visible),
      ownerType: row.owner_type as OwnerType,
      ownerId: row.owner_id as string,
      customData: parseJsonField<Record<string, unknown>>(row.custom_data, {}),
      createdAt: (row.created_at as number) || Date.now(),
      updatedAt: (row.updated_at as number) || Date.now(),
    };
  }

  /**
   * entity → row 转换（insert/update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   * JSON 字段（stats/effects/value/tags/customData）需 JSON.stringify。
   */
  private entityToRow(entity: Partial<InventoryItem>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.itemId !== undefined) row.item_id = entity.itemId;
    if (entity.poolId !== undefined) row.pool_id = entity.poolId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.category !== undefined) row.category = entity.category;
    if (entity.quantity !== undefined) row.quantity = entity.quantity;
    if (entity.quality !== undefined) row.quality = entity.quality;
    if (entity.durability !== undefined) row.durability = entity.durability;
    if (entity.maxDurability !== undefined) row.max_durability = entity.maxDurability;
    if (entity.inventorySlot !== undefined) row.inventory_slot = entity.inventorySlot;
    if (entity.equippedSlot !== undefined) row.equipped_slot = entity.equippedSlot;
    if (entity.equipped !== undefined) row.equipped = entity.equipped;
    if (entity.equippedIndex !== undefined) row.equipped_index = entity.equippedIndex;
    if (entity.weight !== undefined) row.weight = entity.weight;
    if (entity.maxStack !== undefined) row.max_stack = entity.maxStack;
    if (entity.visible !== undefined) row.visible = entity.visible;
    if (entity.ownerType !== undefined) row.owner_type = entity.ownerType;
    if (entity.ownerId !== undefined) row.owner_id = entity.ownerId;
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt;
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt;

    // JSON 字段需 stringify
    if (entity.stats !== undefined) row.stats = JSON.stringify(entity.stats ?? {});
    if (entity.effects !== undefined) row.effects = JSON.stringify(entity.effects ?? []);
    if (entity.value !== undefined) row.value = JSON.stringify(entity.value ?? {});
    if (entity.tags !== undefined) row.tags = JSON.stringify(entity.tags ?? []);
    if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData ?? {});

    return row;
  }

  async findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<InventoryItem[]> {
    const rows = await this.query(trx).where({ save_id: saveId }).select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(itemId: string, trx?: Knex.Transaction): Promise<InventoryItem | null> {
    const row = await this.query(trx).where({ id: itemId }).first();
    return row ? this.rowToEntity(row) : null;
  }

  async findBySaveIdAndItemId(
    saveId: string,
    itemId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, item_id: itemId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  // S1-5 偏差 C: 按 owner 过滤查询
  async findBySaveIdAndOwner(
    saveId: string,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, owner_type: ownerType, owner_id: ownerId })
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  /** 按 saveId + ownerType 查询（不限定 ownerId） */
  async findBySaveIdAndOwnerType(
    saveId: string,
    ownerType: OwnerType,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, owner_type: ownerType })
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  // S1-5 偏差 C 补充: 按名称+owner 查询单个物品
  async findByNameAndSaveIdAndOwner(
    saveId: string,
    name: string,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name, owner_type: ownerType, owner_id: ownerId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  // S1-5 偏差 F: 查询已装备物品
  async findEquippedBySaveIdAndOwner(
    saveId: string,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, owner_type: ownerType, owner_id: ownerId, equipped: true })
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  // M12: 查询存档下所有 owner 的已装备物品（通配符查询支持）
  async findEquippedBySaveId(
    saveId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, equipped: true })
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  // M12: 按 saveId + name 查所有 owner 的记录（get_item 通配支持）
  async findAllByNameAndSaveId(
    saveId: string,
    name: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, name })
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  // S1-5 偏差 D 补充: 按槽位查询单个已装备物品
  async findEquippedBySlot(
    saveId: string,
    slot: EquipmentSlot,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem | null> {
    const row = await this.query(trx)
      .where({
        save_id: saveId,
        equipped_slot: slot,
        equipped: true,
        owner_type: ownerType,
        owner_id: ownerId
      })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  /** 查询某数组化槽位的所有已装备物品，按 equippedIndex 升序返回 */
  async findByEquippedSlotOrdered(
    saveId: string,
    slot: EquipmentSlot,
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem[]> {
    const rows = await this.query(trx)
      .where({
        save_id: saveId,
        equipped_slot: slot,
        equipped: true,
        owner_type: ownerType,
        owner_id: ownerId,
      })
      .whereNotNull('equipped_index')
      .orderBy('equipped_index', 'asc')
      .select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  /** 批量调整某槽位装备的 equippedIndex（delta 正负均可；可选 condition 过滤范围） */
  async updateEquippedIndexBatch(
    saveId: string,
    slot: EquipmentSlot,
    delta: number,
    condition: { minIndex?: number; maxIndex?: number },
    ownerType: OwnerType,
    ownerId: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const query = this.query(trx)
      .where({
        save_id: saveId,
        equipped_slot: slot,
        equipped: true,
        owner_type: ownerType,
        owner_id: ownerId,
      })
      .whereNotNull('equipped_index');
    if (condition.minIndex !== undefined) {
      query.where('equipped_index', '>=', condition.minIndex);
    }
    if (condition.maxIndex !== undefined) {
      query.where('equipped_index', '<=', condition.maxIndex);
    }
    await query.increment('equipped_index', delta);
  }


  // S1-5 偏差 D: 查询已占用槽位
  async findOccupiedSlots(saveId: string, trx?: Knex.Transaction): Promise<number[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereNotNull('inventory_slot')
      .where('equipped', false)
      .pluck('inventory_slot');
    return rows as number[];
  }

  // S1-5 偏差 D 补充: 查询可堆叠物品
  async findStackableItem(
    saveId: string,
    itemId: string,
    ownerType?: OwnerType,
    ownerId?: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem | null> {
    const query = this.query(trx)
      .where({ save_id: saveId, item_id: itemId })
      .whereNotNull('inventory_slot')
      .where('equipped', false);
    if (ownerType) query.where({ owner_type: ownerType });
    if (ownerId) query.where({ owner_id: ownerId });
    const row = await query.first();
    return row ? this.rowToEntity(row) : null;
  }

  // 全面去重查询：不限于非装备物品，用于 addItemFromPool 防止重复创建
  async findByItemId(
    saveId: string,
    itemId: string,
    trx?: Knex.Transaction
  ): Promise<InventoryItem | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, item_id: itemId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  // S1-5 偏差 D: 查询物品总数量（支持可选 owner 过滤）
  async sumQuantityBySaveIdAndItemId(
    saveId: string,
    itemId: string,
    ownerType?: OwnerType,
    ownerId?: string,
    trx?: Knex.Transaction
  ): Promise<number> {
    const query = this.query(trx).where({ save_id: saveId, item_id: itemId });
    if (ownerType) query.where({ owner_type: ownerType });
    if (ownerId) query.where({ owner_id: ownerId });
    const result = await query.sum('quantity as totalQuantity').first();
    return Number(result?.totalQuantity ?? 0);
  }

  async insert(item: Omit<InventoryItem, 'id'>, trx?: Knex.Transaction): Promise<InventoryItem> {
    const id = generateReadableId('item', item.name || 'unknown') as ID;
    const now = Date.now() as Timestamp;
    const row = this.entityToRow(item);
    await this.query(trx).insert({
      ...row,
      id,
      created_at: item.createdAt || now,
      updated_at: item.updatedAt || now,
    });
    const inserted = await this.query(trx).where({ id }).first();
    return this.rowToEntity(inserted);
  }

  async update(itemId: string, patch: Partial<InventoryItem>, trx?: Knex.Transaction): Promise<InventoryItem | null> {
    const row = this.entityToRow(patch);
    await this.query(trx).where({ id: itemId }).update(row);
    const updated = await this.query(trx).where({ id: itemId }).first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async delete(itemId: string, trx?: Knex.Transaction): Promise<boolean> {
    const count = await this.query(trx).where({ id: itemId }).del();
    return count > 0;
  }

  async deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  async countBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }

  async sumWeightBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).sum('weight as total').first();
    return Number(result?.total ?? 0);
  }
}
