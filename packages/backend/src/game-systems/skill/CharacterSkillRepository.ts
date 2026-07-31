import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { mapCharacterSkillRow } from './mappers.js';
import type { ICharacterSkillRepository, CharacterSkill, OwnerType } from './types.js';

/**
 * character_skills 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 SkillService 多处 db('character_skills') 调用收敛而来，统一封装:
 * - row → CharacterSkill 映射（共享 mappers.mapCharacterSkillRow）
 * - CRUD + 6 个查询方法 + 2 个批量更新方法
 * - D9 trx 透传（事务内调用透传 trx 参数）
 */
export class CharacterSkillRepository
  extends BaseRepository<'character_skills', CharacterSkill>
  implements ICharacterSkillRepository
{
  constructor(db: Knex) {
    super(db, 'character_skills');
  }

  protected rowToEntity(row: Record<string, unknown>): CharacterSkill {
    return mapCharacterSkillRow(row);
  }

  /**
   * entity → row 转换（insert 共用）。
   * JSON 字段（cost/effects/customData）需 JSON.stringify。
   * 布尔字段（unlocked/visible）转 0/1 整数。
   * pool_id 字段在原代码中与 skill_id 相同（指向 skill_pool.id），保持一致。
   */
  private entityToRow(entity: Omit<CharacterSkill, 'id'> & { id?: ID }): Record<string, unknown> {
    const row: Record<string, unknown> = {
      save_id: entity.saveId,
      skill_id: entity.skillId,
      name: entity.name,
      description: entity.description,
      level: entity.level,
      max_level: entity.maxLevel,
      experience: entity.experience,
      cooldown_remaining: entity.cooldownRemaining,
      category: entity.category,
      element: entity.element,
      cost: JSON.stringify(entity.cost ?? []),
      effects: JSON.stringify(entity.effects ?? {}),
      custom_data: JSON.stringify(entity.customData ?? {}),
      unlocked: entity.unlocked ? 1 : 0,
      visible: entity.visible ? 1 : 0,
      owner_type: entity.ownerType,
      owner_id: entity.ownerId,
      consecutive_uses: entity.consecutiveUses ?? 0,
      last_used_at: entity.lastUsedAt ?? 0,
      pool_id: entity.skillId,
    };
    if (entity.id !== undefined) row.id = entity.id;
    return row;
  }

  /**
   * patch → row 转换（update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   */
  private patchToRow(patch: Partial<CharacterSkill>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.level !== undefined) row.level = patch.level;
    if (patch.maxLevel !== undefined) row.max_level = patch.maxLevel;
    if (patch.experience !== undefined) row.experience = patch.experience;
    if (patch.cooldownRemaining !== undefined) row.cooldown_remaining = patch.cooldownRemaining;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.element !== undefined) row.element = patch.element;
    if (patch.cost !== undefined) row.cost = JSON.stringify(patch.cost);
    if (patch.effects !== undefined) row.effects = JSON.stringify(patch.effects);
    if (patch.customData !== undefined) row.custom_data = JSON.stringify(patch.customData);
    if (patch.unlocked !== undefined) row.unlocked = patch.unlocked ? 1 : 0;
    if (patch.visible !== undefined) row.visible = patch.visible ? 1 : 0;
    if (patch.ownerType !== undefined) row.owner_type = patch.ownerType;
    if (patch.ownerId !== undefined) row.owner_id = patch.ownerId;
    if (patch.consecutiveUses !== undefined) row.consecutive_uses = patch.consecutiveUses;
    if (patch.lastUsedAt !== undefined) row.last_used_at = patch.lastUsedAt;

    return row;
  }

  async findBySaveId(
    saveId: ID,
    options?: { visibility?: string; ownerType?: OwnerType; ownerId?: string },
    trx?: Knex.Transaction
  ): Promise<CharacterSkill[]> {
    // §13.3 数据归属保守处理：ownerType 与 ownerId 必须成对提供，禁止只传 ownerType 不传 ownerId
    if (options?.ownerType && !options?.ownerId) {
      throw new Error(
        `CharacterSkillRepository.findBySaveId: ownerType provided without ownerId (saveId=${saveId}, ownerType=${options.ownerType}). ` +
        `Use findBySaveIdAndOwnerType for ownerType-only queries, or provide both ownerType and ownerId.`
      );
    }

    let query = this.query(trx).where({ save_id: saveId });

    if (options?.ownerType && options?.ownerId) {
      query = query.where({ owner_type: options.ownerType, owner_id: options.ownerId });
    }

    const rows = await query.orderBy('created_at', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  /**
   * 按 saveId + ownerType 查询（不限定 ownerId）。
   * 与 InventoryRepository.findBySaveIdAndOwnerType 对称，用于 DataRefreshHandler 面板刷新。
   * 期望效果：返回该 saveId 下所有指定 ownerType 的技能记录（含多个 character/NPC 的合并视图）。
   * D9: 支持可选 trx 参数。
   */
  async findBySaveIdAndOwnerType(
    saveId: ID,
    ownerType: OwnerType,
    trx?: Knex.Transaction
  ): Promise<CharacterSkill[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, owner_type: ownerType })
      .orderBy('created_at', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(
    saveId: ID,
    skillId: string,
    options?: { ownerType?: string; ownerId?: string },
    trx?: Knex.Transaction
  ): Promise<CharacterSkill | null> {
    // §13.3 数据归属保守处理：ownerType 与 ownerId 必须成对提供
    if (options?.ownerType && !options?.ownerId) {
      throw new Error(
        `CharacterSkillRepository.findById: ownerType provided without ownerId (saveId=${saveId}, skillId=${skillId}, ownerType=${options.ownerType}). ` +
        `Provide both ownerType and ownerId, or omit both.`
      );
    }

    let query = this.query(trx).where({ save_id: saveId, id: skillId });

    if (options?.ownerType && options?.ownerId) {
      query = query.where({ owner_type: options.ownerType, owner_id: options.ownerId });
    }

    const row = await query.first();
    return row ? this.rowToEntity(row) : null;
  }

  async findBySkillIdOrName(
    skillIdOrName: string,
    saveId: ID,
    options?: { ownerType?: string; ownerId?: string },
    trx?: Knex.Transaction
  ): Promise<CharacterSkill | null> {
    // §13.3 数据归属保守处理：ownerType 与 ownerId 必须成对提供
    if (options?.ownerType && !options?.ownerId) {
      throw new Error(
        `CharacterSkillRepository.findBySkillIdOrName: ownerType provided without ownerId (saveId=${saveId}, skillIdOrName=${skillIdOrName}, ownerType=${options.ownerType}). ` +
        `Provide both ownerType and ownerId, or omit both.`
      );
    }

    const ownerFilter = options?.ownerType && options?.ownerId
      ? { owner_type: options.ownerType, owner_id: options.ownerId }
      : {};

    // 1. 按记录 id 精确匹配
    const byId = await this.query(trx)
      .where({ id: skillIdOrName, save_id: saveId, ...ownerFilter })
      .first();
    if (byId) return this.rowToEntity(byId);

    // 2. 按 skill_id 精确匹配
    const bySkillId = await this.query(trx)
      .where({ skill_id: skillIdOrName, save_id: saveId, ...ownerFilter })
      .first();
    if (bySkillId) return this.rowToEntity(bySkillId);

    // 3. 按 name 精确匹配
    const byName = await this.query(trx)
      .where({ save_id: saveId, name: skillIdOrName, ...ownerFilter })
      .first();
    return byName ? this.rowToEntity(byName) : null;
  }

  /**
   * M12: 按 skill_id 或 name 查询所有 owner 的匹配记录（通配符查询支持）。
   * 与 findBySkillIdOrName 的区别：不限定 owner，返回所有 owner 的数组。
   * 查询顺序: id → skill_id → name（与 findBySkillIdOrName 一致）
   */
  async findAllBySkillIdOrName(
    skillIdOrName: string,
    saveId: ID,
    trx?: Knex.Transaction
  ): Promise<CharacterSkill[]> {
    // 1. 按记录 id 精确匹配（id 唯一，最多一条）
    const byId = await this.query(trx)
      .where({ id: skillIdOrName, save_id: saveId })
      .first();
    if (byId) return [this.rowToEntity(byId)];

    // 2. 按 skill_id 匹配（可能多个 owner 拥有同 skill_id）
    const bySkillId = await this.query(trx)
      .where({ skill_id: skillIdOrName, save_id: saveId });
    if (bySkillId.length > 0) return bySkillId.map((row: Record<string, unknown>) => this.rowToEntity(row));

    // 3. 按 name 匹配（可能多个 owner 拥有同名技能）
    const byName = await this.query(trx)
      .where({ save_id: saveId, name: skillIdOrName });
    return byName.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findLearnedBySaveIdAndSkillId(
    saveId: ID,
    skillId: string,
    ownerType?: string,
    ownerId?: string,
    trx?: Knex.Transaction
  ): Promise<CharacterSkill | null> {
    let query = this.query(trx).where({ save_id: saveId, skill_id: skillId });

    if (ownerType && ownerId) {
      query = query.where({ owner_type: ownerType, owner_id: ownerId });
    }

    const row = await query.first();
    return row ? this.rowToEntity(row) : null;
  }

  async findWithActiveCooldown(saveId: ID, trx?: Knex.Transaction): Promise<CharacterSkill[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .where('cooldown_remaining', '>', 0);
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findWeightCooldownExpired(saveId: ID, trx?: Knex.Transaction): Promise<CharacterSkill[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .where('consecutive_uses', '>', 0)
      .where('cooldown_remaining', 0);
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(skill: Omit<CharacterSkill, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<CharacterSkill> {
    const id = (skill.id ?? generateReadableId('skill', skill.name)) as ID;
    const now = Date.now() as Timestamp;
    const row = this.entityToRow({ ...skill, id });

    await this.query(trx).insert({
      ...row,
      id,
      created_at: now,
      updated_at: now,
    });

    const inserted = await this.query(trx).where({ id, save_id: skill.saveId }).first();
    return this.rowToEntity(inserted);
  }

  async update(
    saveId: ID,
    skillId: string,
    patch: Partial<CharacterSkill>,
    options?: { ownerType?: string; ownerId?: string },
    trx?: Knex.Transaction
  ): Promise<CharacterSkill | null> {
    const row = this.patchToRow(patch);
    row.updated_at = Date.now() as Timestamp;

    let query = this.query(trx).where({ save_id: saveId, id: skillId });
    if (options?.ownerType && options?.ownerId) {
      query = query.where({ owner_type: options.ownerType, owner_id: options.ownerId });
    }

    await query.update(row);

    const updated = await this.query(trx).where({ save_id: saveId, id: skillId }).first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async updateCooldowns(
    saveId: ID,
    updates: Array<{ skillId: string; cooldownRemaining: number; ownerType?: string; ownerId?: string }>,
    trx?: Knex.Transaction
  ): Promise<number> {
    let count = 0;
    for (const update of updates) {
      let query = this.query(trx).where({ save_id: saveId, id: update.skillId });
      if (update.ownerType && update.ownerId) {
        query = query.where({ owner_type: update.ownerType, owner_id: update.ownerId });
      }
      const result = await query.update({
        cooldown_remaining: update.cooldownRemaining,
        updated_at: Date.now() as Timestamp,
      });
      count += result;
    }
    return count;
  }

  async updateWeightCooldown(
    saveId: ID,
    skillId: string,
    patch: { consecutiveUses?: number; lastUsedAt?: number; cooldownRemaining?: number; customData?: Record<string, unknown> },
    trx?: Knex.Transaction
  ): Promise<void> {
    const row: Record<string, unknown> = { updated_at: Date.now() as Timestamp };

    if (patch.consecutiveUses !== undefined) row.consecutive_uses = patch.consecutiveUses;
    if (patch.lastUsedAt !== undefined) row.last_used_at = patch.lastUsedAt;
    if (patch.cooldownRemaining !== undefined) row.cooldown_remaining = patch.cooldownRemaining;
    if (patch.customData !== undefined) row.custom_data = JSON.stringify(patch.customData);

    await this.query(trx)
      .where({ save_id: saveId, id: skillId })
      .update(row);
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
