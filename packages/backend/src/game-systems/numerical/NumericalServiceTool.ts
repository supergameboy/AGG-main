import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { NumericalService } from './NumericalService.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import { CharacterRepository } from '../character/CharacterRepository.js';
import { InventoryRepository } from '../inventory/InventoryRepository.js';
import { NPCRepository } from '../npc/NPCRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';

export class NumericalServiceTool extends BaseTool {
  constructor() {
    super(
      'numerical_service' as ToolType,
      'Numerical Service',
      '数值计算服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 创建 NumericalService 实例（组合根入口，D8）。
   * public 供跨领域 ServiceTool（如 CombatServiceTool）调用获取 INumericalService（S3-2 Phase C）。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   *
   * S4 重构：注入 Repository + TransactionManager，移除 db 直传。
   */
  async createNumericalService(context: ToolContext): Promise<NumericalService> {
    return context.requestScope.getOrCompute('numerical', () => this.buildNumericalService(context));
  }

  private async buildNumericalService(context: ToolContext): Promise<NumericalService> {
    const db = context.requestScope.getDb();
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const characterRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const npcRepo = new NPCRepository(db);
    const txManager = new KnexTransactionManager(db);
    return new NumericalService(characterRepo, inventoryRepo, npcRepo, txManager, ruleParser);
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'calculate_damage',
      description: '计算伤害值(物理/魔法/真实/固定伤害)',
      parameters: {
        formula: { type: 'object', required: true, description: '伤害公式配置。type:伤害类型(physical/magical/true/fixed), basePower:基础威力(数字), scaling:属性缩放数组(每个元素{attribute:属性名,multiplier:缩放倍率}), multiplier:总倍率, flatBonus:固定加成。例: {type:"physical",basePower:20,scaling:[{attribute:"attack",multiplier:0.5}]}' },
        attackerLevel: { type: 'number', required: true, description: '攻击者等级' },
        defenderLevel: { type: 'number', required: true, description: '防御者等级' },
        attackerStat: { type: 'number', required: false, description: '攻击属性值' },
        defenderDefense: { type: 'number', required: false, description: '防御值' },
        resistance: { type: 'number', required: false, description: '抗性(0-1)' },
        vulnerability: { type: 'number', required: false, description: '脆弱(0-1)' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const formula = params.formula as Record<string, unknown>;
        if (!formula || typeof formula !== 'object') {
          return { success: false, error: 'formula is required and must be an object' };
        }
        const validDamageTypes = ['physical', 'magical', 'true', 'fixed'];
        const damageType = (formula.type as string) || 'physical';
        if (!validDamageTypes.includes(damageType)) {
          return { success: false, error: `Invalid damage type: ${formula.type}. Must be one of: ${validDamageTypes.join(', ')}` };
        }
        const normalizedFormula: Record<string, unknown> = {
          ...formula,
          type: damageType,
          basePower: typeof formula.basePower === 'number' ? formula.basePower : 10,
        };
        // Normalize scaling: LLM may pass object {stat, ratio} instead of array [{attribute, multiplier}]
        const scaling = normalizedFormula.scaling;
        if (scaling && !Array.isArray(scaling)) {
          if (typeof scaling === 'object') {
            const s = scaling as Record<string, unknown>;
            normalizedFormula.scaling = [{
              attribute: (s.stat as string) || (s.attribute as string) || 'attack',
              multiplier: typeof s.ratio === 'number' ? s.ratio : (typeof s.multiplier === 'number' ? s.multiplier : 0.5)
            }];
          } else {
            normalizedFormula.scaling = undefined;
          }
        }
        const result = service.calculateDamage(
          normalizedFormula as unknown as Parameters<NumericalService['calculateDamage']>[0],
          {
            attackerLevel: params.attackerLevel as number,
            defenderLevel: params.defenderLevel as number,
            attackerStat: params.attackerStat as number | undefined,
            defenderDefense: params.defenderDefense as number | undefined,
            resistance: params.resistance as number | undefined,
            vulnerability: params.vulnerability as number | undefined
          }
        );
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '伤害计算结果(DamageResult)',
            properties: {
              finalDamage: { type: 'number' },
              baseDamage: { type: 'number' },
              isCritical: { type: 'boolean' },
              criticalMultiplier: { type: 'number' },
              type: { type: 'string' },
              breakdown: { type: 'object' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'calculate_experience',
      description: '计算经验奖励',
      parameters: {
        actionType: { type: 'string', required: true, description: '行动类型: combat/quest/exploration/crafting/social' },
        difficulty: { type: 'number', required: true, description: '难度(1-10)' },
        level: { type: 'number', required: true, description: '角色等级' },
        bonusMultiplier: { type: 'number', required: false, description: '额外倍率' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = service.calculateExperience({
          actionType: params.actionType as Parameters<NumericalService['calculateExperience']>[0]['actionType'],
          difficulty: params.difficulty as number,
          level: params.level as number,
          bonusMultiplier: params.bonusMultiplier as number | undefined
        });
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '经验计算结果(ExperienceResult)',
            properties: {
              experience: { type: 'number' },
              breakdown: { type: 'object' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'add_experience',
      description: '为角色增加经验值(经验足够时自动完成升级，无需再调用process_level_up)',
      parameters: {
        amount: { type: 'number', required: true, description: '增加的经验量' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = await service.addExperience(context.saveId, params.amount as number);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '经验增加结果',
            properties: {
              leveledUp: { type: 'boolean' },
              newLevel: { type: 'number' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_level_progress',
      description: '获取等级进度信息',
      parameters: {
        currentExp: { type: 'number', required: true, description: '当前经验值' },
        level: { type: 'number', required: true, description: '当前等级' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = service.getLevelProgress(params.currentExp as number, params.level as number);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '等级进度(LevelProgress)',
            properties: {
              currentLevel: { type: 'number' },
              currentExp: { type: 'number' },
              expForNextLevel: { type: 'number' },
              expToNextLevel: { type: 'number' },
              totalExpForLevel: { type: 'number' },
              progressPercent: { type: 'number' },
              canLevelUp: { type: 'boolean' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'calculate_derived_attributes',
      description: '根据基础属性计算派生属性',
      parameters: {
        attributes: { type: 'object', required: true, description: '基础属性(模板定义的属性ID和值，如 {str: 12, dex: 10, int: 14, con: 11, wis: 8, cha: 10})' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = service.calculateDerivedAttributes(params.attributes as Parameters<NumericalService['calculateDerivedAttributes']>[0]);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '派生属性(DerivedAttributes)',
            properties: {
              attack: { type: 'number' },
              defense: { type: 'number' },
              speed: { type: 'number' },
              critRate: { type: 'number' },
              critDamage: { type: 'number' },
              dodgeRate: { type: 'number' },
              blockRate: { type: 'number' },
              magicAttack: { type: 'number' },
              magicDefense: { type: 'number' },
              maxHealth: { type: 'number' },
              maxMana: { type: 'number' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'heal',
      description: '治疗角色(恢复HP和MP)',
      parameters: {
        amount: { type: 'number', required: true, description: '治疗量(HP恢复100%, MP恢复50%)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = await service.heal(context.saveId, params.amount as number);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '治疗结果',
            properties: {
              amount: { type: 'number' },
              healthHealed: { type: 'number' },
              manaRestored: { type: 'number' },
              newHealth: { type: 'number' },
              newMana: { type: 'number' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'calculate_loot',
      description: '根据掉落表计算战利品',
      parameters: {
        dropTable: { type: 'array', required: true, description: '掉落表 [{id, name, quality, chance, minQuantity, maxQuantity}]' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const result = service.calculateLoot(params.dropTable as Parameters<NumericalService['calculateLoot']>[0]);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: '战利品计算结果(LootResult)',
            properties: {
              drops: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    quality: { type: 'string' },
                    quantity: { type: 'number' }
                  }
                }
              },
              totalItems: { type: 'number' },
              uniqueItems: { type: 'number' },
              dropped: { type: 'boolean' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'calculate_stats',
      description: '重新计算并持久化派生属性(含装备加成)。支持角色(ownerType=character)和NPC(ownerType=npc)',
      parameters: {
        ownerType: { type: 'string', required: false, description: '所有者类型: character(默认) 或 npc' },
        ownerId: { type: 'string', required: false, description: 'NPC ID(ownerType=npc时必填)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createNumericalService(context);
        const ownerType = (params.ownerType as string) || 'character';
        if (ownerType === 'npc') {
          const npcId = params.ownerId as string;
          if (!npcId) {
            return { success: false, error: 'ownerId is required when ownerType is npc' };
          }
          const result = await service.recalculateNpcAttributes(context.saveId, npcId);
          return { success: true, data: result };
        }
        const result = await service.recalculateDerivedAttributes(context.saveId);
        return { success: true, data: result };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '重新计算后的派生属性(DerivedAttributes)，含装备加成' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('damage', 'calculate_damage', 10, '计算伤害值');
    this.addActionHandler('experience', 'calculate_experience', 10, '计算经验奖励');
    this.addActionHandler('add_experience', 'add_experience', 10, '增加经验值');
    this.addActionHandler('level_progress', 'get_level_progress', 10, '获取等级进度');
    this.addActionHandler('derived', 'calculate_derived_attributes', 10, '计算派生属性');
    this.addActionHandler('heal', 'heal', 10, '治疗角色');
    this.addActionHandler('loot', 'calculate_loot', 10, '计算战利品');
  }
}
