import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { InventoryService } from './InventoryService.js';
import { InventoryRepository } from './InventoryRepository.js';
import { ItemPoolRepository } from './ItemPoolRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { NumericalService } from '../numerical/NumericalService.js';
import { CharacterRepository } from '../character/CharacterRepository.js';
import { NPCRepository } from '../npc/NPCRepository.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import type { NPCServiceTool } from '../npc/NPCServiceTool.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { ITemplatePoolProvider } from '../shared/types.js';

/**
 * Inventory 领域 ServiceTool（S1-5 重构后的组合根，D8）。
 * 每次请求时在 createInventoryService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 InventoryService。跨领域 Service 通过构造注入的 CharacterServiceTool/NPCServiceTool 获取。
 */
export class InventoryServiceTool extends BaseTool {
  private readonly characterServiceTool: CharacterServiceTool;
  private readonly npcServiceTool: NPCServiceTool | null;
  private readonly templatePoolService: ITemplatePoolProvider | null;

  constructor(
    characterServiceTool: CharacterServiceTool,
    templatePoolService: ITemplatePoolProvider | null = null,
    // 可选注入：用于把 LLM 传入的 NPC 名称解析为完整 id（避免 owner_id 字段存入名字
    // 导致后续 recalculateNpcAttributes 按 id 查 npcs 表失败）
    npcServiceTool: NPCServiceTool | null = null,
  ) {
    super(
      'inventory_service' as ToolType,
      'Inventory Service',
      '背包系统服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.characterServiceTool = characterServiceTool;
    this.templatePoolService = templatePoolService;
    this.npcServiceTool = npcServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 创建 InventoryService 实例（组合根入口，D8）。
   * public 供跨领域 ServiceTool（如 QuestServiceTool）调用，避免重复创建依赖。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createInventoryService(context: ToolContext): Promise<InventoryService> {
    return context.requestScope.getOrCompute('inventory', () => this.buildInventoryService(context));
  }

  private async buildInventoryService(context: ToolContext): Promise<InventoryService> {
    const db = context.requestScope.getDb();
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const inventoryRepo = new InventoryRepository(db);
    const itemPoolRepo = new ItemPoolRepository(db);
    const txManager = new KnexTransactionManager(db);
    const characterRepo = new CharacterRepository(db);
    const npcRepo = new NPCRepository(db);
    const numericalService = new NumericalService(characterRepo, inventoryRepo, npcRepo, txManager, ruleParser);
    const saveRepo = new SaveRepository(db);
    const characterService = await this.characterServiceTool.createCharacterService(context);
    // 懒加载 NPCService：避免在 NPC 域未初始化时（如 bootstrap 测试）强制依赖
    // 注：NPCServiceTool.createNPCService 内部用 requestScope 缓存，请求内不会重复创建
    const npcService = this.npcServiceTool
      ? await this.npcServiceTool.createNPCService(context)
      : undefined;
    return new InventoryService(
      inventoryRepo,
      itemPoolRepo,
      characterService,
      numericalService,
      saveRepo,
      txManager,
      ruleParser,
      this.templatePoolService,
      npcService,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_inventory',
      description: '获取背包列表(含物品完整详情、数量、耐久度、装备状态)。支持通配符查询：ownerType="all"时返回存档下所有拥有者(character+npc)的物品',
      parameters: {
        visibility: { type: 'string', required: false, description: '可见性过滤：不传=只返回背包中可见的物品，"all"=返回全部物品(含不可见)，"visible"=只返回可见的物品' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的背包，"all"=所有拥有者(仅查询类支持)' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const visibility = params.visibility as 'all' | 'visible' | undefined;
        const ownerType = params.ownerType as 'character' | 'npc' | 'all' | undefined;
        const ownerId = params.ownerId as string | undefined;
        const inventoryResult = await service.listInventory(context.saveId, undefined, visibility, ownerType, ownerId);
        return { success: true, data: inventoryResult };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '完整背包列表，含物品详情、数量、耐久度、装备状态' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_item',
      description: '获取背包中指定物品的详情(含属性、耐久度、装备状态)。支持通配符查询：ownerType="all"时按物品名称查询返回所有拥有者的匹配记录(数组)',
      parameters: {
        items: {
          type: 'array',
          required: true,
          description: '要获取的物品列表',
          items: {
            type: 'object',
            required: ['inventoryId'],
            properties: {
              inventoryId: { type: 'string', description: '背包物品ID(必填)。可使用预加载上下文中的id(如 item_生锈的铁剑_xxx)或itemId(如 medieval-fantasy__rusty-sword)或物品名称' },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的物品，"all"=所有拥有者(仅查询类支持，返回数组)' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略' }
            }
          }
        }
      },
      isWrite: false,
      batch: { param: 'items' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const item = await service.getItem(context.saveId, params.inventoryId as string, params.ownerType as string | 'all' | undefined, params.ownerId as string | undefined);
          return { success: true, data: item };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '物品详情(单个)或物品数组(ownerType=all时按名称匹配返回所有拥有者的记录)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_item',
      description: '添加物品到背包(自动堆叠同ID物品,自动找空槽位,支持最大堆叠数限制,负重系统检查)。必须传入完整的物品属性（description、stats、effects、value、quality、tags等），不依赖模板。',
      parameters: {
        items: {
          type: 'array',
          required: true,
          description: '要添加的物品列表，必须传入完整的物品属性',
          items: {
            type: 'object',
            required: ['name', 'category'],
            properties: {
              name: { type: 'string', description: '物品名称(用户语言，必填)' },
              category: { type: 'string', description: '物品分类(必填) weapon|armor|accessory|consumable|material|quest|misc' },
              description: { type: 'string', description: '物品描述(用户语言，100-200字，必填)' },
              quantity: { type: 'number', description: '添加数量(默认1)' },
              quality: { type: 'string', description: '品质 common|uncommon|rare|epic|legendary(默认common)' },
              stats: { type: 'object', description: '属性加成(如{"attack":5,"defense":3})' },
              effects: { type: 'array', description: '效果描述数组(如["恢复50点生命值","增加10点攻击力"])', items: { type: 'string' } },
              value: { type: 'number', description: '物品价值(金币)' },
              tags: { type: 'array', description: '标签数组(如["可交易","可装备","任务物品"])', items: { type: 'string' } },
              durability: { type: 'number', description: '当前耐久度' },
              maxDurability: { type: 'number', description: '最大耐久度' },
              weight: { type: 'number', description: '单个物品重量(默认1)' },
              maxStack: { type: 'number', description: '最大堆叠数(默认99)' },
              visible: { type: 'boolean', description: '是否对玩家可见，可选，默认true（创建即放入背包）' },
              customData: { type: 'object', description: '物品展示与机制数据。必须包含: displayType(展示类型，如"武器"/"防具"/"消耗品"), displayRarity(展示稀有度，如"普通"/"优秀"/"精良"/"史诗"/"传说"), displayStats(属性数组，如[{"key":"attack","label":"攻击力","value":"+15"},{"key":"defense","label":"防御力","value":"+2"}]), displayEffects(效果描述数组，如["攻击力+15","防御力+2"]), displayDescription(物品描述文本), displayValue(价值，如{"buy":120,"sell":60,"currency":"gold"}), tags(标签数组如["可交易","可装备"])。消耗品还需: effects(机制效果数组，如[{"type":"heal","value":20,"target":"self"}]), price(售价数值)' },
              fromPool: { type: 'boolean', description: '设为true时优先从物品池取用物品' },
              inventorySlot: { type: 'number', description: '背包排列序号' },
              ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=添加到NPC背包' },
              ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'items' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const item = await service.addItem({
            saveId: context.saveId,
            name: params.name as string,
            category: params.category as any,
            description: params.description as string | undefined,
            quantity: params.quantity as number | undefined,
            quality: params.quality as any,
            durability: params.durability as number | undefined,
            maxDurability: params.maxDurability as number | undefined,
            weight: params.weight as number | undefined,
            maxStack: params.maxStack as number | undefined,
            visible: params.visible as boolean | undefined,
            customData: params.customData as Record<string, unknown> | undefined,
            ownerType: params.ownerType as 'character' | 'npc' | undefined,
            ownerId: params.ownerId as string | undefined,
            stats: params.stats as Record<string, number> | undefined,
            effects: Array.isArray(params.effects) ? params.effects.map(e => typeof e === 'string' ? { type: e, value: 0 } : e) as any : undefined,
            value: typeof params.value === 'number' ? { buy: params.value as number, sell: Math.floor((params.value as number) * 0.6) } as any : params.value as any,
            tags: params.tags as string[] | undefined,
            fromPool: params.fromPool as boolean | undefined,
            inventorySlot: params.inventorySlot as number | undefined,
          });
          return { success: true, data: item };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to add item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '添加后的物品记录' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'remove_item',
      description: '移除背包中的物品(支持部分移除或全部删除)',
      parameters: {
        inventoryId: { type: 'string', required: true, description: '背包物品唯一ID' },
        quantity: { type: 'number', required: false, description: '移除数量(不传则删除全部)' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的物品' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const result = await service.removeItem(
          context.saveId,
          params.inventoryId as any,
          params.quantity as number | undefined,
          undefined,
          params.ownerType as string | undefined,
          params.ownerId as string | undefined
        );
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '移除结果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_item',
      description: '更新物品属性(名称、描述、稀有度、类型、自定义数据)。enrich_data模式下用于丰富物品的中文描述和显示数据。quantity设为0时自动删除该物品',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要更新的物品列表',
          items: {
            type: 'object',
            required: ['inventoryId'],
            properties: {
              inventoryId: { type: 'string', description: '背包物品ID(必填)。可使用预加载上下文中的id(如 item_生锈的铁剑_xxx)或itemId(如 medieval-fantasy__rusty-sword)或物品名称' },
              name: { type: 'string', description: '物品名称(用户语言)' },
              description: { type: 'string', description: '物品描述(用户语言,100-200字)' },
              quality: { type: 'string', description: '品质 common|uncommon|rare|epic|legendary' },
              category: { type: 'string', description: '物品分类 weapon|armor|consumable|material|misc' },
              customData: { type: 'object', description: '物品展示与机制数据。必须包含: displayType(展示类型，如"武器"/"防具"/"消耗品"), displayRarity(展示稀有度，如"普通"/"优秀"/"精良"/"史诗"/"传说"), displayStats(属性数组，如[{"key":"attack","label":"攻击力","value":"+15"},{"key":"defense","label":"防御力","value":"+2"}]), displayEffects(效果描述数组，如["攻击力+15","防御力+2"]), displayDescription(物品描述文本), displayValue(价值，如{"buy":120,"sell":60,"currency":"gold"}), tags(标签数组如["可交易","可装备"])。消耗品还需: effects(机制效果数组，如[{"type":"heal","value":20,"target":"self"}]), price(售价数值)' },
              quantity: { type: 'number', description: '更新数量(设为0时自动删除该物品)' },
              visible: { type: 'boolean', description: '是否对玩家可见，设为true让玩家可见该物品' },
              stats: { type: 'object', description: '更新物品属性加成' },
              effects: { type: 'array', description: '更新物品效果', items: { type: 'string' } },
              value: { type: 'object', description: '更新物品价值' },
              tags: { type: 'array', description: '更新物品标签', items: { type: 'string' } },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的物品' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'updates' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          if (!params.inventoryId) {
            return { success: false, error: 'inventoryId参数必填。请使用预加载上下文中的物品ID，如 item_生锈的铁剑_xxx 或 medieval-fantasy__rusty-sword' };
          }
          // quantity=0 时自动删除
          if (params.quantity === 0) {
            const result = await service.removeItem(
              context.saveId,
              params.inventoryId as string,
              undefined,
              undefined,
              params.ownerType as string | undefined,
              params.ownerId as string | undefined
            );
            return { success: true, data: result };
          }

          const item = await service.updateItem({
            saveId: context.saveId,
            inventoryId: params.inventoryId as string,
            name: params.name as string | undefined,
            description: params.description as string | undefined,
            category: params.category as any,
            customData: params.customData as Record<string, unknown> | undefined,
            quantity: params.quantity as number | undefined,
            visible: params.visible as boolean | undefined,
            ownerType: params.ownerType as any,
            ownerId: params.ownerId as string | undefined,
            stats: params.stats as Record<string, number> | undefined,
            effects: Array.isArray(params.effects) ? params.effects.map(e => typeof e === 'string' ? { type: e, value: 0 } : e) as any : undefined,
            value: typeof params.value === 'number' ? { buy: params.value as number, sell: Math.floor((params.value as number) * 0.6) } as any : params.value as any,
            tags: params.tags as string[] | undefined,
          });
          return { success: true, data: item };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的物品记录(quantity=0时为删除结果)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'equip_item',
      description: '批量装备物品到指定槽位(自动替换已装备物品,验证槽位类型兼容性)。程序对每项自动四级查找：背包→名称→存档物品池→模板池→字段齐全创建',
      parameters: {
        items: {
          type: 'array',
          required: true,
          description: '要装备的物品列表',
          items: {
            type: 'object',
            properties: {
              inventoryId: { type: 'string', required: true, description: '背包物品唯一ID或物品名称' },
              targetSlot: { type: 'string', required: false, description: '目标装备槽位ID(不传则自动选择)。标准槽位: main_hand/off_hand/head/body/hands/feet/accessory1/accessory2。常见别名自动映射: chest/torso→body, hat/helmet/cap→head, boot/boots/shoe/shoes→feet, main→main_hand, off→off_hand, hand→hands, ring1/amulet→accessory1, ring2/necklace→accessory2。返回值含 requestedSlot 字段时说明发生了别名映射' },
              ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC装备物品' },
              ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' },
              fullParams: { type: 'object', required: false, description: '物品完整字段（当物品不在背包/物品池时用于自动创建）' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'items' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const result = await service.equipItem(
          context.saveId,
          params.inventoryId as any,
          params.targetSlot as any,
          params.ownerType as 'character' | 'npc' | undefined,
          params.ownerId as string | undefined,
          params.fullParams as Record<string, unknown> | undefined
        );
        return { success: result.success, data: result, error: result.success ? undefined : result.message };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '装备结果，含槽位和替换信息' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'unequip_item',
      description: '卸下装备回背包。ownerType为npc时必须传ownerId（可传NPC名称或ID，系统自动解析）',
      parameters: {
        inventoryId: { type: 'string', required: true, description: '已装备物品的唯一ID' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=当前角色(character)，"npc"=NPC。当为npc时必须传ownerId' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传（可传NPC名称或ID），ownerType为character时不传（自动从存档解析）' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const item = await service.unequipItem(context.saveId, params.inventoryId as any, params.ownerType as 'character' | 'npc' | undefined, params.ownerId as string | undefined);
        return { success: true, data: item };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '卸下装备后的物品记录' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'use_item',
      description: '使用消耗品(减少数量并返回效果,仅consumable类别可用)',
      parameters: {
        inventoryId: { type: 'string', required: true, description: '消耗品唯一ID' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC使用物品' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const result = await service.useItem(context.saveId, params.inventoryId as any, params.ownerType as string | undefined, params.ownerId as string | undefined);
        return { success: result.success, data: result, error: result.success ? undefined : result.message };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '使用消耗品的结果和效果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'trade_items',
      description: '交易物品(卖出物品验证数量和价格→移除→买入物品记录→更新金币)',
      parameters: {
        sellItems: { type: 'array', required: true, description: '卖出的物品列表 [{inventoryId, quantity}]' },
        buyItems: { type: 'array', required: true, description: '买入的物品列表 [{inventoryId, quantity}]' },
        goldDelta: { type: 'number', required: false, description: '金币变化量(正数获得,负数支付)' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC交易物品' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const result = await service.tradeItems(context.saveId, {
            sellItems: params.sellItems as any,
            buyItems: params.buyItems as any,
            goldDelta: params.goldDelta as number | undefined,
            ownerType: params.ownerType as any,
            ownerId: params.ownerId as string | undefined
          });

          if (!result.success) {
            return { success: false, error: result.error || 'Failed to trade items' };
          }

          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to trade items';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '交易结果，含卖出/买入明细和金币变化' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_equipment',
      description: '获取当前装备列表(按装备槽位排序)。支持通配符查询：ownerType="all"时返回存档下所有拥有者(character+npc)的已装备物品',
      parameters: {
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=获取NPC装备，"all"=所有拥有者(仅查询类支持)' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const equipmentResult = await service.getEquipment(context.saveId, params.ownerType as 'character' | 'npc' | 'all' | undefined, params.ownerId as string | undefined);
        return { success: true, data: equipmentResult };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '当前装备列表，按装备槽位排序' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'check_item_quantity',
      description: '检查背包中指定物品的总数量(按item_id汇总)',
      parameters: {
        itemId: { type: 'string', required: true, description: '物品模板ID' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的物品' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const quantity = await service.checkItemQuantity(context.saveId, params.itemId as string, params.ownerType as string | undefined, params.ownerId as string | undefined);
          return { success: true, data: { itemId: params.itemId, quantity } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check item quantity';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: '物品数量查询结果',
            properties: {
              itemId: { type: 'string' as const, description: '物品模板ID' },
              quantity: { type: 'number' as const, description: '该物品的总数量' }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_pool_item',
      description: '向物品池添加物品定义，taken默认为false。返回完整的物品池条目。',
      parameters: {
        name: { type: 'string', required: true, description: '物品名称(用户语言，必填)' },
        description: { type: 'string', required: false, description: '物品描述(用户语言)' },
        category: { type: 'string', required: false, description: '物品分类 weapon|armor|accessory|consumable|material|quest|misc' },
        quality: { type: 'string', required: false, description: '品质 common|uncommon|rare|epic|legendary' },
        stats: { type: 'object', required: false, description: '物品属性加成，如{attack:5,defense:3}' },
        effects: { type: 'array', required: false, description: '物品效果数组', items: { type: 'string' } },
        value: { type: 'object', required: false, description: '物品价值，如{buy:20,sell:10,currency:"gold"}' },
        tags: { type: 'array', required: false, description: '物品标签数组', items: { type: 'string' } },
        weight: { type: 'number', required: false, description: '物品重量' },
        maxStack: { type: 'number', required: false, description: '最大堆叠数' },
        equippedSlot: { type: 'string', required: false, description: '装备槽位' },
        durability: { type: 'number', required: false, description: '当前耐久度' },
        maxDurability: { type: 'number', required: false, description: '最大耐久度' },
        customData: { type: 'object', required: false, description: '自定义数据' },
        recommendedClasses: { type: 'array', required: false, description: '推荐职业列表', items: { type: 'string' } }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const addParams = {
            saveId: context.saveId,
            name: String(params.name ?? ''),
            description: params.description as string | undefined,
            category: params.category as import('./types.js').ItemCategory | undefined,
            quality: params.quality as import('./types.js').ItemQuality | undefined,
            stats: params.stats as Record<string, number> | undefined,
            effects: params.effects as import('./types.js').ItemEffect[] | undefined,
            value: params.value as import('./types.js').ItemValue | undefined,
            tags: params.tags as string[] | undefined,
            weight: params.weight as number | undefined,
            maxStack: params.maxStack as number | undefined,
            equippedSlot: params.equippedSlot as string | null | undefined,
            durability: params.durability as number | undefined,
            maxDurability: params.maxDurability as number | undefined,
            customData: params.customData as Record<string, unknown> | undefined,
            recommendedClasses: params.recommendedClasses as string[] | undefined,
          };
          const result = await service.addPoolItem(context.saveId, addParams);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to add pool item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '添加后的物品池条目' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'list_pool_items',
      description: '列出物品池中的物品，可按taken状态和category筛选。preloaded: 返回结果包含所有物品池条目。',
      parameters: {
        taken: { type: 'boolean', required: false, description: '按taken状态筛选：true=已取用，false=未取用，不传=全部' },
        category: { type: 'string', required: false, description: '按物品分类筛选' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const options: { taken?: boolean; category?: string } = {};
          if (params.taken !== undefined) options.taken = params.taken as boolean;
          if (params.category !== undefined) options.category = params.category as string;
          const result = await service.listPoolItems(context.saveId, options);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to list pool items';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '物品池条目列表' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_pool_item',
      description: '获取物品池中指定物品的详细信息。preloaded: 返回结果包含完整物品定义。',
      parameters: {
        poolItemId: { type: 'string', required: true, description: '物品池条目ID' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const result = await service.getPoolItem(context.saveId, params.poolItemId as string);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get pool item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '物品池条目详情' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'remove_pool_item',
      description: '从物品池中删除物品定义。',
      parameters: {
        poolItemId: { type: 'string', required: true, description: '物品池条目ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        try {
          const result = await service.removePoolItem(context.saveId, params.poolItemId as string);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to remove pool item';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '删除结果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_item_from_pool',
      description: '从物品池批量取用物品到背包。传入物品列表，程序对每项自动三级查找：存档物品池→模板池复制→字段完整则创建并回写模板池。支持一次为多个NPC添加不同物品',
      parameters: {
        items: {
          type: 'array',
          required: true,
          description: '要取用的物品列表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', required: true, description: '物品名称（如"铁剑"），程序自动从物品池匹配或创建' },
              quantity: { type: 'number', required: false, description: '取用数量(默认1)' },
              ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=添加到NPC背包' },
              ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' },
              category: { type: 'string', required: false, description: '物品分类 weapon|armor|accessory|consumable|material|quest|misc' },
              description: { type: 'string', required: false, description: '物品描述' },
              stats: { type: 'object', required: false, description: '属性加成' },
              effects: { type: 'array', required: false, description: '效果数组' },
              value: { type: 'object', required: false, description: '物品价值' },
              quality: { type: 'string', required: false, description: '品质 common|uncommon|rare|epic|legendary' },
              customData: { type: 'object', required: false, description: '自定义数据' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'items' },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInventoryService(context);
        const { name, quantity, ownerType, ownerId, ...restParams } = params;
        if (!name) {
          return { success: false, error: '必须提供 name 字段' };
        }
        const fullParams = { name, ...restParams };
        try {
          const result = await service.addItemFromPool(
            context.saveId,
            name as string,
            quantity as number | undefined,
            ownerType as 'character' | 'npc' | undefined,
            ownerId as string | undefined,
            Object.keys(restParams).length > 0 ? fullParams as Record<string, unknown> : undefined
          );
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to add item from pool';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '从物品池取用后的背包物品记录' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('list', 'list_inventory', 10, '获取背包列表');
    this.addActionHandler('add', 'add_item', 10, '添加物品');
    this.addActionHandler('remove', 'remove_item', 10, '移除物品');
    this.addActionHandler('update', 'update_item', 8, '更新物品属性');
    this.addActionHandler('equip', 'equip_item', 10, '装备物品');
    this.addActionHandler('unequip', 'unequip_item', 10, '卸下装备');
    this.addActionHandler('use', 'use_item', 10, '使用物品');

    this.addActionHandler('trade', 'trade_items', 10, '交易物品');
    this.addActionHandler('get_equipment', 'get_equipment', 10, '获取装备列表');
    this.addActionHandler('check_quantity', 'check_item_quantity', 10, '检查物品数量');

    // 别名映射(priority=5)
    this.addActionHandler('inventory', 'list_inventory', 5, '背包(别名)');
  }
}
