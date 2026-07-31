import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { ID } from '../../../../shared/src/types/core.js';
import { SkillService } from './SkillService.js';
import { SkillPoolRepository } from './SkillPoolRepository.js';
import { CharacterSkillRepository } from './CharacterSkillRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import { SkillPoolEntityResolver } from './SkillPoolEntityResolver.js';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import type { NPCServiceTool } from '../npc/NPCServiceTool.js';
import type { InventoryServiceTool } from '../inventory/InventoryServiceTool.js';
import type { ITemplateProvider, ITemplatePoolProvider } from '../shared/types.js';

/**
 * Skill 领域 ServiceTool（S2-2 重构后的组合根，D8）。
 * 每次请求时在 createSkillService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 SkillService。跨领域 CharacterService/NPCService/InventoryService 通过构造注入的 ServiceTool 获取；
 * ITemplateProvider/ITemplatePoolProvider 为单例，通过 setter 在 init.ts 注入。
 */
export class SkillServiceTool extends BaseTool {
  private readonly characterServiceTool: CharacterServiceTool;
  private readonly npcServiceTool: NPCServiceTool;
  private readonly inventoryServiceTool: InventoryServiceTool;
  private templateService: ITemplateProvider | null = null;
  private templatePoolService: ITemplatePoolProvider | null = null;

  constructor(
    characterServiceTool: CharacterServiceTool,
    npcServiceTool: NPCServiceTool,
    inventoryServiceTool: InventoryServiceTool,
  ) {
    super(
      'skill_service' as ToolType,
      'Skill Service',
      '技能系统服务。详细使用方法请调用 get_tool_help 工具。',
      '1.1.0'
    );

    this.characterServiceTool = characterServiceTool;
    this.npcServiceTool = npcServiceTool;
    this.inventoryServiceTool = inventoryServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  setTemplateService(templateService: ITemplateProvider): void {
    this.templateService = templateService;
  }

  setTemplatePoolService(service: ITemplatePoolProvider): void {
    this.templatePoolService = service;
  }

  /**
   * 创建 SkillService 实例（组合根入口，D8）。
   * public 供跨领域消费方调用获取 SkillService。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createSkillService(context: ToolContext): Promise<SkillService> {
    return context.requestScope.getOrCompute('skill', () => this.buildSkillService(context));
  }

  private async buildSkillService(context: ToolContext): Promise<SkillService> {
    const db = context.requestScope.getDb();
    const skillPoolRepo = new SkillPoolRepository(db);
    const characterSkillRepo = new CharacterSkillRepository(db);
    const saveRepo = new SaveRepository(db);
    const txManager = new KnexTransactionManager(db);
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const characterService = await this.characterServiceTool.createCharacterService(context);
    const npcService = await this.npcServiceTool.createNPCService(context);
    const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
    const skillPoolResolver = new SkillPoolEntityResolver(skillPoolRepo, db);

    return new SkillService(
      skillPoolRepo,
      characterSkillRepo,
      characterService,
      npcService,
      inventoryService,
      saveRepo,
      txManager,
      ruleParser,
      this.templateService,
      this.templatePoolService,
      skillPoolResolver,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_skills',
      description: '获取技能列表(含完整详情)。支持通配符查询：ownerType="all"时返回存档下所有拥有者(character+npc)的技能',
      parameters: {
        visibility: { type: 'string', required: false, description: '可见性过滤：不传=只返回可见的技能，"all"=返回全部技能(含不可见)，"not_visible"=只返回不可见的技能' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的技能，"all"=所有拥有者(仅查询类支持)' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const skillsResult = await service.listSkills(context.saveId, params.visibility as string | undefined, params.ownerType as 'character' | 'npc' | 'all' | undefined, params.ownerId as string | undefined);
        return { success: true, data: skillsResult };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '技能列表(含完整详情)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_skill',
      description: '获取技能详情(含等级/经验/冷却/效果)。支持通配符查询：ownerType="all"时按技能名称查询返回所有拥有者的匹配记录(数组)',
      parameters: {
        skills: {
          type: 'array',
          required: true,
          description: '要获取的技能列表',
          items: {
            type: 'object',
            properties: {
              skillId: { type: 'string', description: '技能ID' },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的技能，"all"=所有拥有者(仅查询类支持，返回数组)' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略' }
            }
          }
        }
      },
      batch: { param: 'skills' },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        try {
          const skill = await service.findSkill(context.saveId, params.skillId as string, params.ownerType as string | 'all' | undefined, params.ownerId as string | undefined);
          return { success: true, data: skill };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : `Skill not found: ${params.skillId}`;
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '技能详情(单个)或技能数组(ownerType=all时按名称匹配返回所有拥有者的记录)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'learn_skill',
      description: '从技能池学习技能(检查前置条件和等级要求)。传入技能名称即可，程序会自动从存档技能池→模板技能池→创建新技能的三级路径匹配。若技能已学习，会增量更新非黑名单字段（visible/level/exp等）',
      parameters: {
        skills: {
          type: 'array',
          required: true,
          description: '要学习的技能列表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', required: true, description: '技能名称（如"火球术"），程序会自动从技能池匹配或创建）' },
              visible: { type: 'boolean', description: '是否对玩家可见，可选，默认false（学习后对玩家不可见，需显式设为true才可见）。NPC技能通常设为false' },
              level: { type: 'number', description: '技能等级，可选。若技能已学习且传入此字段，会增量更新技能等级' },
              exp: { type: 'number', description: '技能经验值，可选。若技能已学习且传入此字段，会增量更新经验值' },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC学习技能' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' },
              description: { type: 'string', required: false, description: '技能描述' },
              category: { type: 'string', required: false, description: '技能类别(attack/defense/healing/buff/debuff/utility/passive)' },
              element: { type: 'string', required: false, description: '元素属性(fire/water/earth/wind/light/dark/physical/none)' },
              cost: { type: 'array', required: false, description: '消耗数组(如[{type:"mp",amount:10}])' },
              damage: { type: 'object', required: false, description: '伤害数据' },
              effects: { type: 'array', required: false, description: '技能效果数组' },
              cooldown: { type: 'number', required: false, description: '冷却时间' },
              maxLevel: { type: 'number', required: false, description: '最大等级(默认10)' },
              targetType: { type: 'string', required: false, description: '目标类型(single/multi/self/aoe)' },
              range: { type: 'number', required: false, description: '技能范围(默认1)' },
              customData: { type: 'object', required: false, description: '自定义数据' }
            }
          }
        }
      },
      batch: { param: 'skills' },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const { visible, ownerType, ownerId, name, ...restParams } = params;
        if (!name) {
          return { success: false, error: '必须提供 name 字段' };
        }
        const fullParams = { name, ...restParams };
        const result = await service.learnSkill(
          context.saveId,
          name as string,
          visible as boolean | undefined,
          ownerType as 'character' | 'npc' | undefined,
          ownerId as string | undefined,
          Object.keys(restParams).length > 0 ? fullParams : undefined,
        );

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to learn skill' };
        }

        // 透传 alreadyLearned + warnings，让 Agent 知晓技能已存在及字段更新情况
        return {
          success: true,
          data: {
            ...result.skill,
            alreadyLearned: result.alreadyLearned,
            warnings: result.warnings,
          },
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '学习到的技能对象，含alreadyLearned（是否已学习）和warnings（字段更新提示）字段' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'create_skill',
      description: '自由创建技能(写入技能池,可选是否立即学习)',
      parameters: {
        skills: {
          type: 'array',
          required: true,
          description: '要创建的技能列表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '技能名称' },
              description: { type: 'string', description: '技能描述' },
              category: { type: 'string', description: '技能类别(attack/defense/healing/buff/debuff/utility/passive)' },
              element: { type: 'string', description: '元素属性(fire/water/earth/wind/light/dark/physical/none)' },
              cost: { type: 'array', description: '消耗数组(如[{type:"mp",amount:10},{type:"stamina",amount:5}])' },
              maxLevel: { type: 'number', description: '最大等级(默认10)' },
              damage: { type: 'object', description: '伤害数据(如{base:10,min:5,max:15,scaling:"strength*0.5"})' },
              scalingStat: { type: 'string', description: '缩放属性(如"strength","intelligence")' },
              cooldown: { type: 'number', description: '冷却时间(回合制为回合数,时间制为毫秒,默认0)' },
              effects: { type: 'array', description: '技能效果数组(如[{type:"damage",value:10,target:"enemy"}])' },
              skillType: { type: 'string', description: '技能类型标识(如"active","passive","ultimate")' },
              targetType: { type: 'string', description: '目标类型(single/multi/self/aoe,默认single)' },
              range: { type: 'number', description: '技能范围(默认1)' },
              customData: { type: 'object', description: '自定义数据' },
              visible: { type: 'boolean', description: '是否对玩家可见，可选，默认true（创建即可见）。设为false则对玩家不可见' },
              learn: { type: 'boolean', description: '是否立即学习该技能，默认false（仅写入技能池）' },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC创建技能' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
            }
          }
        }
      },
      batch: { param: 'skills' },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const result = await service.createSkill(context.saveId, {
          name: params.name as string,
          description: params.description as string | undefined,
          category: params.category as string | undefined,
          element: params.element as string | undefined,
          cost: params.cost as import('../../../../shared/src/types/game.js').SkillCostEntry[] | undefined,
          maxLevel: params.maxLevel as number | undefined,
          damage: params.damage as Record<string, unknown> | undefined,
          scalingStat: params.scalingStat as string | undefined,
          cooldown: params.cooldown as number | undefined,
          effects: params.effects as Array<Record<string, unknown>> | undefined,
          skillType: params.skillType as string | undefined,
          targetType: params.targetType as string | undefined,
          range: params.range as number | undefined,
          customData: params.customData as Record<string, unknown> | undefined,
          visible: params.visible as boolean | undefined,
          learn: params.learn as boolean | undefined,
        }, params.ownerType as 'character' | 'npc' | undefined, params.ownerId as string | undefined);

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to create skill' };
        }

        return { success: true, data: { skill: result.skill, poolSkillId: result.poolSkillId } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            properties: {
              skill: { type: 'object' as const, description: '创建的技能对象' },
              poolSkillId: { type: 'string' as const, description: '技能池中的ID' }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'list_pool_skills',
      description: '查询技能池中的技能(可按学习状态和分类过滤)',
      parameters: {
        learned: { type: 'boolean', required: false, description: '学习状态过滤：true=已学习, false=未学习, 不传=全部' },
        category: { type: 'string', required: false, description: '按分类过滤(attack/defense/healing/buff/debuff/utility/passive)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const options: { learned?: boolean; category?: string } = {};
        if (params.learned !== undefined) options.learned = params.learned as boolean;
        if (params.category !== undefined) options.category = params.category as string;
        const poolSkills = await service.listPoolSkills(context.saveId, options);
        return { success: true, data: poolSkills };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'array' as const,
            description: '技能池中的技能列表',
            items: { type: 'object' as const }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_pool_skill',
      description: '向技能池添加技能(不学习,仅注册到池中)',
      parameters: {
        name: { type: 'string', required: true, description: '技能名称' },
        description: { type: 'string', required: false, description: '技能描述' },
        category: { type: 'string', required: false, description: '技能类别(attack/defense/healing/buff/debuff/utility/passive)' },
        element: { type: 'string', required: false, description: '元素属性(fire/water/earth/wind/light/dark/physical/none)' },
        cost: { type: 'array', required: false, description: '消耗数组(如[{type:"mp",amount:10}])' },
        damage: { type: 'object', required: false, description: '伤害数据' },
        effects: { type: 'array', required: false, description: '技能效果数组' },
        cooldown: { type: 'number', required: false, description: '冷却时间' },
        maxLevel: { type: 'number', required: false, description: '最大等级(默认10)' },
        targetType: { type: 'string', required: false, description: '目标类型(single/multi/self/aoe)' },
        range: { type: 'number', required: false, description: '技能范围(默认1)' },
        customData: { type: 'object', required: false, description: '自定义数据' },
        recommendedClasses: { type: 'array', required: false, description: '推荐职业列表', items: { type: 'string' } }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const poolSkill = await service.addPoolSkill(context.saveId, {
          name: params.name as string,
          description: params.description as string | undefined,
          category: params.category as string | undefined,
          element: params.element as string | undefined,
          cost: params.cost as import('../../../../shared/src/types/game.js').SkillCostEntry[] | undefined,
          damage: params.damage as Record<string, unknown> | undefined,
          effects: params.effects as Array<Record<string, unknown>> | undefined,
          cooldown: params.cooldown as number | undefined,
          maxLevel: params.maxLevel as number | undefined,
          targetType: params.targetType as string | undefined,
          range: params.range as number | undefined,
          customData: params.customData as Record<string, unknown> | undefined,
          recommendedClasses: params.recommendedClasses as string[] | undefined,
        });
        return { success: true, data: poolSkill };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '添加到技能池的技能对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'remove_pool_skill',
      description: '从技能池删除技能',
      parameters: {
        poolSkillId: { type: 'string', required: true, description: '技能池中的技能ID' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const removed = await service.removePoolSkill(context.saveId, params.poolSkillId as string);
        if (!removed) {
          return { success: false, error: `技能池中未找到: ${params.poolSkillId}` };
        }
        return { success: true, data: { removed: true } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            properties: {
              removed: { type: 'boolean' as const }
            }
          },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'upgrade_skill',
      description: '升级技能(检查经验是否足够,计算属性加成)',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能ID' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC升级技能' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const result = await service.upgradeSkill(context.saveId, params.skillId as string, params.ownerType as string | undefined, params.ownerId as string | undefined);

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to upgrade skill' };
        }

        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '升级结果(含技能对象和升级信息)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'set_cooldown',
      description: '设置技能冷却剩余时间(ms或回合数,取决于冷却系统类型)',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能ID' },
        remaining: { type: 'number', required: true, description: '冷却剩余值(时间制为毫秒,回合制为回合数)' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的技能' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        try {
          const updatedSkill = await service.setCooldown(
            context.saveId,
            params.skillId as string,
            params.remaining as number,
            params.ownerType as string | undefined,
            params.ownerId as string | undefined
          );
          return { success: true, data: updatedSkill };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to set cooldown';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的技能对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'check_cooldown',
      description: '检查技能是否可用(冷却是否结束,返回冷却类型和剩余值)。支持通配符查询：ownerType="all"时返回所有拥有者的冷却状态(数组)',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能ID' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的技能，"all"=所有拥有者(仅查询类支持，返回数组)' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        try {
          const result = await service.checkCooldown(context.saveId, params.skillId as string, params.ownerType as string | 'all' | undefined, params.ownerId as string | undefined);
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check cooldown';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '冷却检查结果(单个)或冷却数组(ownerType=all时返回所有拥有者的冷却状态，含ownerId/ownerType字段)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'use_skill',
      description: '使用技能(检查冷却→检查资源→扣减多种资源→设置冷却→获得经验→计算伤害→传入targetId时自动扣减目标HP)。传入targetId后程序自动应用伤害到目标HP并返回targetApplied字段(newHp/maxHp)，LLM无需额外调用modify_health',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能ID' },
        targetId: { type: 'string', required: false, description: '目标ID(可选，战斗中使用)。传入后程序按ID前缀自动识别character/npc并扣减目标HP：npc_开头或能解析为NPC→扣NPC的HP，否则→扣character的HP。返回targetApplied字段含newHp/maxHp，无需再调用modify_health' },
        ownerType: { type: 'string', required: false, description: '拥有者类型：不传=默认角色(character)，"npc"=NPC使用技能' },
        ownerId: { type: 'string', required: false, description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        try {
          const result = await service.useSkill(
            context.saveId,
            params.skillId as string,
            params.targetId as ID | undefined,
            params.ownerType as 'character' | 'npc' | undefined,
            params.ownerId as string | undefined
          );

          if (!result.success) {
            return { success: false, error: result.error || 'Failed to use skill' };
          }

          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to use skill';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '使用结果(含效果、资源扣减、经验获得)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_skill_tree',
      description: '获取技能树信息(已学习技能+可学习技能+掌握等级)',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        const templateId = context.templateId as string | undefined;
        const result = await service.getSkillTreeInfo(context.saveId, templateId);
        return { success: true, data: result };
      }
    });

    this.registerMethod({
      name: 'update_skill',
      description: '更新技能的属性，包括customData',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要更新的技能列表',
          items: {
            type: 'object',
            required: ['skillId'],
            properties: {
              skillId: { type: 'string', description: '技能ID(必填)。可使用预加载上下文中的id(如 skill_斩击_xxx)或skillId(如 medieval-fantasy__slash)或技能名称' },
              name: { type: 'string', description: '技能名称' },
              description: { type: 'string', description: '技能描述' },
              customData: { type: 'object', description: '自定义数据' },
              visible: { type: 'boolean', description: '是否对玩家可见，设为true让玩家可见该技能' },
              ownerType: { type: 'string', description: '拥有者类型：不传=默认角色(character)，"npc"=NPC的技能' },
              ownerId: { type: 'string', description: '拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)' }
            }
          }
        }
      },
      batch: { param: 'updates' },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createSkillService(context);
        try {
          if (!params.skillId) {
            return { success: false, error: 'skillId参数必填。请使用预加载上下文中的技能ID，如 skill_斩击_xxx 或 medieval-fantasy__slash' };
          }
          const fields: { name?: string; description?: string; customData?: Record<string, unknown>; visible?: boolean } = {};
          if (params.name !== undefined) fields.name = params.name as string;
          if (params.description !== undefined) fields.description = params.description as string;
          if (params.customData !== undefined) fields.customData = params.customData as Record<string, unknown>;
          if (params.visible !== undefined) fields.visible = params.visible as boolean;

          const updatedSkill = await service.updateSkill(
            context.saveId,
            params.skillId as string,
            fields,
            params.ownerType as string | undefined,
            params.ownerId as string | undefined
          );
          return { success: true, data: updatedSkill };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update skill';
          return { success: false, error: errorMessage };
        }
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的技能对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('list', 'list_skills', 10, '获取技能列表');
    this.addActionHandler('get', 'get_skill', 10, '获取技能详情');
    this.addActionHandler('learn', 'learn_skill', 10, '学习技能');
    this.addActionHandler('upgrade', 'upgrade_skill', 10, '升级技能');
    this.addActionHandler('cooldown', 'set_cooldown', 10, '设置技能冷却');
    this.addActionHandler('check_cooldown', 'check_cooldown', 10, '检查技能冷却');

    this.addActionHandler('use', 'use_skill', 10, '使用技能', { skillId: 'target' });
    this.addActionHandler('update', 'update_skill', 8, '更新技能属性');
    // 别名映射(priority=5)
    this.addActionHandler('skills', 'list_skills', 5, '技能列表(别名)');
  }
}
