import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { npcRowToProfile } from './mappers.js';
import type { INPCRepository, NPCProfile } from './types.js';

/**
 * npcs 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 NPCService 33 处 db('npcs') 调用收敛而来，统一封装:
 * - row → NPCProfile 映射（共享 mappers.npcRowToProfile）
 * - 11 个查询方法 + 6 个写入方法
 * - D9 trx 透传（事务内调用透传 trx 参数）
 *
 * 派生字段（relation/visibility）存储在 custom_data 中，不直接持久化，
 * 由 mappers.npcRowToProfile 从 customData 读取。
 */
export class NPCRepository
  extends BaseRepository<'npcs', NPCProfile>
  implements INPCRepository
{
  constructor(db: Knex) {
    super(db, 'npcs');
  }

  protected rowToEntity(row: Record<string, unknown>): NPCProfile {
    return npcRowToProfile(row);
  }

  /**
   * entity → row 转换（insert/update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   * JSON 字段需 JSON.stringify。派生字段（relation/visibility）不持久化。
   */
  private entityToRow(entity: Partial<NPCProfile>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.templateNpcId !== undefined) row.template_npc_id = entity.templateNpcId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.title !== undefined) row.title = entity.title;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.role !== undefined) row.role = entity.role;
    if (entity.race !== undefined) row.race = entity.race;
    if (entity.locationId !== undefined) row.location_id = entity.locationId;
    if (entity.level !== undefined) row.level = entity.level;
    if (entity.services !== undefined) row.services = JSON.stringify(entity.services ?? []);
    if (entity.dialogueHistory !== undefined) row.dialogue_history = JSON.stringify(entity.dialogueHistory ?? []);
    if (entity.inParty !== undefined) row.in_party = entity.inParty ? 1 : 0;
    if (entity.joinedPartyAt !== undefined) row.joined_party_at = entity.joinedPartyAt;
    if (entity.reputation !== undefined) row.reputation = entity.reputation;
    if (entity.mood !== undefined) row.mood = entity.mood;
    if (entity.visible !== undefined) row.visible = entity.visible ? 1 : 0;
    if (entity.attrInitialized !== undefined) row.attr_initialized = entity.attrInitialized ? 1 : 0;
    if (entity.invInitialized !== undefined) row.inv_initialized = entity.invInitialized ? 1 : 0;
    if (entity.skillInitialized !== undefined) row.skill_initialized = entity.skillInitialized ? 1 : 0;
    if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData ?? {});
    if (entity.currency !== undefined) row.currency = JSON.stringify(entity.currency ?? {});
    if (entity.attributes !== undefined) row.attributes = JSON.stringify(entity.attributes ?? {});
    if (entity.derivedAttributes !== undefined) row.derived_attributes = JSON.stringify(entity.derivedAttributes ?? {});
    if (entity.currentHp !== undefined) row.current_hp = entity.currentHp;
    if (entity.maxHp !== undefined) row.max_hp = entity.maxHp;
    if (entity.currentMp !== undefined) row.current_mp = entity.currentMp;
    if (entity.maxMp !== undefined) row.max_mp = entity.maxMp;

    return row;
  }

  async findBySaveId(
    saveId: ID,
    options?: { visibility?: 'all' | 'visible' | 'hidden' },
    trx?: Knex.Transaction,
  ): Promise<NPCProfile[]> {
    const query = this.query(trx).where({ save_id: saveId }).select('*');

    const visibility = options?.visibility;
    if (visibility === 'visible') {
      query.where({ visible: 1 });
    } else if (visibility === 'hidden') {
      query.where({ visible: 0 });
    } else if (visibility !== 'all') {
      // 默认只返回可见 NPC（与原 listNPCs 行为一致）
      query.where({ visible: 1 });
    }

    const rows = await query.orderBy('name', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(npcId: ID, saveId: ID, trx?: Knex.Transaction): Promise<NPCProfile | null> {
    const row = await this.query(trx)
      .where({ id: npcId, save_id: saveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<NPCProfile | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByTemplateNpcId(saveId: ID, templateNpcId: string, trx?: Knex.Transaction): Promise<NPCProfile | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, template_npc_id: templateNpcId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByNameContaining(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<NPCProfile[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereRaw('name LIKE ?', [`%${namePattern}%`])
      .select('*');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByIds(npcIds: ID[], trx?: Knex.Transaction): Promise<NPCProfile[]> {
    if (npcIds.length === 0) return [];
    const rows = await this.query(trx)
      .whereIn('id', npcIds)
      .select('*');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findNamesByIds(npcIds: ID[], trx?: Knex.Transaction): Promise<Map<ID, string>> {
    if (npcIds.length === 0) return new Map();
    const rows = await this.query(trx)
      .whereIn('id', npcIds)
      .select('id', 'name');
    return new Map(rows.map((r: { id: string; name: string }) => [r.id as ID, r.name]));
  }

  async findSummariesByLocationIds(
    saveId: ID,
    locationIds: ID[],
    trx?: Knex.Transaction,
  ): Promise<Array<{
    id: string;
    name: string;
    role: string;
    locationId: string;
    services: string | null;
    reputation: number;
    mood: string | null;
    inParty: boolean;
    title: string | null;
  }>> {
    if (locationIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('location_id', locationIds)
      .select('id', 'name', 'role', 'location_id', 'services', 'reputation', 'mood', 'in_party', 'title');
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      role: r.role as string,
      locationId: r.location_id as string,
      services: (r.services as string) ?? null,
      reputation: (r.reputation as number) ?? 0,
      mood: (r.mood as string) ?? null,
      inParty: Boolean(r.in_party),
      title: (r.title as string) ?? null,
    }));
  }

  async findPartyMembers(saveId: ID, trx?: Knex.Transaction): Promise<NPCProfile[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, in_party: 1 })
      .select('*')
      .orderBy('joined_party_at', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findPartyMemberIds(saveId: ID, trx?: Knex.Transaction): Promise<ID[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, in_party: 1 })
      .select('id');
    return rows.map((r: { id: string }) => r.id as ID);
  }

  async findByLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<NPCProfile[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, location_id: locationId })
      .select('*')
      .orderBy('name', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(npc: Omit<NPCProfile, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<NPCProfile> {
    const id = (npc.id || generateReadableId('npc', npc.name || 'unknown')) as ID;
    const now = Date.now() as Timestamp;
    const row = this.entityToRow(npc);

    await this.query(trx).insert({
      ...row,
      id,
      save_id: npc.saveId,
      created_at: now,
      updated_at: now,
    });

    const inserted = await this.query(trx).where({ id, save_id: npc.saveId }).first();
    return this.rowToEntity(inserted);
  }

  async update(
    npcId: ID,
    saveId: ID,
    patch: Partial<NPCProfile>,
    trx?: Knex.Transaction,
  ): Promise<NPCProfile | null> {
    const row = this.entityToRow(patch);
    await this.query(trx)
      .where({ save_id: saveId, id: npcId })
      .update({ ...row, updated_at: Date.now() as Timestamp });
    const updated = await this.query(trx).where({ save_id: saveId, id: npcId }).first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async updateLocationForNpcs(
    saveId: ID,
    npcIds: ID[],
    locationId: ID,
    trx?: Knex.Transaction,
  ): Promise<number> {
    if (npcIds.length === 0) return 0;
    return await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('id', npcIds)
      .update({ location_id: locationId, updated_at: Date.now() as Timestamp });
  }

  async updateCustomData(
    npcId: ID,
    saveId: ID,
    customData: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<NPCProfile | null> {
    return await this.update(npcId, saveId, { customData }, trx);
  }

  async updateInitFlag(
    npcId: ID,
    saveId: ID,
    field: 'attrInitialized' | 'invInitialized' | 'skillInitialized',
    trx?: Knex.Transaction,
  ): Promise<void> {
    const column = INIT_FLAG_COLUMN_MAP[field];
    await this.query(trx)
      .where({ save_id: saveId, id: npcId })
      .update({ [column]: 1, updated_at: Date.now() as Timestamp });
  }

  async findInitFlag(
    npcId: ID,
    saveId: ID,
    field: 'attrInitialized' | 'invInitialized' | 'skillInitialized',
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const column = INIT_FLAG_COLUMN_MAP[field];
    const row = await this.query(trx)
      .where({ save_id: saveId, id: npcId })
      .first(column);
    return Boolean(row?.[column]);
  }

  async delete(npcId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean> {
    const count = await this.query(trx)
      .where({ save_id: saveId, id: npcId })
      .del();
    return count > 0;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }
}

/** NPCProfile 初始化标记字段 → 数据库列名映射 */
const INIT_FLAG_COLUMN_MAP: Record<'attrInitialized' | 'invInitialized' | 'skillInitialized', string> = {
  attrInitialized: 'attr_initialized',
  invInitialized: 'inv_initialized',
  skillInitialized: 'skill_initialized',
};
