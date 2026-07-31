import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { NumericalService } from '../numerical/NumericalService.js';
import type {
  CreateCharacterInput,
  CharacterData,
  CharacterStatusPanel,
  ICharacterService,
  CharacterBasicInfo,
  CharacterCombatInfo,
  ICharacterRepository,
} from './types.js';
import type { ISaveRepository } from '../save/types.js';
import type { ITemplateProvider } from '../shared/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import { parseJsonField } from '../../utils/pool-helpers.js';
import { computeDedupUpdate, formatDedupWarnings } from '../shared/dedup-helper.js';

export { CreateCharacterInput, CharacterData, CharacterStatusPanel };

/**
 * CharacterService（S4 重构：移除 db 字段，注入 Repository + TransactionManager + 跨领域端口）。
 *
 * 依赖注入：
 * - ICharacterRepository: characters 表读写（31 处 db 调用迁移目标）
 * - ITransactionManager: 事务边界管理（D10）
 * - ISaveRepository: 跨领域查询 saves 表 template_id（getFullStatus 解析模板名称）
 * - ITemplateProvider: 跨层查询 templates 表 character_creation（getFullStatus 解析种族/职业/背景名称）
 * - NumericalService: 派生属性计算 + recalculateDerivedAttributes
 *
 * 31 处 db 调用全部迁移到 Repository：
 * - createCharacter: characters insert
 * - getCharacter: characters select
 * - getFullStatus: saves select + templates select（跨领域 → ISaveRepository + ITemplateProvider）
 * - updateAttributes: characters update + recalculateDerivedAttributes
 * - modifyHealth/modifyMana: characters read + update
 * - modifyCurrency: characters read + update
 * - getCurrentLocationId/updateLocationId/countCharactersAtLocation: characters select/update/count
 * - modifyStamina: characters read + update custom_data
 * - getCharacterResources/getCharacterLevel/grantExperience: characters select/update
 * - getCharacterCombatInfo/setVitals/mergeCurrency/getCharacterStatus/setPermadeath: characters select/update
 * - updateLevel/markPermadeath: characters update
 */
export class CharacterService implements ICharacterService {
  private logger: ReturnType<typeof createChildLogger>;
  private characterRepo: ICharacterRepository;
  private saveRepo: ISaveRepository;
  private templateProvider: ITemplateProvider | null;
  private numericalService: NumericalService;
  private readonly txManager: ITransactionManager;

  constructor(
    characterRepo: ICharacterRepository,
    saveRepo: ISaveRepository,
    numericalService: NumericalService,
    txManager: ITransactionManager,
    templateProvider?: ITemplateProvider | null,
  ) {
    this.logger = createChildLogger('service:character');
    this.characterRepo = characterRepo;
    this.saveRepo = saveRepo;
    this.numericalService = numericalService;
    this.txManager = txManager;
    this.templateProvider = templateProvider ?? null;
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
   * 获取角色基本信息（跨领域只读查询，ICharacterService 端口接口实现）。
   * 返回 inventory 等跨领域消费方所需的最小字段集：characterId / attributes / currency。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  async getCharacterBasicInfo(saveId: string, trx?: Knex.Transaction): Promise<CharacterBasicInfo | null> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) return null;
    return {
      characterId: row.id,
      attributes: parseJsonField<Record<string, number>>(row.attributes, {}),
      currency: parseJsonField<Record<string, number>>(row.currency, {}),
    };
  }

  async createCharacter(input: CreateCharacterInput, templateConfig?: { default_location_id?: string }, trx?: Knex.Transaction): Promise<CharacterData & { alreadyExists?: boolean; warnings?: string[] }> {
    try {
      // 幂等检查：processInitialize 已在 GM 启动前创建角色，GM 若重复调用 create_character
      // 应增量更新已有角色字段，而不是生成新 ID 并 INSERT 导致 UNIQUE constraint 失败。
      const existing = await this.characterRepo.findEntityBySaveId(input.saveId, trx);
      if (existing) {
        return await this.applyCharacterDedupUpdate(input, existing, trx);
      }

      const now = Date.now() as Timestamp;
      const characterId = generateReadableId('char', input.name || 'unknown') as ID;

      const finalAttrs = { ...input.attributes };
      const derivedAttrs = this.numericalService.calculateDerivedAttributes(finalAttrs);
      // DerivedAttributes.maxHealth/maxMana 是可选字段，createCharacter 路径必须有值
      const maxHp = derivedAttrs.maxHealth ?? 0;
      const maxMp = derivedAttrs.maxMana ?? 0;

      // 角色创建时不预设位置，由 Agent 初始化完成后分配
      const defaultLocationId = templateConfig?.default_location_id || null;

      await this.characterRepo.insert({
        id: characterId,
        save_id: input.saveId,
        name: input.name,
        gender: input.gender,
        custom_gender: input.customGender || null,
        age_group: input.ageGroup || null,
        race: input.race,
        class: input.classType,
        background: input.background,
        level: 1,
        experience: 0,
        current_hp: maxHp,
        max_hp: maxHp,
        base_max_hp: maxHp,
        current_mp: maxMp,
        max_mp: maxMp,
        base_max_mp: maxMp,
        currency: JSON.stringify({ gold: 0 }),
        attributes: JSON.stringify(finalAttrs),
        derived_attributes: JSON.stringify(derivedAttrs),
        status: JSON.stringify({}),
        custom_data: JSON.stringify(input.customOptions ?? {}),
        current_location_id: input.currentLocationId || defaultLocationId,
        created_at: now,
        updated_at: now,
      }, trx);

      const character = await this.characterRepo.findEntityBySaveId(input.saveId, trx);
      if (!character) throw new Error('Failed to retrieve created character');

      this.logger.info('Character created', {
        saveId: input.saveId,
        name: input.name,
        race: input.race,
        class: input.classType,
      });

      return character;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create character', { error: errorMessage });
      throw error;
    }
  }

  /**
   * 角色去重防护：同 saveId 已存在时增量更新非黑名单字段 + 返回 alreadyExists + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、createdAt
   * 可更新字段：name、gender、customGender、ageGroup、race、class、background、
   *            currentLocationId、attributes 等所有非黑名单字段
   *
   * 特殊处理：
   * - attributes 变化时：重新计算 derivedAttributes + maxHP/maxMP（复用 updateBaseAttributes + recalculateDerivedAttributes）
   * - classType（输入）→ class（实体字段名）映射
   * - 不更新 currentHP/currentMP（保持当前血量，避免属性更新时意外回满血）
   */
  private async applyCharacterDedupUpdate(
    input: CreateCharacterInput,
    existing: CharacterData,
    trx?: Knex.Transaction,
  ): Promise<CharacterData & { alreadyExists?: boolean; warnings?: string[] }> {
    this.logger.info('Character already exists, applying incremental update', {
      saveId: input.saveId, existingId: existing.id, existingName: existing.name,
    });

    // 构建 newValues（实体字段名 camelCase）
    const newValues: Record<string, unknown> = {
      name: input.name,
      gender: input.gender,
      customGender: input.customGender,
      ageGroup: input.ageGroup,
      race: input.race,
      class: input.classType, // input.classType → entity.class
      background: input.background,
      currentLocationId: input.currentLocationId,
      attributes: input.attributes,
    };

    // 构建 existingValues（实体字段名）
    const existingValues: Record<string, unknown> = {
      name: existing.name,
      gender: existing.gender,
      customGender: existing.customGender,
      ageGroup: existing.ageGroup,
      race: existing.race,
      class: existing.class,
      background: existing.background,
      currentLocationId: existing.currentLocationId,
      attributes: existing.attributes,
    };

    const CHARACTER_BLACKLIST = ['id', 'saveId', 'createdAt'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, CHARACTER_BLACKLIST,
    );

    // 应用更新（事务内）
    await this.runInTransaction(trx, async (t) => {
      // 处理 attributes 特殊更新（重新计算派生属性）
      const attributesUpdate = updatedFields.find(f => f.field === 'attributes');
      if (attributesUpdate) {
        const finalAttrs = attributesUpdate.newValue as Record<string, number>;
        const derivedAttrs = this.numericalService.calculateDerivedAttributes(finalAttrs);
        await this.characterRepo.updateBaseAttributes(
          input.saveId,
          finalAttrs,
          derivedAttrs.maxHealth ?? 0,
          derivedAttrs.maxMana ?? 0,
          t,
        );
        await this.numericalService.recalculateDerivedAttributes(input.saveId, t);
      }

      // 处理其他字段更新（row 格式 snake_case）
      const patch: Record<string, unknown> = {};
      for (const f of updatedFields) {
        if (f.field === 'attributes') continue; // 已通过 updateBaseAttributes 处理
        switch (f.field) {
          case 'name': patch.name = f.newValue; break;
          case 'gender': patch.gender = f.newValue; break;
          case 'customGender': patch.custom_gender = f.newValue; break;
          case 'ageGroup': patch.age_group = f.newValue; break;
          case 'race': patch.race = f.newValue; break;
          case 'class': patch.class = f.newValue; break;
          case 'background': patch.background = f.newValue; break;
          case 'currentLocationId': patch.current_location_id = f.newValue; break;
        }
      }
      if (Object.keys(patch).length > 0) {
        await this.characterRepo.updateFields(input.saveId, patch, t);
      }
    });

    // 获取更新后的实体
    const updated = await this.characterRepo.findEntityBySaveId(input.saveId, trx);
    if (!updated) throw new Error('Failed to retrieve updated character');

    const warnings = formatDedupWarnings('角色', existing.name, updatedFields, blockedFields);

    this.logger.info('Character incremental update applied', {
      saveId: input.saveId, existingId: existing.id,
      updatedFields: updatedFields.map(f => f.field),
      blockedFields: blockedFields.map(f => f.field),
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  async getCharacter(saveId: ID, trx?: Knex.Transaction): Promise<CharacterData> {
    try {
      const character = await this.characterRepo.findEntityBySaveId(saveId, trx);
      if (!character) throw new Error("Character not found. 建议：使用 create_character 创建角色");
      return character;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get character', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getFullStatus(saveId: ID): Promise<CharacterStatusPanel> {
    const character = await this.getCharacter(saveId);

    const levelProgress = this.numericalService.getLevelProgress(
      character.experience,
      character.level,
    );

    let raceName = character.race;
    let className = character.class;
    let backgroundName = character.background;
    const attributeNames: Record<string, string> = {};

    // 跨领域查询：通过 ISaveRepository 获取 templateId，再通过 ITemplateProvider 获取模板
    // 解析种族/职业/背景/属性的显示名称
    if (this.templateProvider) {
      try {
        const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId);
        if (templateId) {
          const template = await this.templateProvider.getTemplate(templateId);
          const cc = template.characterCreation;
          if (cc && typeof cc === 'object') {
            const races = (cc.races ?? []) as Array<{ id: string; name: string }>;
            const classes = (cc.classes ?? []) as Array<{ id: string; name: string }>;
            const backgrounds = (cc.backgrounds ?? []) as Array<{ id: string; name: string }>;
            const attributes = (cc.attributes ?? []) as Array<{ id: string; name: string }>;

            const race = races.find((r) => r.id === character.race);
            if (race) raceName = race.name;

            const cls = classes.find((c) => c.id === character.class);
            if (cls) className = cls.name;

            const bg = backgrounds.find((b) => b.id === character.background);
            if (bg) backgroundName = bg.name;

            for (const attr of attributes) {
              attributeNames[attr.id] = attr.name;
            }
          }
        }
      } catch {
        this.logger.warn('Failed to resolve entity names from template, using IDs as fallback');
      }
    }

    return {
      basicInfo: {
        name: character.name,
        gender: character.gender,
        customGender: character.customGender,
        ageGroup: character.ageGroup,
        race: character.race,
        raceName,
        class: character.class,
        className,
        background: character.background,
        backgroundName,
        level: character.level,
      },
      attributes: character.attributes,
      attributeNames,
      derivedAttributes: character.derivedAttributes,
      vitals: {
        currentHP: character.currentHP,
        maxHP: character.maxHP,
        currentMP: character.currentMP,
        maxMP: character.maxMP,
      },
      experience: {
        current: character.experience,
        nextLevel: levelProgress.expForNextLevel,
        progress: levelProgress.progressPercent,
      },
      currency: character.currency,
    };
  }

  async updateAttributes(saveId: ID, deltas: Partial<Record<string, number>>, trx?: Knex.Transaction): Promise<CharacterData> {
    return this.runInTransaction(trx, async (t) => {
      const character = await this.getCharacter(saveId, t);

      const newAttrs = { ...character.attributes };
      for (const [key, delta] of Object.entries(deltas)) {
        if (key in newAttrs && typeof delta === 'number') {
          (newAttrs as Record<string, number>)[key] += delta;
        }
      }

      const derivedAttrs = this.numericalService.calculateDerivedAttributes(newAttrs);

      await this.characterRepo.updateBaseAttributes(
        saveId,
        newAttrs,
        derivedAttrs.maxHealth ?? 0,
        derivedAttrs.maxMana ?? 0,
        t,
      );

      await this.numericalService.recalculateDerivedAttributes(saveId, t);

      return (await this.getCharacter(saveId, t))!;
    });
  }

  async modifyHealth(saveId: ID, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number; max: number }> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const previous = row.current_hp;
    const newValue = Math.max(0, Math.min(row.max_hp, row.current_hp + delta));

    // updateHealth 同时更新 hp + mp，modifyHealth 只更新 hp，mp 传原值
    await this.characterRepo.updateHealth(saveId, newValue, row.current_mp, trx);

    return { previous, current: newValue, max: row.max_hp };
  }

  async modifyMana(saveId: ID, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number; max: number }> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const previous = row.current_mp;
    const newValue = Math.max(0, Math.min(row.max_mp, row.current_mp + delta));

    // updateHealth 同时更新 hp + mp，modifyMana 只更新 mp，hp 传原值
    await this.characterRepo.updateHealth(saveId, row.current_hp, newValue, trx);

    return { previous, current: newValue, max: row.max_mp };
  }

  /**
   * 修改角色货币（ICharacterService 端口接口实现）。
   * 多货币模型：currencyId 指定货币种类（如 'gold'）。
   * D9: 支持 trx 参数，供跨领域事务调用（如 inventory.tradeItems 事务内更新金币）。
   * 返回更新后的完整货币记录。
   */
  async modifyCurrency(
    saveId: string,
    currencyId: string,
    delta: number,
    trx?: Knex.Transaction,
  ): Promise<Record<string, number>> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const currency = parseJsonField<Record<string, number>>(row.currency, {});
    currency[currencyId] = Math.max(0, (currency[currencyId] ?? 0) + delta);

    await this.characterRepo.updateCurrency(saveId, currency, trx);

    return currency;
  }

  /**
   * 获取角色当前所在地点 ID（S2-1 新增，ICharacterService 端口接口实现）。
   * 覆盖原 MapService.getCurrentLocation 跨领域 characters 查询。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  async getCurrentLocationId(saveId: string, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.characterRepo.findById(saveId, trx);
    return row?.current_location_id ?? null;
  }

  /**
   * 更新角色当前位置（S2-1 新增，ICharacterService 端口接口实现）。
   * 覆盖原 NPCService.moveCharacterTo + quickTravelTo 跨领域 characters 更新。
   * D9: 支持 trx 参数，供事务内跨领域调用（角色+队伍 NPC 位置原子性）。
   */
  async updateLocationId(saveId: string, locationId: string, trx?: Knex.Transaction): Promise<void> {
    await this.characterRepo.updateLocationId(saveId, locationId, trx);
  }

  /**
   * 统计在某地点的角色数量（S2-1 新增，ICharacterService 端口接口实现）。
   * 覆盖原 MapService.deleteLocation 跨领域 characters 计数校验。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  async countCharactersAtLocation(saveId: string, locationId: string, trx?: Knex.Transaction): Promise<number> {
    return this.characterRepo.countBySaveIdAndLocation(saveId, locationId, trx);
  }

  /**
   * 修改角色体力（S2-2 新增，ICharacterService 端口接口实现）。
   * 覆盖原 SkillService.deductResource stamina 分支。
   * stamina 存储在 characters.custom_data.stamina（JSON 字段），下限为 0。
   * D9: 支持 trx 参数，供事务内跨领域调用。
   */
  async modifyStamina(saveId: string, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number }> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const customData = parseJsonField<Record<string, unknown>>(row.custom_data, {});
    const previous = (customData.stamina as number) ?? 0;
    const current = Math.max(0, previous + delta);
    customData.stamina = current;

    await this.characterRepo.updateCustomData(saveId, customData, trx);

    return { previous, current };
  }

  /**
   * 查询角色资源量（S2-2 新增，ICharacterService 端口接口实现）。
   * 一次性读取 current_mp / current_hp / custom_data.stamina / currency，
   * 覆盖原 SkillService.getCurrentResourceAmount 跨领域 characters 查询。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  async getCharacterResources(saveId: string, trx?: Knex.Transaction): Promise<{
    currentMp: number;
    currentHp: number;
    currentStamina: number;
    currency: Record<string, number>;
  }> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) {
      return { currentMp: 0, currentHp: 0, currentStamina: 0, currency: {} };
    }

    const customData = parseJsonField<Record<string, unknown>>(row.custom_data, {});
    const currency = parseJsonField<Record<string, number>>(row.currency, {});

    return {
      currentMp: row.current_mp ?? 0,
      currentHp: row.current_hp ?? 0,
      currentStamina: (customData.stamina as number) ?? 0,
      currency,
    };
  }

  /**
   * 查询角色等级（S2-2 新增，ICharacterService 端口接口实现）。
   * 覆盖原 SkillService.learnSkill 等级前置检查。
   * D9: 支持 trx 参数，供事务内跨领域只读查询使用。
   */
  async getCharacterLevel(saveId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.characterRepo.findById(saveId, trx);
    return row?.level ?? 1;
  }

  /**
   * 增加角色经验值（S3-1 Phase B 新增，ICharacterService 端口接口实现）。
   * 覆盖原 QuestService.grantRewards L860 直接 UPDATE characters.experience。
   * D9: 支持 trx 参数，供 quest grantRewards 事务内调用。
   */
  async grantExperience(saveId: string, delta: number, trx?: Knex.Transaction): Promise<{ previous: number; current: number }> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const previous = row.experience ?? 0;
    const current = Math.max(0, previous + delta);

    await this.characterRepo.updateExperience(saveId, current, trx);

    return { previous, current };
  }

  // === S3-2 新增（combat 跨领域 characters 表读写） ===

  /**
   * 获取角色战斗信息（S3-2 新增，ICharacterService 端口接口实现）。
   * 覆盖 CombatService.startCombat L56-89 直接 SELECT characters。
   * D9: 支持事务参数，供 combat startCombat 事务内只读查询使用。
   */
  async getCharacterCombatInfo(saveId: string, trx?: Knex.Transaction): Promise<CharacterCombatInfo | null> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) return null;
    return {
      characterId: row.id as ID,
      name: row.name,
      level: row.level,
      currentHP: row.current_hp ?? 0,
      maxHP: row.max_hp ?? 0,
      currentMP: row.current_mp ?? 0,
      maxMP: row.max_mp ?? 0,
      attributes: parseJsonField<Record<string, number>>(row.attributes, {}),
      derivedAttributes: parseJsonField<Record<string, number>>(row.derived_attributes, {}),
    };
  }

  /**
   * 设置角色 HP/MP（S3-2 新增，ICharacterService 端口接口实现）。
   * 覆盖 CombatService.finalizeCombat L907-913 直接 UPDATE characters HP/MP。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   */
  async setVitals(saveId: string, hp: number, mp: number, trx?: Knex.Transaction): Promise<void> {
    await this.characterRepo.updateHealth(saveId, hp, mp, trx);
  }

  /**
   * 合并货币到角色现有 currency（S3-2 新增，ICharacterService 端口接口实现）。
   * 覆盖 CombatService.finalizeCombat L923-940 读 currency + 合并 + 更新。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   * 返回合并后的完整货币记录。
   */
  async mergeCurrency(saveId: string, currency: Record<string, number>, trx?: Knex.Transaction): Promise<Record<string, number>> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const currentCurrency = parseJsonField<Record<string, number>>(row.currency, {});
    for (const [key, value] of Object.entries(currency)) {
      currentCurrency[key] = Math.max(0, (currentCurrency[key] ?? 0) + value);
    }

    await this.characterRepo.updateCurrency(saveId, currentCurrency, trx);

    return currentCurrency;
  }

  /**
   * 获取角色状态（S3-2 新增，ICharacterService 端口接口实现）。
   * 覆盖 CombatService.finalizeCombat L944-948 直接 SELECT characters status。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内只读查询使用。
   */
  async getCharacterStatus(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) return {};
    return parseJsonField<Record<string, unknown>>(row.status, {});
  }

  /**
   * 设置角色永久死亡状态（S3-2 新增，ICharacterService 端口接口实现）。
   * 覆盖 CombatService.finalizeCombat L952-957 直接 UPDATE characters status。
   * D9: 支持事务参数，供 combat finalizeCombat 事务内调用。
   */
  async setPermadeath(saveId: string, trx?: Knex.Transaction): Promise<void> {
    const row = await this.characterRepo.findById(saveId, trx);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const currentStatus = parseJsonField<Record<string, unknown>>(row.status, {});
    await this.characterRepo.updateStatus(saveId, { ...currentStatus, permadeath: true }, trx);

    this.logger.info('Character marked as permadeath', { saveId });
  }

  async updateLevel(saveId: ID, newLevel: number): Promise<void> {
    await this.characterRepo.updateLevel(saveId, newLevel);
  }

  async markPermadeath(saveId: ID): Promise<void> {
    const row = await this.characterRepo.findById(saveId);
    if (!row) throw new Error(`Character not found: ${saveId}`);

    const currentStatus = parseJsonField<Record<string, unknown>>(row.status, {});
    await this.characterRepo.updateStatus(saveId, { ...currentStatus, permadeath: true });

    this.logger.info('Character marked as permadeath', { saveId });
  }
}
