import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { Gender } from '../../../../shared/src/types/game.js';
import { CharacterService } from './CharacterService.js';
import { CharacterRepository } from './CharacterRepository.js';
import { NumericalService } from '../numerical/NumericalService.js';
import { InventoryRepository } from '../inventory/InventoryRepository.js';
import { NPCRepository } from '../npc/NPCRepository.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { ITemplateProvider } from '../shared/types.js';

/**
 * Character 领域 ServiceTool（S4 重构后的组合根，D8）。
 * 每次请求时在 createCharacterService 内创建 Repository + TransactionManager + 跨领域端口，
 * 注入 CharacterService（5 参数构造）。
 * ITemplateProvider 为可选依赖，由 init.ts 通过 setTemplateService 注入。
 */
export class CharacterServiceTool extends BaseTool {
  private templateService: ITemplateProvider | null = null;

  constructor() {
    super(
      'character_service' as ToolType,
      'Character Service',
      '角色管理服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
    this.registerHandledActions();
  }

  /** 注入 ITemplateProvider 实例（可选依赖，组合根在 init.ts 中按需注入） */
  setTemplateService(templateService: ITemplateProvider): void {
    this.templateService = templateService;
  }

  /**
   * 创建 CharacterService 实例（组合根入口，D8）。
   * public 供跨领域 ServiceTool（如 InventoryServiceTool）调用获取 ICharacterService。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createCharacterService(context: ToolContext): Promise<CharacterService> {
    return context.requestScope.getOrCompute('character', () => this.buildCharacterService(context));
  }

  private async buildCharacterService(context: ToolContext): Promise<CharacterService> {
    const db = context.requestScope.getDb();
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const characterRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const npcRepo = new NPCRepository(db);
    const txManager = new KnexTransactionManager(db);
    const saveRepo = new SaveRepository(db);
    const numericalService = new NumericalService(characterRepo, inventoryRepo, npcRepo, txManager, ruleParser);
    return new CharacterService(
      characterRepo,
      saveRepo,
      numericalService,
      txManager,
      this.templateService,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'create_character',
      description: '创建新角色(含属性初始化和派生属性计算)',
      parameters: {
        name: { type: 'string', required: true, description: '角色名称' },
        gender: { type: 'string', required: true, description: '性别(male/female/custom)' },
        race: { type: 'string', required: true, description: '种族' },
        classType: { type: 'string', required: true, description: '职业' },
        background: { type: 'string', required: true, description: '背景' },
        attributes: { type: 'object', required: false, description: '初始属性(模板定义的属性ID和值，如 {str: 12, dex: 10, int: 14, con: 11, wis: 8, cha: 10})' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const character = await service.createCharacter({
          saveId: context.saveId,
          name: params.name as string,
          gender: (params.gender as Gender) || 'male',
          race: params.race as string,
          classType: params.classType as string,
          background: params.background as string,
          attributes: (params.attributes || {}) as Parameters<CharacterService['createCharacter']>[0]['attributes']
        });
        return { success: true, data: character, writeOperation: { toolType: this.type, method: 'create_character', params, result: character, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '创建的角色完整数据(CharacterData)' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_full_status',
      description: '获取角色完整状态面板(含基础信息/属性/派生属性/经验/金币)',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const status = await service.getFullStatus(context.saveId);
        return { success: true, data: status };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '角色完整状态面板(CharacterStatusPanel)，含基础信息/属性/派生属性/生命/经验/货币' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_attributes',
      description: '更新角色基础属性(自动重算派生属性)',
      parameters: {
        deltas: { type: 'object', required: true, description: '属性增量(模板定义的属性ID和增量，如 {str: +2, con: +3})' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const character = await service.updateAttributes(context.saveId, params.deltas as Partial<Record<string, number>>);
        return { success: true, data: character, writeOperation: { toolType: this.type, method: 'update_attributes', params, result: character, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的角色完整数据(CharacterData)' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'modify_health',
      description: '修改角色HP(正数治疗/负数受伤)',
      parameters: {
        delta: { type: 'number', required: true, description: 'HP变化量' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const result = await service.modifyHealth(context.saveId, params.delta as number);
        return { success: true, data: result, writeOperation: { toolType: this.type, method: 'modify_health', params, result, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: 'HP变更结果',
            properties: {
              previous: { type: 'number' as const, description: '变更前HP' },
              current: { type: 'number' as const, description: '当前HP' },
              max: { type: 'number' as const, description: '最大HP' }
            }
          }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'modify_mana',
      description: '修改角色MP(正数恢复/负数消耗)',
      parameters: {
        delta: { type: 'number', required: true, description: 'MP变化量' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const result = await service.modifyMana(context.saveId, params.delta as number);
        return { success: true, data: result, writeOperation: { toolType: this.type, method: 'modify_mana', params, result, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: 'MP变更结果',
            properties: {
              previous: { type: 'number' as const, description: '变更前MP' },
              current: { type: 'number' as const, description: '当前MP' },
              max: { type: 'number' as const, description: '最大MP' }
            }
          }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'modify_currency',
      description: '修改角色货币(正数获得/负数花费)',
      parameters: {
        currencyId: { type: 'string', required: true, description: '货币ID(如 gold, silver 等)' },
        delta: { type: 'number', required: true, description: '货币变化量' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        const currency = await service.modifyCurrency(context.saveId, params.currencyId as string, params.delta as number);
        return { success: true, data: { currency }, writeOperation: { toolType: this.type, method: 'modify_currency', params, result: { currency }, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: '货币变更结果',
            properties: {
              currency: { type: 'object' as const, description: '所有货币余额(如 {gold: 100, silver: 50})' }
            }
          }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'mark_permadeath',
      description: '标记角色永久死亡(permadeath规则触发时调用)',
      parameters: {},
      isWrite: true,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCharacterService(context);
        await service.markPermadeath(context.saveId);
        const result = { permadeath: true };
        return { success: true, data: result, writeOperation: { toolType: this.type, method: 'mark_permadeath', params: _params, result, timestamp: context.timestamp } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            description: '永久死亡标记结果',
            properties: {
              permadeath: { type: 'boolean' as const, description: '是否已标记永久死亡' }
            }
          }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射

    this.addActionHandler('get_status', 'get_full_status', 10, '获取角色完整状态面板');
    this.addActionHandler('create_character', 'create_character', 10, '创建新角色');
    this.addActionHandler('update_attributes', 'update_attributes', 10, '更新角色基础属性');
    this.addActionHandler('modify_health', 'modify_health', 10, '修改角色HP');
    this.addActionHandler('modify_mana', 'modify_mana', 10, '修改角色MP');
    this.addActionHandler('modify_currency', 'modify_currency', 10, '修改角色货币');
    this.addActionHandler('mark_permadeath', 'mark_permadeath', 10, '标记角色永久死亡');
    // 别名映射(priority=5)
    this.addActionHandler('status', 'get_full_status', 5, '获取角色状态(别名)');
    this.addActionHandler('heal', 'modify_health', 5, '治疗角色(别名)');
    this.addActionHandler('modify_gold', 'modify_currency', 5, '修改金币(别名，统一走modify_currency)');
  }
}
