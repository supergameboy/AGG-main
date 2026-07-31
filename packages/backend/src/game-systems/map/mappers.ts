import { ID } from '../../../../shared/src/types/core.js';
import type { Coordinates, LocationData } from './types.js';

/**
 * locations 表 row → LocationData 纯映射函数。
 *
 * 共享消费方:
 * - LocationRepository.rowToEntity: BaseRepository 抽象方法实现，封装 row → entity 映射
 * - DataRefreshHandler.createMapRefreshConfig: 直接 db 查询后映射（S6 完整重构前的过渡）
 *
 * 设计原则: 一个概念只表达一次（code-standards §二.4）。原 MapService.rowToLocationData
 * 为公开 leaked 方法，迁移为独立纯映射函数后供 Repository + DataRefreshHandler 共享。
 *
 * 注意: 返回的 LocationData.connections/childLocationIds/isParent 为空/默认值，
 * 需要由调用方（如 MapService.getLocation）后续通过 Repository 填充。
 */
export function mapLocationRowToData(row: Record<string, unknown>): LocationData {
  const customData: Record<string, unknown> = typeof row.custom_data === 'string'
    ? JSON.parse(row.custom_data)
    : (row.custom_data as Record<string, unknown> || {});

  const coordinates = resolveCoordinates(row, customData);
  const events = resolveEvents(row, customData);

  // 防御性：若 id 缺失（undefined/null/空字符串），生成可追溯的临时 id。
  // 上游 staging-knex 或 schema 问题可能导致 row 为空对象，临时 id 避免 fillConnections 静默丢弃。
  const rawId = row.id as ID | null | undefined;
  const id: ID = (rawId !== null && rawId !== undefined && rawId !== '')
    ? rawId
    : `loc_unknown_${row.save_id ?? 'unknown'}_${row.name ?? 'unnamed'}` as ID;

  return {
    id,
    saveId: row.save_id as ID,
    locationLevel: (row.location_level as number) ?? 1,
    parentLocationId: (row.parent_location_id as ID) || null,
    name: row.name as string,
    description: (row.description as string) ?? '',
    type: (row.type as string) || 'poi',
    terrainType: (row.terrain_type as string | null) ?? null,
    coordinates,
    isExplored: Boolean(row.is_explored),
    events,
    connections: [],
    dangerLevel: (row.danger_level as number) ?? 1,
    visible: Boolean(row.visible),
    childLocationIds: [],
    isParent: false,
    customData,
    createdAt: (row.created_at as number) ?? 0,
  };
}

function resolveCoordinates(row: Record<string, unknown>, customData: Record<string, unknown>): Coordinates {
  if (row.x !== undefined && row.y !== undefined) {
    return { x: row.x as number, y: row.y as number };
  }
  if (customData.coordinates && typeof customData.coordinates === 'object') {
    return customData.coordinates as Coordinates;
  }
  return { x: 0, y: 0 };
}

function resolveEvents(row: Record<string, unknown>, customData: Record<string, unknown>): string[] {
  if (row.events !== undefined) {
    return typeof row.events === 'string'
      ? JSON.parse(row.events)
      : (row.events as string[]) ?? [];
  }
  if (Array.isArray(customData.events)) {
    return customData.events as string[];
  }
  return [];
}
