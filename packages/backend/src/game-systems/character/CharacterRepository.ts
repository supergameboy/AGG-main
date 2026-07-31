import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import { parseJsonField } from '../../utils/pool-helpers.js';
import type {
  CharacterData,
  CharacterRow,
  ICharacterRepository,
} from './types.js';
import type { Gender, AgeGroup } from '../../../../shared/src/types/game.js';

/**
 * characters 表 Repository 实现（D7: 操作 characters 表）。
 * 从 CharacterService.rowToCharacterData (L573-607) 迁移映射逻辑。
 *
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 * Row 类型单一化：JSON 字段在 Row 中为 string，rowToEntity 负责 JSON.parse。
 */
export class CharacterRepository
  extends BaseRepository<'characters', CharacterData>
  implements ICharacterRepository
{
  constructor(db: Knex) {
    super(db, 'characters');
  }

  protected rowToEntity(row: Record<string, unknown>): CharacterData {
    return {
      id: row.id as ID,
      saveId: row.save_id as ID,
      name: row.name as string,
      gender: (row.gender as Gender) || 'male',
      customGender: (row.custom_gender as string) || undefined,
      ageGroup: (row.age_group as AgeGroup) || undefined,
      race: row.race as string,
      class: row.class as string,
      background: row.background as string,
      level: row.level as number,
      experience: row.experience as number,
      currentLocationId: (row.current_location_id as string) || null,
      attributes: parseJsonField<Record<string, number>>(row.attributes, {}),
      derivedAttributes: parseJsonField<Record<string, number>>(row.derived_attributes, {}),
      currentHP: row.current_hp as number,
      maxHP: row.max_hp as number,
      currentMP: row.current_mp as number,
      maxMP: row.max_mp as number,
      currency: parseJsonField<Record<string, number>>(row.currency, {}),
      status: parseJsonField<Record<string, unknown>>(row.status, {}),
    };
  }

  async findById(saveId: ID, trx?: Knex.Transaction): Promise<CharacterRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .first();
    return (row as unknown as CharacterRow) ?? null;
  }

  async findFullStatusBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<CharacterRow | null> {
    // S4 阶段与 findById 合并（S5 可分化为带 join 的完整状态查询）
    return this.findById(saveId, trx);
  }

  /**
   * 按 saveId 查询并返回已映射的 CharacterData 实体。
   * Service 层使用此方法获取已映射实体，无需重复 rowToEntity 映射逻辑。
   */
  async findEntityBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<CharacterData | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .first();
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async findBySaveIdWithNames(saveId: ID, names?: string[], trx?: Knex.Transaction): Promise<CharacterRow[]> {
    const query = this.query(trx).where({ save_id: saveId });
    if (names && names.length > 0) {
      query.whereIn('name', names);
    }
    const rows = await query.select();
    return rows as unknown as CharacterRow[];
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId })
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  async countBySaveIdAndLocation(saveId: ID, locationId: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId, current_location_id: locationId })
      .count('id as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  /**
   * 全字段插入（CharacterService.createCharacter 使用）。
   * 接受 Omit<Row, 'created_at' | 'updated_at'> + 可选 created_at/updated_at，
   * Repository 内部填充默认时间戳。
   */
  async insert(row: Omit<CharacterRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }, trx?: Knex.Transaction): Promise<void> {
    const now = Date.now();
    await this.query(trx).insert({
      ...row,
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
    });
  }

  async updateCurrency(saveId: ID, currency: Record<string, unknown>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        currency: JSON.stringify(currency),
        updated_at: Date.now(),
      });
  }

  async updateHealth(saveId: ID, currentHp: number, currentMp: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        current_hp: currentHp,
        current_mp: currentMp,
        updated_at: Date.now(),
      });
  }

  /**
   * 更新 attributes + derived_attributes（同时更新两者，用于 CharacterService.updateAttributes 调用 recalculateDerivedAttributes 之后回写）。
   */
  async updateAttributes(
    saveId: ID,
    attributes: Record<string, unknown>,
    derivedAttributes: Record<string, unknown>,
    trx?: Knex.Transaction
  ): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        attributes: JSON.stringify(attributes),
        derived_attributes: JSON.stringify(derivedAttributes),
        updated_at: Date.now(),
      });
  }

  /**
   * 更新派生属性相关字段（NumericalService.recalculateDerivedAttributes 使用）。
   * 一次更新 5-7 字段：derived_attributes + max_hp + max_mp + base_max_hp + base_max_mp + 可选 current_hp + current_mp。
   * 当 currentHp/currentMp 未传时，不更新这两个字段（保持原值，由调用方控制）。
   */
  async updateDerivedAttributes(
    saveId: ID,
    derivedAttributes: Record<string, unknown>,
    maxHp: number,
    maxMp: number,
    baseMaxHp: number,
    baseMaxMp: number,
    currentHp?: number,
    currentMp?: number,
    trx?: Knex.Transaction
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      derived_attributes: JSON.stringify(derivedAttributes),
      max_hp: maxHp,
      max_mp: maxMp,
      base_max_hp: baseMaxHp,
      base_max_mp: baseMaxMp,
      updated_at: Date.now(),
    };
    if (currentHp !== undefined) patch.current_hp = currentHp;
    if (currentMp !== undefined) patch.current_mp = currentMp;
    await this.query(trx).where({ save_id: saveId }).update(patch);
  }

  /**
   * 更新 attributes + base_max_hp + base_max_mp（CharacterService.updateAttributes + NumericalService.processLevelUp 使用）。
   * 不更新 derived_attributes（由调用方后续调用 recalculateDerivedAttributes 单独处理）。
   */
  async updateBaseAttributes(
    saveId: ID,
    attributes: Record<string, unknown>,
    baseMaxHp: number,
    baseMaxMp: number,
    trx?: Knex.Transaction
  ): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        attributes: JSON.stringify(attributes),
        base_max_hp: baseMaxHp,
        base_max_mp: baseMaxMp,
        updated_at: Date.now(),
      });
  }

  async updateLevelAndExp(saveId: ID, level: number, exp: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        level,
        experience: exp,
        updated_at: Date.now(),
      });
  }

  async updateLevel(saveId: ID, level: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        level,
        updated_at: Date.now(),
      });
  }

  async updateExperience(saveId: ID, experience: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        experience,
        updated_at: Date.now(),
      });
  }

  async updateLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        current_location_id: locationId,
        updated_at: Date.now(),
      });
  }

  async updateStatus(saveId: ID, status: Record<string, unknown>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        status: JSON.stringify(status),
        updated_at: Date.now(),
      });
  }

  async updateCustomData(saveId: ID, customData: Record<string, unknown>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        custom_data: JSON.stringify(customData),
        updated_at: Date.now(),
      });
  }

  async updateFields(saveId: ID, patch: Record<string, unknown>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        ...patch,
        updated_at: Date.now(),
      });
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  // === S6 新增（StoryKernel 跨领域 characters 表只读查询） ===

  async getResourceStatus(
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<{ hp: number; max_hp: number; mp: number; max_mp: number; gold: number } | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .select('current_hp', 'max_hp', 'current_mp', 'max_mp', 'currency')
      .first();

    if (!row) return null;

    const currencyRaw = (row as Record<string, unknown>).currency;
    let gold = 0;
    if (typeof currencyRaw === 'string') {
      try {
        const currency = JSON.parse(currencyRaw) as Record<string, number>;
        gold = currency.gold ?? 0;
      } catch {
        gold = 0;
      }
    } else if (currencyRaw && typeof currencyRaw === 'object') {
      gold = (currencyRaw as Record<string, number>).gold ?? 0;
    }

    return {
      hp: (row.current_hp as number) ?? 0,
      max_hp: (row.max_hp as number) ?? 100,
      mp: (row.current_mp as number) ?? 0,
      max_mp: (row.max_mp as number) ?? 100,
      gold,
    };
  }
}
