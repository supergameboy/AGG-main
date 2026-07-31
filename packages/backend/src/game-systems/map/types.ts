import type { Knex } from 'knex';
import { ID } from '../../../../shared/src/types/core.js';

export interface Coordinates {
  x: number;
  y: number;
}

export interface LocationData {
  id: ID;
  saveId?: ID;
  locationLevel: number;
  parentLocationId: ID | null;
  name: string;
  description: string;
  type: string;
  /** 地形类型（plain/forest/mountain/swamp/desert/city/dungeon/road），影响移动时间计算 */
  terrainType?: string | null;
  coordinates: Coordinates;
  isExplored: boolean;
  events: string[];
  connections: string[];
  dangerLevel: number;
  visible: boolean;
  childLocationIds: ID[];
  isParent: boolean;
  customData: Record<string, unknown>;
  /** 13.2 时间戳兼容：实体引用解析时优先匹配相同时间戳数据 */
  createdAt: number;
}

export interface ExploreResult {
  success: boolean;
  location: LocationData;
  discoveries: Array<{
    type: 'npc' | 'event' | 'item' | 'secret';
    id: string;
    name: string;
    description: string;
  }>;
  rewards: Record<string, unknown>;
  dangerLevel: number;
}

export interface NavigationPath {
  path: Array<{
    locationId: ID;
    name: string;
    distance: number;
    relationship?: 'parent' | 'child' | 'connection';
  }>;
  totalDistance: number;
  estimatedTime: number;
  dangers: Array<{
    locationId: ID;
    dangerLevel: number;
    type: string;
  }>;
  crossesRegionBoundary: boolean;
}

export interface RegionConnection {
  from: ID;
  to: ID;
  direction?: string;
}

/**
 * 地点连接实体（location_connections 表 row → entity）。
 * D7: 一表一 Repository，连接表独立实体。
 * 包含连接关系 + 类型 + 自定义数据（如方向），忠实反映表结构。
 */
export interface LocationConnection {
  fromLocationId: ID;
  toLocationId: ID;
  /** 连接类型（normal/secret/locked 等），默认 normal */
  connectionType?: string;
  /** 自定义数据（如 direction/travelTime 等） */
  customData?: Record<string, unknown>;
  /** 距离（影响移动时间计算），可为 null */
  distance?: number | null;
}

/**
 * Map 领域 Repository 端口接口（地点表 locations）。
 * D7: 一表一 Repository，本接口只操作 locations 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 */
export interface ILocationRepository {
  // === 查询 ===
  findById(locationId: ID, saveId: ID, trx?: Knex.Transaction): Promise<LocationData | null>;
  findByIds(locationIds: ID[], saveId: ID, trx?: Knex.Transaction): Promise<LocationData[]>;
  findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<LocationData | null>;
  findByNameLike(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<LocationData | null>;
  findBySaveId(saveId: ID, options?: { locationLevel?: number }, trx?: Knex.Transaction): Promise<LocationData[]>;
  findByParentId(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<LocationData[]>;
  search(saveId: ID, query: { name?: string; type?: string; locationLevel?: number }, trx?: Knex.Transaction): Promise<LocationData[]>;
  /** 查询某父地点下的子地点 ID 列表（覆盖 getChildLocationIds） */
  findIdsByParentId(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<ID[]>;
  /** 查询所有有父地点的地点的 (id, parentLocationId) 对（覆盖 buildChildMap） */
  findAllParentLinks(saveId: ID, trx?: Knex.Transaction): Promise<Array<{ id: ID; parentLocationId: ID | null }>>;
  /** 批量查询地点名称（覆盖 getLocationNamesByIds） */
  findNamesByIds(saveId: ID, locationIds: ID[], trx?: Knex.Transaction): Promise<Map<ID, string>>;
  // === 写入 ===
  insert(data: Omit<LocationData, 'id'> & { id?: ID }, saveId: ID, trx?: Knex.Transaction): Promise<LocationData>;
  update(locationId: ID, saveId: ID, patch: Partial<LocationData>, trx?: Knex.Transaction): Promise<LocationData | null>;
  delete(locationId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean>;
  /** 删除地点时清除子地点的父引用（parent_location_id = null，覆盖 deleteLocation） */
  clearParentForChildren(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<number>;
  /**
   * 按 saveId 查询最早创建的地点。
   * 替代 processInitialize 中的 db('locations').where({save_id}).orderBy('created_at','asc').first()。
   * D9: 支持可选 trx 参数。
   */
  findFirstBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<LocationData | null>;
  /**
   * 按 saveId 删除所有地点（rollbackSave 回滚存档时清理 locations 表）。
   * S4-D6: 统一返回 Promise<void>。D9: 支持可选 trx 参数。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  /** 统计存档下地点数量（GameInitService.getInitializationStatus 跨领域 count） */
  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;
}

/**
 * Map 领域 Repository 端口接口（地点连接表 location_connections）。
 * D7: 一表一 Repository，本接口只操作 location_connections 表。
 * D9: 所有写操作支持可选 trx 参数。
 */
export interface ILocationConnectionRepository {
  /** 查询从某地点出发的连接目标 ID 列表（覆盖 getConnectedLocations） */
  findConnectedIds(saveId: ID, fromLocationId: ID, trx?: Knex.Transaction): Promise<ID[]>;
  /** 批量查询从多个地点出发的连接（覆盖 fillConnections from 方向） */
  findByFromIds(saveId: ID, fromIds: ID[], trx?: Knex.Transaction): Promise<LocationConnection[]>;
  /** 批量查询到达多个地点的连接（覆盖 fillConnections to 方向） */
  findByToIds(saveId: ID, toIds: ID[], trx?: Knex.Transaction): Promise<LocationConnection[]>;
  /** 查询存档下所有连接（覆盖 getRegionConnections + findShortestPathBFS） */
  findAll(saveId: ID, trx?: Knex.Transaction): Promise<LocationConnection[]>;
  /** 检查连接是否已存在（覆盖 createLocation 去重检查） */
  exists(saveId: ID, fromLocationId: ID, toLocationId: ID, trx?: Knex.Transaction): Promise<boolean>;
  /** 插入连接（覆盖 createLocation + updateLocation 连接写入） */
  insert(saveId: ID, fromLocationId: ID, toLocationId: ID, trx?: Knex.Transaction): Promise<void>;
  /** 删除涉及某地点的所有连接（覆盖 updateLocation + deleteLocation 连接清理） */
  deleteByLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<number>;
  /**
   * 按 saveId 删除所有地点连接（rollbackSave 回滚存档时清理 location_connections 表）。
   * S4-D6: 统一返回 Promise<void>。D9: 支持可选 trx 参数。
   *
   * 设计偏差 S4-P0-2-DEV-1: 设计文档 §6.2 说"location_connections 通过 LocationRepository 新增
   * deleteConnectionsBySaveId 方法处理"，但 D7（一表一 Repository）要求 location_connections 由独立的
   * LocationConnectionRepository 处理。因此改为在本接口新增 deleteBySaveId 方法，遵循 D7。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

/**
 * Map 领域 Repository 端口接口（已发现地点表 discovered_locations）。
 * D7: 一表一 Repository，本接口只操作 discovered_locations 表。
 * discovered_locations 记录玩家已发现的地点（用于小地图显示过滤）。
 */
export interface IDiscoveredLocationRepository {
  /** 查询存档下所有已发现地点的 ID 列表 */
  findLocationIdsBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<ID[]>;
  /** 插入已发现地点记录（幂等：UNIQUE(save_id, location_id) 约束保证不重复） */
  insert(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void>;
}

/**
 * Map 领域 Service 端口接口。
 * 从 agents/types.ts 迁入 map/types.ts（D-S2-2 一致性）。
 * 清理 leaked 内部方法: rowToLocationData 移入 LocationRepository.rowToEntity，
 * fillChildLocationIds 移入 MapService 私有方法。
 * 仅暴露 GM Agent + NPCService 跨领域调用所需的程序化数据查询方法。
 */
export interface IMapService {
  // === ReActAgent 使用 ===
  getCurrentLocation(saveId: ID): Promise<LocationData | null>;
  getReachableLocationIds(saveId: ID, locationId: ID): Promise<ID[]>;
  getChildLocationIds(saveId: ID, locationId: ID): Promise<ID[]>;
  getLocationNamesByIds(saveId: ID, locationIds: ID[]): Promise<Map<ID, string>>;
  // === NPCService 跨领域调用所需 ===
  getLocation(locationId: ID, saveId: ID): Promise<LocationData>;
  resolveLocationId(locationIdOrName: string, saveId: ID): Promise<ID>;
  getLocationByName(saveId: ID, name: string): Promise<LocationData>;
  getNavigationPath(fromId: ID, toId: ID, saveId: ID): Promise<NavigationPath>;
  /** 标记地点为已发现（写入 discovered_locations，幂等）。D9: 支持可选 trx 参数，供 NPCService.moveCharacterTo/quickTravelTo 事务内调用。 */
  markDiscovered(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void>;
  /** 获取已发现地点 ID 列表（用于小地图显示过滤） */
  getDiscoveredLocationIds(saveId: ID): Promise<ID[]>;
}
