import { BaseTool, throwIfAborted, isAbortError } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse, ActionHandler } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { GameInitService } from './GameInitService.js';
import type { CharacterInputData } from './types.js';
import { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import { CharacterRepository } from '../character/CharacterRepository.js';
import { LocationRepository } from '../map/LocationRepository.js';
import { NPCRepository } from '../npc/NPCRepository.js';
import { SkillPoolRepository } from '../skill/SkillPoolRepository.js';
import { ItemPoolRepository } from '../inventory/ItemPoolRepository.js';
import { QuestRepository } from '../quest/QuestRepository.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import type { ITemplateProvider } from '../shared/types.js';

/**
 * GameInit 领域 ServiceTool（S4 重构后的组合根，D8）。
 *
 * 依赖注入：
 * - CharacterServiceTool: 跨领域获取 CharacterService（createCharacter + modifyCurrency）
 * - ITemplateProvider: 跨层访问 templates 表（可选依赖，由 init.ts 通过 setTemplateService 注入）
 *
 * 组合根 createInitService 内按请求创建：
 * - 6 Repository（characterRepo + locationRepo + npcRepo + skillPoolRepo + itemPoolRepo + questRepo）
 * - KnexTransactionManager
 * - CharacterService（通过 CharacterServiceTool 跨领域获取，requestScope 共享）
 * - GameInitService（注入以上全部依赖）
 */
export class GameInitServiceTool extends BaseTool {
  private characterServiceTool: CharacterServiceTool;
  private templateService: ITemplateProvider | null = null;

  constructor(characterServiceTool: CharacterServiceTool) {
    super(
      'game_init_service' as ToolType,
      'Game Init Service',
      '游戏初始化服务：读取模板数据、初始化角色数值。初始化流程由game-initialization技能驱动，通过spawn_agent调度子Agent完成技能/物品/地图/NPC/任务的创建。',
      '2.0.0',
      [] as ActionHandler[]
    );

    this.characterServiceTool = characterServiceTool;
    this.registerMethods();
  }

  /** 注入 ITemplateProvider 实例（可选依赖，组合根在 init.ts 中按需注入） */
  setTemplateService(templateService: ITemplateProvider): void {
    this.templateService = templateService;
  }

  /**
   * 创建 GameInitService 实例（组合根入口，D8）。
   * 通过 requestScope 在请求内共享，避免重复创建。
   */
  async createInitService(context: ToolContext): Promise<GameInitService> {
    return context.requestScope.getOrCompute('gameInit', () => this.buildInitService(context));
  }

  private async buildInitService(context: ToolContext): Promise<GameInitService> {
    const db = context.requestScope.getDb();
    const characterRepo = new CharacterRepository(db);
    const locationRepo = new LocationRepository(db);
    const npcRepo = new NPCRepository(db);
    const skillPoolRepo = new SkillPoolRepository(db);
    const itemPoolRepo = new ItemPoolRepository(db);
    const questRepo = new QuestRepository(db);

    // 跨领域获取 CharacterService（requestScope 共享，避免重复创建）
    const characterService = await this.characterServiceTool.createCharacterService(context);

    if (!this.templateService) {
      throw new Error('ITemplateProvider not injected. Call setTemplateService() before use.');
    }

    const txManager = new KnexTransactionManager(db);

    return new GameInitService(
      characterRepo,
      locationRepo,
      npcRepo,
      skillPoolRepo,
      itemPoolRepo,
      questRepo,
      characterService,
      this.templateService,
      txManager,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'init_stats',
      description: '初始化角色数值属性和金币。注意：角色可能已由game.ts创建，此方法会检查是否已存在，已存在则跳过创建仅返回数据。',
      parameters: {
        characterData: {
          type: 'object',
          required: false,
          description: '角色数据（角色已存在时可不传）',
          properties: {
            name: { type: 'string', required: false, description: '角色名称' },
            gender: { type: 'string', required: false, description: '性别(male/female/custom)' },
            customGender: { type: 'string', required: false, description: '自定义性别(gender为custom时填写)' },
            ageGroup: { type: 'string', required: false, description: '年龄段(young/youth/middle/elderly)' },
            race: { type: 'string', required: false, description: '种族' },
            classType: { type: 'string', required: false, description: '职业' },
            background: { type: 'string', required: false, description: '背景' },
            attributes: {
              type: 'object',
              required: false,
              description: '属性值(模板定义的属性ID和值)',
              properties: {} // 动态属性，具体字段由模板定义
            },
            customOptions: { type: 'object', required: false, description: '自定义选项(模板定义的自定义字段键值对)' }
          }
        }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createInitService(context);
        try {
          // M6 阶段①：幂等检查（角色可能已由 game.ts 创建）——阶段边界 abort 检查点
          context.onUpdate?.({ percent: 0, message: '检查角色是否已存在...', stage: 'check_existing' });
          throwIfAborted(context.abortSignal);

          const existingCharacterId = await service.hasCharacter(context.saveId);
          if (existingCharacterId) {
            context.onUpdate?.({ percent: 100, message: '角色已存在，跳过初始化', stage: 'complete' });
            return { success: true, data: { characterId: existingCharacterId, action: 'skipped', reason: 'character_already_exists' } };
          }

          const characterData = params.characterData as CharacterInputData | undefined;
          if (!characterData) {
            return { success: false, error: 'characterData is required when character does not exist yet' };
          }

          // M6 阶段②：模板数据获取——阶段边界 abort 检查点先于帧上报（避免报告未进入的阶段）
          throwIfAborted(context.abortSignal);
          context.onUpdate?.({ percent: 30, message: '读取模板数据...', stage: 'load_template' });

          // templateId 优先从 context 获取（不暴露给 LLM），兼容过渡期从 params 获取
          const templateId = context.templateId || (params.templateId as string | undefined);
          const templateData = await service.getTemplateData(templateId);

          // M6 阶段③：属性计算与角色落库——事务开启前 abort 检查点先于帧上报
          throwIfAborted(context.abortSignal);
          context.onUpdate?.({ percent: 60, message: '计算角色属性并创建角色...', stage: 'create_character' });

          const result = await service.step1_initStats(
            context.saveId,
            characterData,
            templateData
          );

          context.onUpdate?.({ percent: 100, message: '角色数值初始化完成', stage: 'complete' });
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'init_stats', params, result, timestamp: context.timestamp } };
        } catch (error) {
          // M6：取消错误冒泡，由 BaseTool 统一规范化为 aborted 响应（单一规范化点）
          if (isAbortError(error)) {
            throw error;
          }
          const errorMessage = error instanceof Error ? error.message : 'Failed to init stats';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '初始化结果',
            properties: {
              characterId: { type: 'string', description: '角色ID' },
              action: { type: 'string', description: '执行动作：created 或 skipped' },
              reason: { type: 'string', description: '跳过原因(如 character_already_exists)' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_template_data',
      description: '获取模板数据。可按section筛选，支持: initial_data, character_creation, starting_scene, world_setting, items, skills, locations, game_rules, ai_constraints, ui_theme, ui_layout, special_rules。不传sections则返回全部数据。',
      parameters: {
        sections: {
          type: 'array',
          required: false,
          description: '要获取的数据段落列表，如 ["skills","items"]。不传则返回全部。',
          items: { type: 'string' }
        }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const db = context.requestScope.getDb();
        const service = await this.createInitService(context);
        try {
          let templateId = context.templateId || (params.templateId as string | undefined);
          // 兜底：从 saves 表解析 templateId
          if (!templateId && context.saveId) {
            const saveRepo = new SaveRepository(db);
            templateId = (await saveRepo.getTemplateIdBySaveId(context.saveId)) ?? undefined;
          }
          if (!templateId) {
            return { success: false, error: 'templateId 未指定且无法从存档解析，请确认存档关联了模板' };
          }
          const templateData = await service.getTemplateData(templateId);

          // 按 sections 筛选
          const sections = params.sections as string[] | undefined;
          if (sections && sections.length > 0) {
            const sectionKeyMap: Record<string, keyof typeof templateData> = {
              initial_data: 'initial_data',
              character_creation: 'character_creation',
              starting_scene: 'starting_scene',
              world_setting: 'world_setting',
              items: 'items',
              skills: 'skills',
              locations: 'locations',
              game_rules: 'game_rules',
              ai_constraints: 'ai_constraints',
              ui_theme: 'ui_theme',
              ui_layout: 'ui_layout',
              special_rules: 'special_rules',
            };
            const filtered: Record<string, unknown> = { id: templateData.id, name: templateData.name };
            for (const section of sections) {
              const key = sectionKeyMap[section];
              if (key && templateData[key] !== undefined) {
                filtered[section] = templateData[key];
              }
            }
            return { success: true, data: filtered };
          }

          return { success: true, data: templateData };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get template data';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '模板数据(全部或按sections筛选后的子集)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });
  }
}
