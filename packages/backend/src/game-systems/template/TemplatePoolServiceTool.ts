import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { ITemplatePoolProvider } from '../shared/types.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export class TemplatePoolServiceTool extends BaseTool {
  private templatePoolService: ITemplatePoolProvider | null = null;

  constructor() {
    super(
      'template_pool_service' as ToolType,
      'Template Pool Service',
      '模板池服务。查询技能池和物品池中的模板数据，支持批量写入生成数据。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
  }

  /** 注入 ITemplatePoolProvider 实例，在 init.ts 中调用 */
  setTemplatePoolService(service: ITemplatePoolProvider): void {
    this.templatePoolService = service;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_template_skills',
      description: '查询模板技能池中的技能(可按分类和推荐职业过滤)',
      parameters: {
        category: { type: 'string', required: false, description: '按分类过滤(attack/defense/healing/buff/debuff/utility/passive)' },
        recommendedClass: { type: 'string', required: false, description: '按推荐职业过滤(返回推荐该职业的技能+无职业限制的技能)' }
      },
      isWrite: false,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'array', description: '模板技能列表' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) {
          return { success: false, error: 'templateId 不可用，无法查询模板池' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const options: { category?: string; recommendedClass?: string } = {};
        if (params.category !== undefined) options.category = params.category as string;
        if (params.recommendedClass !== undefined) options.recommendedClass = params.recommendedClass as string;
        const skills = await service.listSkills(templateId, options);
        return { success: true, data: skills };
      }
    });

    this.registerMethod({
      name: 'get_template_skill',
      description: '获取模板技能池中指定技能的详情',
      parameters: {
        skillId: { type: 'string', required: true, description: '模板技能ID' }
      },
      isWrite: false,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'object', description: '模板技能详情' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) {
          return { success: false, error: 'templateId 不可用，无法查询模板池' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const skill = await service.getSkill(templateId, params.skillId as string);
        if (!skill) {
          return { success: false, error: `模板技能未找到: ${params.skillId}` };
        }
        return { success: true, data: skill };
      }
    });

    this.registerMethod({
      name: 'list_template_items',
      description: '查询模板物品池中的物品(可按分类、装备槽位、推荐职业和品质过滤)',
      parameters: {
        category: { type: 'string', required: false, description: '按分类过滤(weapon/armor/consumable/material/quest/misc/accessory)' },
        equippedSlot: { type: 'string', required: false, description: '按装备槽位过滤(head/chest/legs/feet/hands/main_hand/off_hand/accessory)' },
        recommendedClass: { type: 'string', required: false, description: '按推荐职业过滤(返回推荐该职业的物品+无职业限制的物品)' },
        quality: { type: 'string', required: false, description: '按品质过滤(common/uncommon/rare/epic/legendary)' }
      },
      isWrite: false,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'array', description: '模板物品列表' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) {
          return { success: false, error: 'templateId 不可用，无法查询模板池' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const options: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string } = {};
        if (params.category !== undefined) options.category = params.category as string;
        if (params.equippedSlot !== undefined) options.equippedSlot = params.equippedSlot as string;
        if (params.recommendedClass !== undefined) options.recommendedClass = params.recommendedClass as string;
        if (params.quality !== undefined) options.quality = params.quality as string;
        const items = await service.listItems(templateId, options);
        return { success: true, data: items };
      }
    });

    this.registerMethod({
      name: 'get_template_item',
      description: '获取模板物品池中指定物品的详情',
      parameters: {
        itemId: { type: 'string', required: true, description: '模板物品ID' }
      },
      isWrite: false,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'object', description: '模板物品详情' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) {
          return { success: false, error: 'templateId 不可用，无法查询模板池' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const item = await service.getItem(templateId, params.itemId as string);
        if (!item) {
          return { success: false, error: `模板物品未找到: ${params.itemId}` };
        }
        return { success: true, data: item };
      }
    });

    this.registerMethod({
      name: 'get_template_pool_stats',
      description: '获取模板池统计信息(技能/物品数量及分类)',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: {
            type: 'object',
            description: '模板池统计',
            properties: {
              skillCount: { type: 'number', description: '技能总数' },
              itemCount: { type: 'number', description: '物品总数' },
              skillCategories: { type: 'object', description: '技能分类统计(分类名→数量)' },
              itemCategories: { type: 'object', description: '物品分类统计(分类名→数量)' }
            }
          }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) {
          return { success: false, error: 'templateId 不可用，无法查询模板池' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const stats = await service.getPoolStats(templateId);
        return { success: true, data: stats };
      }
    });
    this.registerMethod({
      name: 'add_template_pool_skills',
      description: '批量向模板技能池添加技能（仅模板生成路径可用，source自动设为generated）',
      parameters: {
        skills: {
          type: 'array',
          required: true,
          description: '技能数组，每项包含: name(必填), description, category, element, icon, cost, damage, effects, cooldown, maxLevel, targetType, range, recommendedClasses'
        }
      },
      isWrite: true,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'array', description: '创建的技能列表' },
          errors: { type: 'array', description: '失败的技能及原因' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) return { success: false, error: 'templateId 不可用，无法写入模板池' };
        const skills = params.skills as Array<Record<string, unknown>>;
        if (!Array.isArray(skills) || skills.length === 0) {
          return { success: false, error: 'skills 数组不能为空' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const created: import('../../../../shared/src/types/game.js').TemplateSkillPoolEntry[] = [];
        const errors: Array<{ name: string; error: string }> = [];
        for (const skill of skills) {
          try {
            const entry = await service.upsertSkill(templateId, {
              name: skill.name as string,
              description: skill.description as string | undefined,
              category: skill.category as string | undefined,
              element: skill.element as string | undefined,
              icon: skill.icon as string | undefined,
              cost: skill.cost as import('../../../../shared/src/types/game.js').SkillCostEntry[] | undefined,
              damage: skill.damage as Record<string, unknown> | undefined,
              effects: skill.effects as Array<Record<string, unknown>> | undefined,
              cooldown: skill.cooldown as number | undefined,
              maxLevel: skill.maxLevel as number | undefined,
              targetType: skill.targetType as string | undefined,
              range: skill.range as number | undefined,
              recommendedClasses: skill.recommendedClasses as string[] | undefined,
              source: 'generated',
            });
            created.push(entry);
          } catch (err) {
            errors.push({ name: skill.name as string, error: getErrorMessage(err) });
          }
        }
        return { success: true, data: { created, errors } };
      }
    });

    this.registerMethod({
      name: 'add_template_pool_items',
      description: '批量向模板物品池添加物品（LLM生成时使用，source自动设为generated）',
      parameters: {
        items: {
          type: 'array',
          required: true,
          description: '物品数组，每项包含: name(必填), description, category, quality, icon, stats, effects, value, equippedSlot, recommendedClasses'
        }
      },
      isWrite: true,
      returns: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: '是否成功' },
          data: { type: 'array', description: '创建的物品列表' },
          errors: { type: 'array', description: '失败的物品及原因' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const templateId = context.templateId;
        if (!templateId) return { success: false, error: 'templateId 不可用，无法写入模板池' };
        const items = params.items as Array<Record<string, unknown>>;
        if (!Array.isArray(items) || items.length === 0) {
          return { success: false, error: 'items 数组不能为空' };
        }
        if (!this.templatePoolService) {
          return { success: false, error: 'TemplatePoolService 未注入' };
        }
        const service = this.templatePoolService;
        const created: import('../../../../shared/src/types/game.js').TemplateItemPoolEntry[] = [];
        const errors: Array<{ name: string; error: string }> = [];
        for (const item of items) {
          try {
            const entry = await service.upsertItem(templateId, {
              name: item.name as string,
              description: item.description as string | undefined,
              category: item.category as import('../../../../shared/src/types/game.js').ItemCategory | undefined,
              quality: item.quality as import('../../../../shared/src/types/game.js').ItemQuality | undefined,
              icon: item.icon as string | undefined,
              stats: item.stats as Record<string, number> | undefined,
              effects: item.effects as import('../../../../shared/src/types/game.js').ItemEffect[] | undefined,
              value: item.value as import('../../../../shared/src/types/game.js').ItemValue | undefined,
              tags: item.tags as string[] | undefined,
              weight: item.weight as number | undefined,
              maxStack: item.maxStack as number | undefined,
              equippedSlot: item.equippedSlot as string | null | undefined,
              durability: item.durability as number | undefined,
              maxDurability: item.maxDurability as number | undefined,
              recommendedClasses: item.recommendedClasses as string[] | undefined,
              source: 'generated',
            });
            created.push(entry);
          } catch (err) {
            errors.push({ name: item.name as string, error: getErrorMessage(err) });
          }
        }
        return { success: true, data: { created, errors } };
      }
    });
  }
}
