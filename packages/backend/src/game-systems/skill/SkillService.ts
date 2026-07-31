import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, generateReadableId } from '../../../../shared/src/types/core.js';
import { parseScaling } from '../../../../shared/src/types/template.js';
import type { SkillScalingEntry, WeightCooldownConfig } from '../../../../shared/src/types/template.js';
import { parseCostArray } from '../../../../shared/src/types/game.js';
import type { SkillCostEntry, SkillPoolEntry } from '../../../../shared/src/types/game.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { ITemplateProvider, ITemplatePoolProvider } from '../shared/types.js';
import type { TemplateSkillPoolEntry } from '../../../../shared/src/types/game.js';
import { DecayCurveCalculator } from '../numerical/DecayCurveCalculator.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import type { ISaveRepository } from '../save/types.js';
import type { ICharacterService } from '../character/types.js';
import type { INPCService } from '../npc/types.js';
import type { IInventoryService } from '../inventory/types.js';
import type {
  ISkillPoolRepository,
  ICharacterSkillRepository,
  ISkillService,
  CharacterSkill,
  EntitySkill,
  LearnSkillResult,
  UpgradeSkillResult,
  SkillTreeInfo,
  UseSkillResult,
  SkillCategory,
  SkillElement,
  CooldownSystemType,
  OwnerType
} from './types.js';
import { computeDedupUpdate, formatDedupWarnings } from '../shared/dedup-helper.js';
import { SkillPoolEntityResolver } from './SkillPoolEntityResolver.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';

export {
  CharacterSkill,
  EntitySkill,
  LearnSkillResult,
  UpgradeSkillResult,
  SkillTreeInfo,
  CooldownSystemType
};
export type { OwnerType };

const DEFAULT_COOLDOWN_TURNS = 1;
const DEFAULT_COOLDOWN_MS = 3000;

/**
 * Skill 领域 Service（S2-2 重构后）。
 * 完全无 Knex db 依赖，通过 ISkillPoolRepository/ICharacterSkillRepository 端口操作表，
 * 通过 ICharacterService/INPCService/IInventoryService/ISaveRepository 端口跨领域访问，
 * 事务通过 ITransactionManager 端口开启。
 */
export class SkillService implements ISkillService {
  private readonly logger: ReturnType<typeof createChildLogger>;
  private readonly ruleParser: TemplateRuleParser;
  private readonly templateService: ITemplateProvider | null;
  private readonly templatePoolService: ITemplatePoolProvider | null;

  constructor(
    private readonly skillPoolRepo: ISkillPoolRepository,
    private readonly characterSkillRepo: ICharacterSkillRepository,
    private readonly characterService: ICharacterService,
    private readonly npcService: INPCService,
    private readonly inventoryService: IInventoryService,
    private readonly saveRepo: ISaveRepository,
    private readonly txManager: ITransactionManager,
    ruleParser: TemplateRuleParser,
    templateService: ITemplateProvider | null,
    templatePoolService: ITemplatePoolProvider | null,
    private readonly skillPoolResolver?: SkillPoolEntityResolver,
  ) {
    this.logger = createChildLogger('service:skill');
    this.ruleParser = ruleParser;
    this.templateService = templateService;
    this.templatePoolService = templatePoolService;
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

  // ---------------------------------------------------------------------------
  // 私有工具方法
  // ---------------------------------------------------------------------------

  private async resolveOwnerId(saveId: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<{ ownerType: OwnerType; ownerId: string }> {
    // character 或未传：自动从 saveId 解析 characterId
    // 玩家角色就是存档主人，saveId 可唯一定位 characterId，不应让 LLM 传
    if (!ownerType || ownerType === 'character') {
      const charInfo = await this.characterService.getCharacterBasicInfo(saveId, trx);
      if (!charInfo) {
        throw new Error(`Character not found for saveId: ${saveId}`);
      }
      return { ownerType: 'character', ownerId: charInfo.characterId };
    }

    // npc: LLM 传 NPC 名称，通过 resolveNpcId 解析为完整 id
    if (ownerType === 'npc') {
      if (!ownerId) {
        throw new Error('ownerId is required when ownerType is npc');
      }
      const resolvedNpcId = await this.npcService.resolveNpcId(saveId, ownerId, trx);
      return { ownerType: 'npc', ownerId: resolvedNpcId };
    }

    throw new Error(`Invalid ownerType: ${ownerType}. Supported: 'character', 'npc', or undefined (defaults to character)`);
  }

  private async validateOwnership(saveId: ID, skillId: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<void> {
    const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, trx);
    const skill = await this.characterSkillRepo.findById(saveId, skillId, { ownerType: resolved.ownerType, ownerId: resolved.ownerId }, trx);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (skill.ownerType !== resolved.ownerType || skill.ownerId !== resolved.ownerId) {
      throw new Error(`Skill ${skillId} does not belong to ${resolved.ownerType}:${resolved.ownerId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 技能池方法
  // ---------------------------------------------------------------------------

  async addPoolSkill(saveId: ID, params: {
    name: string;
    description?: string;
    category?: string;
    element?: string;
    cost?: SkillCostEntry[];
    damage?: Record<string, unknown>;
    effects?: Array<Record<string, unknown>>;
    cooldown?: number;
    maxLevel?: number;
    targetType?: string;
    range?: number;
    customData?: Record<string, unknown>;
    recommendedClasses?: string[];
  }, trx?: Knex.Transaction): Promise<SkillPoolEntry & { alreadyExists?: boolean; warnings?: string[] }> {
    // 步骤 1：save pool 预查重（幂等）——已存在则增量更新非黑名单字段
    if (params.name) {
      const existing = await this.skillPoolRepo.findByName(saveId, params.name, trx);
      if (existing) {
        return await this.applyPoolSkillDedupUpdate(saveId, existing, params, trx);
      }
    }

    const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId, trx);

    // 步骤 2：构造数据（可选 merge 模板补全缺失字段，命中与否只影响"读"，不影响"写"）
    let mergedParams: Record<string, unknown> = params as Record<string, unknown>;
    if (templateId && this.templatePoolService && params.name) {
      const templateEntry = await this.templatePoolService.findSkillByName(templateId, params.name);
      if (templateEntry) {
        mergedParams = this.mergeWithTemplate(templateEntry, params as Record<string, unknown>);
      }
    }

    // 步骤 3：写存档池
    const newEntry = await this.insertPoolSkill(saveId, mergedParams, trx);

    // 步骤 4：upsert 模板池（固定调用，无分支）
    // 设计原则：LLM 除读之外任何操作程序都自动回写。以工具调用效果为核心，不以程序路径为核心。
    if (templateId && this.templatePoolService && params.name) {
      await this.templatePoolService.upsertSkill(
        templateId,
        { ...mergedParams, source: 'generated' } as import('../../services/template-pool.js').CreateTemplateSkillParams,
      );
    }

    return newEntry;
  }

  private async insertPoolSkill(saveId: ID, params: Record<string, unknown>, trx?: Knex.Transaction): Promise<SkillPoolEntry> {
    const entry: Omit<SkillPoolEntry, 'id'> = {
      saveId,
      name: params.name as string,
      description: (params.description as string) || '',
      category: (params.category as string) || 'attack',
      element: (params.element as string) || 'physical',
      cost: (params.cost as SkillCostEntry[]) ?? [],
      damage: (params.damage as Record<string, unknown>) ?? {},
      effects: (params.effects as Array<Record<string, unknown>>) ?? [],
      cooldown: (params.cooldown as number) ?? 0,
      maxLevel: (params.maxLevel as number) ?? 10,
      targetType: (params.targetType as string) || 'single',
      range: (params.range as number) ?? 1,
      learned: false,
      customData: (params.customData as Record<string, unknown>) ?? {},
      recommendedClasses: (params.recommendedClasses as string[]) ?? [],
    };

    const inserted = await this.skillPoolRepo.insert(entry, trx);
    this.logger.info('Pool skill added', { saveId, poolSkillId: inserted.id, name: inserted.name });
    return inserted;
  }

  /**
   * 技能池去重防护：同 saveId+name 已存在时增量更新非黑名单字段 + 返回 alreadyExists + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、skillId、createdAt
   * 可更新字段：description、category、element、cost、damage、effects、cooldown、maxLevel、
   *            targetType、range、customData、recommendedClasses
   */
  private async applyPoolSkillDedupUpdate(
    saveId: ID,
    existing: SkillPoolEntry,
    params: {
      name: string;
      description?: string;
      category?: string;
      element?: string;
      cost?: SkillCostEntry[];
      damage?: Record<string, unknown>;
      effects?: Array<Record<string, unknown>>;
      cooldown?: number;
      maxLevel?: number;
      targetType?: string;
      range?: number;
      customData?: Record<string, unknown>;
      recommendedClasses?: string[];
    },
    trx?: Knex.Transaction,
  ): Promise<SkillPoolEntry & { alreadyExists?: boolean; warnings?: string[] }> {
    this.logger.info('Pool skill already exists, applying incremental update', {
      saveId, existingId: existing.id, existingName: existing.name,
    });

    const newValues: Record<string, unknown> = {
      name: params.name,
      description: params.description,
      category: params.category,
      element: params.element,
      cost: params.cost,
      damage: params.damage,
      effects: params.effects,
      cooldown: params.cooldown,
      maxLevel: params.maxLevel,
      targetType: params.targetType,
      range: params.range,
      customData: params.customData,
      recommendedClasses: params.recommendedClasses,
    };

    const existingValues: Record<string, unknown> = {
      name: existing.name,
      description: existing.description,
      category: existing.category,
      element: existing.element,
      cost: existing.cost,
      damage: existing.damage,
      effects: existing.effects,
      cooldown: existing.cooldown,
      maxLevel: existing.maxLevel,
      targetType: existing.targetType,
      range: existing.range,
      customData: existing.customData,
      recommendedClasses: existing.recommendedClasses,
    };

    const POOL_SKILL_BLACKLIST = ['id', 'saveId', 'skillId', 'createdAt'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, POOL_SKILL_BLACKLIST,
    );

    if (updatedFields.length > 0) {
      const patch: Record<string, unknown> = {};
      for (const f of updatedFields) {
        patch[f.field] = f.newValue;
      }
      await this.runInTransaction(trx, async (t) => {
        await this.skillPoolRepo.update(saveId, existing.id, patch, t);
      });
    }

    const updated = await this.skillPoolRepo.findById(saveId, existing.id, trx);
    if (!updated) throw new Error('Failed to retrieve updated pool skill');

    const warnings = formatDedupWarnings('技能池', existing.name, updatedFields, blockedFields);

    this.logger.info('Pool skill incremental update applied', {
      saveId, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  async listPoolSkills(saveId: ID, options?: { learned?: boolean; category?: string }): Promise<SkillPoolEntry[]> {
    return this.skillPoolRepo.findBySaveId(saveId, options);
  }

  async getPoolSkill(saveId: ID, poolSkillId: string, trx?: Knex.Transaction): Promise<SkillPoolEntry | null> {
    return this.skillPoolRepo.findById(saveId, poolSkillId, trx);
  }

  async removePoolSkill(saveId: ID, poolSkillId: string): Promise<boolean> {
    const deleted = await this.skillPoolRepo.delete(saveId, poolSkillId);
    if (deleted) {
      this.logger.info('Pool skill removed', { saveId, poolSkillId });
    }
    return deleted;
  }

  async resolvePoolSkillId(idOrName: string, saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    if (!idOrName || typeof idOrName !== 'string') {
      throw new Error('技能名称不能为空');
    }

    /**
     * 优先委托给 SkillPoolEntityResolver 统一设施（13.2 规则收敛）。
     * - name/id 双兼容 + 时间戳兼容由 EntityResolverBase 提供
     * - 失败抛 EntityResolutionError（含候选列表），转为对调用方友好的 null 返回
     * - trx 透传由基类阶段1/2 的子类实现支持
     *
     * 兜底路径：未注入 resolver 时（如 bootstrap 实例），回退到原 skillPoolRepo.findByIdOrName。
     * 注：bootstrap 实例不调用 resolvePoolSkillId，运行时路径必有 resolver 注入。
     */
    if (this.skillPoolResolver) {
      try {
        const resolved = await this.skillPoolResolver.resolve({
          saveId,
          entityType: 'skill',
          ref: idOrName,
        }, trx);
        this.logger.info('Resolved pool skill', { input: idOrName, resolved: resolved.entityId });
        return resolved.entityId;
      } catch (error) {
        if (error instanceof EntityResolutionError) {
          // not_found 或多匹配歧义，返回 null（保持原契约：调用方决定是否抛异常）
          this.logger.warn('Pool skill resolution failed', {
            input: idOrName,
            reason: error.reason,
            candidateCount: error.candidates.length,
          });
          return null;
        }
        throw error;
      }
    }

    // 兜底：未注入 resolver（bootstrap 路径）
    const entry = await this.skillPoolRepo.findByIdOrName(idOrName, saveId, trx);
    if (entry) {
      this.logger.info('Resolved pool skill (fallback)', { input: idOrName, resolved: entry.id });
      return entry.id;
    }
    return null;
  }

  private mergeWithTemplate(template: TemplateSkillPoolEntry, overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      name: overrides.name ?? template.name,
      description: overrides.description ?? template.description,
      category: overrides.category ?? template.category,
      element: overrides.element ?? template.element,
      cost: overrides.cost ?? template.cost,
      damage: overrides.damage ?? template.damage,
      effects: overrides.effects ?? template.effects,
      cooldown: overrides.cooldown ?? template.cooldown,
      maxLevel: overrides.maxLevel ?? template.maxLevel,
      targetType: overrides.targetType ?? template.targetType,
      range: overrides.range ?? template.range,
      customData: overrides.customData ?? template.customData,
      recommendedClasses: overrides.recommendedClasses ?? template.recommendedClasses,
    };
  }

  /**
   * 返回缺失的必填字段列表（用于错误信息精确化）。
   * 必填字段：name, category（与 insertPoolSkill 的默认值逻辑一致——
   * 缺失时 insertPoolSkill 会回退到 'attack'，但 LLM 创建场景应显式提供）。
   */
  private getMissingSkillFields(params: Record<string, unknown>): string[] {
    const missing: string[] = [];
    if (!params.name) missing.push('name');
    if (!params.category) missing.push('category');
    return missing;
  }

  private isSkillFieldsComplete(params: Record<string, unknown>): boolean {
    return this.getMissingSkillFields(params).length === 0;
  }

  // ---------------------------------------------------------------------------
  // 资源查询与扣减
  // ---------------------------------------------------------------------------

  async getCurrentResourceAmount(
    saveId: string,
    ownerType: OwnerType,
    ownerId: string,
    resourceType: 'mp' | 'hp' | 'stamina' | 'currency' | 'item' | 'mana',
    trx?: Knex.Transaction,
  ): Promise<number> {
    // mana 等同于 mp
    const normalizedType = resourceType === 'mana' ? 'mp' : resourceType;

    // item: 不支持数量查询，返回 Infinity 表示不限制
    if (normalizedType === 'item') return Infinity;

    if (ownerType === 'character') {
      const resources = await this.characterService.getCharacterResources(saveId, trx);
      switch (normalizedType) {
        case 'mp': return resources.currentMp;
        case 'hp': return resources.currentHp;
        case 'stamina': return resources.currentStamina;
        case 'currency': return resources.currency.gold ?? 0;
        default: return 0;
      }
    }

    // NPC
    const resources = await this.npcService.getNpcResources(saveId, ownerId, trx);
    switch (normalizedType) {
      case 'mp': return resources.currentMp ?? 0;
      case 'hp': return resources.currentHp ?? 0;
      case 'stamina': return resources.currentStamina ?? 0;
      case 'currency': return resources.currency.gold ?? 0;
      default: return 0;
    }
  }

  async deductResource(
    saveId: string,
    ownerType: OwnerType,
    ownerId: string,
    resourceType: 'mp' | 'hp' | 'stamina' | 'currency' | 'item' | 'mana',
    amount: number,
    itemId?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    // mana 等同于 mp
    const normalizedType = resourceType === 'mana' ? 'mp' : resourceType;

    switch (normalizedType) {
      case 'mp':
        if (ownerType === 'character') {
          await this.characterService.modifyMana(saveId, -amount, trx);
        } else {
          await this.npcService.modifyNpcResource(saveId, ownerId, 'mp', -amount, trx);
        }
        return;

      case 'hp':
        if (ownerType === 'character') {
          await this.characterService.modifyHealth(saveId, -amount, trx);
        } else {
          await this.npcService.modifyNpcResource(saveId, ownerId, 'hp', -amount, trx);
        }
        return;

      case 'stamina':
        if (ownerType === 'character') {
          await this.characterService.modifyStamina(saveId, -amount, trx);
        } else {
          await this.npcService.modifyNpcResource(saveId, ownerId, 'stamina', -amount, trx);
        }
        return;

      case 'currency':
        if (ownerType === 'character') {
          await this.characterService.modifyCurrency(saveId, 'gold', -amount, trx);
        } else {
          await this.npcService.modifyNpcResource(saveId, ownerId, 'currency', -amount, trx);
        }
        return;

      case 'item':
        if (!itemId) return;
        await this.inventoryService.consumeItem(saveId, itemId, amount, trx);
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // 已学技能查询
  // ---------------------------------------------------------------------------

  async listSkills(saveId: ID, visibility?: string, ownerType?: OwnerType | 'all', ownerId?: string): Promise<{ skills: CharacterSkill[]; hint?: string }> {
    try {
      // M12: ownerType 空或 "all" → 查所有 owner；精确 owner → 按 owner 过滤
      let allSkills: CharacterSkill[];
      if (!ownerType || ownerType === 'all') {
        allSkills = await this.characterSkillRepo.findBySaveId(saveId);
      } else {
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId);
        allSkills = await this.characterSkillRepo.findBySaveId(saveId, {
          ownerType: resolved.ownerType,
          ownerId: resolved.ownerId,
        });
      }

      let skills = allSkills;
      if (visibility === 'all') {
        // 返回全部技能(含不可见)
      } else if (visibility === 'not_visible') {
        skills = skills.filter(skill => !skill.visible);
      } else {
        skills = skills.filter(skill => skill.visible);
      }

      if (skills.length === 0) {
        return { skills: [], hint: "尚未学习任何技能. 建议：使用 learn_skill 学习新技能" };
      }
      return { skills };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get skills', { saveId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 查询技能（端口接口方法，供跨领域调用，返回单个）。
   * ISkillService.getSkill 端口接口契约：返回 { element?: string } | null。
   * CharacterSkill 包含 element 字段，类型兼容。
   * 内部需要通配符查询请用 findSkill，需要按 owner 精确查单个请用 resolveSkill。
   */
  async getSkill(saveId: ID, skillId: string): Promise<CharacterSkill | null> {
    try {
      const skill = await this.characterSkillRepo.findBySkillIdOrName(skillId, saveId);
      return skill;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get skill', { saveId, skillId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 查询技能（域内方法，支持通配符，供工具层使用）。
   * - ownerType 空或 "all" → 返回所有 owner 的匹配记录（数组）
   * - ownerType 精确（character/npc）→ 返回单个
   */
  async findSkill(saveId: ID, skillId: string, ownerType?: string | 'all', ownerId?: string): Promise<CharacterSkill | CharacterSkill[]> {
    try {
      // M12: ownerType 空或 "all" → 返回所有 owner 的匹配记录（数组）
      if (!ownerType || ownerType === 'all') {
        // 按 id/skill_id/name 查所有 owner（使用 findAllBySkillIdOrName 返回数组）
        const skills = await this.characterSkillRepo.findAllBySkillIdOrName(skillId, saveId);
        if (skills.length > 0) return skills;
        // 构造可用技能列表提示
        const available = await this.characterSkillRepo.findBySaveId(saveId);
        const hint = available.slice(0, 20).map(s => `${s.name}(${s.id})`).join(', ');
        throw new Error(`技能未找到: ${skillId}. 可用技能: ${hint}`);
      }

      // 精确 owner 查询
      const skill = await this.resolveSkill(saveId, skillId, ownerType, ownerId);
      return skill;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to find skill', { saveId, skillId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 解析技能 ID/名称/skill_id 并返回完整实体。
   * 合并原 resolveSkillId + getSkill 的查询路径，避免二次查询。
   * 找不到时构造可用技能列表的错误提示。
   */
  private async resolveSkill(saveId: ID, skillIdOrName: string, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<CharacterSkill> {
    if (!skillIdOrName || typeof skillIdOrName !== 'string') {
      throw new Error('技能ID不能为空');
    }

    const options = (ownerType && ownerId) ? { ownerType, ownerId } : undefined;
    const skill = await this.characterSkillRepo.findBySkillIdOrName(skillIdOrName, saveId, options, trx);
    if (skill) return skill;

    // 构造可用技能列表提示
    const available = await this.characterSkillRepo.findBySaveId(saveId, undefined, trx);
    const hint = available.slice(0, 20).map(s => `${s.name}(${s.id})`).join(', ');
    throw new Error(`技能未找到: ${skillIdOrName}. 可用技能: ${hint}`);
  }

  // ---------------------------------------------------------------------------
  // learnSkill：从技能池学习
  // ---------------------------------------------------------------------------

  async learnSkill(saveId: ID, skillIdOrName: string, visible?: boolean, ownerType?: OwnerType, ownerId?: string, fullParams?: Record<string, unknown>, trx?: Knex.Transaction): Promise<LearnSkillResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        this.logger.debug('learnSkill: starting', { skillIdOrName, saveId, hasFullParams: !!fullParams, fullParamsKeys: fullParams ? Object.keys(fullParams) : [] });
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, t);

        // Level 1: 尝试从 save pool 查找
        const poolSkillId = await this.resolvePoolSkillId(skillIdOrName, saveId, t);
        this.logger.debug('learnSkill: pool lookup result', { skillIdOrName, poolSkillId });
        if (poolSkillId) {
          const poolSkill = await this.getPoolSkill(saveId, poolSkillId, t);
          if (!poolSkill) {
            return { success: false, error: `技能池中未找到: ${skillIdOrName}` };
          }

          // 检查是否已学习
          const existingSkill = await this.characterSkillRepo.findLearnedBySaveIdAndSkillId(
            saveId, poolSkillId, resolved.ownerType, resolved.ownerId, t,
          );

          if (existingSkill) {
            // 已学习技能：增量更新非黑名单字段（visible/level/experience 等）+ 返回 alreadyLearned + warnings
            return await this.applyLearnedSkillDedupUpdate(
              saveId, existingSkill, visible, fullParams, resolved, t,
            );
          }

          // 前置条件检查
          const customData = poolSkill.customData ?? {};
          const levelRequired = customData.level_requirement as number | undefined;
          if (levelRequired) {
            const characterLevel = await this.characterService.getCharacterLevel(saveId, t);
            if (characterLevel < levelRequired) {
              return {
                success: false,
                error: `Level requirement not met. Need level ${levelRequired}`
              };
            }
          }

          const prerequisiteSkills = customData.prerequisites as string[] | undefined;
          if (prerequisiteSkills && Array.isArray(prerequisiteSkills) && prerequisiteSkills.length > 0) {
            for (const prereq of prerequisiteSkills) {
              // 按 owner 过滤：NPC 学技能时检查 NPC 自己的前置技能，不跨 owner 查询
              const hasPrereq = await this.characterSkillRepo.findLearnedBySaveIdAndSkillId(saveId, prereq, resolved.ownerType, resolved.ownerId, t);
              if (!hasPrereq) {
                return {
                  success: false,
                  error: `Prerequisite skill not learned: ${prereq}`
                };
              }
            }
          }

          // 写入 character_skills
          const skillName = poolSkill.name;
          const characterSkillId = generateReadableId('skill', skillName) as ID;
          const skillCategory = (poolSkill.category || 'attack') as SkillCategory;
          const skillElement = (poolSkill.element || 'none') as SkillElement;

          const inserted = await this.characterSkillRepo.insert({
            id: characterSkillId,
            saveId,
            skillId: poolSkillId,
            name: skillName,
            description: poolSkill.description || '',
            level: 1,
            maxLevel: poolSkill.maxLevel || 10,
            experience: 0,
            cooldownRemaining: 0,
            category: skillCategory,
            element: skillElement,
            cost: poolSkill.cost ?? [],
            effects: { effects: poolSkill.effects ?? [] },
            customData,
            unlocked: true,
            visible: Boolean(visible),
            ownerType: resolved.ownerType,
            ownerId: resolved.ownerId,
            consecutiveUses: 0,
            lastUsedAt: 0,
          }, t);

          // 更新 skill_pool 的 learned = 1
          await this.skillPoolRepo.updateLearned(saveId, poolSkillId, true, t);

          this.logger.info('Skill learned from pool', {
            saveId,
            poolSkillId,
            skillName
          });

          return {
            success: true,
            skill: inserted
          };
        }

        // Level 2: 尝试从模板池查找
        const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId, t);
        if (templateId && this.templatePoolService) {
          const templateSkill = await this.templatePoolService.findSkillByName(templateId, skillIdOrName);
          if (templateSkill) {
            // 合并模板数据与覆盖参数，写入 save pool
            const mergedParams = this.mergeWithTemplate(templateSkill, fullParams ?? {}) as Parameters<typeof this.addPoolSkill>[1];
            const newEntry = await this.addPoolSkill(saveId, mergedParams, t);
            // 从 save pool 学习（透传 t 避免开新事务）
            return this.learnSkill(saveId, newEntry.id, visible, ownerType, ownerId, undefined, t);
          }
        }

        // Level 3: 检查字段是否完整，完整则创建 + 学习
        // 回写模板池由 addPoolSkill 统一处理（单一数据源原则），此处不再重复回写
        const paramsToUse = fullParams ?? { name: skillIdOrName };
        if (this.isSkillFieldsComplete(paramsToUse)) {
          const newEntry = await this.addPoolSkill(saveId, paramsToUse as Parameters<typeof this.addPoolSkill>[1], t);
          return this.learnSkill(saveId, newEntry.id, visible, ownerType, ownerId, undefined, t);
        }

        // 字段不完整：列出具体缺失字段
        const missingFields = this.getMissingSkillFields(paramsToUse);
        return {
          success: false,
          error: `技能"${skillIdOrName}"学习失败：存档池/模板池均未找到，且 fullParams 缺少必填字段 [${missingFields.join(', ')}]。`
            + `请在 fullParams 中提供 name（技能名）和 category（attack/defense/healing/buff/passive 之一）。`
            + `可选字段：element, cost, damage, effects, cooldown, maxLevel, targetType, range 等。`,
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to learn skill', { saveId, skillIdOrName, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 已学技能去重防护：同 saveId+ownerId+skillId 已学习时增量更新非黑名单字段 + 返回 alreadyLearned + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、skillId、ownerId、ownerType、createdAt
   * 可更新字段：visible、level、experience 等所有非黑名单字段
   *
   * 数据来源：
   * - visible：learnSkill 函数参数
   * - level/experience：fullParams 中的 level/exp/experience 字段
   */
  private async applyLearnedSkillDedupUpdate(
    saveId: ID,
    existing: CharacterSkill,
    visible?: boolean,
    fullParams?: Record<string, unknown>,
    resolved?: { ownerType: OwnerType; ownerId: string },
    trx?: Knex.Transaction,
  ): Promise<LearnSkillResult> {
    this.logger.info('Skill already learned, applying incremental update', {
      saveId, existingId: existing.id, skillId: existing.skillId,
    });

    // 构建新值（从函数参数 + fullParams 提取）
    const newValues: Record<string, unknown> = {
      visible: visible,
      level: fullParams?.level,
      experience: fullParams?.exp ?? fullParams?.experience,
    };

    // 构建已有值
    const existingValues: Record<string, unknown> = {
      visible: existing.visible,
      level: existing.level,
      experience: existing.experience,
    };

    const LEARNED_SKILL_BLACKLIST = ['id', 'saveId', 'skillId', 'ownerId', 'ownerType', 'createdAt'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, LEARNED_SKILL_BLACKLIST,
    );

    if (updatedFields.length > 0) {
      const patch: Partial<CharacterSkill> = {};
      for (const f of updatedFields) {
        (patch as Record<string, unknown>)[f.field] = f.newValue;
      }
      await this.characterSkillRepo.update(
        saveId, existing.id, patch,
        { ownerType: resolved?.ownerType, ownerId: resolved?.ownerId },
        trx,
      );
    }

    // 获取更新后的实体
    const updated = await this.characterSkillRepo.findById(
      saveId, existing.id,
      { ownerType: resolved?.ownerType, ownerId: resolved?.ownerId },
      trx,
    );
    if (!updated) throw new Error('Failed to retrieve updated learned skill');

    const skillName = existing.name ?? existing.skillId;
    const warnings = formatDedupWarnings('技能', skillName, updatedFields, blockedFields);

    this.logger.info('Learned skill incremental update applied', {
      saveId, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { success: true, alreadyLearned: true, skill: updated, warnings };
  }

  // ---------------------------------------------------------------------------
  // createSkill：先写 pool，可选学习
  // ---------------------------------------------------------------------------

  async createSkill(saveId: ID, params: {
    name: string;
    description?: string;
    category?: string;
    element?: string;
    cost?: SkillCostEntry[];
    maxLevel?: number;
    damage?: Record<string, unknown>;
    scalingStat?: string;
    cooldown?: number;
    effects?: Array<Record<string, unknown>>;
    customData?: Record<string, unknown>;
    visible?: boolean;
    skillType?: string;
    targetType?: string;
    range?: number;
    learn?: boolean;
  }, ownerType?: OwnerType, ownerId?: string): Promise<LearnSkillResult & { poolSkillId?: string }> {
    try {
      // 合并扩展属性到 customData
      const enrichedCustomData: Record<string, unknown> = {
        ...(params.customData ?? {}),
        ...(Object.keys(params.damage ?? {}).length > 0 ? { damage: params.damage } : {}),
        ...(params.scalingStat ? { scaling_stat: params.scalingStat } : {}),
        ...(params.skillType ? { skill_type: params.skillType } : {}),
      };

      // Step 1: 写入 skill_pool
      const poolSkill = await this.addPoolSkill(saveId, {
        name: params.name,
        description: params.description,
        category: params.category,
        element: params.element,
        cost: params.cost,
        damage: params.damage,
        effects: params.effects,
        cooldown: params.cooldown,
        maxLevel: params.maxLevel,
        targetType: params.targetType,
        range: params.range,
        customData: enrichedCustomData,
      });

      const poolSkillId = poolSkill.id;

      // Step 2: 如果 learn=true，从池中学习
      if (params.learn) {
        const learnResult = await this.learnSkill(saveId, poolSkillId, params.visible, ownerType, ownerId);
        return { ...learnResult, poolSkillId };
      }

      // 不学习时返回 pool 技能信息
      const skillCategory = (params.category || 'attack') as SkillCategory;
      const skillElement = (params.element || 'none') as SkillElement;

      this.logger.info('Skill created (pool only)', {
        saveId,
        poolSkillId,
        skillName: params.name
      });

      return {
        success: true,
        poolSkillId,
        skill: {
          id: poolSkillId,
          saveId,
          skillId: poolSkillId,
          name: params.name,
          description: params.description || '',
          level: 1,
          maxLevel: params.maxLevel || 10,
          experience: 0,
          cooldownRemaining: 0,
          category: skillCategory,
          element: skillElement,
          cost: params.cost ?? [],
          effects: { effects: params.effects ?? [] },
          customData: enrichedCustomData,
          unlocked: true,
          visible: Boolean(params.visible),
          ownerType: ownerType ?? 'character',
          ownerId: ownerId ?? '',
        }
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create skill', { saveId, params, error: errorMessage });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // upgradeSkill
  // ---------------------------------------------------------------------------

  async upgradeSkill(saveId: ID, skillId: string, ownerType?: string, ownerId?: string): Promise<UpgradeSkillResult> {
    try {
      // 写入类方法：owner 为空默认 character，通过 resolveOwnerId 自动解析 characterId
      const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId);
      const skill = await this.characterSkillRepo.findBySkillIdOrName(skillId, saveId, { ownerType: resolved.ownerType, ownerId: resolved.ownerId });
      if (!skill) {
        return {
          success: false,
          previousLevel: 0,
          newLevel: 0,
          bonuses: {},
          error: `Skill not found: ${skillId}`
        };
      }

      if (skill.level >= skill.maxLevel) {
        return {
          success: false,
          previousLevel: skill.level,
          newLevel: skill.level,
          bonuses: {},
          error: `Skill already at max level: ${skill.maxLevel}`
        };
      }

      const expNeeded = this.calcExpForLevel(skill.level + 1);

      if (skill.experience < expNeeded) {
        return {
          success: false,
          previousLevel: skill.level,
          newLevel: skill.level,
          bonuses: {},
          error: `Not enough experience. Need ${expNeeded}, have ${skill.experience}`
        };
      }

      const previousLevel = skill.level;
      const newLevel = skill.level + 1;
      const bonuses = this.calcLevelBonuses(skill.category, newLevel);

      const currentEffects = { ...skill.effects };
      for (const [key, value] of Object.entries(bonuses)) {
        if (currentEffects[key] !== undefined) {
          (currentEffects as Record<string, number>)[key] += value;
        } else {
          currentEffects[key] = value;
        }
      }

      const remainingExp = skill.experience - expNeeded;

      await this.characterSkillRepo.update(saveId, skill.id, {
        level: newLevel,
        experience: remainingExp,
        effects: currentEffects,
      }, { ownerType: resolved.ownerType, ownerId: resolved.ownerId });

      this.logger.info('Skill upgraded', {
        saveId,
        skillId,
        previousLevel,
        newLevel,
        bonuses
      });

      return {
        success: true,
        previousLevel,
        newLevel,
        bonuses
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to upgrade skill', { saveId, skillId, error: errorMessage });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // setCooldown / updateSkill / checkCooldown
  // ---------------------------------------------------------------------------

  /**
   * 设置技能冷却（trx-aware 双模式）。
   *
   * 核心写操作（characterSkillRepo.update cooldownRemaining）在事务内执行，
   * 保证 useSkill 事务包裹的原子性。
   *
   * 模板池回写（upsertSkill）在事务外执行：
   * - ITemplatePoolProvider.upsertSkill 端口接口不支持 trx 参数
   * - upsertSkill 用 skill_pool.cooldown 自身值覆盖自身（no-op），非运行时状态变更
   * - 配置回写不严格要求与运行时状态变更的原子性
   */
  async setCooldown(saveId: ID, skillId: string, remaining: number, ownerType?: string, ownerId?: string, trx?: Knex.Transaction): Promise<CharacterSkill> {
    const updated = await this.runInTransaction(trx, async (t) => {
      // 写入类方法：owner 为空默认 character
      const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, t);
      const skill = await this.characterSkillRepo.findBySkillIdOrName(skillId, saveId, { ownerType: resolved.ownerType, ownerId: resolved.ownerId }, t);
      if (!skill) {
        throw new Error(`Skill not found: ${skillId}`);
      }

      const cooldownRemaining = Math.max(0, remaining);
      const updated = await this.characterSkillRepo.update(saveId, skill.id, { cooldownRemaining }, undefined, t);
      if (!updated) {
        throw new Error(`Skill not found after cooldown update: ${skillId}`);
      }
      return updated;
    });

    // 模板池回写（事务外副作用）：覆盖 skill_pool.cooldown 字段。
    // 理由：冷却时间是技能定义的一部分（skill_pool.cooldown），修改后应同步到模板池。
    // 注意：character_skills.cooldownRemaining 是角色运行时状态，不回写。
    const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId);
    if (templateId && this.templatePoolService && updated.skillId) {
      const poolSkill = await this.skillPoolRepo.findById(saveId, updated.skillId);
      if (poolSkill?.name) {
        await this.templatePoolService.upsertSkill(templateId, {
          name: poolSkill.name,
          cooldown: poolSkill.cooldown,
          source: 'generated',
        } as import('../../services/template-pool.js').CreateTemplateSkillParams);
      }
    }

    return updated;
  }

  async updateSkill(saveId: ID, skillId: string, fields: { name?: string; description?: string; customData?: Record<string, unknown>; visible?: boolean }, ownerType?: string, ownerId?: string): Promise<CharacterSkill> {
    // 先解析技能（含所有权校验）
    const skill = await this.resolveSkill(saveId, skillId, ownerType, ownerId);
    await this.validateOwnership(saveId, skill.id, ownerType, ownerId);

    const patch: Partial<CharacterSkill> = {};
    if (fields.name !== undefined) patch.name = fields.name;
    if (fields.description !== undefined) patch.description = fields.description;
    if (fields.customData !== undefined) patch.customData = fields.customData;
    if (fields.visible !== undefined) patch.visible = fields.visible;

    const updated = await this.characterSkillRepo.update(saveId, skill.id, patch);
    if (!updated) {
      throw new Error(`Skill not found after update: ${skillId}`);
    }
    return updated;
  }

  async checkCooldown(saveId: ID, skillId: string, ownerType?: string | 'all', ownerId?: string): Promise<{ available: boolean; remaining: number; cooldownType?: CooldownSystemType } | Array<{ available: boolean; remaining: number; cooldownType?: CooldownSystemType; ownerId: string; ownerType: string }>> {
    const result = await this.findSkill(saveId, skillId, ownerType, ownerId);

    // M12: 通配符模式返回数组
    const skills = Array.isArray(result) ? result : [result];
    if (skills.length === 0) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const cooldownSystem = this.ruleParser.getSkillRules().cooldown_system as CooldownSystemType;

    const buildCooldown = (skill: CharacterSkill) => {
      if (cooldownSystem === 'none') {
        return { available: true, remaining: 0, cooldownType: 'none' as const };
      }
      return {
        available: skill.cooldownRemaining <= 0,
        remaining: Math.max(0, skill.cooldownRemaining),
        cooldownType: cooldownSystem,
      };
    };

    // 通配符模式 → 返回数组（带 owner 标识）
    if (!ownerType || ownerType === 'all') {
      return skills.map(skill => ({
        ...buildCooldown(skill),
        ownerId: skill.ownerId,
        ownerType: skill.ownerType,
      }));
    }

    // 精确 owner → 返回单个对象
    return buildCooldown(skills[0]);
  }

  // ---------------------------------------------------------------------------
  // getSkillTreeInfo：从 pool 读取未学习技能
  // ---------------------------------------------------------------------------

  async getSkillTreeInfo(saveId: ID, _templateId?: string): Promise<SkillTreeInfo> {
    const { skills: learnedSkills } = await this.listSkills(saveId);

    // 从 skill_pool 获取未学习的技能
    const unlearnedPoolSkills = await this.listPoolSkills(saveId, { learned: false });

    const learnedIds = new Set(learnedSkills.map(s => s.skillId));

    const availableSkills = unlearnedPoolSkills
      .filter(poolSkill => !learnedIds.has(poolSkill.id))
      .map(poolSkill => ({
        skillTemplateId: poolSkill.id,
        name: poolSkill.name,
        requirements: {
          levelRequired: poolSkill.customData?.level_requirement as number | undefined,
          prerequisiteSkills: Array.isArray(poolSkill.customData?.prerequisites)
            ? poolSkill.customData.prerequisites as string[]
            : undefined
        }
      }));

    const masteryLevel = learnedSkills.reduce((sum, s) => sum + s.level, 0);

    return {
      learnedSkills,
      availableSkills,
      masteryLevel
    };
  }

  // ---------------------------------------------------------------------------
  // addExperience / tickCooldowns
  // ---------------------------------------------------------------------------

  /**
   * 增加技能经验（trx-aware 双模式）。
   * S2-2 修复事务漏洞：原代码事务内用 this.getSkill（走 this.db）脱离事务上下文，
   * 重构后用 characterSkillRepo.findById + update，全部透传 trx。
   */
  async addExperience(saveId: ID, skillId: string, amount: number, trx?: Knex.Transaction): Promise<CharacterSkill | null> {
    return this.runInTransaction(trx, async (t) => {
      const skill = await this.characterSkillRepo.findById(saveId, skillId, undefined, t);
      if (!skill) return null;

      const newExp = skill.experience + amount;
      const updated = await this.characterSkillRepo.update(
        saveId, skillId, { experience: newExp }, undefined, t,
      );
      return updated;
    });
  }

  async tickCooldowns(saveId: ID, deltaMs: number): Promise<number> {
    return this.txManager.transaction(async trx => {
      const cooldownSystem = this.ruleParser.getSkillRules().cooldown_system as CooldownSystemType;

      if (cooldownSystem === 'none') {
        return 0;
      }

      const skills = await this.characterSkillRepo.findWithActiveCooldown(saveId, trx);
      const decayConfig = this.ruleParser.getDecayCurves();

      let updatedCount = 0;
      const cooldownUpdates: Array<{ skillId: string; cooldownRemaining: number }> = [];

      for (const skill of skills) {
        let newCooldown: number;

        const decayCurveName = skill.customData?.decayCurve as string | undefined;

        if (decayCurveName) {
          const curve = DecayCurveCalculator.getCurve(
            decayConfig?.curves,
            decayCurveName,
            decayConfig?.default_curve
          );
          const delta = cooldownSystem === 'turn' ? 1 : deltaMs;
          newCooldown = DecayCurveCalculator.applyDecay(skill.cooldownRemaining, curve, delta);
        } else if (cooldownSystem === 'turn') {
          newCooldown = Math.max(0, skill.cooldownRemaining - 1);
        } else {
          newCooldown = Math.max(0, skill.cooldownRemaining - deltaMs);
        }

        cooldownUpdates.push({ skillId: skill.id, cooldownRemaining: newCooldown });

        if (newCooldown === 0 && skill.cooldownRemaining > 0) {
          updatedCount++;
        }
      }

      // 批量更新冷却
      if (cooldownUpdates.length > 0) {
        await this.characterSkillRepo.updateCooldowns(saveId, cooldownUpdates, trx);
      }

      // Reset weight cooldown for skills whose cooldown has expired
      const weightConfig = this.ruleParser.getWeightCooldownConfig();
      if (weightConfig) {
        await this.resetWeightCooldownForExpiredSkills(trx, saveId, cooldownSystem, deltaMs, weightConfig);
      }

      return updatedCount;
    });
  }

  /**
   * Reset consecutiveUses for skills whose cooldown expired and have rested
   * long enough (reset_after turns/time since last use).
   */
  private async resetWeightCooldownForExpiredSkills(
    trx: Knex.Transaction,
    saveId: ID,
    _cooldownSystem: CooldownSystemType,
    _deltaMs: number,
    weightConfig: WeightCooldownConfig,
  ): Promise<void> {
    // Find skills that have just had their cooldown reach 0 and have consecutive uses > 0
    const skillsWithWeight = await this.characterSkillRepo.findWeightCooldownExpired(saveId, trx);

    const now = Date.now();

    for (const skill of skillsWithWeight) {
      const lastUsedAt = skill.lastUsedAt ?? 0;
      let shouldReset = false;

      if (weightConfig.reset_unit === 'turn') {
        // For turn-based: count turns since cooldown reached 0
        // Since cooldown_remaining just hit 0, the skill has been resting for
        // the number of turns it took to reach 0. We approximate by checking
        // if enough time has passed. A simpler approach: reset_after turns
        // after cooldown expires. We track this by storing the turn count
        // when cooldown expired in the skill's custom_data, but for simplicity
        // we use a time-based approximation: if the skill's cooldown is 0
        // and lastUsedAt was more than reset_after * typical_turn_duration ago.
        // For a cleaner approach, we use the game's turn counter.
        // Since we don't have a global turn counter here, we reset when
        // cooldown_remaining has been 0 for reset_after ticks.
        // We store the reset counter in custom_data.
        const customData: Record<string, unknown> = { ...(skill.customData ?? {}) };
        const restTurns = (customData._wc_rest_turns as number) ?? 0;
        const newRestTurns = restTurns + 1;

        if (newRestTurns >= weightConfig.reset_after) {
          shouldReset = true;
          delete customData._wc_rest_turns;
        } else {
          customData._wc_rest_turns = newRestTurns;
        }

        if (shouldReset) {
          await this.characterSkillRepo.updateWeightCooldown(saveId, skill.id, {
            consecutiveUses: 0,
            lastUsedAt: 0,
            customData,
          }, trx);
        } else {
          await this.characterSkillRepo.updateWeightCooldown(saveId, skill.id, {
            customData,
          }, trx);
        }
      } else {
        // Time-based: check if enough time has passed since last use
        const elapsed = now - lastUsedAt;
        if (elapsed >= weightConfig.reset_after) {
          shouldReset = true;
        }

        if (shouldReset) {
          await this.characterSkillRepo.updateWeightCooldown(saveId, skill.id, {
            consecutiveUses: 0,
            lastUsedAt: 0,
          }, trx);
        }
      }

      if (shouldReset) {
        this.logger.debug('Weight cooldown reset', {
          saveId,
          skillId: skill.id,
          skillName: skill.name,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // useSkill：遍历 cost 数组扣减多种资源
  // ---------------------------------------------------------------------------

  async useSkill(saveId: ID, skillId: string, targetId?: ID, ownerType?: OwnerType, ownerId?: string, trx?: Knex.Transaction): Promise<UseSkillResult & { targetApplied?: { targetType: 'character' | 'npc'; targetId: ID; damage: number; newHp: number; maxHp: number } }> {
    try {
      return await this.runInTransaction(trx, async (t) => {
        // Step 0: 解析 owner（写入类方法，owner 为空默认 character）
        const resolved = await this.resolveOwnerId(saveId, ownerType, ownerId, t);

        // Step 1: 验证技能存在（按 owner 精确查单个）
        const skill = await this.characterSkillRepo.findBySkillIdOrName(skillId, saveId, { ownerType: resolved.ownerType, ownerId: resolved.ownerId }, t);
        if (!skill) {
          return {
            success: false,
            error: `Skill not found: ${skillId}`
          };
        }

        // Step 2: 检查冷却是否就绪（直接用 skill 实体判断，无需再次查询）
        const cooldownSystem = this.ruleParser.getSkillRules().cooldown_system as CooldownSystemType;
        if (cooldownSystem !== 'none' && skill.cooldownRemaining > 0) {
          const unitLabel = cooldownSystem === 'turn' ? 'turns' : 'ms';
          return {
            success: false,
            error: `Skill is on cooldown. Remaining: ${skill.cooldownRemaining} ${unitLabel}`
          };
        }

        // Step 3: 遍历 cost 数组，检查所有资源是否足够
        const costEntries = skill.cost ?? [];
        const insufficientResources: string[] = [];

        for (const entry of costEntries) {
          if (entry.type === 'item' && !entry.itemId) continue; // 物品消耗缺少 itemId 时跳过
          const current = await this.getCurrentResourceAmount(saveId, resolved.ownerType, resolved.ownerId, entry.type, t);
          if (current < entry.amount) {
            insufficientResources.push(`${entry.type}: 需要 ${entry.amount}, 当前 ${current}`);
          }
        }

        if (insufficientResources.length > 0) {
          return {
            success: false,
            error: `资源不足: ${insufficientResources.join('; ')}`
          };
        }

        // Step 4: 根据冷却系统类型设置冷却（cooldownSystem 已在 Step 2 声明）
        let cooldownValue = 0;

        if (cooldownSystem === 'none') {
          cooldownValue = 0;
        } else if (cooldownSystem === 'turn') {
          const effects = skill.effects as Record<string, unknown>;
          cooldownValue = (effects.cooldown_turns as number) ?? DEFAULT_COOLDOWN_TURNS;
        } else {
          const effects = skill.effects as Record<string, unknown>;
          cooldownValue = (effects.cooldown_ms as number) ?? DEFAULT_COOLDOWN_MS;
        }

        // Apply weight cooldown: increase cooldown based on consecutive uses
        const weightConfig = this.ruleParser.getWeightCooldownConfig();
        let newConsecutiveUses = skill.consecutiveUses ?? 0;
        let currentTurnOrTime = 0;

        if (weightConfig && cooldownValue > 0) {
          newConsecutiveUses += 1;
          cooldownValue = this.calculateWeightedCooldown(cooldownValue, newConsecutiveUses, weightConfig);

          if (cooldownSystem === 'turn') {
            // For turn-based, use cooldownRemaining as a proxy for current turn
            currentTurnOrTime = Date.now();
          } else {
            currentTurnOrTime = Date.now();
          }
        }

        if (cooldownValue > 0) {
          await this.setCooldown(saveId, skill.id, cooldownValue, resolved.ownerType, resolved.ownerId, t);
        }

        // Update consecutive uses and last used timestamp
        if (weightConfig) {
          await this.characterSkillRepo.update(saveId, skill.id, {
            consecutiveUses: newConsecutiveUses,
            lastUsedAt: currentTurnOrTime,
          }, undefined, t);
        }

        // Step 5: 遍历 cost 数组，统一扣减所有资源
        for (const entry of costEntries) {
          if (entry.type === 'item' && !entry.itemId) continue; // 物品消耗缺少 itemId 时跳过
          await this.deductResource(saveId, resolved.ownerType, resolved.ownerId, entry.type, entry.amount, entry.itemId, t);
        }

        // Step 6: 计算技能经验奖励
        const expGained = Math.floor(10 * (1 + skill.level * 0.1));
        await this.addExperience(saveId, skillId, expGained, t);

        // Step 7: 计算伤害 = base + scaling加成 + effects固定值
        let skillDamage: Record<string, unknown> = {};
        if (this.templateService) {
          const templates = await this.templateService.getTemplates();
          for (const tpl of templates) {
            const match = tpl.skills.find(s => s.id === skill.skillId);
            if (match) {
              skillDamage = (match.damage ?? {}) as Record<string, unknown>;
              break;
            }
          }
        }
        if (Object.keys(skillDamage).length === 0) {
          const customData = skill.customData ?? {};
          skillDamage = (customData.damage ?? {}) as Record<string, unknown>;
        }

        const baseDamage = (skillDamage.base as number) ?? (skillDamage.min as number) ?? 0;
        const scalingEntries: SkillScalingEntry[] = parseScaling(skillDamage.scaling);

        let scalingDamage = 0;
        if (scalingEntries.length > 0) {
          const charAttrs = await this.resolveOwnerAttributes(saveId, resolved.ownerType, resolved.ownerId);

          for (const entry of scalingEntries) {
            const attrValue = charAttrs[entry.attribute];
            if (attrValue !== undefined) {
              scalingDamage += attrValue * entry.multiplier;
            }
          }
        }

        const skillEffects = skill.effects as Record<string, unknown>;
        const effectsApplied: Array<{ type: string; value: number; target: string }> = [];
        let effectsDamage = 0;

        if (skillEffects.effects && Array.isArray(skillEffects.effects)) {
          for (const effect of skillEffects.effects as Array<Record<string, unknown>>) {
            const effectEntry = {
              type: effect.type as string || 'unknown',
              value: effect.value as number || 0,
              target: effect.target as string || 'self'
            };
            effectsApplied.push(effectEntry);

            if (effect.type === 'damage' || effect.type === 'power') {
              effectsDamage += (effect.value as number) || 0;
            }
          }
        }

        const damage = Math.floor(baseDamage + scalingDamage + effectsDamage);

        this.logger.info('Skill used', {
          saveId,
          skillId,
          skillName: skill.name,
          costSpent: costEntries,
          expGained,
          cooldownSet: cooldownValue,
          cooldownSystem,
          damage,
          effectsAppliedCount: effectsApplied.length
        });

        const updatedSkill = await this.characterSkillRepo.findBySkillIdOrName(skillId, saveId, { ownerType: resolved.ownerType, ownerId: resolved.ownerId }, t);
        if (!updatedSkill) {
          throw new Error(`Skill not found after use: ${skillId}`);
        }

        // Step 8: 若 targetId 传入，将 damage apply 到目标 HP
        // 高级方法自动完成低级方法：传 targetId 后程序自动扣减目标 HP，LLM 无需额外调用 modify_health
        let targetApplied: { targetType: 'character' | 'npc'; targetId: ID; damage: number; newHp: number; maxHp: number } | undefined;
        if (targetId && damage > 0) {
          const resolvedTarget = await this.resolveTarget(saveId, targetId);
          if (resolvedTarget.targetType === 'character') {
            const result = await this.characterService.modifyHealth(saveId, -damage, t);
            targetApplied = {
              targetType: 'character',
              targetId: resolvedTarget.targetId,
              damage,
              newHp: result.current,
              maxHp: result.max,
            };
          } else {
            const result = await this.npcService.modifyNpcHealth(saveId, resolvedTarget.targetId, -damage, t);
            targetApplied = {
              targetType: 'npc',
              targetId: resolvedTarget.targetId,
              damage,
              newHp: result.current,
              maxHp: result.max,
            };
          }
        }

        return {
          success: true,
          skill: updatedSkill,
          damage,
          effectsApplied,
          expGained,
          costSpent: costEntries,
          cooldownSet: cooldownValue,
          ...(targetApplied ? { targetApplied } : {}),
        };
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to use skill', { saveId, skillId, error: errorMessage });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 私有计算方法
  // ---------------------------------------------------------------------------

  /**
   * 解析技能目标类型：按 ID 前缀区分 character/npc。
   * - targetId === saveId → character（自打自，少见但合法）
   * - targetId 以 'npc_' 开头 → npc（直接使用，无需 resolveNpcId）
   * - 否则尝试 npcService.resolveNpcId：成功 → npc（使用解析后的真实 ID）；失败 → 抛错（无效目标）
   */
  private async resolveTarget(
    saveId: ID,
    targetId: ID,
  ): Promise<{ targetType: 'character' | 'npc'; targetId: ID }> {
    if (targetId === saveId) {
      return { targetType: 'character', targetId };
    }
    if (typeof targetId === 'string' && targetId.startsWith('npc_')) {
      return { targetType: 'npc', targetId };
    }
    try {
      const resolvedNpcId = await this.npcService.resolveNpcId(saveId, targetId as string);
      return { targetType: 'npc', targetId: resolvedNpcId as ID };
    } catch {
      // resolveNpcId 失败 → 目标既非角色也非 NPC，抛错暴露无效目标（禁止静默退化为 character）
      throw new Error(`Invalid targetId: ${targetId}. Cannot resolve to character or npc`);
    }
  }

  private calcExpForLevel(level: number): number {
    if (level <= 1) return 0;
    const base = this.ruleParser.getSkillRules().upgrade_cost.base;
    const growth = this.ruleParser.getSkillRules().upgrade_cost.multiplier;
    let totalExp = 0;
    for (let i = 1; i < level; i++) {
      totalExp += Math.floor(base * Math.pow(growth, i - 1));
    }
    return totalExp;
  }

  /**
   * Calculate effective cooldown with weight factor applied.
   * Formula: baseCooldown * min(max_multiplier, weight_factor^(consecutiveUses - 1))
   */
  private calculateWeightedCooldown(baseCooldown: number, consecutiveUses: number, config: WeightCooldownConfig): number {
    if (consecutiveUses <= 1) return baseCooldown;
    const multiplier = Math.min(config.max_multiplier, Math.pow(config.weight_factor, consecutiveUses - 1));
    return Math.floor(baseCooldown * multiplier);
  }

  private calcLevelBonuses(category: SkillCategory, level: number): Record<string, number> {
    const baseBonus = Math.floor(level * 1.5);

    switch (category) {
      case 'attack':
        return {
          powerBonus: baseBonus,
          costReduction: Math.floor(level * 0.5)
        };
      case 'defense':
        return {
          defenseBonus: baseBonus,
          damageReduction: Math.floor(level * 0.3)
        };
      case 'healing':
        return {
          healBonus: baseBonus,
          costReduction: Math.floor(level * 0.4)
        };
      case 'passive':
        return {
          passiveBonus: baseBonus,
          effectDuration: Math.floor(level * 0.3)
        };
      case 'buff':
        return {
          buffPower: baseBonus,
          buffDuration: Math.floor(level * 0.4)
        };
      case 'debuff':
        return {
          debuffPower: baseBonus,
          debuffChance: Math.min(0.5, level * 0.02)
        };
      case 'utility':
        return {
          utilityBonus: baseBonus,
          cooldownReduction: Math.floor(level * 0.2)
        };
      default:
        return { genericBonus: baseBonus };
    }
  }

  /**
   * 计算技能基础伤害（base + scaling + effects），供 CombatService 调用
   */
  async calculateSkillDamage(
    saveId: string,
    skillId: string,
    casterAttrs?: Record<string, number>
  ): Promise<{ base: number; scaling: number; effects: number; total: number }> {
    const skill = await this.getSkill(saveId, skillId);
    if (!skill) {
      return { base: 0, scaling: 0, effects: 0, total: 0 };
    }

    // 读取技能 damage 定义
    let skillDamage: Record<string, unknown> = {};
    if (this.templateService) {
      const templates = await this.templateService.getTemplates();
      for (const tpl of templates) {
        const match = tpl.skills.find(s => s.id === skill.skillId);
        if (match) {
          skillDamage = (match.damage ?? {}) as Record<string, unknown>;
          break;
        }
      }
    }
    if (Object.keys(skillDamage).length === 0) {
      const customData = skill.customData ?? {};
      skillDamage = (customData.damage ?? {}) as Record<string, unknown>;
    }

    const base = (skillDamage.base as number) ?? (skillDamage.min as number) ?? 0;
    const scalingEntries: SkillScalingEntry[] = parseScaling(skillDamage.scaling);

    // 属性缩放
    let scaling = 0;
    if (scalingEntries.length > 0) {
      let charAttrs = casterAttrs ?? {};
      if (!casterAttrs) {
        try {
          charAttrs = await this.resolveOwnerAttributes(saveId, skill.ownerType, skill.ownerId);
        } catch {
          charAttrs = {};
        }
      }
      for (const entry of scalingEntries) {
        const attrValue = charAttrs[entry.attribute];
        if (attrValue !== undefined) {
          scaling += attrValue * entry.multiplier;
        }
      }
    }

    // effects 固定伤害
    const skillEffects = skill.effects as Record<string, unknown>;
    let effects = 0;
    if (skillEffects?.effects && Array.isArray(skillEffects.effects)) {
      for (const effect of skillEffects.effects as Array<Record<string, unknown>>) {
        if (effect.type === 'damage' || effect.type === 'power') {
          effects += (effect.value as number) || 0;
        }
      }
    }

    const total = Math.floor(base + scaling + effects);
    return { base, scaling, effects, total };
  }

  /**
   * 解析技能所有者的属性（用于伤害缩放计算）。
   * 合并原 resolveSkillOwner + useSkill 内联属性读取，统一通过端口接口。
   */
  private async resolveOwnerAttributes(
    saveId: string,
    ownerType: string,
    ownerId: string,
    trx?: Knex.Transaction,
  ): Promise<Record<string, number>> {
    if (ownerType === 'npc') {
      const npcAttrs = await this.npcService.getNpcAttributes(saveId, ownerId, trx);
      return npcAttrs as Record<string, number>;
    }

    const charInfo = await this.characterService.getCharacterBasicInfo(saveId, trx);
    if (charInfo) {
      return charInfo.attributes;
    }
    return {};
  }

  // ---------------------------------------------------------------------------
  // P0-2: 技能使用前置校验（从 game-service.validateSkillUsage 迁移）
  // ---------------------------------------------------------------------------

  /**
   * 校验玩家角色技能使用条件（资源是否足够、冷却是否就绪）。
   * P0-2: 从 game-service.validateSkillUsage 迁移，消除 game-service 直接 db 调用。
   * 返回 null 表示校验通过，返回 string 表示错误消息。
   * D9: 只读校验，无写操作，不需要 trx 参数。
   */
  async validateUsage(saveId: ID, skillId?: string, skillName?: string): Promise<string | null> {
    // 1. 三级查找：id → name → skill_id（复用 Repository 端口，消除 db 调用）
    const skill = await this.characterSkillRepo.findBySkillIdOrName(
      skillId ?? skillName ?? '',
      saveId,
    );
    if (!skill) {
      return `技能未找到: ${skillName || skillId}`;
    }

    // 2. 检查冷却
    if (skill.cooldownRemaining > 0) {
      return `技能「${skill.name}」冷却中，还需等待 ${skill.cooldownRemaining} 回合`;
    }

    // 3. 解析消耗
    const cost = parseCostArray(skill.cost);
    if (!cost || cost.length === 0) {
      return null; // 无消耗，校验通过
    }

    // 4. 获取角色当前资源并逐项检查
    const resources = await this.characterService.getCharacterResources(saveId);
    const insufficient: string[] = [];
    const typeLabel: Record<string, string> = {
      mp: '法力', hp: '生命', stamina: '体力', currency: '金币', item: '物品', mana: '法力',
    };
    for (const entry of cost) {
      if (entry.type === 'item' && !entry.itemId) continue; // 物品消耗缺少 itemId 时跳过
      const normalizedType = entry.type === 'mana' ? 'mp' : entry.type;
      let currentAmount = 0;
      switch (normalizedType) {
        case 'mp': currentAmount = resources.currentMp; break;
        case 'hp': currentAmount = resources.currentHp; break;
        case 'stamina': currentAmount = resources.currentStamina; break;
        case 'currency': currentAmount = resources.currency.gold ?? 0; break;
        case 'item': continue;
        default: continue;
      }
      if (currentAmount < entry.amount) {
        insufficient.push(`${typeLabel[entry.type] || entry.type}: 需要 ${entry.amount}，当前 ${currentAmount}`);
      }
    }

    if (insufficient.length > 0) {
      return `技能「${skill.name}」资源不足: ${insufficient.join('；')}`;
    }

    return null; // 校验通过
  }
}
