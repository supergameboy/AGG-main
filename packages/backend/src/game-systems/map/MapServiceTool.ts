import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { MapService } from './MapService.js';
import { LocationRepository } from './LocationRepository.js';
import { LocationEntityResolver } from './LocationEntityResolver.js';
import { LocationConnectionRepository } from './LocationConnectionRepository.js';
import { DiscoveredLocationRepository } from './DiscoveredLocationRepository.js';
import { EventRepository } from '../event/EventRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import { validateRequired } from '../../utils/paramValidator.js';

/**
 * Map 领域 ServiceTool（S2-1 重构后的组合根，D8）。
 * 每次请求时在 createMapService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 MapService。跨领域 CharacterService 通过构造注入的 CharacterServiceTool 获取。
 */
export class MapServiceTool extends BaseTool {
  private readonly characterServiceTool: CharacterServiceTool;

  constructor(characterServiceTool: CharacterServiceTool) {
    super(
      'map_service' as ToolType,
      'Map Service',
      '地图服务。详细使用方法请调用 get_tool_help 工具。',
      '2.0.0'
    );

    this.characterServiceTool = characterServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 创建 MapService 实例（组合根入口，D8）。
   * public 供跨领域 ServiceTool（如 NPCServiceTool）调用获取 MapService。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createMapService(context: ToolContext): Promise<MapService> {
    return context.requestScope.getOrCompute('map', () => this.buildMapService(context));
  }

  private async buildMapService(context: ToolContext): Promise<MapService> {
    const db = context.requestScope.getDb();
    const locationRepo = new LocationRepository(db);
    const connectionRepo = new LocationConnectionRepository(db);
    const discoveredRepo = new DiscoveredLocationRepository(db);
    const eventRepo = new EventRepository(db);
    const txManager = new KnexTransactionManager(db);
    const characterService = await this.characterServiceTool.createCharacterService(context);
    const locationResolver = new LocationEntityResolver(locationRepo, db);
    return new MapService(locationRepo, connectionRepo, discoveredRepo, characterService, eventRepo, txManager, locationResolver);
  }

  private async resolveLocationId(params: Record<string, unknown>, context: ToolContext): Promise<string | null> {
    const locationId = params.locationId as string | undefined;
    const locationName = params.locationName as string | undefined;
    const targetLocationId = params.targetLocationId as string | undefined;
    const targetLocationName = params.targetLocationName as string | undefined;

    const service = await this.createMapService(context);

    const candidates = [locationId, locationName, targetLocationId, targetLocationName];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim()) {
        try {
          const resolved = await service.resolveLocationId(candidate, context.saveId);
          if (resolved) return resolved;
        } catch {
          // continue to next candidate
        }
      }
    }
    return null;
  }

  private parseJsonArrayField(value: unknown): string[] | undefined {
    if (!value) return undefined;
    try {
      return typeof value === 'string' ? JSON.parse(value) : value as string[];
    } catch {
      return undefined;
    }
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'get_location',
      description: '获取地点详情。支持locationId或locationName查询',
      parameters: {
        locations: {
          type: 'array',
          required: true,
          description: '要获取的地点列表',
          items: {
            type: 'object',
            properties: {
              locationId: { type: 'string', description: '地点ID(优先)' },
              locationName: { type: 'string', description: '地点名称(模糊匹配,作为ID的回退)' }
            }
          }
        }
      },
      isWrite: false,
      batch: { param: 'locations' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required' };
        }
        const location = await service.getLocation(resolvedId, context.saveId);
        return { success: true, data: location };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '地点详情(LocationData)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_location_by_name',
      description: '按名称模糊查询地点(返回第一个匹配)',
      parameters: {
        name: { type: 'string', required: true, description: '地点名称(模糊匹配)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['name']);
        if (missing) return { success: false, error: missing };
        const service = await this.createMapService(context);
        const location = await service.getLocationByName(context.saveId, params.name as string);
        return { success: true, data: location };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '地点详情(LocationData)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'search_locations',
      description: '搜索地点(支持按名称/类型/地点层级筛选)',
      parameters: {
        name: { type: 'string', required: false, description: '名称关键词' },
        type: { type: 'string', required: false, description: '地点类型(如village,forest,dungeon)' },
        locationLevel: { type: 'number', required: false, description: '地点层级(1=区域/大陆,2=地点/村镇森林湖泊,3=具体位置/广场房间)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const locations = await service.searchLocations(context.saveId, {
          name: params.name as string | undefined,
          type: params.type as string | undefined,
          locationLevel: params.locationLevel as number | undefined,
        });
        return { success: true, data: locations };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '搜索结果地点列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_current_location',
      description: '获取角色当前位置',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const location = await service.getCurrentLocation(context.saveId);
        return { success: true, data: location };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '当前位置(LocationData)，可能为null' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'explore_location',
      description: '探索地点(标记已探索,发现隐藏内容)。支持locationId或locationName',
      parameters: {
        locationId: { type: 'string', required: false, description: '要探索的地点ID(优先)' },
        locationName: { type: 'string', required: false, description: '地点名称(模糊匹配,作为ID的回退)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required' };
        }
        const result = await service.exploreLocation(context.saveId, resolvedId);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '探索结果(ExploreResult)，含discoveries/rewards/dangerLevel' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_connected_locations',
      description: '获取相邻可到达地点。不传locationId时自动使用角色当前位置',
      parameters: {
        locationId: { type: 'string', required: false, description: '地点ID(优先,不传则用当前位置)' },
        locationName: { type: 'string', required: false, description: '地点名称(模糊匹配,作为ID的回退)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        let resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          const currentLoc = await service.getCurrentLocation(context.saveId);
          resolvedId = currentLoc?.id || null;
        }
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required, and current location could not be resolved' };
        }
        const locations = await service.getConnectedLocations(resolvedId, context.saveId);
        return { success: true, data: locations };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '相邻地点列表(LocationData[])', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_navigation_path',
      description: '计算导航路径(BFS最短路径)。fromLocationId可选，不传则使用角色当前位置',
      parameters: {
        fromLocationId: { type: 'string', required: false, description: '起点地点ID(可选,默认角色当前位置)' },
        toLocationId: { type: 'string', required: true, description: '终点地点ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['toLocationId']);
        if (missing) return { success: false, error: missing };
        const service = await this.createMapService(context);
        let fromLocationId: string | undefined;
        if (params.fromLocationId as string) {
          const resolvedFrom = await this.resolveLocationId({ locationId: params.fromLocationId as string }, context);
          fromLocationId = resolvedFrom || (await service.getCurrentLocation(context.saveId))?.id;
        } else {
          fromLocationId = (await service.getCurrentLocation(context.saveId))?.id;
        }
        if (!fromLocationId) {
          return { success: false, error: `fromLocationId="${params.fromLocationId || ''}" 解析失败且角色无当前位置。请提供有效的 fromLocationId（地点ID或名称），或先通过 move_character 让角色进入某地点。` };
        }
        const resolvedToId = await this.resolveLocationId({ locationId: params.toLocationId as string }, context);
        if (!resolvedToId) {
          return { success: false, error: `toLocationId="${params.toLocationId}" 解析失败：未找到匹配的地点ID或名称。请使用 list_locations 查看可用地点。` };
        }
        const path = await service.getNavigationPath(
          fromLocationId,
          resolvedToId,
          context.saveId
        );
        return { success: true, data: path };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '导航路径(NavigationPath)，含path/totalDistance/estimatedTime/dangers' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'create_location',
      description: '创建新地点(自动建立双向连接)',
      parameters: {
        locations: {
          type: 'array',
          required: true,
          description: '要创建的地点列表',
          items: {
          type: 'object',
          required: ['locationLevel', 'name'],
          properties: {
            locationLevel: { type: 'number', required: true, description: '地点层级(必填,1=区域/大陆,2=地点/村镇森林湖泊,3=具体位置/广场房间)' },
            name: { type: 'string', required: true, description: '地点名称(必填)' },
            description: { type: 'string', description: '地点描述' },
              type: { type: 'string', description: '地点类型(如village,forest,dungeon,poi)' },
              x: { type: 'number', description: 'X坐标' },
              y: { type: 'number', description: 'Y坐标' },
              terrainType: { type: 'string', description: '地形类型(plain,forest,mountain,swamp,desert,city,dungeon,road)' },
              dangerLevel: { type: 'number', description: '危险等级(1-5)' },
              visible: { type: 'boolean', description: '是否对玩家可见，可选，默认false。设为true则玩家已访问该地点（如起始地点）' },
              isExplored: { type: 'boolean', description: '是否已探索，可选，默认false。设为true则地点标记为已探索并加入已发现列表（用于初始已探索地点）' },
              connections: { type: 'string', description: '连接的地点ID或名称列表（JSON数组字符串，如["白杨村","暗影森林"]）' },
              events: { type: 'string', description: '事件ID或名称列表（JSON数组字符串）' },
              parentLocationId: { type: 'string', description: '父地点ID或名称（如"白杨村"，用于创建子地点）' },
              childLocationIds: { type: 'string', description: '子地点ID或名称列表（JSON数组字符串，用于将已有地点链接为当前地点的子地点，会更新这些地点的parentLocationId）' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'locations' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const connections = this.parseJsonArrayField(params.connections);
        const events = this.parseJsonArrayField(params.events);
        const childLocationIds = this.parseJsonArrayField(params.childLocationIds);
        const location = await service.createLocation(context.saveId, {
          locationLevel: params.locationLevel as number,
          name: params.name as string,
          description: params.description as string | undefined,
          type: params.type as string | undefined,
          x: params.x as number | undefined,
          y: params.y as number | undefined,
          terrainType: params.terrainType as string | undefined,
          dangerLevel: params.dangerLevel as number | undefined,
          visible: params.visible as boolean | undefined,
          isExplored: params.isExplored as boolean | undefined,
          connections,
          events,
          parentLocationId: params.parentLocationId as string | undefined,
          childLocationIds,
        });
        const result: ToolResponse = { success: true, data: { ...location, warnings: location.warnings } };
        return result;
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '创建的地点数据(LocationData)，含warnings字段' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_location',
      description: '更新地点属性(只传需要修改的字段)',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要更新的地点列表',
          items: {
            type: 'object',
            required: ['locationId'],
            properties: {
              locationId: { type: 'string', description: '地点ID(必填)。可使用预加载上下文中的id(如 loc_白杨村_xxx)或locationId(如 medieval-fantasy__village-square)或地点名称' },
              name: { type: 'string', description: '新名称' },
              description: { type: 'string', description: '新描述' },
              type: { type: 'string', description: '新类型' },
              terrainType: { type: 'string', description: '新地形类型' },
              dangerLevel: { type: 'number', description: '新危险等级' },
              x: { type: 'number', description: '新X坐标' },
              y: { type: 'number', description: '新Y坐标' },
              connections: { type: 'string', description: '新连接地点ID列表(JSON数组字符串)' },
              events: { type: 'string', description: '新事件ID列表(JSON数组字符串)' },
              visible: { type: 'boolean', description: '是否对玩家可见，设为true让玩家访问该地点' },
              parentLocationId: { type: 'string', description: '设置或更改父地点ID。传null清除父地点关系' },
              custom_data: { type: 'object', description: '自定义数据' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'updates' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const { locationId, ...updateData } = params;
        const resolvedLocationId = await this.resolveLocationId({ locationId: locationId as string }, context);
        if (!resolvedLocationId) {
          return { success: false, error: `locationId="${locationId}" 解析失败：未找到匹配的地点ID或名称。请使用 list_locations 查看可用地点。` };
        }
        const connections = this.parseJsonArrayField(updateData.connections);
        const events = this.parseJsonArrayField(updateData.events);
        const location = await service.updateLocation(context.saveId, resolvedLocationId, {
          name: updateData.name as string | undefined,
          description: updateData.description as string | undefined,
          type: updateData.type as string | undefined,
          terrainType: updateData.terrainType as string | undefined,
          dangerLevel: updateData.dangerLevel as number | undefined,
          x: updateData.x as number | undefined,
          y: updateData.y as number | undefined,
          connections,
          events,
          visible: updateData.visible as boolean | undefined,
          parentLocationId: updateData.parentLocationId as string | null | undefined,
          custom_data: updateData.custom_data as Record<string, unknown> | undefined,
        });
        return { success: true, data: location };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的地点数据(LocationData)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'batch_create_locations',
      description: '批量创建地点（先创建所有地点，再统一建立连接关系，解决地点间互相引用的顺序依赖问题）',
      parameters: {
        locations: {
          type: 'array',
          required: true,
          description: '要创建的地点列表。支持地点间互相引用连接名称，无需关心创建顺序（如A连接B、B连接A可同时传入）',
          items: {
            type: 'object',
            required: ['locationLevel', 'name'],
            properties: {
              locationLevel: { type: 'number', required: true, description: '地点层级(必填,1=区域/大陆,2=地点/村镇森林湖泊,3=具体位置/广场房间)' },
              name: { type: 'string', required: true, description: '地点名称(必填)' },
              description: { type: 'string', description: '地点描述' },
              type: { type: 'string', description: '地点类型(如village,forest,dungeon,poi)' },
              x: { type: 'number', description: 'X坐标' },
              y: { type: 'number', description: 'Y坐标' },
              terrainType: { type: 'string', description: '地形类型(plain,forest,mountain,swamp,desert,city,dungeon,road)' },
              dangerLevel: { type: 'number', description: '危险等级(1-5)' },
              visible: { type: 'boolean', description: '是否对玩家可见，可选，默认false。设为true则玩家已访问该地点（如起始地点）' },
              connections: { type: 'string', description: '连接的地点名称列表（JSON数组字符串，如["白杨村","暗影森林"]）。所有地点创建后统一建立连接' },
              events: { type: 'string', description: '事件ID或名称列表（JSON数组字符串）' },
              parentLocationId: { type: 'string', description: '父地点ID或名称（如"白杨村"，用于创建子地点）' }
            }
          }
        }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const locations = params.locations as Array<Record<string, unknown>>;
        if (!Array.isArray(locations) || locations.length === 0) {
          return { success: false, error: 'locations 必须是非空数组' };
        }

        const results: Array<Record<string, unknown>> = [];

        // Phase 1: 创建所有地点（不传 connections，避免顺序依赖）
        for (let i = 0; i < locations.length; i++) {
          const loc = locations[i];
          const missing: string[] = [];
          if (!loc.locationLevel) missing.push('locationLevel');
          if (!loc.name) missing.push('name');
          if (missing.length > 0) {
            return { success: false, error: `locations[${i}] 缺少必填字段 [${missing.join(', ')}]（locationLevel 和 name 为必填）` };
          }

          const events = this.parseJsonArrayField(loc.events);
          try {
            const created = await service.createLocation(context.saveId, {
              locationLevel: loc.locationLevel as number,
              name: loc.name as string,
              description: loc.description as string | undefined,
              type: loc.type as string | undefined,
              x: loc.x as number | undefined,
              y: loc.y as number | undefined,
              terrainType: loc.terrainType as string | undefined,
              dangerLevel: loc.dangerLevel as number | undefined,
              visible: loc.visible as boolean | undefined,
              connections: [], // 延迟到 Phase 2
              events,
              parentLocationId: loc.parentLocationId as string | undefined,
            });
            results.push({ ...created, pendingConnections: this.parseJsonArrayField(loc.connections) || [] });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return { success: false, error: `locations[${i}] "${loc.name}" 创建失败：${errMsg}` };
          }
        }

        // Phase 2: 统一建立连接关系（所有地点已创建，名称可解析）
        const allWarnings: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const pending = r.pendingConnections as string[];
          if (!pending || pending.length === 0) continue;

          try {
            await service.updateLocation(context.saveId, r.id as string, {
              connections: pending,
            });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const warning = `locations[${i}] "${r.name}" 连接建立失败：${errMsg}`;
            allWarnings.push(warning);
          }
          delete r.pendingConnections;
        }

        return {
          success: true,
          data: {
            locations: results,
            createdCount: results.length,
            ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
          },
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: '批量创建结果，含 locations 数组、createdCount、warnings（连接失败警告）',
            properties: {
              locations: { type: 'array' as const, description: '创建的地点列表', items: { type: 'object' as const } },
              createdCount: { type: 'number' as const, description: '成功创建的地点数量' },
              warnings: { type: 'array' as const, description: '连接建立失败的警告信息', items: { type: 'string' as const } }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'delete_location',
      description: '删除地点',
      parameters: {
        locationId: { type: 'string', required: true, description: '要删除的地点ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const resolvedLocationId = await this.resolveLocationId({ locationId: params.locationId as string }, context);
        if (!resolvedLocationId) {
          return { success: false, error: `locationId="${params.locationId}" 解析失败：未找到匹配的地点ID或名称。请使用 list_locations 查看可用地点。` };
        }
        const deleted = await service.deleteLocation(resolvedLocationId, context.saveId as string);
        return { success: deleted, data: { deleted } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: '删除结果',
            properties: {
              deleted: { type: 'boolean' as const }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_region_connections',
      description: '获取父地点(区域)间的连接关系。如果父地点A的子地点与父地点B的子地点相连接，则显示为A和B连接。用于展示区域级别的地图拓扑',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const connections = await service.getRegionConnections(context.saveId);
        return { success: true, data: connections };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'array' as const,
            description: '区域间连接关系(RegionConnection[])',
            items: {
              type: 'object' as const,
              properties: {
                from: { type: 'string' as const },
                to: { type: 'string' as const },
                direction: { type: 'string' as const }
              }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_reachable_locations',
      description: '获取从当前位置可达的所有地点（含层级关系：兄弟地点、父地点、子地点、连接地点）',
      parameters: {
        locationId: { type: 'string', required: false, description: '地点ID(不传则用角色当前位置)' },
        locationName: { type: 'string', required: false, description: '地点名称(模糊匹配,作为ID的回退)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        let resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          const currentLoc = await service.getCurrentLocation(context.saveId);
          resolvedId = currentLoc?.id || null;
        }
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required' };
        }
        const reachableIds = await service.getReachableLocationIds(context.saveId, resolvedId);
        const locations = await Promise.all(
          reachableIds.map(id => service.getLocation(id, context.saveId))
        );
        return { success: true, data: locations };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '可达地点列表(LocationData[])', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'list_locations_by_level',
      description: '按地点层级获取地点列表(1=区域/大陆,2=地点/村镇森林湖泊,3=具体位置/广场房间)',
      parameters: {
        locationLevel: { type: 'number', required: true, description: '地点层级(1=区域/大陆,2=地点,3=具体位置)' },
        parentLocationId: { type: 'string', required: false, description: '父地点ID(筛选某地图/区域下的子地点)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['locationLevel']);
        if (missing) return { success: false, error: missing };
        const service = await this.createMapService(context);
        let locations = await service.listLocationsByLevel(context.saveId, params.locationLevel as number);
        if (params.parentLocationId) {
          const parentId = params.parentLocationId as string;
          locations = locations.filter(loc => loc.parentLocationId === parentId);
        }
        return { success: true, data: locations };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '指定层级的地点列表(LocationData[])', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_sub_locations',
      description: '获取指定地点的子地点列表',
      parameters: {
        locationId: { type: 'string', required: false, description: '父地点ID(不传则用角色当前位置)' },
        locationName: { type: 'string', required: false, description: '父地点名称(模糊匹配,作为ID的回退)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        let resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          const currentLoc = await service.getCurrentLocation(context.saveId);
          resolvedId = currentLoc?.id || null;
        }
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required' };
        }
        const subLocations = await service.getSubLocations(context.saveId, resolvedId);
        return { success: true, data: subLocations };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '子地点列表(LocationData[])', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_current_top_location',
      description: '获取角色当前所在的最顶层区域(level=1)地点',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const location = await service.getCurrentTopLevelLocation(context.saveId);
        return { success: true, data: location };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '当前顶层区域(LocationData)，可能为null' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'mark_discovered',
      description: '批量标记地点为已发现（写入 discovered_locations，幂等）。初始化时用于标记玩家已知的起始区域地点。visible=true 的地点在 create_location 时自动标记，无需手动调用',
      parameters: {
        locations: {
          type: 'array',
          required: true,
          description: '要标记为已发现的地点列表',
          items: {
            type: 'object',
            properties: {
              locationId: { type: 'string', description: '地点ID' },
              locationName: { type: 'string', description: '地点名称（作为ID的回退）' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'locations' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const resolvedId = await this.resolveLocationId(params, context);
        if (!resolvedId) {
          return { success: false, error: 'locationId or locationName is required' };
        }
        await service.markDiscovered(context.saveId, resolvedId);
        return { success: true, data: { locationId: resolvedId, discovered: true } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '标记结果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_discovered_locations',
      description: '查询存档下所有已发现的地点ID列表（用于小地图显示过滤）',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createMapService(context);
        const locationIds = await service.getDiscoveredLocationIds(context.saveId);
        return { success: true, data: { locationIds } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '已发现地点ID列表' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    this.addActionHandler('get_location', 'get_location', 10, '获取地点详情');
    this.addActionHandler('current_location', 'get_current_location', 10, '获取当前位置');
    this.addActionHandler('explore', 'explore_location', 10, '探索地点');
    this.addActionHandler('connected', 'get_connected_locations', 10, '获取相邻地点');
    this.addActionHandler('reachable', 'get_reachable_locations', 10, '获取可达地点');
    this.addActionHandler('navigate', 'get_navigation_path', 10, '计算导航路径');
    this.addActionHandler('create_location', 'create_location', 10, '创建地点');
    this.addActionHandler('update_location', 'update_location', 10, '更新地点');
    this.addActionHandler('delete_location', 'delete_location', 10, '删除地点');
    this.addActionHandler('region_connections', 'get_region_connections', 10, '获取区域间连接');
    this.addActionHandler('search', 'search_locations', 10, '搜索地点');
    this.addActionHandler('list_by_level', 'list_locations_by_level', 10, '按层级获取地点');
    this.addActionHandler('sub_locations', 'get_sub_locations', 10, '获取子地点');
    this.addActionHandler('current_map', 'get_current_top_location', 10, '获取当前区域');
  }
}
