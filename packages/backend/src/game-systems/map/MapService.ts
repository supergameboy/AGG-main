import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { ID } from '../../../../shared/src/types/core.js';
import type { Knex } from 'knex';
import type {
  Coordinates,
  LocationData,
  ExploreResult,
  NavigationPath,
  RegionConnection,
  ILocationRepository,
  ILocationConnectionRepository,
  IDiscoveredLocationRepository,
  IMapService,
} from './types.js';
import type { ICharacterService } from '../character/types.js';
import type { IEventRepository } from '../event/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { computeDedupUpdate, formatDedupWarnings } from '../shared/dedup-helper.js';
import { LocationEntityResolver } from './LocationEntityResolver.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';

export {
  LocationData,
  ExploreResult,
  NavigationPath,
  RegionConnection
};

const TERRAIN_TIME_MULTIPLIERS: Record<string, number> = {
  'plain': 1.0,
  'forest': 1.5,
  'mountain': 2.0,
  'swamp': 2.5,
  'desert': 1.8,
  'city': 0.8,
  'dungeon': 1.2,
  'road': 0.7
};

const BASE_MOVE_SPEED = 5;
const MAX_LOCATION_LEVEL = 3;

/**
 * Map 领域 Service（S2-1 重构后）。
 *
 * 依赖注入（D8 组合根，per-request 创建）:
 * - locationRepo: locations 表 Repository（本领域）
 * - connectionRepo: location_connections 表 Repository（本领域）
 * - characterService: 跨领域 characters 表访问端口
 * - eventRepo: 跨领域 events 表只读端口
 * - txManager: 事务管理端口
 *
 * 事务: createLocation/updateLocation/deleteLocation 三个多步写操作通过 txManager 事务包裹。
 * 跨领域访问: characters 表 → ICharacterService 端口；events 表 → IEventRepository 端口。
 */
export class MapService implements IMapService {
  private logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly locationRepo: ILocationRepository,
    private readonly connectionRepo: ILocationConnectionRepository,
    private readonly discoveredRepo: IDiscoveredLocationRepository,
    private readonly characterService: ICharacterService,
    private readonly eventRepo: IEventRepository,
    private readonly txManager: ITransactionManager,
    private readonly locationResolver: LocationEntityResolver,
  ) {
    this.logger = createChildLogger('service:map');
  }

  async getLocation(locationId: ID, saveId: ID): Promise<LocationData> {
    try {
      const location = await this.locationRepo.findById(locationId, saveId);
      if (!location) {
        throw new Error(`Location not found: ${locationId}. 建议：使用 create_location 创建新地点，或使用 search_locations 按名称搜索`);
      }
      location.childLocationIds = await this.getChildLocationIds(saveId, location.id);
      location.isParent = location.childLocationIds.length > 0;
      await this.fillConnections(saveId, [location]);
      return location;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get location', { locationId, saveId, error: errorMessage });
      throw error;
    }
  }

  async getCurrentLocation(saveId: ID): Promise<LocationData | null> {
    try {
      const currentLocationId = await this.characterService.getCurrentLocationId(saveId);
      if (!currentLocationId) {
        return null;
      }
      return await this.getLocation(currentLocationId as ID, saveId);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get current location', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getCurrentTopLevelLocation(saveId: ID): Promise<LocationData | null> {
    try {
      const currentLocationId = await this.characterService.getCurrentLocationId(saveId);
      if (!currentLocationId) {
        return null;
      }

      let currentId = currentLocationId as ID;

      for (let i = 0; i < MAX_LOCATION_LEVEL; i++) {
        const location = await this.locationRepo.findById(currentId, saveId);
        if (!location) return null;

        if (location.locationLevel === 1) {
          return await this.getLocation(currentId, saveId);
        }

        if (!location.parentLocationId) return null;
        currentId = location.parentLocationId;
      }

      return null;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get current map location', { saveId, error: errorMessage });
      throw error;
    }
  }

  async exploreLocation(saveId: ID, locationId: ID): Promise<ExploreResult> {
    try {
      const location = await this.getLocation(locationId, saveId);

      const discoveries = [];
      const rewards: Record<string, number> = {};
      const wasExplored = location.isExplored;

      if (!wasExplored) {
        await this.locationRepo.update(locationId, saveId, { isExplored: true });

        discoveries.push(...this.generateDiscoveries(location));
        Object.assign(rewards, this.generateExplorationRewards(location));
      }

      // 探索即发现：写入 discovered_locations（幂等）
      await this.markDiscovered(saveId, locationId);

      this.logger.info('Location explored', {
        saveId,
        locationId,
        wasExplored,
        discoveryCount: discoveries.length
      });

      return {
        success: true,
        location: { ...location, isExplored: true },
        discoveries,
        rewards,
        dangerLevel: location.dangerLevel
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to explore location', { saveId, locationId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 标记地点为已发现（写入 discovered_locations 表，幂等）。
   * 调用点：exploreLocation（探索即发现）、createLocation（visible=true 时）、
   * NPCService.moveCharacterTo/quickTravelTo（访问即发现）。
   *
   * 错误处理：discoveredRepo.insert 已用 onConflict ignore 处理幂等，UNIQUE 冲突不会抛错。
   * 此处不再 try/catch 吞错——真实错误（DB 连接、FK 违反等）必须向上抛，由调用方决策。
   * NPCService.moveCharacterTo/quickTravelTo 在事务提交后调用本方法，自行决定是否容忍错误；
   * exploreLocation/createLocation 让错误抛出（与事务一致性保持同步）。
   */
  async markDiscovered(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.discoveredRepo.insert(saveId, locationId, trx);
  }

  /** 查询存档下所有已发现地点的 ID 列表（供前端小地图过滤） */
  async getDiscoveredLocationIds(saveId: ID): Promise<ID[]> {
    try {
      return await this.discoveredRepo.findLocationIdsBySaveId(saveId);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get discovered location ids', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getConnectedLocations(locationId: ID | null, saveId: ID): Promise<LocationData[] | { locations: LocationData[]; hint: string }> {
    try {
      if (!locationId) {
        return { locations: [], hint: "角色尚未分配位置，无法获取相邻地点" };
      }

      const location = await this.getLocation(locationId, saveId);
      const connectionIds = location.connections;

      if (!connectionIds || connectionIds.length === 0) {
        return { locations: [], hint: "该地点暂无相邻可达地点. 建议：使用 update_location 添加地点连接，或使用 create_location 在附近创建新地点" };
      }

      const results = await this.locationRepo.findByIds(connectionIds, saveId);
      await this.fillChildLocationIds(saveId, results);
      await this.fillConnections(saveId, results);
      return results;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get connected locations', { locationId, saveId, error: errorMessage });
      throw error;
    }
  }

  async getNavigationPath(fromId: ID, toId: ID, saveId: ID): Promise<NavigationPath> {
    try {
      const fromLocation = await this.getLocation(fromId, saveId);
      const toLocation = await this.getLocation(toId, saveId);

      if (fromId === toId) {
        return {
          path: [{ locationId: fromId, name: fromLocation.name, distance: 0, relationship: 'connection' }],
          totalDistance: 0,
          estimatedTime: 0,
          dangers: [],
          crossesRegionBoundary: false
        };
      }

      const directConnectionsResult = await this.getConnectedLocations(fromId, saveId);
      const directConnections = Array.isArray(directConnectionsResult) ? directConnectionsResult : directConnectionsResult.locations;
      const isDirectlyConnected = directConnections.some(loc => loc.id === toId);

      if (isDirectlyConnected) {
        const distance = this.calculateDistance(fromLocation.coordinates, toLocation.coordinates);
        const timeCost = this.calculateMoveTime(distance, toLocation.type);

        return {
          path: [
            { locationId: fromId, name: fromLocation.name, distance: 0, relationship: 'connection' },
            { locationId: toId, name: toLocation.name, distance, relationship: 'connection' }
          ],
          totalDistance: distance,
          estimatedTime: timeCost,
          dangers: toLocation.dangerLevel > 3 ? [{
            locationId: toId,
            dangerLevel: toLocation.dangerLevel,
            type: toLocation.type
          }] : [],
          crossesRegionBoundary: false
        };
      }

      const pathWithRelationships = await this.findShortestPathBFS(fromId, toId, saveId);

      if (!pathWithRelationships) {
        throw new Error(`No path found from ${fromId} to ${toId}. 建议：两地点间无连通路径，请检查地图连接，或使用 update_location 为地点添加连接关系`);
      }

      let totalDistance = 0;
      const dangers: NavigationPath['dangers'] = [];
      const detailedPath: NavigationPath['path'] = [];
      const locationCache = new Map<ID, LocationData>();

      for (let i = 0; i < pathWithRelationships.length; i++) {
        const step = pathWithRelationships[i];
        let currentLoc = locationCache.get(step.id);
        if (!currentLoc) {
          currentLoc = await this.getLocation(step.id, saveId);
          locationCache.set(step.id, currentLoc);
        }

        detailedPath.push({
          locationId: step.id,
          name: currentLoc.name,
          distance: i > 0 ? this.calculateDistance(
            locationCache.get(pathWithRelationships[i - 1].id)!.coordinates,
            currentLoc.coordinates
          ) : 0,
          relationship: step.relationship
        });

        if (i > 0) {
          totalDistance += detailedPath[i].distance;
        }

        if (currentLoc.dangerLevel > 3) {
          dangers.push({
            locationId: step.id,
            dangerLevel: currentLoc.dangerLevel,
            type: currentLoc.type
          });
        }
      }

      const estimatedTime = this.calculateMoveTime(totalDistance / Math.max(1, pathWithRelationships.length - 1), 'plain');
      const crossesRegionBoundary = pathWithRelationships.some(step => step.relationship === 'parent' || step.relationship === 'child');

      return {
        path: detailedPath,
        totalDistance,
        estimatedTime,
        dangers,
        crossesRegionBoundary
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get navigation path', { fromId, toId, saveId, error: errorMessage });
      throw error;
    }
  }

  async createLocation(saveId: ID, data: {
    locationLevel: number;
    name: string;
    description?: string;
    type?: string;
    x?: number;
    y?: number;
    terrainType?: string;
    dangerLevel?: number;
    visible?: boolean;
    isExplored?: boolean;
    connections?: string[];
    events?: string[];
    parentLocationId?: ID;
    childLocationIds?: string[];
    locationId?: ID;
  }): Promise<LocationData & { alreadyExists?: boolean; warnings?: string[] }> {
    try {
      // === 读取校验（事务外） ===
      if (data.name) {
        const existing = await this.locationRepo.findByName(saveId, data.name);
        if (existing) {
          return await this.applyLocationDedupUpdate(saveId, existing, data);
        }
      }

      const level = data.locationLevel;
      if (level < 1 || level > MAX_LOCATION_LEVEL) {
        throw new Error(`locationLevel 必须为 1-${MAX_LOCATION_LEVEL}，当前值: ${level}`);
      }

      if (level === 1 && data.parentLocationId) {
        throw new Error('level=1 的地点不能有 parentLocationId');
      }

      let parentLocationId: ID | null = null;
      if (level === 2) {
        if (!data.parentLocationId) {
          throw new Error('level=2 的地点必须指定 parentLocationId（指向 level=1 的区域）。请先创建 level=1 区域，再在其下创建 level=2 地点');
        }
        parentLocationId = await this.resolveLocationIdInternal(saveId, data.parentLocationId);
        await this.validateParentLevel(saveId, parentLocationId, 1);
      }

      if (level === 3) {
        if (!data.parentLocationId) {
          throw new Error('level=3 的地点必须指定 parentLocationId（指向 level=2 的地点）');
        }
        parentLocationId = await this.resolveLocationIdInternal(saveId, data.parentLocationId);
        await this.validateParentLevel(saveId, parentLocationId, 2);
      }

      const eventResult = data.events
        ? await this.resolveIdsSoft(saveId, data.events)
        : { resolved: [] as ID[], failed: [] as string[] };

      const connectionIds = data.connections
        ? await this.resolveIds(saveId, data.connections, 'location')
        : [];

      // === 写入（事务内，避免地点创建成功但连接失败导致孤立地点） ===
      const locationData: Omit<LocationData, 'id'> & { id?: ID } = {
        saveId,
        locationLevel: level,
        parentLocationId,
        name: data.name,
        description: data.description || '',
        type: data.type || 'poi',
        terrainType: data.terrainType || null,
        coordinates: { x: data.x ?? 0, y: data.y ?? 0 },
        isExplored: data.isExplored ?? false,
        events: eventResult.resolved,
        connections: [],
        dangerLevel: data.dangerLevel ?? 1,
        visible: data.visible ?? false,
        childLocationIds: [],
        isParent: false,
        customData: {},
        createdAt: 0,
      };
      if (data.locationId) {
        locationData.id = data.locationId;
      }

      const location = await this.txManager.transaction(async trx => {
        const inserted = await this.locationRepo.insert(locationData, saveId, trx);

        for (const connectedId of connectionIds) {
          const exists = await this.connectionRepo.exists(saveId, inserted.id, connectedId, trx);
          if (!exists) {
            await this.connectionRepo.insert(saveId, inserted.id, connectedId, trx);
          }
        }

        // visible=true 或 isExplored=true 的地点创建即发现（玩家已知该地点存在）
        if (locationData.visible || locationData.isExplored) {
          await this.discoveredRepo.insert(saveId, inserted.id, trx);
        }

        return inserted;
      });

      this.logger.info('Location created', { saveId, locationId: location.id, name: data.name, level, discovered: locationData.visible });

      const warnings: string[] = [];
      if (eventResult.failed.length > 0) {
        warnings.push(`事件关联失败：${eventResult.failed.join('、')}未创建，请创建事件后通过update_location关联`);
      }

      return {
        ...location,
        connections: connectionIds,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create location', { saveId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 地点去重防护：同 name 已存在时增量更新非黑名单字段 + 返回 alreadyExists + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、createdAt、locationLevel（结构元数据）
   * 可更新字段：parentLocationId、description、type、terrainType、coordinates、dangerLevel、
   *            visible、isExplored、events、connections、childLocationIds 等所有非黑名单字段
   *
   * 特殊处理：
   * - parentLocationId：Agent 传入 name/id → 解析为完整 ID，并校验父层级匹配
   * - events：Agent 传入 name/id → 解析为完整 ID
   * - connections：Agent 传入 name/id → 解析为完整 ID，单独通过 connectionRepo 更新（不入 locationRepo.update patch）
   * - childLocationIds：Agent 传入 name/id → 解析为完整 ID，通过更新子地点的 parentLocationId 实现（不入 locationRepo.update patch）
   * - isExplored：更新为 true 时同时调用 discoveredRepo.insert 标记为已发现
   * - coordinates：Agent 传入 x/y → 映射为 coordinates: {x, y}
   * - locationId：Agent 传入 → 映射为 id（黑名单字段，拒绝更新并记录到 blockedFields）
   */
  private async applyLocationDedupUpdate(
    saveId: ID,
    existing: LocationData,
    data: {
      locationLevel: number;
      name: string;
      description?: string;
      type?: string;
      x?: number;
      y?: number;
      terrainType?: string;
      dangerLevel?: number;
      visible?: boolean;
      isExplored?: boolean;
      connections?: string[];
      events?: string[];
      parentLocationId?: ID;
      childLocationIds?: string[];
      locationId?: ID;
    },
  ): Promise<LocationData & { alreadyExists?: boolean; warnings?: string[] }> {
    this.logger.info('Location already exists, applying incremental update', {
      saveId, name: data.name, existingId: existing.id,
    });

    // 填充 existing 的计算字段（childLocationIds / isParent / connections）
    existing.childLocationIds = await this.getChildLocationIds(saveId, existing.id);
    existing.isParent = existing.childLocationIds.length > 0;
    await this.fillConnections(saveId, [existing]);

    // 解析特殊字段（name → id）
    let resolvedParentLocationId: ID | null | undefined = undefined;
    if (data.parentLocationId !== undefined) {
      if (data.parentLocationId !== null) {
        resolvedParentLocationId = await this.resolveLocationIdInternal(saveId, data.parentLocationId);
        // 校验父层级匹配（existing.locationLevel 不变，因黑名单保护）
        const expectedParentLevel = existing.locationLevel - 1;
        if (expectedParentLevel >= 1) {
          await this.validateParentLevel(saveId, resolvedParentLocationId, expectedParentLevel);
        }
      } else {
        resolvedParentLocationId = null;
      }
    }

    let resolvedEvents: ID[] | undefined = undefined;
    if (data.events !== undefined) {
      const eventResult = await this.resolveIdsSoft(saveId, data.events);
      resolvedEvents = eventResult.resolved;
    }

    let resolvedConnections: ID[] | undefined = undefined;
    if (data.connections !== undefined) {
      resolvedConnections = await this.resolveIds(saveId, data.connections, 'location');
    }

    // 解析 childLocationIds（name/id → 完整 ID），用于更新子地点的 parentLocationId
    let resolvedChildLocationIds: ID[] | undefined = undefined;
    if (data.childLocationIds !== undefined) {
      resolvedChildLocationIds = await this.resolveIds(saveId, data.childLocationIds, 'location');
    }

    // 构建 newValues（键为存储字段名，已完成解析和映射）
    const newValues: Record<string, unknown> = {
      id: data.locationId, // 黑名单字段，若 Agent 传入会被拒绝
      saveId, // 黑名单字段
      locationLevel: data.locationLevel, // 黑名单字段
      parentLocationId: resolvedParentLocationId,
      description: data.description,
      type: data.type,
      terrainType: data.terrainType,
      coordinates: (data.x !== undefined || data.y !== undefined)
        ? { x: data.x ?? existing.coordinates.x, y: data.y ?? existing.coordinates.y }
        : undefined,
      dangerLevel: data.dangerLevel,
      visible: data.visible,
      isExplored: data.isExplored,
      events: resolvedEvents,
      connections: resolvedConnections,
      childLocationIds: resolvedChildLocationIds,
    };

    // 构建 existingValues（键为存储字段名）
    const existingValues: Record<string, unknown> = {
      id: existing.id,
      saveId: existing.saveId,
      locationLevel: existing.locationLevel,
      parentLocationId: existing.parentLocationId,
      description: existing.description,
      type: existing.type,
      terrainType: existing.terrainType,
      coordinates: existing.coordinates,
      dangerLevel: existing.dangerLevel,
      visible: existing.visible,
      isExplored: existing.isExplored,
      events: existing.events,
      connections: existing.connections,
      childLocationIds: existing.childLocationIds,
    };

    const LOCATION_BLACKLIST = ['id', 'saveId', 'createdAt', 'locationLevel'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, LOCATION_BLACKLIST,
    );

    // connections 需要单独通过 connectionRepo 更新（不入 locationRepo.update patch）
    // childLocationIds 是计算字段，需要通过更新子地点的 parentLocationId 实现（不入 locationRepo.update patch）
    const connectionsUpdate = updatedFields.find(f => f.field === 'connections');
    const childLocationIdsUpdate = updatedFields.find(f => f.field === 'childLocationIds');
    const isExploredUpdate = updatedFields.find(f => f.field === 'isExplored');
    const patch: Partial<LocationData> = {};
    for (const f of updatedFields) {
      if (f.field !== 'connections' && f.field !== 'childLocationIds') {
        (patch as Record<string, unknown>)[f.field] = f.newValue;
      }
    }

    // 应用更新（事务内，避免连接删除后字段更新失败导致数据不一致）
    if (Object.keys(patch).length > 0 || connectionsUpdate || childLocationIdsUpdate) {
      await this.txManager.transaction(async trx => {
        if (connectionsUpdate) {
          const newConnectionIds = connectionsUpdate.newValue as ID[];
          await this.connectionRepo.deleteByLocationId(saveId, existing.id, trx);
          for (const connectedId of newConnectionIds) {
            const connExists = await this.connectionRepo.exists(saveId, existing.id, connectedId, trx);
            if (!connExists) {
              await this.connectionRepo.insert(saveId, existing.id, connectedId, trx);
            }
          }
        }
        // childLocationIds 更新：将子地点的 parentLocationId 设置为当前地点
        if (childLocationIdsUpdate) {
          const newChildIds = childLocationIdsUpdate.newValue as ID[];
          for (const childId of newChildIds) {
            const child = await this.locationRepo.findById(childId, saveId, trx);
            if (!child) {
              this.logger.warn('Child location not found during dedup update, skipping', { saveId, childId, parentId: existing.id });
              continue;
            }
            // 校验子地点层级 = 当前地点层级 + 1
            if (child.locationLevel !== existing.locationLevel + 1) {
              throw new Error(`子地点 '${child.name}'(level=${child.locationLevel}) 层级不匹配，期望 level=${existing.locationLevel + 1}（父地点 '${existing.name}' 的下一级）`);
            }
            await this.locationRepo.update(childId, saveId, { parentLocationId: existing.id }, trx);
          }
        }
        // isExplored 更新为 true 时，同时标记为已发现
        if (isExploredUpdate && isExploredUpdate.newValue === true) {
          await this.discoveredRepo.insert(saveId, existing.id, trx);
        }
        if (Object.keys(patch).length > 0) {
          await this.locationRepo.update(existing.id, saveId, patch, trx);
        }
      });
    }

    const warnings = formatDedupWarnings('地点', existing.name, updatedFields, blockedFields);

    // 重新获取更新后的地点数据（含计算字段）
    const updated = await this.getLocation(existing.id, saveId);

    this.logger.info('Location incremental update applied', {
      saveId, name: data.name, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  async getLocationByName(saveId: ID, name: string): Promise<LocationData> {
    try {
      const idPattern = /^loc_[\w\u4e00-\u9fff]+_\d+$/;
      if (idPattern.test(name)) {
        const byId = await this.locationRepo.findById(name as ID, saveId);
        if (byId) {
          this.logger.info('Location found by ID fallback (name matched ID pattern)', { name });
          byId.childLocationIds = await this.getChildLocationIds(saveId, byId.id);
          byId.isParent = byId.childLocationIds.length > 0;
          await this.fillConnections(saveId, [byId]);
          return byId;
        }
      }

      const normalizedName = name.replace(/-/g, ' ');
      const row = await this.locationRepo.findByNameLike(saveId, normalizedName);

      if (!row) throw new Error(`未找到名称匹配 '${name}' 的地点. 建议：请检查名称拼写是否正确，或使用 search_locations 进行更灵活的搜索`);
      row.childLocationIds = await this.getChildLocationIds(saveId, row.id);
      row.isParent = row.childLocationIds.length > 0;
      await this.fillConnections(saveId, [row]);
      return row;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get location by name', { saveId, name, error: errorMessage });
      throw error;
    }
  }

  async listLocations(saveId: ID, options?: { locationLevel?: number }): Promise<LocationData[]> {
    try {
      const results = await this.locationRepo.findBySaveId(saveId, options);
      await this.fillChildLocationIds(saveId, results);
      await this.fillConnections(saveId, results);
      return results;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to list locations', { saveId, error: errorMessage });
      throw error;
    }
  }

  async listLocationsByLevel(saveId: ID, level: number): Promise<LocationData[]> {
    return this.listLocations(saveId, { locationLevel: level });
  }

  async getSubLocations(saveId: ID, parentLocationId: ID): Promise<LocationData[]> {
    try {
      const results = await this.locationRepo.findByParentId(saveId, parentLocationId);
      await this.fillChildLocationIds(saveId, results);
      await this.fillConnections(saveId, results);
      return results;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get sub-locations', { saveId, parentLocationId, error: errorMessage });
      throw error;
    }
  }

  async searchLocations(saveId: ID, query: { name?: string; type?: string; locationLevel?: number }): Promise<LocationData[] | { locations: LocationData[]; hint: string }> {
    try {
      const results = await this.locationRepo.search(saveId, query);
      await this.fillChildLocationIds(saveId, results);
      await this.fillConnections(saveId, results);
      if (results.length === 0) {
        return { locations: [], hint: "未找到匹配的地点. 建议：尝试放宽搜索条件（如只按类型搜索），或使用 create_location 创建新地点" };
      }
      return results;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to search locations', { saveId, query, error: errorMessage });
      throw error;
    }
  }

  async updateLocation(saveId: ID, locationId: ID, data: {
    name?: string;
    description?: string;
    type?: string;
    terrainType?: string;
    dangerLevel?: number;
    x?: number;
    y?: number;
    connections?: string[];
    events?: string[];
    visible?: boolean;
    parentLocationId?: ID | null;
    custom_data?: Record<string, unknown>;
  }): Promise<LocationData> {
    try {
      // === 读取校验（事务外） ===
      const existing = await this.locationRepo.findById(locationId, saveId);
      if (!existing) {
        throw new Error(`Location not found: ${locationId}`);
      }

      const patch: Partial<LocationData> = {};

      if (data.name !== undefined) patch.name = data.name;
      if (data.description !== undefined) patch.description = data.description;
      if (data.type !== undefined) patch.type = data.type;
      if (data.terrainType !== undefined) patch.terrainType = data.terrainType;
      if (data.dangerLevel !== undefined) patch.dangerLevel = data.dangerLevel;
      if (data.x !== undefined || data.y !== undefined) {
        patch.coordinates = {
          x: data.x ?? existing.coordinates.x,
          y: data.y ?? existing.coordinates.y,
        };
      }
      if (data.visible !== undefined) patch.visible = data.visible;
      if (data.events !== undefined) {
        patch.events = await this.resolveIds(saveId, data.events, 'event');
      }

      if (data.parentLocationId !== undefined) {
        if (data.parentLocationId !== null) {
          patch.parentLocationId = await this.resolveLocationIdInternal(saveId, data.parentLocationId);
        } else {
          patch.parentLocationId = null;
        }
      }

      if (data.custom_data !== undefined) {
        patch.customData = { ...existing.customData, ...data.custom_data };
      }

      const connectionIds = data.connections !== undefined
        ? await this.resolveIds(saveId, data.connections, 'location')
        : null;

      // === 写入（事务内，避免连接删除后更新失败导致连接丢失） ===
      await this.txManager.transaction(async trx => {
        if (connectionIds !== null) {
          await this.connectionRepo.deleteByLocationId(saveId, locationId, trx);
          for (const connectedId of connectionIds) {
            await this.connectionRepo.insert(saveId, locationId, connectedId, trx);
          }
        }

        await this.locationRepo.update(locationId, saveId, patch, trx);
      });

      this.logger.info('Location updated', { locationId, fields: Object.keys(patch) });
      return await this.getLocation(locationId, saveId);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update location', { locationId, error: errorMessage });
      throw error;
    }
  }

  async getChildLocationIds(saveId: ID, locationId: ID): Promise<ID[]> {
    return await this.locationRepo.findIdsByParentId(saveId, locationId);
  }

  async getAncestorLocationIds(saveId: ID, locationId: ID): Promise<ID[]> {
    const location = await this.getLocation(locationId, saveId);
    if (location.parentLocationId) {
      return [location.parentLocationId];
    }
    return [];
  }

  async getRegionConnections(saveId: ID): Promise<RegionConnection[]> {
    try {
      const childMap = await this.buildChildMap(saveId);

      const childToParent = new Map<ID, ID>();
      for (const [parentId, childIds] of childMap) {
        for (const childId of childIds) {
          childToParent.set(childId, parentId);
        }
      }

      const connections = await this.connectionRepo.findAll(saveId);

      const seen = new Set<string>();
      const regionConnections: RegionConnection[] = [];

      for (const conn of connections) {
        const fromId = conn.fromLocationId;
        const toId = conn.toLocationId;

        const fromParent = childToParent.get(fromId) || fromId;
        const toParent = childToParent.get(toId) || toId;

        if (fromParent === toParent) continue;

        const key = fromParent < toParent
          ? `${fromParent}:${toParent}`
          : `${toParent}:${fromParent}`;

        if (seen.has(key)) continue;
        seen.add(key);

        regionConnections.push({
          from: fromParent,
          to: toParent,
          direction: conn.customData?.direction as string | undefined,
        });
      }

      this.logger.info('Computed region connections', {
        saveId,
        connectionCount: regionConnections.length
      });

      return regionConnections;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get region connections', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getReachableLocationIds(saveId: ID, locationId: ID): Promise<ID[]> {
    const reachableIds = new Set<ID>();
    reachableIds.add(locationId);

    const location = await this.getLocation(locationId, saveId);
    const childMap = await this.buildChildMap(saveId);

    if (location.parentLocationId) {
      reachableIds.add(location.parentLocationId);
      (childMap.get(location.parentLocationId) || []).forEach(id => reachableIds.add(id));

      const parent = await this.getLocation(location.parentLocationId, saveId);
      for (const connId of parent.connections) {
        reachableIds.add(connId);
        (childMap.get(connId) || []).forEach(id => reachableIds.add(id));
      }
    }

    (childMap.get(locationId) || []).forEach(id => reachableIds.add(id));

    for (const connId of location.connections) {
      reachableIds.add(connId);
      (childMap.get(connId) || []).forEach(id => reachableIds.add(id));
    }

    return Array.from(reachableIds);
  }

  async deleteLocation(locationId: ID, saveId: ID): Promise<boolean> {
    try {
      // === 读取校验（事务外） ===
      const existing = await this.locationRepo.findById(locationId, saveId);
      if (!existing) {
        this.logger.warn('Location not found for deletion', { locationId });
        return false;
      }

      const charCount = await this.characterService.countCharactersAtLocation(saveId, locationId);
      if (charCount > 0) {
        throw new Error(`无法删除地点 "${existing.name}"：角色当前位置在此。请先将角色移动到其他地点`);
      }

      // === 写入（事务内，避免连接删除后地点删除失败导致孤立连接） ===
      const deleted = await this.txManager.transaction(async trx => {
        await this.connectionRepo.deleteByLocationId(saveId, locationId, trx);
        await this.locationRepo.clearParentForChildren(saveId, locationId, trx);
        return await this.locationRepo.delete(locationId, saveId, trx);
      });

      this.logger.info('Location deleted', { locationId, name: existing.name });
      return deleted;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to delete location', { locationId, error: errorMessage });
      throw error;
    }
  }

  async resolveLocationId(locationIdOrName: string, saveId: ID): Promise<ID> {
    return this.resolveLocationIdInternal(saveId, locationIdOrName);
  }

  async getLocationNamesByIds(saveId: ID, locationIds: ID[]): Promise<Map<ID, string>> {
    return await this.locationRepo.findNamesByIds(saveId, locationIds);
  }

  // === 私有方法 ===

  private async resolveLocationIdInternal(saveId: ID, locationIdOrName: string): Promise<ID> {
    /**
     * 委托给 LocationEntityResolver 统一设施（13.2 规则收敛）。
     * - name/id 双兼容 + 时间戳兼容由 EntityResolverBase 提供
     * - 失败抛 EntityResolutionError（含候选列表），转为对调用方友好的 Error 信息
     */
    try {
      const resolved = await this.locationResolver.resolve({
        saveId,
        entityType: 'location',
        ref: locationIdOrName,
      });
      if (resolved.matchedBy === 'name') {
        this.logger.info('Resolved locationId by name match', { input: locationIdOrName, resolved: resolved.entityId, matchedBy: resolved.matchedBy });
      }
      return resolved.entityId as ID;
    } catch (error) {
      if (error instanceof EntityResolutionError) {
        throw new Error(`Location not found: ${locationIdOrName}. 可用操作：search_locations 查看所有地点`);
      }
      throw error;
    }
  }

  private async resolveIds(saveId: ID, refs: string[], type: 'location' | 'event'): Promise<ID[]> {
    const resolved: ID[] = [];
    for (const ref of refs) {
      let resolvedId: ID;
      switch (type) {
        case 'location':
          resolvedId = await this.resolveLocationIdInternal(saveId, ref);
          break;
        case 'event':
          resolvedId = await this.resolveEventId(ref);
          break;
      }
      resolved.push(resolvedId);
    }
    return resolved;
  }

  private async resolveIdsSoft(
    saveId: ID, refs: string[]
  ): Promise<{ resolved: ID[]; failed: string[] }> {
    const resolved: ID[] = [];
    const failed: string[] = [];
    for (const ref of refs) {
      try {
        const resolvedId = await this.resolveEventId(ref);
        resolved.push(resolvedId);
      } catch {
        this.logger.warn('Skipping unresolvable reference in create_location', { type: 'event', ref, saveId });
        failed.push(ref);
      }
    }
    return { resolved, failed };
  }

  private async resolveEventId(eventIdOrName: string): Promise<ID> {
    const result = await this.eventRepo.resolveEventId(eventIdOrName);
    if (result !== null) {
      return result;
    }
    throw new Error(`Event not found: ${eventIdOrName}. 请先创建事件或使用 list_events 查看可用事件`);
  }

  private async buildChildMap(saveId: ID): Promise<Map<ID, ID[]>> {
    const parentLinks = await this.locationRepo.findAllParentLinks(saveId);

    const childMap = new Map<ID, ID[]>();
    for (const link of parentLinks) {
      const parentId = link.parentLocationId;
      if (!parentId) continue;
      if (!childMap.has(parentId)) childMap.set(parentId, []);
      childMap.get(parentId)!.push(link.id);
    }
    return childMap;
  }

  private async validateParentLevel(saveId: ID, parentLocationId: ID, expectedLevel: number): Promise<void> {
    const parent = await this.locationRepo.findById(parentLocationId, saveId);
    if (!parent) {
      throw new Error(`Parent location not found: ${parentLocationId}`);
    }
    if (parent.locationLevel !== expectedLevel) {
      throw new Error(`Parent location must be level ${expectedLevel}, but found level ${parent.locationLevel}`);
    }
  }

  private async fillConnections(saveId: ID, locations: LocationData[]): Promise<void> {
    if (locations.length === 0) return;
    // 过滤 undefined/null id，避免含空值数组传入 knex whereIn 触发
    // "Undefined binding(s) detected" 编译错误（LocationConnectionRepository 亦有双重防御）
    const locationIds = locations
      .map(l => l.id)
      .filter((id): id is ID => id !== undefined && id !== null && id !== '');
    // id 缺失显式警告，便于排查上游 schema 不一致或数据问题
    if (locationIds.length < locations.length) {
      this.logger.warn('fillConnections: 部分地点 id 缺失，已过滤', {
        saveId,
        totalCount: locations.length,
        validCount: locationIds.length,
        missingCount: locations.length - locationIds.length,
      });
    }
    if (locationIds.length === 0) return;

    const fromConns = await this.connectionRepo.findByFromIds(saveId, locationIds);
    const toConns = await this.connectionRepo.findByToIds(saveId, locationIds);

    const connMap = new Map<ID, Set<ID>>();
    for (const conn of fromConns) {
      if (!connMap.has(conn.fromLocationId)) connMap.set(conn.fromLocationId, new Set());
      connMap.get(conn.fromLocationId)!.add(conn.toLocationId);
    }
    for (const conn of toConns) {
      if (!connMap.has(conn.toLocationId)) connMap.set(conn.toLocationId, new Set());
      connMap.get(conn.toLocationId)!.add(conn.fromLocationId);
    }

    for (const loc of locations) {
      loc.connections = connMap.has(loc.id) ? Array.from(connMap.get(loc.id)!) : [];
    }
  }

  private calculateDistance(from: Coordinates, to: Coordinates): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private calculateMoveTime(distance: number, terrainType: string): number {
    const multiplier = TERRAIN_TIME_MULTIPLIERS[terrainType] || 1.0;
    return Math.ceil((distance / BASE_MOVE_SPEED) * multiplier * 60);
  }

  private generateDiscoveries(location: LocationData): ExploreResult['discoveries'] {
    const discoveries: ExploreResult['discoveries'] = [];
    const discoveryRate = Math.max(0.1, 1 - location.dangerLevel * 0.1);

    if (location.events.length > 0 && Math.random() < discoveryRate * 0.7) {
      const hiddenEvent = location.events[Math.floor(Math.random() * location.events.length)];
      discoveries.push({
        type: 'event',
        id: hiddenEvent,
        name: `Hidden Event: ${hiddenEvent}`,
        description: 'Uncovered a secret event'
      });
    }

    if (Math.random() < discoveryRate * 0.3) {
      discoveries.push({
        type: 'item',
        id: `item-${Date.now()}`,
        name: 'Hidden Treasure',
        description: 'Found a hidden item during exploration'
      });
    }

    if (location.dangerLevel >= 4 && Math.random() < 0.2) {
      discoveries.push({
        type: 'secret',
        id: `secret-${Date.now()}`,
        name: 'Ancient Secret',
        description: 'Discovered an ancient secret hidden in this dangerous place'
      });
    }

    return discoveries;
  }

  private generateExplorationRewards(location: LocationData): Record<string, unknown> {
    const rewards: Record<string, unknown> = {};
    const baseReward = 10 + location.dangerLevel * 5;

    rewards.experience = baseReward + Math.floor(Math.random() * baseReward);

    if (Math.random() < 0.3) {
      rewards.currency = { gold: Math.floor(baseReward * 0.5 * (1 + Math.random())) };
    }

    return rewards;
  }

  private async findShortestPathBFS(fromId: ID, toId: ID, saveId: ID): Promise<Array<{ id: ID; relationship: 'connection' | 'parent' | 'child' }> | null> {
    const childMap = await this.buildChildMap(saveId);

    const parentLinks = await this.locationRepo.findAllParentLinks(saveId);

    const parentMap = new Map<ID, ID>();
    for (const link of parentLinks) {
      if (link.parentLocationId) {
        parentMap.set(link.id, link.parentLocationId);
      }
    }

    const allConnections = await this.connectionRepo.findAll(saveId);

    const connectionMap = new Map<ID, ID[]>();
    for (const conn of allConnections) {
      const from = conn.fromLocationId;
      const to = conn.toLocationId;
      if (!connectionMap.has(from)) connectionMap.set(from, []);
      if (!connectionMap.has(to)) connectionMap.set(to, []);
      connectionMap.get(from)!.push(to);
      connectionMap.get(to)!.push(from);
    }

    const visited = new Set<ID>();
    const queue: Array<{ id: ID; path: Array<{ id: ID; relationship: 'connection' | 'parent' | 'child' }> }> = [{ id: fromId, path: [{ id: fromId, relationship: 'connection' }] }];
    const maxDepth = 20;

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (path.length > maxDepth) continue;

      if (visited.has(id)) continue;
      visited.add(id);

      if (id === toId) {
        return path;
      }

      const neighbors: Array<{ id: ID; relationship: 'connection' | 'parent' | 'child' }> = [];

      for (const connId of (connectionMap.get(id) || [])) {
        neighbors.push({ id: connId, relationship: 'connection' });
      }

      const parentId = parentMap.get(id);
      if (parentId) {
        neighbors.push({ id: parentId, relationship: 'parent' });
      }

      for (const childId of (childMap.get(id) || [])) {
        neighbors.push({ id: childId, relationship: 'child' });
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          queue.push({ id: neighbor.id, path: [...path, neighbor] });
        }
      }
    }

    return null;
  }

  private async fillChildLocationIds(saveId: ID, locations: LocationData[]): Promise<void> {
    if (locations.length === 0) return;

    const childMap = await this.buildChildMap(saveId);

    for (const loc of locations) {
      loc.childLocationIds = childMap.get(loc.id) || [];
      loc.isParent = loc.childLocationIds.length > 0;
    }
  }
}
