import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID } from '../../../../shared/src/types/core.js';
import type { NumericalComplexity } from '@ai-rpg/shared';
import type {
  TemplateData,
  TemplateInitialData,
} from './types.js';

export {
  TemplateData,
  TemplateInitialData,
};

import type { CharacterInputData, IGameInitService } from './types.js';
export type { CharacterInputData };

import type { ICharacterRepository } from '../character/types.js';
import type { ILocationRepository } from '../map/types.js';
import type { INPCRepository } from '../npc/types.js';
import type { ISkillPoolRepository } from '../skill/types.js';
import type { IItemPoolRepository } from '../inventory/types.js';
import type { IQuestRepository } from '../quest/types.js';
import type { ITemplateProvider } from '../shared/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import type { CharacterService } from '../character/CharacterService.js';

/**
 * GameInit 领域 Service（S4 重构后）。
 *
 * 依赖注入（D8 组合根在 GameInitServiceTool.createInitService 内创建）：
 * - 6 Repository: characterRepo + locationRepo + npcRepo + skillPoolRepo + itemPoolRepo + questRepo
 * - CharacterService: 跨领域调用 createCharacter + modifyCurrency（含负数保护业务逻辑，S4-D4）
 * - ITemplateProvider: 跨层访问 templates 表（端口接口，消除 services/ 运行时依赖）
 * - ITransactionManager: 事务管理器端口（D10，预留原子操作扩展点）
 *
 * 设计偏差修正（2026-07-09）：
 * 设计文档 §4.4 原列 7 Repository（含 characterSkillRepo + inventoryRepo），
 * 但 GameInitService 实际查询 6 表（characters/locations/npcs/skill_pool/item_pool/quests），
 * 不查询 character_skills 和 inventory 表，故移除此二 Repository，新增 itemPoolRepo。
 */
export class GameInitService implements IGameInitService {
  private logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly characterRepo: ICharacterRepository,
    private readonly locationRepo: ILocationRepository,
    private readonly npcRepo: INPCRepository,
    private readonly skillPoolRepo: ISkillPoolRepository,
    private readonly itemPoolRepo: IItemPoolRepository,
    private readonly questRepo: IQuestRepository,
    private readonly characterService: CharacterService,
    private readonly templateProvider: ITemplateProvider,
    private readonly txManager: ITransactionManager,
  ) {
    this.logger = createChildLogger('service:init');
  }

  /**
   * 事务执行辅助：统一处理外部事务复用与自建事务。
   * 消除各方法中 `if (trx) return execute(trx); return this.txManager.transaction(execute);` 样板。
   */
  private runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  /**
   * 检查存档是否已有角色（幂等检查）。
   * GameInitServiceTool.init_stats handler 调用此方法判断是否跳过初始化。
   */
  async hasCharacter(saveId: ID): Promise<string | null> {
    const character = await this.characterRepo.findById(saveId);
    return character?.id ?? null;
  }

  async step1_initStats(
    saveId: ID,
    characterData: CharacterInputData,
    templateData: TemplateData,
    trx?: Knex.Transaction,
  ): Promise<Record<string, unknown>> {
    return this.runInTransaction(trx, async (t) => {
      const attrPoints = templateData.character_creation.attribute_points ?? 50;
      const attrDefs = templateData.character_creation.attributes ?? [];
      const baseTotal = attrDefs.reduce((sum, a) => sum + (a.default_value ?? 10), 0) || (Object.keys(characterData.attributes).length * 10);
      const totalPoints = Object.values(characterData.attributes).reduce((sum, val) => sum + val, 0);
      const allocatedPoints = totalPoints - baseTotal;

      if (allocatedPoints > attrPoints) {
        throw new Error(`Allocated attribute points exceed limit: ${allocatedPoints} > ${attrPoints}`);
      }

      // 应用种族加成/惩罚和背景属性加成
      const finalAttributes = { ...characterData.attributes } as Record<string, number>;

      const selectedRace = templateData.character_creation.races?.find(r => r.id === characterData.race);
      if (selectedRace) {
        // 应用种族 bonuses
        for (const [attr, bonus] of Object.entries(selectedRace.bonuses ?? {})) {
          if (finalAttributes[attr] !== undefined) {
            finalAttributes[attr] += bonus;
          }
        }
        // 应用种族 penalties（penalty 值为负数，直接加即可）
        for (const [attr, penalty] of Object.entries(selectedRace.penalties ?? {})) {
          if (finalAttributes[attr] !== undefined) {
            finalAttributes[attr] += penalty;
          }
        }
      }

      const selectedBackground = templateData.character_creation.backgrounds?.find(b => b.id === characterData.background);
      if (selectedBackground) {
        for (const [attr, bonus] of Object.entries(selectedBackground.attribute_bonuses ?? {})) {
          if (finalAttributes[attr] !== undefined) {
            finalAttributes[attr] += bonus;
          }
        }
      }

      const selectedAgeGroup = templateData.character_creation.age_groups?.find(a => a.id === characterData.ageGroup);
      if (selectedAgeGroup) {
        for (const [attr, bonus] of Object.entries(selectedAgeGroup.bonuses ?? {})) {
          if (finalAttributes[attr] !== undefined) {
            finalAttributes[attr] += bonus;
          }
        }
        for (const [attr, penalty] of Object.entries(selectedAgeGroup.penalties ?? {})) {
          if (finalAttributes[attr] !== undefined) {
            finalAttributes[attr] += penalty;
          }
        }
      }

      const globalMinAttr = templateData.character_creation.min_attribute ?? 1;
      const globalMaxAttr = templateData.character_creation.max_attribute ?? 99;
      const attrDefMap = new Map(
        (templateData.character_creation.attributes ?? []).map(a => [a.id, a])
      );

      for (const [attr, value] of Object.entries(finalAttributes)) {
        const attrDef = attrDefMap.get(attr);
        const minVal = attrDef?.min_value ?? globalMinAttr;
        const maxVal = attrDef?.max_value ?? globalMaxAttr;
        finalAttributes[attr] = Math.max(minVal, Math.min(maxVal, value));
      }

      const createdCharacter = await this.characterService.createCharacter({
        saveId,
        name: characterData.name,
        gender: characterData.gender,
        customGender: characterData.customGender,
        ageGroup: characterData.ageGroup,
        race: characterData.race,
        classType: characterData.classType,
        background: characterData.background,
        attributes: finalAttributes as Record<string, number>,
        customOptions: characterData.customOptions
      }, {
        default_location_id: templateData.starting_scene.location
      }, t);

      // 优先级: 1. initial_data.gold[background]  2. initial_data.gold.default  3. 硬编码fallback 30
      const goldConfig = templateData.initial_data.gold as Record<string, number> | undefined;
      let initialGold = goldConfig?.default ?? 30;
      if (goldConfig && goldConfig[characterData.background]) {
        initialGold = goldConfig[characterData.background];
      }
      if (selectedBackground?.starting_gold_bonus) {
        initialGold += selectedBackground.starting_gold_bonus;
      }

      const currencySystem = (templateData.game_rules as Record<string, any>)?.currency_system;
      const currencyId = currencySystem?.id || 'gold';

      // S4-D4: 调用 CharacterService.modifyCurrency（含 Math.max(0, ...) 负数保护业务逻辑）
      // createCharacter 初始化 currency 为 { gold: 0 }，modifyCurrency 应用增量设置初始金币
      await this.characterService.modifyCurrency(saveId, currencyId, initialGold, t);

      this.logger.info('Character stats initialized', {
        saveId,
        name: characterData.name,
        gold: initialGold,
        raceBonusesApplied: selectedRace ? Object.keys(selectedRace.bonuses ?? {}).length : 0,
        racePenaltiesApplied: selectedRace ? Object.keys(selectedRace.penalties ?? {}).length : 0,
        backgroundBonusesApplied: selectedBackground ? Object.keys(selectedBackground.attribute_bonuses ?? {}).length : 0
      });

      return {
        characterId: createdCharacter.id,
        name: createdCharacter.name,
        level: createdCharacter.level,
        gold: initialGold,
        baseAttributes: characterData.attributes,
        finalAttributes,
        raceBonuses: selectedRace?.bonuses ?? {},
        racePenalties: selectedRace?.penalties ?? {},
        backgroundBonuses: selectedBackground?.attribute_bonuses ?? {}
      };
    });
  }

  async getTemplateData(templateId?: string): Promise<TemplateData> {
    try {
      if (!templateId) {
        throw new Error('getTemplateData: templateId is required');
      }

      let template;
      try {
        template = await this.templateProvider.getTemplate(templateId as ID);
      } catch {
        const defaultTemplate: TemplateData = {
          id: 'default',
          name: 'Default Template',
          initial_data: {},
          character_creation: {
            attribute_points: 50,
            min_attribute: 5,
            max_attribute: 20
          },
          starting_scene: {
            location: 'starting-village',
            description: 'A peaceful village where your adventure begins.',
            atmosphere: 'peaceful',
            time_of_day: 'morning'
          },
          world_setting: {}
        };

        this.logger.warn('No template found, using defaults');
        return defaultTemplate;
      }

      // TemplateRecord (camelCase) → TemplateData (snake_case) 字段映射
      return {
        id: template.id,
        name: template.name,
        game_mode: template.gameMode,
        initial_data: template.initialData as TemplateInitialData,
        items: template.items as TemplateData['items'],
        skills: template.skills as unknown as TemplateData['skills'],
        locations: template.locations as unknown as TemplateData['locations'],
        character_creation: template.characterCreation as TemplateData['character_creation'],
        starting_scene: template.startingScene as TemplateData['starting_scene'],
        world_setting: template.worldSetting,
        game_rules: template.gameRules,
        ai_constraints: template.aiConstraints,
        ui_theme: template.uiTheme,
        ui_layout: template.uiLayout,
        special_rules: template.specialRules,
        numerical_complexity: template.numericalComplexity as NumericalComplexity,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get template data', { templateId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 初始化完整度最小阈值。
   * - locations: 至少 3 个地点（1 区域 + 2 建筑/子地点，构成可探索地图）
   * - npcs: 至少 3 个 NPC（村长/商人/引导等基础角色）
   * - skills: 至少 3 个技能（玩家初始技能 + 池中技能）
   * - items: 至少 3 个物品（玩家初始装备 + 池中物品）
   * - quests: 至少 2 个任务（主线 + 支线，GM skill 明确要求）
   */
  private static readonly INIT_MINIMUM_COUNTS = {
    locations: 3,
    npcs: 3,
    skills: 3,
    items: 3,
    quests: 2,
  } as const;

  async isInitializationComplete(saveId: ID): Promise<boolean> {
    try {
      const status = await this.getInitializationStatus(saveId);
      return status.isInitialized;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check initialization status', { saveId, error: errorMessage });
      return false;
    }
  }

  /**
   * 查询存档初始化完整度，返回各项资源数量与是否达到最小阈值。
   * GM 调用 check_init_status 时返回此信息，让 GM 知道缺什么并补充。
   *
   * S4 重构：6 表 count 查询改为各领域 Repository.countBySaveId()，
   * 消除 GameInitService 直接 db 访问（D3: 禁止跨领域表访问）。
   */
  async getInitializationStatus(saveId: ID): Promise<{
    isInitialized: boolean;
    character: boolean;
    counts: {
      locations: number;
      npcs: number;
      skills: number;
      items: number;
      quests: number;
    };
    missing: string[];
  }> {
    const min = GameInitService.INIT_MINIMUM_COUNTS;
    const missing: string[] = [];

    const [character, locationCount, npcCount, skillCount, itemCount, questCount] = await Promise.all([
      this.characterRepo.findById(saveId),
      this.locationRepo.countBySaveId(saveId),
      this.npcRepo.countBySaveId(saveId),
      this.skillPoolRepo.countBySaveId(saveId),
      this.itemPoolRepo.countBySaveId(saveId),
      this.questRepo.countBySaveId(saveId),
    ]);

    const counts = {
      locations: locationCount,
      npcs: npcCount,
      skills: skillCount,
      items: itemCount,
      quests: questCount,
    };

    if (!character) missing.push('character');
    if (counts.locations < min.locations) missing.push(`locations(${counts.locations}/${min.locations})`);
    if (counts.npcs < min.npcs) missing.push(`npcs(${counts.npcs}/${min.npcs})`);
    if (counts.skills < min.skills) missing.push(`skills(${counts.skills}/${min.skills})`);
    if (counts.items < min.items) missing.push(`items(${counts.items}/${min.items})`);
    if (counts.quests < min.quests) missing.push(`quests(${counts.quests}/${min.quests})`);

    return {
      isInitialized: missing.length === 0,
      character: !!character,
      counts,
      missing,
    };
  }
}
