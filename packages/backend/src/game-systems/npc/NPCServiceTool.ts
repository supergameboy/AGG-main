import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { NPCService } from './NPCService.js';
import { NPCRepository } from './NPCRepository.js';
import { NPCGoalRepository } from './NPCGoalRepository.js';
import { NpcEntityResolver } from './NpcEntityResolver.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { NumericalService } from '../numerical/NumericalService.js';
import { CharacterRepository } from '../character/CharacterRepository.js';
import { InventoryRepository } from '../inventory/InventoryRepository.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { MapServiceTool } from '../map/MapServiceTool.js';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import type { ITemplateProvider } from '../shared/types.js';
import { validateRequired } from '../../utils/paramValidator.js';
import type { NPCMemory, GoalCategory, NpcInitUpdate } from './types.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

/**
 * NPC 领域 ServiceTool（S2-1 重构后的组合根，D8）。
 * 每次请求时在 createNPCService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 NPCService。跨领域 MapService / CharacterService 通过构造注入的 ServiceTool 获取；
 * ITemplateProvider 为单例，通过 setTemplateService 在 init.ts 注入。
 */
export class NPCServiceTool extends BaseTool {
  private readonly mapServiceTool: MapServiceTool;
  private readonly characterServiceTool: CharacterServiceTool;
  private templateProvider: ITemplateProvider | null = null;

  constructor(
    mapServiceTool: MapServiceTool,
    characterServiceTool: CharacterServiceTool,
  ) {
    super(
      'npc_service' as ToolType,
      'NPC Service',
      'NPC服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.mapServiceTool = mapServiceTool;
    this.characterServiceTool = characterServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /** 注入 ITemplateProvider 实例（init.ts 中调用，单例 TemplateService） */
  setTemplateService(templateProvider: ITemplateProvider): void {
    this.templateProvider = templateProvider;
  }

  /**
   * 创建 NPCService 实例（组合根入口，D8）。
   * public 供跨领域消费方调用获取 NPCService。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createNPCService(context: ToolContext): Promise<NPCService> {
    return context.requestScope.getOrCompute('npc', () => this.buildNPCService(context));
  }

  private async buildNPCService(context: ToolContext): Promise<NPCService> {
    const db = context.requestScope.getDb();
    if (!this.templateProvider) {
      throw new Error('ITemplateProvider not injected. Call setTemplateService() in init.ts first.');
    }

    const npcRepo = new NPCRepository(db);
    const goalRepo = new NPCGoalRepository(db);
    const mapService = await this.mapServiceTool.createMapService(context);
    const characterService = await this.characterServiceTool.createCharacterService(context);
    const saveRepo = new SaveRepository(db);
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const txManager = new KnexTransactionManager(db);
    const characterRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const numericalService = new NumericalService(characterRepo, inventoryRepo, npcRepo, txManager, ruleParser);

    // 模块2 简化：删除 relationRepo 构造参数（关系数据由 EntityGraphService 维护）
    const npcResolver = new NpcEntityResolver(npcRepo, db);
    return new NPCService(
      npcRepo,
      goalRepo,
      mapService,
      characterService,
      saveRepo,
      this.templateProvider,
      numericalService,
      txManager,
      npcResolver,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_npcs',
      description: '获取存档中所有NPC列表(含完整信息：id/name/role/race/level/location/description/services/reputation/mood/inParty/visible)。输出NPC数据时必须使用返回的真实ID，禁止编造ID',
      parameters: {
        visibility: { type: 'string', required: false, description: '可见性过滤：不传=只返回玩家可见的NPC，"all"=返回全部NPC(含不可见)，"visible"=只返回可见的NPC，"hidden"=只返回不可见的NPC' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const npcs = await service.listNPCs(context.saveId, params.visibility as 'all' | 'visible' | 'hidden' | undefined);
        return { success: true, data: npcs };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', description: 'NPC列表(NPCProfile[])', items: { type: 'object' } },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_npc',
      description: '获取NPC详情(含完整属性)',
      parameters: {
        npcs: {
          type: 'array',
          required: true,
          description: '要获取的NPC列表',
          items: {
            type: 'object',
            properties: {
              npcId: { type: 'string', description: 'NPC ID。可使用 UUID、templateNpcId、或NPC名称' }
            }
          }
        }
      },
      isWrite: false,
      batch: { param: 'npcs' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const npc = await service.getNPC(context.saveId, params.npcId as string);
        if (!npc) {
          return { success: false, error: `NPC not found: ${params.npcId}` };
        }
        return { success: true, data: npc };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: 'NPC详情(NPCProfile)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_npcs_by_location',
      description: '获取指定地点的所有NPC(含完整信息：id/name/role/race/level/location/description/services/reputation/mood)。不传locationId时自动使用角色当前位置。输出NPC数据时必须使用返回的真实ID，禁止编造ID',
      parameters: {
        locationId: { type: 'string', required: false, description: '地点ID(不传则用角色当前位置)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        let locationId = params.locationId as string | undefined;
        if (!locationId) {
          const mapService = await this.mapServiceTool.createMapService(context);
          const currentLoc = await mapService.getCurrentLocation(context.saveId);
          locationId = currentLoc?.id;
        }
        if (!locationId) {
          return { success: false, error: 'locationId is required and current location could not be resolved' };
        }
        const service = await this.createNPCService(context);
        const result = await service.getNPCsByLocation(context.saveId, locationId);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '按地点查询结果，含npcs数组和hint' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    // 模块2 简化：删除 get_relations + update_relation 工具注册
    // （关系数据由 EntityGraphService.set_relationship 通过 PERCEIVES 边维护，单一数据源）

    this.registerMethod({
      name: 'add_to_party',
      description: '将NPC加入队伍(最多4人)',
      parameters: {
        npcId: { type: 'string', required: true, description: '要加入的NPC ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const member = await service.addToParty(context.saveId, params.npcId as string);
          return { success: true, data: member };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to add to party';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '队伍成员信息(PartyMember)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'remove_from_party',
      description: '将NPC移出队伍',
      parameters: {
        npcId: { type: 'string', required: true, description: '要移除的NPC ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          await service.removeFromParty(context.saveId, params.npcId as string);
          return { success: true, data: { message: `NPC ${params.npcId} removed from party` } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to remove from party';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '移除结果',
            properties: {
              message: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_party',
      description: '获取当前队伍成员列表',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const party = await service.getParty(context.saveId);
        return { success: true, data: party };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', description: '队伍成员列表(PartyMember[])', items: { type: 'object' } },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_npc_full_status',
      description: '获取NPC完整状态面板(聚合信息/位置/关系/服务)',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const status = await service.getNPCFullStatus(context.saveId, params.npcId as string);
          return { success: true, data: status };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get NPC status';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: 'NPC完整状态面板(NPCStatusPanel)，含basicInfo/location/relations/services' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_disposition',
      description: '更新NPC态度/心情',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        disposition: { type: 'string', required: true, description: '态度值(devoted/friendly/warm/neutral/cold/hostile/hated)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const npc = await service.updateNPCDisposition(
            context.saveId,
            params.npcId as string,
            params.disposition as string
          );
          return { success: true, data: npc };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update disposition';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '更新后的NPC数据(NPCProfile)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_nearby_npcs',
      description: '获取指定地点附近的NPC(支持半径筛选)。不传locationId时自动使用角色当前位置',
      parameters: {
        locationId: { type: 'string', required: false, description: '地点ID(不传则用角色当前位置)' },
        radius: { type: 'number', required: false, description: '搜索半径(可选)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        let locationId = params.locationId as string | undefined;
        if (!locationId) {
          const mapService = await this.mapServiceTool.createMapService(context);
          const currentLoc = await mapService.getCurrentLocation(context.saveId);
          locationId = currentLoc?.id;
        }
        if (!locationId) {
          return { success: false, error: 'locationId is required and current location could not be resolved' };
        }
        const service = await this.createNPCService(context);
        const result = await service.getNearbyNPCs(
          context.saveId,
          locationId,
          params.radius as number | undefined
        );
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', description: '附近NPC列表', items: { type: 'object' } },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'create_npc',
      description: '创建NPC到游戏世界。LLM需传入完整的NPC属性（性格、背景、能力等），程序自动分配ID，返回含真实ID的完整NPC数据',
      parameters: {
        npcs: {
          type: 'array',
          required: true,
          description: '要创建的NPC列表，每个元素需提供完整的NPC属性',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'NPC名称（必填）' },
              role: { type: 'string', description: 'NPC角色（必填），如 merchant/guard/healer/quest_giver/warrior/mage/thief/scholar/commoner 等' },
              race: { type: 'string', description: 'NPC种族（必填），如 human/elf/dwarf/orc/halfling/gnome/dragonborn 等' },
              locationId: { type: 'string', description: 'NPC所在地点ID或名称（必填，如"白杨村"，可通过 search_locations 查看）' },
              description: { type: 'string', description: 'NPC外观与特征描述（必填）' },
              personality: { type: 'string', description: 'NPC性格描述（必填），如"温和友善但固执"等' },
              background: { type: 'string', description: 'NPC背景故事（必填），如身世、经历等' },
              abilities: { type: 'string', description: 'NPC能力描述（可选），如技能、特长等' },
              disposition: { type: 'string', description: 'NPC对玩家的初始态度（可选），devoted/friendly/warm/neutral/cold/hostile/hated，默认neutral' },
              level: { type: 'number', description: 'NPC等级（可选，默认1）' },
              services: { type: 'array', description: 'NPC提供的服务列表（可选），如 [{ "type": "trade", "name": "商店" }]' },
              title: { type: 'string', description: 'NPC头衔（可选），如"铁匠大师"等' },
              visible: { type: 'boolean', description: '是否对玩家可见（可选，默认false）。设为true则玩家立即遇到该NPC' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'npcs' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['name', 'role', 'race', 'locationId', 'description', 'personality', 'background']);
        if (missing) return { success: false, error: missing };
        const service = await this.createNPCService(context);
        try {
          const npc = await service.createNPC({
            saveId: context.saveId,
            name: params.name as string,
            role: params.role as string,
            race: params.race as string,
            locationId: params.locationId as string,
            description: params.description as string,
            personality: params.personality as string,
            background: params.background as string,
            abilities: params.abilities as string | undefined,
            disposition: params.disposition as string | undefined,
            level: params.level as number | undefined,
            services: params.services as Array<{ type: string; name: string }> | undefined,
            title: params.title as string | undefined,
            visible: params.visible as boolean | undefined,
          });
          return { success: true, data: npc };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create NPC';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '创建的NPC数据(NPCProfile)，含自动分配的真实ID' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    // V6: NPC记忆系统 - 添加记忆
    this.registerMethod({
      name: 'add_npc_memory',
      description: '为NPC添加记忆',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID或名称（如"村长艾德温"，可通过 list_npcs 查看）' },
        content: { type: 'string', required: true, description: '记忆内容' },
        type: { type: 'string', required: true, description: '记忆类型(interaction/quest/trade/combat/event/secret)' },
        importance: { type: 'number', required: false, description: '重要程度(1-5，5最重要，默认1)' },
        tags: { type: 'array', required: false, description: '标签数组' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const memory = await service.addMemory(
            context.saveId,
            params.npcId as string,
            params.content as string,
            params.type as NPCMemory['type'],
            params.importance as number ?? 1,
            (params.tags as string[]) ?? []
          );
          return { success: true, data: memory };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to add NPC memory';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '添加的记忆数据(NPCMemory)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    // V6: NPC记忆系统 - 获取记忆列表
    this.registerMethod({
      name: 'get_npc_memories',
      description: '获取NPC的记忆列表',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        type: { type: 'string', required: false, description: '过滤记忆类型(interaction/quest/trade/combat/event/secret)' },
        limit: { type: 'number', required: false, description: '返回数量限制(默认20)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const result = await service.getMemories(
            context.saveId,
            params.npcId as string,
            params.type as NPCMemory['type'] | undefined,
            params.limit as number ?? 20
          );
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get NPC memories';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', description: 'NPC记忆列表(NPCMemory[])', items: { type: 'object' } },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    // 模块3 简化：删除 add_npc_knowledge / get_npc_knowledge（NPCKnowledge 已迁移到 PERCEIVES 感知边，
    // 由 entity_graph_service 工具集的 set_awareness / get_awareness 替代）

    this.registerMethod({
      name: 'update_npc',
      description: '更新NPC属性。传入attributes时程序自动调用NumericalService计算derivedAttributes/maxHp/maxMp并满血初始化currentHp/currentMp，LLM无需手动调calculate_derived_attributes',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要更新的NPC列表',
          items: {
            type: 'object',
            required: ['npcId'],
            properties: {
              npcId: { type: 'string', description: 'NPC ID(必填)。可使用预加载上下文中的id(如 npc_村长艾德温_xxx)或npcId(如 medieval-fantasy__village-elder)或NPC名称' },
              name: { type: 'string', description: '名称' },
              description: { type: 'string', description: '描述' },
              title: { type: 'string', description: '头衔' },
              customData: { type: 'object', description: '自定义数据' },
              role: { type: 'string', description: '角色' },
              race: { type: 'string', description: '种族' },
              level: { type: 'number', description: '等级' },
              mood: { type: 'number', description: '心情' },
              visible: { type: 'boolean', description: '是否对玩家可见，设为true让玩家遇到该NPC' },
              locationId: { type: 'string', description: 'NPC的新位置ID（移动NPC到新地点时使用，使用预加载上下文中的真实地点ID）' },
              attributes: { type: 'string', description: '基础属性JSON字符串（如{"strength":12,"agility":10}）。传入后程序自动计算derivedAttributes、maxHp、maxMp并满血初始化currentHp/currentMp，无需再传这些派生字段' },
              currentHp: { type: 'number', description: '当前HP值（不传时若同时传attributes则自动设为maxHp满血初始化；显式传入则覆盖派生值）' },
              maxHp: { type: 'number', description: '最大HP值（不传时若同时传attributes则由派生公式自动计算；显式传入则覆盖派生值）' },
              currentMp: { type: 'number', description: '当前MP值（不传时若同时传attributes则自动设为maxMp满血初始化；显式传入则覆盖派生值）' },
              maxMp: { type: 'number', description: '最大MP值（不传时若同时传attributes则由派生公式自动计算；显式传入则覆盖派生值）' },
              visibility: { type: 'object', description: 'NPC信息可见性标记，控制玩家能看到哪些NPC信息。格式：{attributes:"hidden"|"vague"|"visible",hpMp:"hidden"|"bar_only"|"visible",equipment:"hidden"|"outline"|"visible",inventory:"hidden"|"count_only"|"visible",skills:"hidden"|"category"|"visible"}' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'updates' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        try {
          const fields: Record<string, unknown> = {};
          if (params.name !== undefined) fields.name = params.name;
          if (params.description !== undefined) fields.description = params.description;
          if (params.title !== undefined) fields.title = params.title;
          if (params.customData !== undefined) fields.customData = params.customData;
          if (params.role !== undefined) fields.role = params.role;
          if (params.race !== undefined) fields.race = params.race;
          if (params.level !== undefined) fields.level = params.level;
          if (params.mood !== undefined) fields.mood = params.mood;
          if (params.visible !== undefined) fields.visible = params.visible;
          if (params.locationId !== undefined) fields.locationId = params.locationId;
          if (params.attributes !== undefined) fields.attributes = params.attributes;
          if (params.currentHp !== undefined) fields.currentHp = params.currentHp as number | null;
          if (params.maxHp !== undefined) fields.maxHp = params.maxHp as number | null;
          if (params.currentMp !== undefined) fields.currentMp = params.currentMp as number | null;
          if (params.maxMp !== undefined) fields.maxMp = params.maxMp as number | null;
          if (params.visibility !== undefined) {
            const existingCustomData = (fields.customData as Record<string, unknown>) ?? {};
            existingCustomData.visibility = params.visibility;
            fields.customData = existingCustomData;
          }

          const npc = await service.updateNPC(
            context.saveId,
            params.npcId as string,
            fields
          );
          return { success: true, data: npc };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update NPC';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '更新后的NPC数据(NPCProfile)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'move_npc',
      description: '将NPC迁移到新地点。迁移后应使用add_npc_memory为NPC记录位置变更记忆(类型event,内容描述从哪迁到哪)',
      parameters: {
        moves: {
          type: 'array',
          required: true,
          description: 'NPC迁移列表',
          items: {
            type: 'object',
            properties: {
              npcId: { type: 'string', description: 'NPC ID' },
              locationId: { type: 'string', description: '目标地点ID' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'moves' },
      handler: async (params: any, context: any) => {
        const service = await this.createNPCService(context);
        const result = await service.moveNpc(context.saveId, params.npcId, params.locationId);
        return { success: true, data: { id: result.id, name: result.name, locationId: result.locationId } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '迁移结果',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              locationId: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'move_to',
      description: '移动角色到目标地点(计算路径距离)。队伍中的NPC会自动跟随移动。支持targetLocationId或targetLocationName',
      parameters: {
        targetLocationId: { type: 'string', required: false, description: '目标地点ID(优先)' },
        targetLocationName: { type: 'string', required: false, description: '目标地点名称(模糊匹配,作为ID的回退)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        let targetId = params.targetLocationId as string | undefined;
        if (!targetId && params.targetLocationName) {
          try {
            const mapService = await this.mapServiceTool.createMapService(context);
            targetId = await mapService.resolveLocationId(params.targetLocationName as string, context.saveId);
          } catch {
            return { success: false, error: `Target location not found: ${params.targetLocationName}` };
          }
        }
        if (!targetId) {
          return { success: false, error: 'targetLocationId or targetLocationName is required' };
        }
        const service = await this.createNPCService(context);
        try {
          const result = await service.moveCharacterTo(context.saveId, targetId);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to move character';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '移动结果(MoveResult)，含fromLocationId/toLocationId/distance/followersMoved' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'quick_travel',
      description: '快速旅行(消耗金币，基于BFS路径计算费用，默认每单位距离10金币)。队伍中的NPC会自动跟随移动。支持targetLocationId或targetLocationName',
      parameters: {
        targetLocationId: { type: 'string', required: false, description: '目标地点ID(优先)' },
        targetLocationName: { type: 'string', required: false, description: '目标地点名称(模糊匹配,作为ID的回退)' },
        costPerUnit: { type: 'number', required: false, description: '每单位距离消耗金币数(默认10)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        let targetId = params.targetLocationId as string | undefined;
        if (!targetId && params.targetLocationName) {
          try {
            const mapService = await this.mapServiceTool.createMapService(context);
            targetId = await mapService.resolveLocationId(params.targetLocationName as string, context.saveId);
          } catch {
            return { success: false, error: `Target location not found: ${params.targetLocationName}` };
          }
        }
        if (!targetId) {
          return { success: false, error: 'targetLocationId or targetLocationName is required' };
        }
        const service = await this.createNPCService(context);
        try {
          const result = await service.quickTravelTo(context.saveId, targetId, params.costPerUnit as number | undefined);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to quick travel';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '快速旅行结果(MoveResult)，含fromLocationId/toLocationId/distance/followersMoved' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'create_goal',
      description: '为NPC创建目标(长期/中期)，目标驱动NPC行为决策',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID或名称（如"村长艾德温"）' },
        type: { type: 'string', required: true, description: '目标类型: long_term(长期) 或 mid_term(中期)' },
        category: { type: 'string', required: true, description: '目标类别: survival/wealth/power/knowledge/relationship/duty/creative/freedom' },
        description: { type: 'string', required: true, description: '目标描述' },
        priority: { type: 'number', required: false, description: '优先级1-10，默认5' },
        relatedEntityIds: { type: 'array', required: false, description: '关联的实体ID或名称数组' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['npcId', 'type', 'category', 'description']);
        if (missing) return { success: false, error: missing };
        const service = await this.createNPCService(context);
        try {
          const goalId = await service.createGoal(
            context.saveId,
            params.npcId as string,
            {
              type: params.type as 'long_term' | 'mid_term',
              category: params.category as GoalCategory,
              description: params.description as string,
              priority: params.priority as number | undefined,
              relatedEntityIds: params.relatedEntityIds as string[] | undefined,
            }
          );
          return { success: true, data: { goalId } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create goal';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '创建的目标结果',
            properties: {
              goalId: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_goal',
      description: '更新NPC目标状态/优先级/进度',
      parameters: {
        goalId: { type: 'string', required: true, description: '目标ID' },
        status: { type: 'string', required: false, description: '新状态: active/completed/abandoned/blocked/archived' },
        priority: { type: 'number', required: false, description: '新优先级1-10' },
        progress: { type: 'string', required: false, description: '进度描述' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['goalId']);
        if (missing) return { success: false, error: missing };
        const service = await this.createNPCService(context);
        try {
          await service.updateGoal(
            context.saveId,
            params.goalId as string,
            {
              status: params.status as 'active' | 'completed' | 'abandoned' | 'blocked' | 'archived' | undefined,
              priority: params.priority as number | undefined,
              progress: params.progress as string | undefined,
            }
          );
          return { success: true, data: { goalId: params.goalId, updated: true } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update goal';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '更新结果',
            properties: {
              goalId: { type: 'string' },
              updated: { type: 'boolean' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_goals',
      description: '获取NPC的目标列表',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        status: { type: 'string', required: false, description: '筛选状态(可选): active/completed/abandoned/blocked/archived' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['npcId']);
        if (missing) return { success: false, error: missing };
        const service = await this.createNPCService(context);
        try {
          const goals = await service.getGoals(
            context.saveId,
            params.npcId as string,
            params.status as string | undefined
          );
          return { success: true, data: goals };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get goals';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', description: 'NPC目标列表(NPCGoal[])', items: { type: 'object' } },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'modify_currency',
      description: '修改NPC的货币数量(正数增加，负数减少)',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        currencyType: { type: 'string', required: true, description: '货币类型，如 gold/silver' },
        delta: { type: 'number', required: true, description: '增减数量，正数增加，负数减少' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['npcId', 'currencyType', 'delta']);
        if (missing) return { success: false, error: missing };
        const service = await this.createNPCService(context);
        try {
          const currency = await service.modifyCurrency(
            context.saveId,
            params.npcId as string,
            params.currencyType as string,
            params.delta as number
          );
          return { success: true, data: currency };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to modify currency';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '修改后的货币数据' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_experience',
      description: '为NPC增加经验值，经验达到阈值时自动升级并重算属性',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        amount: { type: 'number', required: true, description: '经验值增量（正整数）' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['npcId', 'amount']);
        if (missing) return { success: false, error: missing };
        const npcId = params.npcId as string;
        const amount = params.amount as number;
        if (!amount || amount <= 0) return { success: false, error: 'amount must be a positive number' };
        const service = await this.createNPCService(context);
        try {
          const result = await service.addExperience(context.saveId, npcId, amount);
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: getErrorMessage(error) };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '经验增加结果，含leveledUp/newLevel等' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'ensure_attr_initialized',
      description: '检查NPC属性是否已初始化。返回true表示需要初始化（attr_initialized=0），false表示已初始化。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const needsInit = await service.ensureAttrInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { needsInit } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '属性初始化检查结果',
            properties: {
              needsInit: { type: 'boolean', description: 'true=需要初始化，false=已初始化' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'mark_attr_initialized',
      description: '标记NPC属性已初始化（设置attr_initialized=1）。在LLM生成属性并写入后调用。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        await service.markAttrInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { message: 'NPC属性已标记为已初始化' } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '标记结果',
            properties: {
              message: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'ensure_inv_initialized',
      description: '检查NPC物品是否已初始化。返回true表示需要初始化（inv_initialized=0），false表示已初始化。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const needsInit = await service.ensureInvInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { needsInit } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '物品初始化检查结果',
            properties: {
              needsInit: { type: 'boolean', description: 'true=需要初始化，false=已初始化' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'mark_inv_initialized',
      description: '标记NPC物品已初始化（设置inv_initialized=1）。在LLM生成物品并添加到NPC背包后调用。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        await service.markInvInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { message: 'NPC物品已标记为已初始化' } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '标记结果',
            properties: {
              message: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'ensure_skill_initialized',
      description: '检查NPC技能是否已初始化。返回true表示需要初始化（skill_initialized=0），false表示已初始化。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        const needsInit = await service.ensureSkillInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { needsInit } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '技能初始化检查结果',
            properties: {
              needsInit: { type: 'boolean', description: 'true=需要初始化，false=已初始化' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'mark_skill_initialized',
      description: '标记NPC技能已初始化（设置skill_initialized=1）。在LLM生成技能并学习后调用。',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNPCService(context);
        await service.markSkillInitialized(context.saveId, params.npcId as string);
        return { success: true, data: { message: 'NPC技能已标记为已初始化' } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '标记结果',
            properties: {
              message: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'batch_check_init_status',
      description: '批量查询多个NPC的初始化状态（attr/inv/skill）。一次调用替代多次 ensure_*_initialized，返回每个NPC三类初始化的 needsInit 状态（true=需要初始化）',
      parameters: {
        npcIds: {
          type: 'array',
          required: true,
          description: '要查询的 NPC ID 列表',
          items: { type: 'string' }
        }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['npcIds']);
        if (missing) return { success: false, error: missing };
        const npcIds = params.npcIds as string[];
        if (!Array.isArray(npcIds)) {
          return { success: false, error: "参数 'npcIds' 必须是数组" };
        }
        const service = await this.createNPCService(context);
        const results = await service.batchCheckInitStatus(context.saveId, npcIds);
        return { success: true, data: { results } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '批量查询结果',
            properties: {
              results: {
                type: 'array',
                description: 'NPC 初始化状态列表（NpcInitStatus[]，每项含 npcId/attrNeedsInit/invNeedsInit/skillNeedsInit）',
                items: { type: 'object' }
              }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'batch_mark_initialized',
      description: '批量标记多个NPC的初始化完成状态。一次调用替代多次 mark_*_initialized，在事务内原子化执行。未提供的字段保持原状态，仅更新显式设为 true 的字段',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要标记的初始化状态列表',
          items: {
            type: 'object',
            properties: {
              npcId: { type: 'string', description: 'NPC ID' },
              attrInitialized: { type: 'boolean', description: '是否标记属性已初始化（true=标记，不传=不修改）' },
              invInitialized: { type: 'boolean', description: '是否标记物品已初始化（true=标记，不传=不修改）' },
              skillInitialized: { type: 'boolean', description: '是否标记技能已初始化（true=标记，不传=不修改）' }
            }
          }
        }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['updates']);
        if (missing) return { success: false, error: missing };
        const updates = params.updates as NpcInitUpdate[];
        if (!Array.isArray(updates)) {
          return { success: false, error: "参数 'updates' 必须是数组" };
        }
        const service = await this.createNPCService(context);
        await service.batchMarkInitialized(context.saveId, updates);
        return { success: true, data: { message: `批量标记 ${updates.length} 个 NPC 初始化状态完成` } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '标记结果',
            properties: {
              message: { type: 'string' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('get_npcs', 'list_npcs', 10, '获取NPC列表');
    this.addActionHandler('get_npc', 'get_npc', 10, '获取NPC详情');
    this.addActionHandler('by_location', 'get_npcs_by_location', 10, '按地点获取NPC');
    // 模块2 简化：删除 get_relations + update_relation action 映射
    this.addActionHandler('add_to_party', 'add_to_party', 10, 'NPC加入队伍');
    this.addActionHandler('remove_from_party', 'remove_from_party', 10, 'NPC移出队伍');
    this.addActionHandler('get_party', 'get_party', 10, '获取队伍成员');
    this.addActionHandler('npc_status', 'get_npc_full_status', 10, '获取NPC完整状态');
    this.addActionHandler('update_disposition', 'update_disposition', 10, '更新NPC态度');
    this.addActionHandler('nearby', 'get_nearby_npcs', 10, '获取附近NPC');
    this.addActionHandler('create_npc', 'create_npc', 10, '创建新NPC');
    this.addActionHandler('upload_npc', 'create_npc', 5, '创建新NPC(旧名别名)');
    this.addActionHandler('add_memory', 'add_npc_memory', 10, '添加NPC记忆');
    this.addActionHandler('get_memories', 'get_npc_memories', 10, '获取NPC记忆');
    // 模块3 简化：删除 add_knowledge / get_knowledge 动作处理器（对应工具已删除）
    this.addActionHandler('update_npc', 'update_npc', 8, '更新NPC属性');
    this.addActionHandler('move_npc', 'move_npc', 10, 'NPC位置迁移');
    this.addActionHandler('move', 'move_to', 10, '角色移动');
    this.addActionHandler('travel', 'quick_travel', 10, '快速旅行');
    this.addActionHandler('go', 'move_to', 5, '前往(别名)');
    this.addActionHandler('walk', 'move_to', 5, '行走(别名)');
    this.addActionHandler('create_goal', 'create_goal', 10, '创建NPC目标');
    this.addActionHandler('update_goal', 'update_goal', 10, '更新NPC目标');
    this.addActionHandler('get_goals', 'get_goals', 10, '获取NPC目标');
    this.addActionHandler('modify_currency', 'modify_currency', 10, '修改NPC货币');
    this.addActionHandler('add_experience', 'add_experience', 10, 'NPC增加经验值');
    this.addActionHandler('ensure_attr_initialized', 'ensure_attr_initialized', 10, '检查NPC属性初始化状态');
    this.addActionHandler('mark_attr_initialized', 'mark_attr_initialized', 10, '标记NPC属性已初始化');
    this.addActionHandler('ensure_inv_initialized', 'ensure_inv_initialized', 10, '检查NPC物品初始化状态');
    this.addActionHandler('mark_inv_initialized', 'mark_inv_initialized', 10, '标记NPC物品已初始化');
    this.addActionHandler('ensure_skill_initialized', 'ensure_skill_initialized', 10, '检查NPC技能初始化状态');
    this.addActionHandler('mark_skill_initialized', 'mark_skill_initialized', 10, '标记NPC技能已初始化');
    this.addActionHandler('batch_check_init', 'batch_check_init_status', 10, '批量查询NPC初始化状态');
    this.addActionHandler('batch_mark_init', 'batch_mark_initialized', 10, '批量标记NPC初始化完成');
    // 别名映射(priority=5)
    this.addActionHandler('party', 'get_party', 5, '队伍(别名)');
    this.addActionHandler('interact', 'interactWithNPC', 5, '交互(别名)');
  }
}
