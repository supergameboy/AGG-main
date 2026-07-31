/**
 * LocationData → LocationPanelData 映射工具（统一面板变更推送机制）
 *
 * 从 DataRefreshHandler.ts:183 本地函数提取，供 DataRefreshHandler（Agent 核心 G）
 * 与 ws-request-handler（服务层 E）共享复用。
 *
 * 符合 code-standards 第 2 章第 4 条"一个概念只表达一次"与项目既有约定——
 * packages/shared/src/utils/ 已存放 error/logger/entity-graph-id 等跨层共享工具函数。
 *
 * types/ 目录只放类型定义不放函数，故提取到 utils/ 目录。
 */

import type { LocationPanelData } from '../types/dynamic-ui.js';
import type { LocationLevel } from '../types/game.js';

/**
 * LocationData 领域实体的最小结构契约。
 *
 * 不直接 import 业务层 LocationData 类型（避免 shared → backend 反向依赖），
 * 仅声明 mapLocationToPanelData 实际读取的字段子集，由调用方保证传入对象满足此契约。
 * 字段与 packages/backend/src/game-systems/map/types.ts LocationData 接口对齐。
 */
export interface LocationDataLike {
  id: string;
  name: string;
  description: string;
  type: string;
  parentLocationId: string | null;
  locationLevel: number;
  coordinates: { x: number; y: number };
  dangerLevel: number;
  customData: Record<string, unknown>;
}

/**
 * 将 LocationData 领域实体映射为 LocationPanelData UI 类型。
 *
 * 字段映射（对应 DataRefreshHandler.ts:183-197 现有映射逻辑）：
 * - id/name/description/type/dangerLevel/customData：直接传递
 * - parentLocationId：null → undefined（UI 类型不接受 null）
 * - locationLevel：强转为 LocationLevel 联合类型
 * - x/y：从 coordinates 嵌套提取
 *
 * @param loc LocationData 领域实体（满足 LocationDataLike 契约）
 * @returns LocationPanelData UI 类型
 */
export function mapLocationToPanelData(loc: LocationDataLike): LocationPanelData {
  return {
    id: loc.id,
    name: loc.name,
    description: loc.description,
    type: loc.type,
    parentLocationId: loc.parentLocationId ?? undefined,
    locationLevel: loc.locationLevel as LocationLevel,
    x: loc.coordinates.x,
    y: loc.coordinates.y,
    dangerLevel: loc.dangerLevel,
    customData: loc.customData,
  };
}
