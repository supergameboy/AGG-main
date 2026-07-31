import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { generateDeterministicId } from '../../../../shared/src/types/core.js';
import { parseJsonField } from '../../utils/pool-helpers.js';
import type {
  IItemPoolRepository,
  ItemPoolEntry,
  ItemCategory,
  ItemQuality,
  ItemEffect,
  ItemValue,
} from './types.js';

/**
 * Item Pool 表 Repository 实现（D7: 操作 item_pool 表）。
 * 从 InventoryService.rowToPoolEntry (L1560-1581) 迁移映射逻辑。
 */
export class ItemPoolRepository
  extends BaseRepository<'item_pool', ItemPoolEntry>
  implements IItemPoolRepository
{
  constructor(db: Knex) {
    super(db, 'item_pool');
  }

  protected rowToEntity(row: Record<string, unknown>): ItemPoolEntry {
    return {
      id: row.id as string,
      saveId: row.save_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      category: row.category as ItemCategory,
      quality: row.quality as ItemQuality,
      stats: parseJsonField<Record<string, number>>(row.stats, {}),
      effects: parseJsonField<ItemEffect[]>(row.effects, []),
      value: parseJsonField<ItemValue>(row.value, {}),
      tags: parseJsonField<string[]>(row.tags, []),
      weight: row.weight as number,
      maxStack: row.max_stack as number,
      equippedSlot: (row.equipped_slot as string) || null,
      durability: row.durability as number,
      maxDurability: row.max_durability as number,
      taken: Boolean(row.taken),
      customData: parseJsonField<Record<string, unknown>>(row.custom_data, {}),
      recommendedClasses: parseJsonField<string[]>(row.recommended_classes, []),
    };
  }

  /**
   * entity → row 转换（insert/update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   * JSON 字段（stats/effects/value/tags/customData/recommendedClasses）需 JSON.stringify。
   */
  private entityToRow(entity: Partial<ItemPoolEntry>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.category !== undefined) row.category = entity.category;
    if (entity.quality !== undefined) row.quality = entity.quality;
    if (entity.weight !== undefined) row.weight = entity.weight;
    if (entity.maxStack !== undefined) row.max_stack = entity.maxStack;
    if (entity.equippedSlot !== undefined) row.equipped_slot = entity.equippedSlot;
    if (entity.durability !== undefined) row.durability = entity.durability;
    if (entity.maxDurability !== undefined) row.max_durability = entity.maxDurability;
    if (entity.taken !== undefined) row.taken = entity.taken;

    // JSON 字段需 stringify
    if (entity.stats !== undefined) row.stats = JSON.stringify(entity.stats ?? {});
    if (entity.effects !== undefined) row.effects = JSON.stringify(entity.effects ?? []);
    if (entity.value !== undefined) row.value = JSON.stringify(entity.value ?? {});
    if (entity.tags !== undefined) row.tags = JSON.stringify(entity.tags ?? []);
    if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData ?? {});
    if (entity.recommendedClasses !== undefined) row.recommended_classes = JSON.stringify(entity.recommendedClasses ?? []);

    return row;
  }

  async findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<ItemPoolEntry[]> {
    const rows = await this.query(trx).where({ save_id: saveId }).select();
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(entryId: string, trx?: Knex.Transaction): Promise<ItemPoolEntry | null> {
    const row = await this.query(trx).where({ id: entryId }).first();
    return row ? this.rowToEntity(row) : null;
  }

  async findBySaveIdAndName(
    saveId: string,
    name: string,
    trx?: Knex.Transaction
  ): Promise<ItemPoolEntry | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async insert(entry: Omit<ItemPoolEntry, 'id'>, trx?: Knex.Transaction): Promise<ItemPoolEntry> {
    const id = generateDeterministicId('item', entry.saveId || 'unknown', entry.name || 'unknown');
    const now = Date.now();
    const row = this.entityToRow(entry);
    await this.query(trx).insert({
      ...row,
      id,
      taken: entry.taken ?? false,
      created_at: now,
      updated_at: now,
    });
    const inserted = await this.query(trx).where({ id }).first();
    return this.rowToEntity(inserted);
  }

  async update(entryId: string, patch: Partial<ItemPoolEntry>, trx?: Knex.Transaction): Promise<ItemPoolEntry | null> {
    const row = this.entityToRow(patch);
    await this.query(trx).where({ id: entryId }).update(row);
    const updated = await this.query(trx).where({ id: entryId }).first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async delete(entryId: string, trx?: Knex.Transaction): Promise<boolean> {
    const count = await this.query(trx).where({ id: entryId }).del();
    return count > 0;
  }

  async countBySaveId(saveId: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }
}
