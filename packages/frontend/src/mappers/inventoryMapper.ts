import type { FrontendInventoryItem } from '@/types';
import type { ItemCategory, ItemQuality, EquipmentSlot, ItemEffect, ItemValue } from '@ai-rpg/shared';
import { INVENTORY_FIELD_KEYS } from '@/utils/fieldDefinitions';
import { assertOwnerType } from '@/utils/entityFilter';

export function parseJsonField<T>(value: unknown, defaultValue: T): T {
  if (!value) return defaultValue;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return defaultValue; }
  }
  return value as T;
}

export function mapInventoryData(rawItems: Record<string, unknown>[], saveId: string): FrontendInventoryItem[] {
  return rawItems.map((item) => ({
    id: (item.id as string) ?? '',
    saveId: saveId,
    itemId: (item.item_id as string) ?? (item.itemId as string) ?? '',
    poolId: (item.pool_id as string) ?? (item.poolId as string) ?? '',
    name: (item.name as string) ?? '未知物品',
    description: (item.description as string) ?? '',
    category: item.category as ItemCategory,
    quantity: item.quantity as number,
    quality: (item.quality ?? 'common') as ItemQuality,
    durability: (item.durability as number) ?? 0,
    maxDurability: ((item.max_durability ?? item.maxDurability) as number) ?? 0,
    inventorySlot: (item.inventory_slot ?? item.inventorySlot) as number | null,
    equippedSlot: (item.equipped_slot ?? item.equippedSlot) as EquipmentSlot | null,
    equippedIndex: ((item.equipped_index ?? item.equippedIndex) as number | null) ?? null,
    equipped: typeof item.equipped === 'boolean' ? item.equipped : Boolean(item.equipped),
    weight: (item.weight as number) ?? 0,
    maxStack: ((item.max_stack ?? item.maxStack) as number) ?? 1,
    stats: parseJsonField<Record<string, number>>(item.stats, {}),
    effects: parseJsonField<ItemEffect[]>(item.effects, []),
    value: parseJsonField<ItemValue>(item.value, {}),
    tags: parseJsonField<string[]>(item.tags, []),
    customData: parseJsonField<Record<string, unknown>>(item.custom_data ?? item.customData, {}),
    visible: (item.visible as boolean) ?? true,
    // §13.3: ownerType 缺失即抛错，禁止 ?? 'character' 兜底
    ownerType: assertOwnerType(
      (item.owner_type as string | undefined) ?? (item.ownerType as string | undefined)
    ),
    ownerId: (item.owner_id as string) ?? (item.ownerId as string) ?? '',
  })) as FrontendInventoryItem[];
}

/**
 * 校验映射结果是否覆盖 INVENTORY_FIELD_KEYS 中的所有字段。
 * 用于测试，确保初始化映射与实时映射字段一致。
 */
export function getInventoryFieldKeys(): readonly string[] {
  return INVENTORY_FIELD_KEYS;
}
